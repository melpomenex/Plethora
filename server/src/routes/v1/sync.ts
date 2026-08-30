import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { requireCloudSync } from '../../middleware/requireCloudSync.js';
import { maybeOffloadSyncPayload, hydrateSyncPayload } from '../../sync/blobStorage.js';
import {
  assertDeviceAllowed,
  assertSyncEpoch,
  assertSyncProtocolVersion,
  minDeviceCursorSeq,
  nextEntityRevision,
  normalizeSyncPullRow,
  paginatePull,
  shouldConflict,
  SYNC_HLC_PATTERN,
  SYNC_OPERATIONS,
  SYNC_PROTOCOL_VERSION,
  SYNC_TABLE_KINDS,
  TOMBSTONE_RETENTION_DAYS,
} from '../../sync/pushPullLogic.js';

export const syncRouter = Router();

syncRouter.use(authMiddleware, requireCloudSync);

const MAX_CIPHERTEXT_BYTES = 5 * 1024 * 1024;

export const SyncRecordSchema = z.object({
  tableKind: z.enum(SYNC_TABLE_KINDS),
  recordId: z.string().min(1).max(255),
  hlc: z.string().regex(SYNC_HLC_PATTERN).max(100),
  deviceId: z.string().uuid(),
  payloadCiphertext: z.string().min(1).max(MAX_CIPHERTEXT_BYTES),
  aad: z.string().min(1).max(500),
  keyVersion: z.number().int().positive().default(1),
  changeId: z.string().min(1).max(255).optional(),
  operation: z.enum(SYNC_OPERATIONS).optional(),
  baseRevision: z.number().int().nonnegative().optional(),
});

const PushPayloadSchema = z.object({
  records: z.array(SyncRecordSchema).max(500),
});

function looksLikePlaintextEnvelope(ciphertext: string): boolean {
  try {
    const decoded = Buffer.from(ciphertext, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded) as { payload_b64?: unknown };
    return typeof parsed === 'object' && parsed !== null && 'payload_b64' in parsed;
  } catch {
    return false;
  }
}

function readProtocolVersion(req: AuthRequest): void {
  try {
    assertSyncProtocolVersion(req.header('x-plethora-sync-protocol-version'));
  } catch (error) {
    const err = error as Error & { statusCode?: number; code?: string };
    throw new AppError(err.statusCode || 400, err.code || 'unsupported_sync_protocol', err.message);
  }
}

