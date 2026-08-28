import type pg from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { JobKindDefinition } from './types.js';

const LOCK_TTL_MS = parseInt(process.env.JOB_LOCK_TTL_MS || '300000', 10);
const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;

export interface ClaimedJob {
  id: string;
  userId: string;
  kind: string;
  params: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
}

export async function claimNextJob(pool: pg.Pool, kinds: string[]): Promise<ClaimedJob | null> {
  if (kinds.length === 0) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reclaim stale running jobs
    await client.query(
      `UPDATE jobs SET status = 'queued', locked_by = NULL, locked_at = NULL, timeout_at = NULL, updated_at = NOW()
       WHERE status = 'running' AND locked_at IS NOT NULL
         AND locked_at < NOW() - ($1::int * interval '1 millisecond')`,
      [LOCK_TTL_MS]
    );

    const claim = await client.query(
      `SELECT id, user_id, kind, params_json, attempts, max_attempts
       FROM jobs
       WHERE status = 'queued' AND kind = ANY($1::text[])
       ORDER BY created_at ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
      [kinds]
    );

    if (claim.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }

    const row = claim.rows[0];
    const timeoutAt = new Date(Date.now() + LOCK_TTL_MS);

    await client.query(
      `UPDATE jobs SET status = 'running', locked_by = $1, locked_at = NOW(), timeout_at = $2,
              attempts = attempts + 1, updated_at = NOW()
       WHERE id = $3`,
      [WORKER_ID, timeoutAt, row.id]
    );

    await client.query(
      `INSERT INTO job_events (id, job_id, event_type, payload_json) VALUES ($1, $2, 'claimed', $3)`,
      [uuidv4(), row.id, JSON.stringify({ workerId: WORKER_ID })]
    );

    await client.query('COMMIT');

    return {
      id: row.id,
      userId: row.user_id,
      kind: row.kind,
      params: row.params_json as Record<string, unknown>,
      attempts: Number(row.attempts) + 1,
      maxAttempts: Number(row.max_attempts),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markJobSucceeded(
  pool: pg.Pool,
  jobId: string,
  result: Record<string, unknown>,
  resultRef?: string
): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = 'succeeded', result_json = $1, error_json = NULL,
            locked_by = NULL, locked_at = NULL, timeout_at = NULL, updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ ...result, ...(resultRef ? { resultRef } : {}) }), jobId]
  );
  await pool.query(
    `INSERT INTO job_events (id, job_id, event_type) VALUES ($1, $2, 'succeeded')`,
    [uuidv4(), jobId]
  );
}

export async function markJobFailed(
  pool: pg.Pool,
  jobId: string,
  error: { code: string; message: string },
  requeue: boolean
): Promise<void> {
  if (requeue) {
    await pool.query(
      `UPDATE jobs SET status = 'queued', error_json = $1,
              locked_by = NULL, locked_at = NULL, timeout_at = NULL, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(error), jobId]
    );
    await pool.query(
      `INSERT INTO job_events (id, job_id, event_type, payload_json) VALUES ($1, $2, 'retry', $3)`,
      [uuidv4(), jobId, JSON.stringify(error)]
    );
  } else {
    await pool.query(
      `UPDATE jobs SET status = 'failed', error_json = $1,
              locked_by = NULL, locked_at = NULL, timeout_at = NULL, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(error), jobId]
    );
    await pool.query(
      `INSERT INTO job_events (id, job_id, event_type, payload_json) VALUES ($1, $2, 'failed', $3)`,
      [uuidv4(), jobId, JSON.stringify(error)]
    );
  }
}

export async function isJobCancelled(pool: pg.Pool, jobId: string): Promise<boolean> {
  const res = await pool.query(`SELECT status FROM jobs WHERE id = $1`, [jobId]);
  return res.rows[0]?.status === 'cancelled';
}

export async function updateJobProgress(
  pool: pg.Pool,
  jobId: string,
  current: number,
  total: number,
  unit: string
): Promise<void> {
  await pool.query(
    `UPDATE jobs SET progress_current = $1, progress_total = $2, progress_unit = $3, updated_at = NOW()
     WHERE id = $4`,
    [current, total, unit, jobId]
  );
}

export function getTimeoutMs(def: JobKindDefinition): number {
  return def.timeoutMs;
}
