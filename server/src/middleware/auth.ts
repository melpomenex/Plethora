import { Request, Response, NextFunction } from 'express';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { AppError } from './error.js';
import { getPool } from '../db/connection.js';
import { getJwtSecret } from '../config/env.js';

export interface TokenPayload {
  userId: string;
  deviceId?: string;
  sessionId?: string;
}

export interface AuthRequest extends Request {
  userId?: string;
  deviceId?: string;
  sessionId?: string;
}

export async function authMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError(401, 'unauthorized', 'No bearer token provided');
  }

  const token = authHeader.slice(7);
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    req.userId = payload.userId;
    req.deviceId = payload.deviceId;
    req.sessionId = payload.sessionId;

    if (payload.sessionId) {
      const pool = getPool();
      const sessionResult = await pool.query(
        'SELECT revoked_at, expires_at FROM sessions WHERE id = $1',
        [payload.sessionId]
      );
      if (sessionResult.rows.length === 0 || sessionResult.rows[0].revoked_at) {
        throw new AppError(401, 'session_revoked', 'Session has been revoked or expired');
      }
      const expiresAt = sessionResult.rows[0].expires_at;
      if (expiresAt && new Date(expiresAt) < new Date()) {
        throw new AppError(401, 'session_revoked', 'Session has been revoked or expired');
      }
    }

    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    if (err instanceof TokenExpiredError) {
      next(new AppError(401, 'token_expired', 'Access token has expired', { retryable: true }));
      return;
    }
    next(new AppError(401, 'invalid_token', 'Access token is invalid'));
  }
}

export function optionalAuthMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  const secret = getJwtSecret();

  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    req.userId = payload.userId;
    req.deviceId = payload.deviceId;
    req.sessionId = payload.sessionId;
    next();
  } catch {
    next();
  }
}
