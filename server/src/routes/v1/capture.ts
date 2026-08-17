import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getPool } from '../../db/connection.js';
import { authenticateToken } from '../../middleware/auth.js';

export const captureRouter = Router();
export const inboxRouter = Router();

// SSRF Protection: Deny private, loopback, and local network IPs
function isPrivateUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();

    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    ) {
      return true;
    }

    // 10.x.x.x, 172.16-31.x.x, 192.168.x.x
    if (
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

// -------------------------------------------------------------------------
// POST /v1/capture/url
// -------------------------------------------------------------------------
captureRouter.post('/url', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { url, title, tags } = req.body;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'url is required' } });
    return;
  }

  if (isPrivateUrl(url)) {
    res.status(400).json({ error: { code: 'FORBIDDEN_URL', message: 'Private and internal URLs are prohibited' } });
    return;
  }

  const itemId = uuidv4();
  const pool = getPool();
  const itemTitle = title || url;
  const itemTags = tags || [];

  await pool.query(
    `INSERT INTO inbox_items (id, user_id, url, title, tags, status)
     VALUES ($1, $2, $3, $4, $5, 'pending')`,
    [itemId, req.user!.userId, url, itemTitle, JSON.stringify(itemTags)]
  );

  res.status(201).json({
    data: {
      id: itemId,
      url,
      title: itemTitle,
      tags: itemTags,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  });
});

// -------------------------------------------------------------------------
// POST /v1/capture/content
// -------------------------------------------------------------------------
captureRouter.post('/content', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { url, title, html, text, tags } = req.body;
  if (!url || !title) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'url and title are required' } });
    return;
  }

  const itemId = uuidv4();
  const pool = getPool();
  const itemTags = tags || [];
  const contentHtml = html || text || '';
  const excerpt = (text || html || '').slice(0, 300);

  await pool.query(
    `INSERT INTO inbox_items (id, user_id, url, title, excerpt, content_html, tags, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
    [itemId, req.user!.userId, url, title, excerpt, contentHtml, JSON.stringify(itemTags)]
  );

  res.status(201).json({
    data: {
      id: itemId,
      url,
      title,
      excerpt,
      tags: itemTags,
      status: 'pending',
      createdAt: new Date().toISOString(),
    },
  });
});

// -------------------------------------------------------------------------
// GET /v1/inbox & PATCH /v1/inbox/:id
// -------------------------------------------------------------------------
inboxRouter.get('/', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const pool = getPool();
  const status = (req.query.status as string) || 'pending';

  const result = await pool.query(
    `SELECT id, url, title, excerpt, tags, status, created_at
     FROM inbox_items WHERE user_id = $1 AND status = $2
     ORDER BY created_at DESC LIMIT 100`,
    [req.user!.userId, status]
  );

  res.json({
    data: result.rows.map((r) => ({
      id: r.id,
      url: r.url,
      title: r.title,
      excerpt: r.excerpt,
      tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags,
      status: r.status,
      createdAt: r.created_at,
    })),
  });
});

inboxRouter.patch('/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { status } = req.body;

  if (!['pending', 'accepted', 'dismissed'].includes(status)) {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid status' } });
    return;
  }

  const pool = getPool();
  const result = await pool.query(
    `UPDATE inbox_items SET status = $1 WHERE id = $2 AND user_id = $3 RETURNING id, status`,
    [status, id, req.user!.userId]
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Inbox item not found' } });
    return;
  }

  res.json({ success: true, data: result.rows[0] });
});
