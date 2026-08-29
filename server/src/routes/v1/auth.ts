import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { AppError } from '../../middleware/error.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';

export const authRouter = Router();

const ACCESS_TOKEN_EXPIRY = '15m';
const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60;
const REFRESH_TOKEN_EXPIRY_DAYS = 30;

import { getJwtSecret } from '../../config/env.js';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateTokens(userId: string, sessionId: string, deviceId?: string) {
  const secret = getJwtSecret();
  const accessToken = jwt.sign(
    { userId, sessionId, deviceId },
    secret,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
  const rawRefreshToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = hashToken(rawRefreshToken);

  return {
    accessToken,
    rawRefreshToken,
    refreshTokenHash,
    expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
  };
}

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  deviceName: z.string().nullish(),
  platform: z.string().nullish(),
  publicKey: z.string().nullish(),
  marketingOptIn: z.boolean().nullish(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  deviceId: z.string().uuid().nullish(),
  deviceName: z.string().nullish(),
  platform: z.string().nullish(),
  publicKey: z.string().nullish(),
});

const RefreshSchema = z.object({
  refreshToken: z.string(),
});

// POST /v1/auth/register
authRouter.post('/register', async (req, res: Response, next) => {
  try {
    const parse = RegisterSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid registration parameters');
    }
    const { email, password, deviceName, platform, publicKey, marketingOptIn } = parse.data;

    const pool = getPool();
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      throw new AppError(409, 'email_exists', 'An account with this email already exists');
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.query(
      `INSERT INTO users (id, email, password_hash, subscription_tier, status, marketing_opt_in, created_at, updated_at)
       VALUES ($1, $2, $3, 'free', 'active', $4, NOW(), NOW())`,
      [userId, email.toLowerCase(), passwordHash, !!marketingOptIn]
    );

    // Register initial device if supplied
    let deviceId: string | undefined;
    if (deviceName || platform) {
      deviceId = uuidv4();
      await pool.query(
        `INSERT INTO devices (id, user_id, device_name, platform, public_key, created_at, last_seen)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [deviceId, userId, deviceName || 'Default Device', platform || 'unknown', publicKey || null]
      );
    }

    // Create initial session
    const sessionId = uuidv4();
    const familyId = uuidv4();
    const { accessToken, rawRefreshToken, refreshTokenHash, expiresIn } = generateTokens(userId, sessionId, deviceId);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, family_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [sessionId, userId, deviceId || null, refreshTokenHash, familyId, expiresAt]
    );

    res.status(201).json({
      user: {
        id: userId,
        email: email.toLowerCase(),
        subscriptionTier: 'free',
      },
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn,
      },
      device: deviceId ? { id: deviceId } : undefined,
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/auth/login
authRouter.post('/login', async (req, res: Response, next) => {
  try {
    const parse = LoginSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid login parameters');
    }
    const { email, password, deviceId: incomingDeviceId, deviceName, platform, publicKey } = parse.data;

    const pool = getPool();
    const userResult = await pool.query(
      'SELECT id, email, password_hash, subscription_tier, status FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    if (userResult.rows.length === 0) {
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    }

    const user = userResult.rows[0];
    if (user.status === 'deleted') {
      throw new AppError(403, 'account_deleted', 'This account has been deleted');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new AppError(401, 'invalid_credentials', 'Invalid email or password');
    }

    // Resolve device identity
    let activeDeviceId: string | undefined = incomingDeviceId ?? undefined;
    if (activeDeviceId) {
      const dev = await pool.query('SELECT id, revoked_at FROM devices WHERE id = $1 AND user_id = $2', [
        activeDeviceId,
        user.id,
      ]);
      if (dev.rows.length === 0 || dev.rows[0].revoked_at) {
        activeDeviceId = undefined;
      } else {
        await pool.query('UPDATE devices SET last_seen = NOW() WHERE id = $1', [activeDeviceId]);
      }
    }

    if (!activeDeviceId && (deviceName || platform)) {
      activeDeviceId = uuidv4();
      await pool.query(
        `INSERT INTO devices (id, user_id, device_name, platform, public_key, created_at, last_seen)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [activeDeviceId, user.id, deviceName || 'Device', platform || 'unknown', publicKey || null]
      );
    }

    // Create session
    const sessionId = uuidv4();
    const familyId = uuidv4();
    const { accessToken, rawRefreshToken, refreshTokenHash, expiresIn } = generateTokens(
      user.id,
      sessionId,
      activeDeviceId
    );
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, family_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [sessionId, user.id, activeDeviceId || null, refreshTokenHash, familyId, expiresAt]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        subscriptionTier: user.subscription_tier,
      },
      tokens: {
        accessToken,
        refreshToken: rawRefreshToken,
        expiresIn,
      },
      device: activeDeviceId ? { id: activeDeviceId } : undefined,
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/auth/token/refresh
authRouter.post('/token/refresh', async (req, res: Response, next) => {
  try {
    const parse = RefreshSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Refresh token is required');
    }
    const tokenHash = hashToken(parse.data.refreshToken);

    const pool = getPool();
    const sessionRes = await pool.query(
      'SELECT id, user_id, device_id, family_id, expires_at, revoked_at FROM sessions WHERE refresh_token_hash = $1',
      [tokenHash]
    );

    if (sessionRes.rows.length === 0) {
      throw new AppError(401, 'invalid_refresh_token', 'Refresh token is invalid or expired');
    }

    const session = sessionRes.rows[0];

    // Reuse detection: if a revoked refresh token is presented again, revoke entire session family!
    if (session.revoked_at) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE family_id = $1', [session.family_id]);
      throw new AppError(401, 'session_revoked', 'Session reuse detected. All sessions in family revoked.');
    }

    if (new Date() > new Date(session.expires_at)) {
      throw new AppError(401, 'token_expired', 'Refresh token has expired');
    }

    // Revoke old session token as part of rotation
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [session.id]);

    // Issue new session in the same family
    const nextSessionId = uuidv4();
    const { accessToken, rawRefreshToken, refreshTokenHash, expiresIn } = generateTokens(
      session.user_id,
      nextSessionId,
      session.device_id
    );
    const nextExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO sessions (id, user_id, device_id, refresh_token_hash, family_id, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [nextSessionId, session.user_id, session.device_id, refreshTokenHash, session.family_id, nextExpiresAt]
    );

    res.json({
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn,
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/auth/logout
authRouter.post('/logout', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const pool = getPool();
    if (req.sessionId) {
      await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE id = $1', [req.sessionId]);
    }
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// GET /v1/auth/account
authRouter.get('/account', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      'SELECT id, email, subscription_tier, status, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      throw new AppError(404, 'user_not_found', 'User account not found');
    }
    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      subscriptionTier: user.subscription_tier,
      status: user.status,
      createdAt: user.created_at,
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/auth/devices
authRouter.get('/devices', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT id, device_name as "deviceName", platform, public_key as "publicKey",
              created_at as "createdAt", last_seen as "lastSeen", revoked_at as "revokedAt"
       FROM devices WHERE user_id = $1 ORDER BY last_seen DESC`,
      [req.userId]
    );
    res.json({ devices: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /v1/auth/devices/:id/revoke
authRouter.post('/devices/:id/revoke', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const pool = getPool();
    const deviceId = req.params.id;
    await pool.query('UPDATE devices SET revoked_at = NOW() WHERE id = $1 AND user_id = $2', [
      deviceId,
      req.userId,
    ]);
    await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE device_id = $1', [deviceId]);
    await pool.query(
      `UPDATE users SET sync_key_epoch = sync_key_epoch + 1, updated_at = NOW() WHERE id = $1`,
      [req.userId]
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// DELETE /v1/auth/account (Proposal 22 - Cascading Account Deletion)
// Response semantics are explicit (Change F §1.4):
//   200 { success: true, deletedAt, message } — account and cloud data fully deleted
//   404 { error: { code: 'account_not_found' } } — nothing to delete (already gone)
//   5xx { error: { code: 'deletion_failed', retryable: true } } — cascade failed;
//       the account remains intact and the client must stay signed in and retry.
export async function deleteAccountHandler(req: AuthRequest, res: Response, next: NextFunction) {
  const pool = getPool();
  try {
    const userId = req.userId;
    await pool.query('BEGIN');
    try {
      // Delete in sequence (FK cascade also covers dependents)
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM devices WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM api_tokens WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM webhooks WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM inbox_items WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM sync_records WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM usage_records WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM capability_grants WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM quota_state WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM purchases WHERE user_id = $1', [userId]);
      await pool.query('DELETE FROM jobs WHERE user_id = $1', [userId]);
      const userDelete = await pool.query('DELETE FROM users WHERE id = $1', [userId]);

      if (userDelete.rowCount === 0) {
        await pool.query('ROLLBACK');
        throw new AppError(404, 'account_not_found', 'No active account exists for this session');
      }

      await pool.query('COMMIT');
      res.json({
        success: true,
        deletedAt: new Date().toISOString(),
        message: 'Account and associated cloud data deleted completely.',
      });
    } catch (txErr) {
      try {
        await pool.query('ROLLBACK');
      } catch {
        // Connection already aborted; nothing further to roll back.
      }
      throw txErr;
    }
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    // Explicit, retryable failure semantics: never a silent partial delete.
    next(
      new AppError(500, 'deletion_failed', 'Account deletion failed. The account remains active; please retry.', {
        retryable: true,
      })
    );
  }
}

authRouter.delete('/account', authMiddleware, deleteAccountHandler);

// GET /v1/auth/export (Proposal 22 - Portability & Cloud Data Export)
authRouter.get('/export', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const pool = getPool();
    const userId = req.userId;

    const userRes = await pool.query('SELECT id, email, subscription_tier, created_at FROM users WHERE id = $1', [userId]);
    const devicesRes = await pool.query('SELECT id, device_name, platform, created_at FROM devices WHERE user_id = $1', [userId]);
    const inboxRes = await pool.query('SELECT id, url, title, status, created_at FROM inbox_items WHERE user_id = $1', [userId]);
    const tokensRes = await pool.query('SELECT id, name, prefix, scopes, created_at FROM api_tokens WHERE user_id = $1', [userId]);
    const webhooksRes = await pool.query('SELECT id, url, events, created_at FROM webhooks WHERE user_id = $1', [userId]);

    res.json({
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      user: userRes.rows[0] || null,
      devices: devicesRes.rows,
      inboxItems: inboxRes.rows,
      apiTokens: tokensRes.rows,
      webhooks: webhooksRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

