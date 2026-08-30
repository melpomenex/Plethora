import type { PoolClient } from 'pg';
import { getPool } from '../db/connection.js';
import { AppError } from '../middleware/error.js';

/** Canonical capability id — matches client `CapabilityId`. */
export const TRANSCRIPTION_CAPABILITY = 'transcription';

/** Default Pro allowance: 120 minutes/month, stored as seconds. */
export const DEFAULT_TRANSCRIPTION_LIMIT_SECONDS = 120 * 60;

export interface TranscriptionQuotaSnapshot {
  used: number;
  limit: number;
  window: 'monthly';
  resetsAt: string;
  remaining: number;
}

function nextMonthlyReset(from = new Date()): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

function snapshotFromRow(row: {
  used: string | number;
  limit_val: string | number;
  window: string;
  resets_at: Date | string | null;
}): TranscriptionQuotaSnapshot {
  const used = Number(row.used ?? 0);
  const limit = Number(row.limit_val ?? 0);
  const resetsAt = row.resets_at
    ? new Date(row.resets_at).toISOString()
    : nextMonthlyReset().toISOString();
  return {
    used,
    limit,
    window: 'monthly',
    resetsAt,
    remaining: Math.max(0, limit - used),
  };
}

async function userIsPro(userId: string): Promise<boolean> {
  const pool = getPool();
  const userRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [userId]);
  return userRes.rows[0]?.subscription_tier === 'pro';
}

async function ensureQuotaRow(userId: string): Promise<TranscriptionQuotaSnapshot> {
  const pool = getPool();
  const resetsAt = nextMonthlyReset();
  await pool.query(
    `INSERT INTO quota_state (user_id, capability, used, limit_val, "window", resets_at)
     VALUES ($1, $2, 0, $3, 'monthly', $4)
     ON CONFLICT (user_id, capability) DO NOTHING`,
    [userId, TRANSCRIPTION_CAPABILITY, DEFAULT_TRANSCRIPTION_LIMIT_SECONDS, resetsAt.toISOString()]
  );

  const rowRes = await pool.query(
    `SELECT used, limit_val, "window", resets_at
     FROM quota_state WHERE user_id = $1 AND capability = $2`,
    [userId, TRANSCRIPTION_CAPABILITY]
  );

  if (rowRes.rows.length === 0) {
    throw new AppError(500, 'internal_server_error', 'Failed to initialize transcription quota.');
  }

  const row = rowRes.rows[0];
  const now = Date.now();
  const resetMs = row.resets_at ? new Date(row.resets_at).getTime() : 0;
  if (resetMs > 0 && now >= resetMs) {
    const nextReset = nextMonthlyReset();
    const resetRes = await pool.query(
      `UPDATE quota_state
       SET used = 0, resets_at = $3
       WHERE user_id = $1 AND capability = $2
       RETURNING used, limit_val, "window", resets_at`,
      [userId, TRANSCRIPTION_CAPABILITY, nextReset.toISOString()]
    );
    return snapshotFromRow(resetRes.rows[0]);
  }

  return snapshotFromRow(row);
}

export async function getTranscriptionQuota(userId: string): Promise<TranscriptionQuotaSnapshot> {
  if (!(await userIsPro(userId))) {
    throw new AppError(403, 'forbidden', 'Premium transcription requires an active Pro subscription.');
  }
  return ensureQuotaRow(userId);
}

export async function checkTranscriptionQuota(
  userId: string,
  durationSeconds: number
): Promise<TranscriptionQuotaSnapshot> {
  const delta = Math.max(0, Math.ceil(durationSeconds));
  const snapshot = await getTranscriptionQuota(userId);
  if (delta > 0 && snapshot.used + delta > snapshot.limit) {
    const retryAfter = Math.max(
      0,
      Math.ceil((new Date(snapshot.resetsAt).getTime() - Date.now()) / 1000)
    );
    throw new AppError(429, 'quota_exceeded', 'Premium transcription quota exceeded for this period.', {
      retryable: true,
      retryAfter,
    });
  }
  return snapshot;
}

export interface MeterTranscriptionOptions {
  providerId?: string;
  model?: string;
  idempotencyKey?: string;
}

async function resetQuotaIfDue(
  client: PoolClient,
  userId: string,
  row: { used: string | number; limit_val: string | number; resets_at: Date | string | null }
): Promise<{ used: number; limit: number; resetsAt: Date }> {
  const now = Date.now();
  const resetMs = row.resets_at ? new Date(row.resets_at).getTime() : 0;
  let used = Number(row.used ?? 0);
  const limit = Number(row.limit_val ?? DEFAULT_TRANSCRIPTION_LIMIT_SECONDS);
  let resetsAt = row.resets_at ? new Date(row.resets_at) : nextMonthlyReset();

  if (resetMs > 0 && now >= resetMs) {
    used = 0;
    resetsAt = nextMonthlyReset();
    await client.query(
      `UPDATE quota_state SET used = 0, resets_at = $3
       WHERE user_id = $1 AND capability = $2`,
      [userId, TRANSCRIPTION_CAPABILITY, resetsAt.toISOString()]
    );
  }

  return { used, limit, resetsAt };
}

export async function meterTranscriptionQuota(
  userId: string,
  durationSeconds: number,
  options: MeterTranscriptionOptions = {}
): Promise<TranscriptionQuotaSnapshot> {
  const delta = Math.max(0, Math.ceil(durationSeconds));
  if (delta === 0) {
    return getTranscriptionQuota(userId);
  }

  if (!(await userIsPro(userId))) {
    throw new AppError(403, 'forbidden', 'Premium transcription requires an active Pro subscription.');
  }

  await ensureQuotaRow(userId);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const rowRes = await client.query(
      `SELECT used, limit_val, "window", resets_at
       FROM quota_state WHERE user_id = $1 AND capability = $2 FOR UPDATE`,
      [userId, TRANSCRIPTION_CAPABILITY]
    );
    if (rowRes.rows.length === 0) {
      throw new AppError(500, 'internal_server_error', 'Transcription quota row missing.');
    }

    const { used, limit, resetsAt } = await resetQuotaIfDue(client, userId, rowRes.rows[0]);
    if (used + delta > limit) {
      const retryAfter = Math.max(0, Math.ceil((resetsAt.getTime() - Date.now()) / 1000));
      throw new AppError(429, 'quota_exceeded', 'Premium transcription quota exceeded for this period.', {
        retryable: true,
        retryAfter,
      });
    }

    const updateRes = await client.query(
      `UPDATE quota_state SET used = used + $3
       WHERE user_id = $1 AND capability = $2
       RETURNING used, limit_val, "window", resets_at`,
      [userId, TRANSCRIPTION_CAPABILITY, delta]
    );

    await client.query(
      `INSERT INTO usage_records (id, user_id, capability, units, provider, model)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [
        userId,
        TRANSCRIPTION_CAPABILITY,
        delta,
        options.providerId ?? null,
        options.model ?? null,
      ]
    );

    await client.query('COMMIT');
    return snapshotFromRow(updateRes.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