async function upsertDeviceCursor(
  userId: string,
  deviceId: string,
  lastSeq: number
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO sync_device_cursors (user_id, device_id, last_seq, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, device_id)
     DO UPDATE SET last_seq = GREATEST(sync_device_cursors.last_seq, EXCLUDED.last_seq), updated_at = NOW()`,
    [userId, deviceId, lastSeq]
  );
}

function authenticatedDeviceId(req: AuthRequest): string {
  if (!req.deviceId) {
    throw new AppError(403, 'device_identity_required', 'An authenticated device identity is required for sync');
  }
  return req.deviceId;
}

async function registerDeviceCursor(userId: string, deviceId: string): Promise<void> {
  const pool = getPool();
  // Cursor rows keyed by ids the account never issued are leftovers from the
  // pre-identity protocol (or from deleted devices). They would permanently
  // pin tombstone GC at their stale seq and consume the device budget, so drop
  // them before enforcing limits. devices.id is UUID while device_id is
  // VARCHAR: Postgres has no varchar = uuid operator, so compare as text or
  // every push/pull/ack fails with "operator does not exist".
  await pool.query(
    `DELETE FROM sync_device_cursors
     WHERE user_id = $1
       AND device_id <> $2
       AND device_id NOT IN (SELECT id::text FROM devices WHERE user_id = $1)`,
    [userId, deviceId]
  );
  const rows = await pool.query(
    'SELECT device_id FROM sync_device_cursors WHERE user_id = $1',
    [userId]
  );
  const knownDevices = rows.rows.map((row) => String(row.device_id));
  try {
    assertDeviceAllowed(knownDevices, deviceId);
  } catch (error) {
    const err = error as Error & { statusCode?: number; code?: string };
    throw new AppError(err.statusCode || 403, err.code || 'device_limit_reached', err.message);
  }
  await pool.query(
    `INSERT INTO sync_device_cursors (user_id, device_id, last_seq, updated_at)
     VALUES ($1, $2, 0, NOW())
     ON CONFLICT (user_id, device_id) DO NOTHING`,
    [userId, deviceId]
  );
}

async function collectEligibleTombstones(userId: string): Promise<void> {
  const pool = getPool();
  const cursorRows = await pool.query(
    'SELECT last_seq FROM sync_device_cursors WHERE user_id = $1',
    [userId]
  );
  const minSeq = minDeviceCursorSeq(cursorRows.rows);
  if (minSeq > 0) {
    await pool.query(
      `DELETE FROM sync_records
       WHERE user_id = $1
         AND seq_number <= $2
         AND table_kind IN ('tombstones', 'tombstone')
         AND created_at < NOW() - INTERVAL '${TOMBSTONE_RETENTION_DAYS} days'`,
      [userId, minSeq]
    );
  }
}

async function getAccountSyncEpoch(userId: string): Promise<number> {
  const pool = getPool();
  const row = await pool.query('SELECT sync_key_epoch FROM users WHERE id = $1', [userId]);
  return Number(row.rows[0]?.sync_key_epoch || 1);
}

async function incrementAccountSyncEpoch(userId: string): Promise<number> {
  const pool = getPool();
  const row = await pool.query(
    `UPDATE users SET sync_key_epoch = sync_key_epoch + 1, updated_at = NOW()
     WHERE id = $1
     RETURNING sync_key_epoch`,
    [userId]
  );
  return Number(row.rows[0]?.sync_key_epoch || 1);
}

async function loadRevokedSyncDevices(userId: string): Promise<Set<string>> {
  const pool = getPool();
  const rows = await pool.query(
    'SELECT sync_device_id FROM sync_revoked_devices WHERE user_id = $1',
    [userId]
  );
  return new Set(rows.rows.map((row) => String(row.sync_device_id)));
}

// POST /v1/sync/push
syncRouter.post('/push', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const parse = PushPayloadSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid sync push payload');
    }
    const { records } = parse.data;
    const userId = req.userId!;
    const deviceId = authenticatedDeviceId(req);
    const pool = getPool();
    const accountEpoch = await getAccountSyncEpoch(userId);
    const revokedDevices = await loadRevokedSyncDevices(userId);

    if (revokedDevices.has(deviceId)) {
      throw new AppError(403, 'device_revoked', 'Sync device has been revoked');
    }
    await registerDeviceCursor(userId, deviceId);
    for (const rec of records) {
      if (rec.deviceId !== deviceId) {
        throw new AppError(403, 'device_identity_mismatch', 'Sync record deviceId does not match the authenticated device');
      }
    }

    let accepted = 0;
    let latestSeq = 0;
    const conflicts: Array<{
      changeId: string;
      entityType: string;
      entityId: string;
      serverRevision: number;
      baseRevision: number;
    }> = [];

    for (const rec of records) {
      if (looksLikePlaintextEnvelope(rec.payloadCiphertext)) {
        throw new AppError(400, 'validation_error', 'Plaintext sync payloads are not accepted');
      }

      try {
        assertSyncEpoch(rec.keyVersion, accountEpoch);
      } catch (error) {
        const err = error as Error & { statusCode?: number; code?: string };
        throw new AppError(err.statusCode || 403, err.code || 'stale_key_epoch', err.message);
      }

      if (rec.changeId) {
        const processed = await pool.query(
          'SELECT 1 FROM processed_changes WHERE user_id = $1 AND change_id = $2',
          [userId, rec.changeId]
        );
        if (processed.rows.length > 0) {
          const existingSeq = await pool.query(
            'SELECT seq_number FROM sync_records WHERE user_id = $1 AND device_id = $2 AND hlc = $3',
            [userId, rec.deviceId, rec.hlc]
          );
          if (existingSeq.rows.length > 0) {
            latestSeq = Math.max(latestSeq, Number(existingSeq.rows[0].seq_number));
          }
          continue;
        }
      }

      const existing = await pool.query(
        'SELECT seq_number FROM sync_records WHERE user_id = $1 AND device_id = $2 AND hlc = $3',
        [userId, rec.deviceId, rec.hlc]
      );

      if (existing.rows.length > 0) {
        latestSeq = Math.max(latestSeq, Number(existing.rows[0].seq_number));
        if (rec.changeId) {
          await pool.query(
            'INSERT INTO processed_changes (user_id, change_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, rec.changeId]
          );
        }
        continue;
      }

      // Large ciphertext is offloaded before taking a DB lock. The critical
      // acceptance path below is otherwise a single transaction so a crash
      // cannot leave a record without its revision/idempotency/cursor state.
      const id = uuidv4();
      const offloaded = await maybeOffloadSyncPayload(userId, id, rec.payloadCiphertext);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Ensure there is a row to lock even for a brand-new entity, then
        // serialize concurrent writers of the same logical entity.
        await client.query(
          `INSERT INTO entity_revisions (user_id, entity_type, entity_id, revision, updated_at)
           VALUES ($1, $2, $3, 0, NOW())
           ON CONFLICT (user_id, entity_type, entity_id) DO NOTHING`,
          [userId, rec.tableKind, rec.recordId]
        );
        const lockedRevision = await client.query(
          `SELECT revision FROM entity_revisions
           WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3
           FOR UPDATE`,
          [userId, rec.tableKind, rec.recordId]
        );
        const serverRevision = Number(lockedRevision.rows[0]?.revision || 0);

        // Re-check idempotency while holding the entity lock. The earlier
        // checks are only fast paths; these are authoritative under races.
        if (rec.changeId) {
          const processed = await client.query(
            'SELECT 1 FROM processed_changes WHERE user_id = $1 AND change_id = $2',
            [userId, rec.changeId]
          );
          if (processed.rows.length > 0) {
            const existingSeq = await client.query(
              `SELECT seq_number FROM sync_records
               WHERE user_id = $1 AND (change_id = $2 OR (device_id = $3 AND hlc = $4))
               ORDER BY seq_number DESC LIMIT 1`,
              [userId, rec.changeId, rec.deviceId, rec.hlc]
            );
            if (existingSeq.rows.length > 0) {
              latestSeq = Math.max(latestSeq, Number(existingSeq.rows[0].seq_number));
            }
            await client.query('COMMIT');
            continue;
          }
        }

        const existing = await client.query(
          'SELECT seq_number FROM sync_records WHERE user_id = $1 AND device_id = $2 AND hlc = $3',
          [userId, rec.deviceId, rec.hlc]
        );
        if (existing.rows.length > 0) {
          latestSeq = Math.max(latestSeq, Number(existing.rows[0].seq_number));
          if (rec.changeId) {
            await client.query(
              'INSERT INTO processed_changes (user_id, change_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [userId, rec.changeId]
            );
          }
          await client.query('COMMIT');
          continue;
        }

        if (shouldConflict(rec.baseRevision, serverRevision)) {
          if (rec.changeId) {
            conflicts.push({
              changeId: rec.changeId,
              entityType: rec.tableKind,
              entityId: rec.recordId,
              serverRevision,
              baseRevision: rec.baseRevision ?? 0,
            });
          }
          await client.query('ROLLBACK');
          continue;
        }

        const nextRevision = nextEntityRevision(serverRevision);
        const insertRes = await client.query(
          `INSERT INTO sync_records (
             id, user_id, table_kind, record_id, hlc, device_id,
             payload_ciphertext, aad, key_version, blob_storage_key,
             change_id, operation, base_revision, entity_revision, created_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
           ON CONFLICT DO NOTHING
           RETURNING seq_number`,
          [
            id,
            userId,
            rec.tableKind,
            rec.recordId,
            rec.hlc,
            rec.deviceId,
            offloaded.payloadCiphertext || ' ',
            rec.aad,
            rec.keyVersion,
            offloaded.blobStorageKey,
            rec.changeId ?? null,
            rec.operation ?? null,
            rec.baseRevision ?? null,
            nextRevision,
          ]
        );

        // A database uniqueness constraint is the final idempotency guard.
        // If another request won the race, acknowledge this retry without
        // incrementing the entity revision a second time.
        if (insertRes.rows.length === 0) {
          const duplicate = await client.query(
            `SELECT seq_number FROM sync_records
             WHERE user_id = $1
               AND ((change_id IS NOT NULL AND change_id = $2) OR (device_id = $3 AND hlc = $4))
             ORDER BY seq_number DESC LIMIT 1`,
            [userId, rec.changeId ?? '', rec.deviceId, rec.hlc]
          );
          if (duplicate.rows.length > 0) {
            latestSeq = Math.max(latestSeq, Number(duplicate.rows[0].seq_number));
          }
          if (rec.changeId) {
            await client.query(
              'INSERT INTO processed_changes (user_id, change_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
              [userId, rec.changeId]
            );
          }
          await client.query('COMMIT');
          continue;
        }

        const seq = Number(insertRes.rows[0]?.seq_number || 0);
        await client.query(
          `UPDATE entity_revisions
           SET revision = $4, updated_at = NOW()
           WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3`,
          [userId, rec.tableKind, rec.recordId, nextRevision]
        );

        if (rec.changeId) {
          await client.query(
            'INSERT INTO processed_changes (user_id, change_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [userId, rec.changeId]
          );
        }

        await client.query('COMMIT');
        latestSeq = Math.max(latestSeq, seq);
        accepted++;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    }

    res.json({ accepted, latestSeq, conflicts });
  } catch (err) {
    next(err);
  }
});

// GET /v1/sync/pull
syncRouter.get('/pull', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const userId = req.userId!;
    const cursor = Number(req.query.cursor || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isSafeInteger(limit)) {
      throw new AppError(400, 'validation_error', 'Invalid sync pull cursor or limit');
    }
    const deviceId = authenticatedDeviceId(req);
    const requestedDeviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : null;
    if (requestedDeviceId && requestedDeviceId !== deviceId) {
      throw new AppError(403, 'device_identity_mismatch', 'Pull deviceId does not match the authenticated device');
    }
    const revokedDevices = await loadRevokedSyncDevices(userId);
    if (revokedDevices.has(deviceId)) {
      throw new AppError(403, 'device_revoked', 'Sync device has been revoked');
    }
    await registerDeviceCursor(userId, deviceId);
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, table_kind as "tableKind", record_id as "recordId", hlc, device_id as "deviceId",
              payload_ciphertext as "payloadCiphertext", aad, key_version as "keyVersion",
              change_id as "changeId", operation, base_revision as "baseRevision",
              entity_revision as "entityRevision", blob_storage_key as "blobStorageKey",
              seq_number as "seqNumber", created_at as "createdAt"
       FROM sync_records
       WHERE user_id = $1 AND seq_number > $2
       ORDER BY seq_number ASC
       LIMIT $3`,
      [userId, cursor, limit + 1]
    );

    const page = paginatePull(result.rows, cursor, limit);
    const records = await Promise.all(
      page.records.map(async (row) => ({
        ...normalizeSyncPullRow(row),
        payloadCiphertext: await hydrateSyncPayload(
          row.payloadCiphertext?.trim() ? row.payloadCiphertext : '',
          row.blobStorageKey
        ),
        blobStorageKey: undefined,
      }))
    );

    res.json({
      records,
      cursor: page.cursor,
      hasMore: page.hasMore,
      protocolVersion: SYNC_PROTOCOL_VERSION,
      accountKeyEpoch: await getAccountSyncEpoch(userId),
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/sync/ack — the client calls this only after transactionally applying
// and persisting all records through `cursor` in its local source of truth.
syncRouter.post('/ack', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const parse = z.object({ cursor: z.number().int().nonnegative().safe() }).safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid sync cursor acknowledgment');
    }
    const userId = req.userId!;
    const deviceId = authenticatedDeviceId(req);
    const revokedDevices = await loadRevokedSyncDevices(userId);
    if (revokedDevices.has(deviceId)) {
      throw new AppError(403, 'device_revoked', 'Sync device has been revoked');
    }

    await registerDeviceCursor(userId, deviceId);
    const pool = getPool();
    const maxRow = await pool.query(
      `SELECT GREATEST(
         COALESCE((SELECT MAX(seq_number) FROM sync_records WHERE user_id = $1), 0),
         COALESCE((SELECT MAX(last_seq) FROM sync_device_cursors WHERE user_id = $1), 0)
       ) AS max_seq`,
      [userId]
    );
    const maxSeq = Number(maxRow.rows[0]?.max_seq || 0);
    if (parse.data.cursor > maxSeq) {
      throw new AppError(400, 'cursor_ahead_of_server', 'Acknowledged cursor exceeds the account sync log');
    }

    await upsertDeviceCursor(userId, deviceId, parse.data.cursor);
    await collectEligibleTombstones(userId);
    res.json({ ok: true, cursor: parse.data.cursor });
  } catch (err) {
    next(err);
  }
});

