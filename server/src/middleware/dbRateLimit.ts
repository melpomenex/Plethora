import type { Request, Response, NextFunction } from 'express';
import { getPool } from '../db/connection.js';

export interface DbRateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix: string;
  keyFn: (req: Request) => string;
}

/**
 * Postgres-backed fixed-window rate limiter (safe across multiple API instances).
 */
export function dbRateLimit(options: DbRateLimitOptions) {
  const { windowMs, max, keyPrefix, keyFn } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const pool = getPool();
      const bucketKey = `${keyPrefix}:${keyFn(req)}`;
      const windowSecs = Math.ceil(windowMs / 1000);

      const result = await pool.query(
        `INSERT INTO rate_limit_buckets (bucket_key, hit_count, window_start)
         VALUES ($1, 1, NOW())
         ON CONFLICT (bucket_key) DO UPDATE SET
           hit_count = CASE
             WHEN rate_limit_buckets.window_start < NOW() - ($2::int * interval '1 second')
             THEN 1
             ELSE rate_limit_buckets.hit_count + 1
           END,
           window_start = CASE
             WHEN rate_limit_buckets.window_start < NOW() - ($2::int * interval '1 second')
             THEN NOW()
             ELSE rate_limit_buckets.window_start
           END
         RETURNING hit_count`,
        [bucketKey, windowSecs]
      );

      const hits = Number(result.rows[0]?.hit_count ?? 1);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - hits)));

      if (hits > max) {
        res.status(429).json({
          error: {
            code: 'rate_limit_exceeded',
            message: 'Too many requests. Please try again later.',
            retryable: true,
          },
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
