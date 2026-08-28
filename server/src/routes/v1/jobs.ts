import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { getJobKind } from '../../jobs/registry.js';
import '../../jobs/kinds/index.js';

export const jobsRouter = Router();

// Apply auth to all job routes
jobsRouter.use(authMiddleware);

const EnqueueJobSchema = z.object({
  kind: z.string().min(1),
  params: z.record(z.unknown()).default({}),
  idempotencyKey: z.string().optional(),
});

// POST /v1/jobs
jobsRouter.post('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const parse = EnqueueJobSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid job submission parameters');
    }
    const { kind, params, idempotencyKey } = parse.data;
    const userId = req.userId!;
    const pool = getPool();

    const kindDef = getJobKind(kind);
    if (!kindDef) {
      throw new AppError(400, 'unknown_job_kind', `Unknown job kind: ${kind}`);
    }
    const validatedParams = kindDef.paramsSchema.parse(params);

    // Deduplicate via idempotencyKey if provided
    if (idempotencyKey) {
      const existing = await pool.query(
        'SELECT id, kind, status, created_at as "createdAt" FROM jobs WHERE user_id = $1 AND idempotency_key = $2',
        [userId, idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const job = existing.rows[0];
        return res.status(200).json({
          id: job.id,
          kind: job.kind,
          status: job.status,
          createdAt: job.createdAt,
          deduplicated: true,
        });
      }
    }

    const jobId = uuidv4();
    await pool.query(
      `INSERT INTO jobs (id, user_id, kind, status, params_json, idempotency_key, max_attempts, created_at, updated_at)
       VALUES ($1, $2, $3, 'queued', $4, $5, $6, NOW(), NOW())`,
      [jobId, userId, kind, JSON.stringify(validatedParams), idempotencyKey || null, kindDef.maxAttempts]
    );

    res.status(202).json({
      id: jobId,
      kind,
      status: 'queued',
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/jobs/:id
jobsRouter.get('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const jobId = req.params.id;
    const userId = req.userId!;
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, kind, status, params_json as params, result_json as result, error_json as error,
              progress_current, progress_total, progress_unit,
              created_at as "createdAt", updated_at as "updatedAt"
       FROM jobs WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(404, 'job_not_found', 'Job not found');
    }

    const row = result.rows[0];
    const progress =
      row.progress_total !== null
        ? {
            current: row.progress_current || 0,
            total: row.progress_total,
            unit: row.progress_unit || 'items',
          }
        : undefined;

    res.json({
      id: row.id,
      kind: row.kind,
      status: row.status,
      params: row.params,
      progress,
      result: row.result,
      error: row.error,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/jobs/:id
jobsRouter.delete('/:id', async (req: AuthRequest, res: Response, next) => {
  try {
    const jobId = req.params.id;
    const userId = req.userId!;
    const pool = getPool();

    const result = await pool.query(
      `UPDATE jobs SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND status IN ('queued', 'running')
       RETURNING id`,
      [jobId, userId]
    );

    if (result.rows.length === 0) {
      throw new AppError(404, 'job_not_found_or_finished', 'Job was not found or already completed');
    }

    res.json({ ok: true, id: jobId, status: 'cancelled' });
  } catch (err) {
    next(err);
  }
});

// GET /v1/jobs
jobsRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const { kind, status, since } = req.query;
    const pool = getPool();

    let query = 'SELECT id, kind, status, created_at as "createdAt", updated_at as "updatedAt" FROM jobs WHERE user_id = $1';
    const params: unknown[] = [userId];

    if (typeof kind === 'string') {
      params.push(kind);
      query += ` AND kind = $${params.length}`;
    }
    if (typeof status === 'string') {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (typeof since === 'string') {
      params.push(new Date(since));
      query += ` AND updated_at >= $${params.length}`;
    }

    query += ' ORDER BY created_at DESC LIMIT 100';

    const result = await pool.query(query, params);
    res.json({ jobs: result.rows });
  } catch (err) {
    next(err);
  }
});