// POST /v1/sync/increment-epoch
syncRouter.post('/increment-epoch', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const userId = req.userId!;
    const accountKeyEpoch = await incrementAccountSyncEpoch(userId);
    res.json({ accountKeyEpoch });
  } catch (err) {
    next(err);
  }
});

// POST /v1/sync/revoke-device
syncRouter.post('/revoke-device', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const parse = z.object({ syncDeviceId: z.string().min(1) }).safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid revoke-device payload');
    }
    const userId = req.userId!;
    const pool = getPool();
    await pool.query(
      `INSERT INTO sync_revoked_devices (user_id, sync_device_id, revoked_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, sync_device_id) DO UPDATE SET revoked_at = NOW()`,
      [userId, parse.data.syncDeviceId]
    );
    // A revoked device never acks again; leaving its cursor row behind would
    // pin tombstone GC at its last acknowledged position forever.
    await pool.query(
      'DELETE FROM sync_device_cursors WHERE user_id = $1 AND device_id = $2',
      [userId, parse.data.syncDeviceId]
    );
    const accountKeyEpoch = await incrementAccountSyncEpoch(userId);
    res.json({ accountKeyEpoch, syncDeviceId: parse.data.syncDeviceId });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/sync/data
syncRouter.delete('/data', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const userId = req.userId!;
    const pool = getPool();

    await pool.query('DELETE FROM sync_records WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sync_device_cursors WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM processed_changes WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM entity_revisions WHERE user_id = $1', [userId]);

    res.json({ ok: true, message: 'All cloud sync ciphertext wiped successfully' });
  } catch (err) {
    next(err);
  }
});
