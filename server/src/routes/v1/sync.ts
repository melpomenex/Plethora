import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';

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
});

const PushPayloadSchema = z.object({
  records: z.array(SyncRecordSchema).max(500),
});

// POST /v1/sync/push
syncRouter.post('/push', async (req: AuthRequest, res: Response, next) => {
  try {
    const parse = PushPayloadSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid sync push payload');
    }
    const { records } = parse.data;
    const userId = req.userId!;
    const pool = getPool();

    let accepted = 0;
    let latestSeq = 0;

    for (const rec of records) {
      // Deduplicate by (user_id, device_id, hlc)
      const existing = await pool.query(
        'SELECT seq_number FROM sync_records WHERE user_id = $1 AND device_id = $2 AND hlc = $3',
        [userId, rec.deviceId, rec.hlc]
      );

      if (existing.rows.length > 0) {
        latestSeq = Math.max(latestSeq, Number(existing.rows[0].seq_number));
        continue;
      }

      const id = uuidv4();
      const insertRes = await pool.query(
        `INSERT INTO sync_records (id, user_id, table_kind, record_id, hlc, device_id, payload_ciphertext, aad, key_version, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         RETURNING seq_number`,
        [id, userId, rec.tableKind, rec.recordId, rec.hlc, rec.deviceId, rec.payloadCiphertext, rec.aad, rec.keyVersion]
      );

      accepted++;
      latestSeq = Math.max(latestSeq, Number(insertRes.rows[0]?.seq_number || 0));
    }

    res.json({ accepted, latestSeq });
  } catch (err) {
    next(err);
  }
});

// GET /v1/sync/pull
syncRouter.get('/pull', async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const cursor = Number(req.query.cursor || 0);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, table_kind as "tableKind", record_id as "recordId", hlc, device_id as "deviceId",
              payload_ciphertext as "payloadCiphertext", aad, key_version as "keyVersion",
              seq_number as "seqNumber", created_at as "createdAt"
       FROM sync_records
       WHERE user_id = $1 AND seq_number > $2
       ORDER BY seq_number ASC
       LIMIT $3`,
      [userId, cursor, limit + 1]
    );

    const hasMore = result.rows.length > limit;
    const records = hasMore ? result.rows.slice(0, limit) : result.rows;
    const nextCursor = records.length > 0 ? Number(records[records.length - 1].seqNumber) : cursor;

    res.json({
      records,
      cursor: nextCursor,
      hasMore,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/sync/data
syncRouter.delete('/data', async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const pool = getPool();

    await pool.query('DELETE FROM sync_records WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sync_device_cursors WHERE user_id = $1', [userId]);

    res.json({ ok: true, message: 'All cloud sync ciphertext wiped successfully' });
  } catch (err) {
    next(err);
  }
});
