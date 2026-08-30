import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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
  /** Set by optionalAuthMiddleware when a bearer token was presented but
   * rejected (expired/invalid). Consumers like /v1/entitlements use it to
   * answer 401 instead of an anonymous 200 — an expired token must never be
   * indistinguishable from "signed out". */
  authRejected?: boolean;
  authError?: 'token_expired' | 'invalid_token';
}

export async function authMiddleware(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next(new AppError(401, 'unauthorized', 'No bearer token provided'));
    return;
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
    if (err instanceof jwt.TokenExpiredError) {
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
  } catch (err) {
    // Control flow is unchanged for every consumer (request continues
    // unauthenticated); consumers that must distinguish "presented but
    // rejected" from "anonymous" read the flags below.
    req.authRejected = true;
    req.authError = err instanceof jwt.TokenExpiredError ? 'token_expired' : 'invalid_token';
    next();
  }
}
