import type { Response, NextFunction } from 'express';
import { getPool } from '../db/connection.js';
import { AppError } from './error.js';
import type { AuthRequest } from './auth.js';

export async function requireCloudSync(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = req.userId;
    if (!userId) {
      throw new AppError(401, 'unauthorized', 'Authentication required');
    }

    const pool = getPool();
    const userRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [userId]);
    const tier = userRes.rows[0]?.subscription_tier || 'free';

    const grantRes = await pool.query(
      'SELECT enabled FROM capability_grants WHERE user_id = $1 AND capability = $2',
      [userId, 'cloud_sync']
    );
    const override = grantRes.rows[0]?.enabled;

    const enabled = override !== undefined ? Boolean(override) : tier === 'pro';
    if (!enabled) {
      throw new AppError(403, 'capability_denied', 'Plethora Pro cloud_sync entitlement required');
    }

    next();
  } catch (error) {
    next(error);
  }
}
