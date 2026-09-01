import type { Response, NextFunction } from 'express';
import { getPool } from '../db/connection.js';
import { AppError } from './error.js';
import type { AuthRequest } from './auth.js';
import { resolveCapability } from '../capabilities/resolve.js';

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
    const { enabled } = await resolveCapability(pool, userId, 'cloud_sync');
    if (!enabled) {
      throw new AppError(403, 'capability_denied', 'Plethora Pro cloud_sync entitlement required');
    }

    next();
  } catch (error) {
    next(error);
  }
}
