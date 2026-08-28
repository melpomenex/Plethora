import { Router, Response } from 'express';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { requireCloudSync } from '../../middleware/requireCloudSync.js';
import { getStorage } from '../../storage/index.js';
import { assertSyncProtocolVersion } from '../../sync/pushPullLogic.js';

export const blobsRouter = Router();

blobsRouter.use(authMiddleware, requireCloudSync);

const DEFAULT_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;
const SHA256_HASH = /^sha256:[a-f0-9]{64}$/;

function readProtocolVersion(req: AuthRequest): void {
  try {
    assertSyncProtocolVersion(req.header('x-plethora-sync-protocol-version'));
  } catch (error) {
    const err = error as Error & { statusCode?: number; code?: string };
    throw new AppError(err.statusCode || 400, err.code || 'unsupported_sync_protocol', err.message);
  }
}

async function getQuota(userId: string): Promise<{ used: number; limit: number }> {
  const pool = getPool();
  const quotaRes = await pool.query(
    'SELECT used, limit_val FROM quota_state WHERE user_id = $1 AND capability = $2',
    [userId, 'cloud_sync']
  );
  if (quotaRes.rows.length > 0) {
    return {
      used: Number(quotaRes.rows[0].used || 0),
      limit: Number(quotaRes.rows[0].limit_val || DEFAULT_QUOTA_BYTES),
    };
  }
  return { used: 0, limit: DEFAULT_QUOTA_BYTES };
}

async function bumpUsage(userId: string, delta: number): Promise<void> {
  if (delta <= 0) {
    return;
  }
  const pool = getPool();
  await pool.query(
    `INSERT INTO quota_state (user_id, capability, used, limit_val, "window")
     VALUES ($1, 'cloud_sync', $2, $3, 'monthly')
     ON CONFLICT (user_id, capability)
     DO UPDATE SET used = GREATEST(0, quota_state.used + $2)`,
    [userId, delta, DEFAULT_QUOTA_BYTES]
  );
}

// GET /v1/blobs/usage — register before /:hash routes
blobsRouter.get('/usage', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const userId = req.userId!;
    const quota = await getQuota(userId);
    res.json({ usedBytes: quota.used, limitBytes: quota.limit });
  } catch (error) {
    next(error);
  }
});

// POST /v1/blobs/check
blobsRouter.post('/check', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const parse = z
      .object({ hashes: z.array(z.string().regex(SHA256_HASH)).max(500) })
      .safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid blob check payload');
    }
    const userId = req.userId!;
    const pool = getPool();
    const result = await pool.query(
      'SELECT content_hash FROM blob_objects WHERE user_id = $1 AND content_hash = ANY($2::text[])',
      [userId, parse.data.hashes]
    );
    res.json({ existing: result.rows.map((row) => row.content_hash as string) });
  } catch (error) {
    next(error);
  }
});

// POST /v1/blobs/upload-url
blobsRouter.post('/upload-url', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const parse = z
      .object({
        hash: z.string().regex(SHA256_HASH),
        sizeBytes: z.number().int().positive().max(512 * 1024 * 1024),
        contentType: z.string().min(1).default('application/octet-stream'),
      })
      .safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid blob upload-url payload');
    }
    const userId = req.userId!;
    const { hash, sizeBytes, contentType } = parse.data;
    const quota = await getQuota(userId);
    if (quota.used + sizeBytes > quota.limit) {
      throw new AppError(413, 'quota_exceeded', 'Cloud sync storage quota exceeded');
    }

    const pool = getPool();
    const existing = await pool.query(
      'SELECT 1 FROM blob_objects WHERE user_id = $1 AND content_hash = $2',
      [userId, hash]
    );
    if (existing.rows.length > 0) {
      res.json({
        uploadUrl: null,
        expiresAt: null,
        alreadyExists: true,
      });
      return;
    }

    const storage = getStorage();
    if (!storage) {
      throw new AppError(503, 'storage_unavailable', 'Blob storage is not configured');
    }

    const storageKey = `blobs/${userId}/${hash.replace('sha256:', '')}.bin`;
    const uploadUrl = await storage.getSignedUploadUrl(storageKey, contentType, 3600, sizeBytes);

    res.json({
      uploadUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      alreadyExists: false,
    });
  } catch (error) {
    next(error);
  }
});

// POST /v1/blobs/complete
blobsRouter.post('/complete', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const parse = z
      .object({
        hash: z.string().regex(SHA256_HASH),
        sizeBytes: z.number().int().positive().max(512 * 1024 * 1024),
        contentType: z.string().min(1).default('application/octet-stream'),
      })
      .safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid blob complete payload');
    }
    const userId = req.userId!;
    const { hash, sizeBytes, contentType } = parse.data;
    const storageKey = `blobs/${userId}/${hash.replace('sha256:', '')}.bin`;

    const storage = getStorage();
    if (!storage) {
      throw new AppError(503, 'storage_unavailable', 'Blob storage is not configured');
    }

    const stored = await storage.getObject(storageKey);
    if (stored.length > sizeBytes) {
      throw new AppError(400, 'validation_error', 'Uploaded blob exceeds declared size');
    }

    const pool = getPool();
    const existing = await pool.query(
      'SELECT size_bytes FROM blob_objects WHERE user_id = $1 AND content_hash = $2',
      [userId, hash]
    );
    if (existing.rows.length === 0) {
      const quota = await getQuota(userId);
      if (quota.used + stored.length > quota.limit) {
        throw new AppError(413, 'quota_exceeded', 'Cloud sync storage quota exceeded');
      }
      await pool.query(
        `INSERT INTO blob_objects (user_id, content_hash, size_bytes, storage_key, content_type)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, hash, stored.length, storageKey, contentType]
      );
      await bumpUsage(userId, stored.length);
    }

    res.json({ ok: true, sizeBytes: stored.length });
  } catch (error) {
    next(error);
  }
});

// GET /v1/blobs/:hash/download-url
blobsRouter.get('/:hash/download-url', async (req: AuthRequest, res: Response, next) => {
  try {
    readProtocolVersion(req);
    const userId = req.userId!;
    const hash = req.params.hash;
    if (!SHA256_HASH.test(hash)) {
      throw new AppError(400, 'validation_error', 'Invalid blob hash');
    }
    const pool = getPool();
    const row = await pool.query(
      'SELECT storage_key FROM blob_objects WHERE user_id = $1 AND content_hash = $2',
      [userId, hash]
    );
    if (row.rows.length === 0) {
      throw new AppError(404, 'not_found', 'Blob not found');
    }
    const storage = getStorage();
    if (!storage) {
      throw new AppError(503, 'storage_unavailable', 'Blob storage is not configured');
    }
    const downloadUrl = await storage.getSignedDownloadUrl(row.rows[0].storage_key, 3600);
    res.json({
      downloadUrl,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    });
  } catch (error) {
    next(error);
  }
});
