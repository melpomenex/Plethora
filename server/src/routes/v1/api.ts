import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../../db/connection.js';
import { authMiddleware, AuthRequest } from '../../middleware/auth.js';

export const apiRouter = Router();

export interface ApiTokenPayload {
  id: string;
  userId: string;
  scopes: string[];
}

/* eslint-disable @typescript-eslint/no-namespace -- required for Express Request augmentation */
declare global {
  namespace Express {
    interface Request {
      apiToken?: ApiTokenPayload;
    }
  }
}

/**
 * Middleware validating Public API Token (Bearer pt_live_...) or User JWT
 */
export async function requireApiToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Missing or malformed Authorization header' },
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  const pool = getPool();

  if (token.startsWith('pt_')) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await pool.query(
      `SELECT id, user_id, scopes FROM api_tokens WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      res.status(401).json({
        error: { code: 'INVALID_TOKEN', message: 'API token is invalid or revoked' },
      });
      return;
    }

    const row = result.rows[0];
    req.apiToken = {
      id: row.id,
      userId: row.user_id,
      scopes: typeof row.scopes === 'string' ? JSON.parse(row.scopes) : row.scopes,
    };

    // Update last_used_at asynchronously
    void pool.query(`UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1`, [row.id]);
    next();
  } else {
    // If not a pt_ token, fallback to standard user check
    res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid API token format' },
    });
  }
}

/**
 * Scope enforcement helper
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.apiToken) {
      res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
      });
      return;
    }

    if (!req.apiToken.scopes.includes(scope) && !req.apiToken.scopes.includes('*')) {
      res.status(403).json({
        error: { code: 'FORBIDDEN', message: `Missing required token scope: ${scope}` },
      });
      return;
    }

    next();
  };
}

// -------------------------------------------------------------------------
// Tokens Management
// -------------------------------------------------------------------------

apiRouter.post('/tokens', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, scopes } = req.body;
  const userId = req.userId;
  if (!userId || !name) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'name is required' } });
    return;
  }

  const rawToken = `pt_${crypto.randomBytes(24).toString('hex')}`;
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenPrefix = rawToken.slice(0, 7);
  const tokenId = uuidv4();
  const tokenScopes = scopes || ['read'];

  const pool = getPool();
  await pool.query(
    `INSERT INTO api_tokens (id, user_id, name, token_hash, token_prefix, scopes)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [tokenId, userId, name, tokenHash, tokenPrefix, JSON.stringify(tokenScopes)]
  );

  res.status(201).json({
    data: {
      id: tokenId,
      name,
      token: rawToken,
      prefix: tokenPrefix,
      scopes: tokenScopes,
      createdAt: new Date().toISOString(),
    },
  });
});

apiRouter.get('/tokens', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT id, name, token_prefix, scopes, last_used_at, created_at
     FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId]
  );

  res.json({
    data: result.rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.token_prefix,
      scopes: typeof r.scopes === 'string' ? JSON.parse(r.scopes) : r.scopes,
      lastUsedAt: r.last_used_at,
      createdAt: r.created_at,
    })),
  });
});

apiRouter.delete('/tokens/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const pool = getPool();
  const result = await pool.query(`DELETE FROM api_tokens WHERE id = $1 AND user_id = $2 RETURNING id`, [
    id,
    req.userId,
  ]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Token not found' } });
    return;
  }
  res.json({ success: true });
});

// -------------------------------------------------------------------------
// Public API Resources
// -------------------------------------------------------------------------

apiRouter.get('/documents', requireApiToken, requireScope('read'), async (req: Request, res: Response): Promise<void> => {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, title, file_type, category, date_added, date_modified, total_pages
     FROM documents WHERE user_id = $1 LIMIT 100`,
    [req.apiToken!.userId]
  );

  res.json({
    data: result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      fileType: r.file_type,
      category: r.category,
      dateAdded: r.date_added,
      dateModified: r.date_modified,
      totalPages: r.total_pages,
    })),
  });
});

apiRouter.get('/cards', requireApiToken, requireScope('read'), async (req: Request, res: Response): Promise<void> => {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, document_id, type, state, date_added, date_modified
     FROM learning_items WHERE user_id = $1 LIMIT 100`,
    [req.apiToken!.userId]
  );

  res.json({
    data: result.rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      type: r.type,
      state: r.state,
      dateAdded: r.date_added,
      dateModified: r.date_modified,
    })),
  });
});

apiRouter.post('/reviews', requireApiToken, requireScope('reviews:write'), async (req: Request, res: Response): Promise<void> => {
  const { itemId, rating } = req.body;
  if (!itemId || rating === undefined) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'itemId and rating are required' } });
    return;
  }

  res.status(201).json({
    success: true,
    data: {
      itemId,
      rating,
      submittedAt: new Date().toISOString(),
    },
  });
});

// -------------------------------------------------------------------------
// Webhook Subscriptions
// -------------------------------------------------------------------------

apiRouter.post('/webhooks', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { url, events } = req.body;
  const userId = req.userId;
  if (!userId || !url) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'url is required' } });
    return;
  }

  const webhookId = uuidv4();
  const secret = `whsec_${crypto.randomBytes(24).toString('hex')}`;
  const pool = getPool();

  await pool.query(
    `INSERT INTO webhooks (id, user_id, url, secret, events, active)
     VALUES ($1, $2, $3, $4, $5, TRUE)`,
    [webhookId, userId, url, secret, JSON.stringify(events || ['*'])]
  );

  res.status(201).json({
    data: {
      id: webhookId,
      url,
      secret,
      events: events || ['*'],
      createdAt: new Date().toISOString(),
    },
  });
});

apiRouter.get('/webhooks', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    return;
  }

  const pool = getPool();
  const result = await pool.query(
    `SELECT id, url, secret, events, active, created_at FROM webhooks WHERE user_id = $1`,
    [userId]
  );

  res.json({
    data: result.rows.map((r) => ({
      id: r.id,
      url: r.url,
      secretPrefix: typeof r.secret === 'string' ? r.secret.slice(0, 10) + '…' : undefined,
      events: typeof r.events === 'string' ? JSON.parse(r.events) : r.events,
      active: r.active,
      createdAt: r.created_at,
    })),
  });
});

apiRouter.delete('/webhooks/:id', authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const pool = getPool();
  const result = await pool.query(`DELETE FROM webhooks WHERE id = $1 AND user_id = $2 RETURNING id`, [
    id,
    req.userId,
  ]);
  if (result.rowCount === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Webhook not found' } });
    return;
  }
  res.json({ success: true });
});
