import { Router, Response } from 'express';
import { z } from 'zod';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import {
  checkTranscriptionQuota,
  getTranscriptionQuota,
  meterTranscriptionQuota,
} from '../../quota/transcription.js';

export const transcriptionUsageRouter = Router();

transcriptionUsageRouter.use(authMiddleware);

const durationSchema = z.object({
  durationSeconds: z.number().finite().min(0).max(24 * 60 * 60),
});

const meterSchema = durationSchema.extend({
  providerId: z.string().max(120).optional(),
  model: z.string().max(120).optional(),
  idempotencyKey: z.string().max(255).optional(),
});

function setQuotaHeaders(
  res: Response,
  snapshot: { used: number; limit: number; remaining: number }
): void {
  res.setHeader('X-Quota-Used', String(snapshot.used));
  res.setHeader('X-Quota-Limit', String(snapshot.limit));
  res.setHeader('X-Quota-Remaining', String(snapshot.remaining));
}

function handleQuotaError(err: unknown, res: Response, next: (err: unknown) => void): void {
  if (err instanceof AppError && err.code === 'quota_exceeded') {
    res.setHeader('X-Quota-Remaining', '0');
    if (err.retryAfter) {
      res.setHeader('Retry-After', String(err.retryAfter));
    }
  }
  next(err);
}

/** GET /v1/usage/transcription — current premium transcription quota snapshot. */
transcriptionUsageRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const snapshot = await getTranscriptionQuota(req.userId!);
    setQuotaHeaders(res, snapshot);
    res.json(snapshot);
  } catch (err) {
    handleQuotaError(err, res, next);
  }
});

/** POST /v1/usage/transcription/check — pre-flight without metering. */
transcriptionUsageRouter.post('/check', async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = durationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'invalid_input', 'durationSeconds must be a non-negative number.');
    }
    const snapshot = await checkTranscriptionQuota(req.userId!, parsed.data.durationSeconds);
    setQuotaHeaders(res, snapshot);
    res.json({ allowed: true, ...snapshot });
  } catch (err) {
    handleQuotaError(err, res, next);
  }
});

/** POST /v1/usage/transcription/meter — record premium transcription usage (seconds). */
transcriptionUsageRouter.post('/meter', async (req: AuthRequest, res: Response, next) => {
  try {
    const parsed = meterSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, 'invalid_input', 'Invalid transcription meter payload.');
    }
    const snapshot = await meterTranscriptionQuota(req.userId!, parsed.data.durationSeconds, {
      providerId: parsed.data.providerId,
      model: parsed.data.model,
      idempotencyKey: parsed.data.idempotencyKey,
    });
    setQuotaHeaders(res, snapshot);
    res.json(snapshot);
  } catch (err) {
    handleQuotaError(err, res, next);
  }
});
