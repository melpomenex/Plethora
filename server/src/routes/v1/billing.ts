import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';

export const billingRouter = Router();

const ValidatePurchaseSchema = z.object({
  provider: z.enum(['appstore', 'playstore', 'stripe', 'mock']),
  productId: z.string().min(1),
  transactionId: z.string().optional(),
  receiptData: z.string().optional(),
});

// POST /v1/billing/validate
billingRouter.post('/validate', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const parse = ValidatePurchaseSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Invalid purchase validation parameters');
    }
    const { provider, productId, transactionId } = parse.data;
    const userId = req.userId!;
    const pool = getPool();

    const purchaseId = uuidv4();
    const renewalDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Record purchase
    await pool.query(
      `INSERT INTO purchases (id, user_id, provider, product_id, status, transaction_id, period, renewal_date, created_at)
       VALUES ($1, $2, $3, $4, 'active', $5, 'monthly', $6, NOW())`,
      [purchaseId, userId, provider, productId, transactionId || `tx_${Date.now()}`, renewalDate]
    );

    // Upgrade user tier to pro
    await pool.query("UPDATE users SET subscription_tier = 'pro', updated_at = NOW() WHERE id = $1", [userId]);

    res.json({
      status: 'active',
      subscriptionTier: 'pro',
      productId,
      provider,
      renewalDate: renewalDate.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/billing/subscriptions
billingRouter.get('/subscriptions', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, provider, product_id as "productId", status, period,
              renewal_date as "renewalDate", created_at as "createdAt"
       FROM purchases WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    res.json({ subscriptions: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /v1/billing/restore
billingRouter.post('/restore', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const pool = getPool();

    const result = await pool.query(
      `SELECT id, provider, product_id as "productId", status, renewal_date as "renewalDate"
       FROM purchases WHERE user_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (result.rows.length > 0) {
      await pool.query("UPDATE users SET subscription_tier = 'pro', updated_at = NOW() WHERE id = $1", [userId]);
      return res.json({
        restored: true,
        subscription: result.rows[0],
      });
    }

    res.json({ restored: false, subscription: null });
  } catch (err) {
    next(err);
  }
});

// POST /v1/billing/webhooks/:provider
billingRouter.post('/webhooks/:provider', async (req, res: Response, next) => {
  try {
    const provider = req.params.provider;
    const body = req.body || {};
    const eventId = body.id || body.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const eventType = body.type || body.eventType || 'unknown';
    const pool = getPool();

    // Idempotency check via webhook_dedupe table
    const existing = await pool.query('SELECT event_id FROM webhook_dedupe WHERE event_id = $1', [eventId]);
    if (existing.rows.length > 0) {
      return res.status(200).json({ deduplicated: true });
    }

    // Insert into dedupe table
    await pool.query(
      'INSERT INTO webhook_dedupe (event_id, provider, processed_at) VALUES ($1, $2, NOW())',
      [eventId, provider]
    );

    // Insert audit event
    const eventRecordId = uuidv4();
    await pool.query(
      `INSERT INTO subscription_events (id, user_id, event_type, provider, payload_json, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [eventRecordId, body.userId || null, eventType, provider, JSON.stringify(body)]
    );

    res.status(200).json({ received: true, eventId });
  } catch (err) {
    next(err);
  }
});
