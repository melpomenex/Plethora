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
  paginatePull,
  shouldConflict,
  SYNC_PROTOCOL_VERSION,
  TOMBSTONE_RETENTION_DAYS,
} from '../../sync/pushPullLogic.js';

export const syncRouter = Router();

syncRouter.use(authMiddleware, requireCloudSync);

const MAX_CIPHERTEXT_BYTES = 5 * 1024 * 1024;

const SyncRecordSchema = z.object({
  tableKind: z.string().min(1),
  recordId: z.string().min(1),
  hlc: z.string().min(1),
  deviceId: z.string().min(1),
  payloadCiphertext: z.string().min(1).max(MAX_CIPHERTEXT_BYTES),
  aad: z.string().min(1),
  keyVersion: z.number().int().positive().default(1),
  changeId: z.string().min(1).optional(),
  operation: z.enum(['create', 'update', 'delete', 'append_event']).optional(),
  baseRevision: z.number().int().optional(),
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
    const pool = getPool();
    const accountEpoch = await getAccountSyncEpoch(userId);
    const revokedDevices = await loadRevokedSyncDevices(userId);

    const deviceRows = await pool.query(
      'SELECT device_id FROM sync_device_cursors WHERE user_id = $1',
      [userId]
    );
    const knownDevices = deviceRows.rows.map((row) => String(row.device_id));
    for (const rec of records) {
      try {
        assertDeviceAllowed(knownDevices, rec.deviceId);
        if (!knownDevices.includes(rec.deviceId)) {
          knownDevices.push(rec.deviceId);
        }
      } catch (error) {
        const err = error as Error & { statusCode?: number; code?: string };
        throw new AppError(err.statusCode || 403, err.code || 'device_limit_reached', err.message);
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

      if (revokedDevices.has(rec.deviceId)) {
        throw new AppError(403, 'device_revoked', 'Sync device has been revoked');
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

      const revisionRow = await pool.query(
        'SELECT revision FROM entity_revisions WHERE user_id = $1 AND entity_type = $2 AND entity_id = $3',
        [userId, rec.tableKind, rec.recordId]
      );
      const serverRevision = Number(revisionRow.rows[0]?.revision || 0);
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
        continue;
      }

      const id = uuidv4();
      const offloaded = await maybeOffloadSyncPayload(userId, id, rec.payloadCiphertext);

      const nextRevision = nextEntityRevision(serverRevision);
      const insertRes = await pool.query(
        `INSERT INTO sync_records (
           id, user_id, table_kind, record_id, hlc, device_id,
           payload_ciphertext, aad, key_version, blob_storage_key,
           change_id, operation, base_revision, entity_revision, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
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

      const seq = Number(insertRes.rows[0]?.seq_number || 0);
      latestSeq = Math.max(latestSeq, seq);
      accepted++;

      await pool.query(
        `INSERT INTO entity_revisions (user_id, entity_type, entity_id, revision, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (user_id, entity_type, entity_id)
         DO UPDATE SET revision = GREATEST(entity_revisions.revision, EXCLUDED.revision), updated_at = NOW()`,
        [userId, rec.tableKind, rec.recordId, nextRevision]
      );

      if (rec.changeId) {
        await pool.query(
          'INSERT INTO processed_changes (user_id, change_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [userId, rec.changeId]
        );
      }

      await upsertDeviceCursor(userId, rec.deviceId, seq);
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
    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : null;
    if (deviceId) {
      const revokedDevices = await loadRevokedSyncDevices(userId);
      if (revokedDevices.has(deviceId)) {
        throw new AppError(403, 'device_revoked', 'Sync device has been revoked');
      }
    }
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
        ...row,
        payloadCiphertext: await hydrateSyncPayload(
          row.payloadCiphertext?.trim() ? row.payloadCiphertext : '',
          row.blobStorageKey
        ),
        blobStorageKey: undefined,
      }))
    );

    if (deviceId) {
      await upsertDeviceCursor(userId, deviceId, page.cursor);
    }

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
