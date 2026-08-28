import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { maybeOffloadSyncPayload, hydrateSyncPayload } from '../../sync/blobStorage.js';
import {
  assertSyncProtocolVersion,
  nextEntityRevision,
  paginatePull,
  shouldConflict,
  SYNC_PROTOCOL_VERSION,
} from '../../sync/pushPullLogic.js';

export const syncRouter = Router();

syncRouter.use(authMiddleware);

const SyncRecordSchema = z.object({
  tableKind: z.string().min(1),
  recordId: z.string().min(1),
  hlc: z.string().min(1),
  deviceId: z.string().min(1),
  payloadCiphertext: z.string().min(1),
  aad: z.string().min(1),
  keyVersion: z.number().int().positive().default(1),
  changeId: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  baseRevision: z.number().int().optional(),
});

const PushPayloadSchema = z.object({
  records: z.array(SyncRecordSchema).max(500),
});

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

      const insertRes = await pool.query(
        `INSERT INTO sync_records (id, user_id, table_kind, record_id, hlc, device_id, payload_ciphertext, aad, key_version, blob_storage_key, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
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
        ]
      );

      const seq = Number(insertRes.rows[0]?.seq_number || 0);
      latestSeq = Math.max(latestSeq, seq);
      accepted++;

      const nextRevision = nextEntityRevision(serverRevision);
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
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, table_kind as "tableKind", record_id as "recordId", hlc, device_id as "deviceId",
              payload_ciphertext as "payloadCiphertext", aad, key_version as "keyVersion",
              blob_storage_key as "blobStorageKey",
              seq_number as "seqNumber", created_at as "createdAt"
       FROM sync_records
       WHERE user_id = $1 AND seq_number > $2
       ORDER BY seq_number ASC`,
      [userId, cursor]
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

    const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : null;
    if (deviceId) {
      await upsertDeviceCursor(userId, deviceId, page.cursor);
    }

    res.json({
      records,
      cursor: page.cursor,
      hasMore: page.hasMore,
      protocolVersion: SYNC_PROTOCOL_VERSION,
    });
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
