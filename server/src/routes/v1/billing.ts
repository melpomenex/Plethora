import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import {
  verifyAppleJws,
  trustedRootFingerprints,
  type VerifiedAppStoreTransaction,
} from '../../billing/jws.js';
import { deriveGrant, selectWinningGrant, PRO_GRACE_MS } from '../../billing/grants.js';
import {
  parseNotification,
  notificationIdempotencyKey,
  notificationAction,
} from '../../billing/asns.js';

export const billingRouter = Router();

/**
 * JWS verification options shared by all routes (bundle id + trusted roots
 * come from env so sandbox fixtures and production agree).
 */
function jwsOptions(): Parameters<typeof verifyAppleJws>[1] {
  return {
    bundleId: process.env.APP_STORE_BUNDLE_ID?.trim() || undefined,
    trustedRoots: trustedRootFingerprints(process.env.APP_STORE_TRUSTED_ROOT_SHA256),
  };
}

const ValidateJwsSchema = z.object({
  // Signed transaction JWS from StoreKit 2 — the only trusted purchase proof.
  jws: z.string().min(20),
  provider: z.enum(['appstore', 'playstore', 'stripe', 'mock']).optional(),
});

/**
 * Upsert a verified transaction keyed by original_transaction_id and bind it
 * to a user. Binding policy (design decision 4): the authenticated requester
 * claims the row when unbound; an already-bound row keeps its owner unless
 * the same appAccountToken re-binds at sign-in (anonymous purchase → account).
 */
async function upsertVerifiedTransaction(
  tx: VerifiedAppStoreTransaction,
  userId: string | null
): Promise<{ id: string; boundUserId: string | null }> {
  const pool = getPool();
  const grant = deriveGrant(tx);
  const expiresAt = tx.expiresDate ? new Date(tx.expiresDate) : null;
  const revocationAt = tx.revocationDate ? new Date(tx.revocationDate) : null;
  const signedDate = tx.signedDate ? new Date(tx.signedDate) : null;

  const existing = await pool.query(
    `SELECT id, user_id, app_account_token FROM store_transactions WHERE original_transaction_id = $1`,
    [tx.originalTransactionId]
  );

  if (existing.rows.length === 0) {
    const id = uuidv4();
    await pool.query(
      `INSERT INTO store_transactions (
         id, original_transaction_id, transaction_id, user_id, product_id,
         environment, status, app_account_token, expires_at, revocation_at,
         revocation_reason, signed_payload, signed_date, verified_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())`,
      [
        id,
        tx.originalTransactionId,
        tx.transactionId,
        userId,
        tx.productId,
        tx.environment,
        grant.status,
        tx.appAccountToken ?? null,
        expiresAt,
        revocationAt,
        tx.revocationReason ?? null,
        JSON.stringify(tx),
        signedDate,
      ]
    );
    return { id, boundUserId: userId };
  }

  const row = existing.rows[0];
  let boundUserId: string | null = row.user_id ?? null;
  if (!boundUserId && userId) {
    boundUserId = userId;
  }
  await pool.query(
    `UPDATE store_transactions SET
       transaction_id = $1, product_id = $2, environment = $3, status = $4,
       user_id = $5, expires_at = $6, revocation_at = $7,
       revocation_reason = $8, signed_payload = $9, signed_date = $10,
       updated_at = NOW()
     WHERE original_transaction_id = $11`,
    [
      tx.transactionId,
      tx.productId,
      tx.environment,
      grant.status,
      boundUserId,
      expiresAt,
      revocationAt,
      tx.revocationReason ?? null,
      JSON.stringify(tx),
      signedDate,
      tx.originalTransactionId,
    ]
  );
  return { id: row.id as string, boundUserId };
}

/** Re-derive a user's tier from ALL their verified transactions. */
async function recomputeUserTier(userId: string): Promise<'pro' | 'free'> {
  const pool = getPool();
  const own = await pool.query(
    `SELECT signed_payload FROM store_transactions WHERE user_id = $1 AND status != 'revoked'`,
    [userId]
  );
  const ownTx = own.rows.map((r) => JSON.parse(r.signed_payload) as VerifiedAppStoreTransaction);

  const winning = selectWinningGrant(ownTx, Date.now(), PRO_GRACE_MS);
  const tier: 'pro' | 'free' = winning && (winning.status === 'active' || winning.status === 'grace') ? 'pro' : 'free';
  await pool.query('UPDATE users SET subscription_tier = $1, updated_at = NOW() WHERE id = $2', [
    tier,
    userId,
  ]);
  return tier;
}

// POST /v1/billing/validate — verify a signed StoreKit 2 transaction JWS.
// Anything unverifiable is rejected with verification_failed and NEVER granted.
billingRouter.post('/validate', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const parse = ValidateJwsSchema.safeParse(req.body);
    if (!parse.success) {
      throw new AppError(400, 'validation_error', 'Provide the signed transaction `jws` string');
    }
    const { jws } = parse.data;
    const result = verifyAppleJws(jws, jwsOptions());
    if (!result.ok || !result.payload) {
      throw new AppError(
        422,
        'verification_failed',
        `Transaction could not be verified (${result.reason}: ${result.detail ?? ''})`
      );
    }

    const tx = result.payload;
    const userId = req.userId!;
    const { boundUserId } = await upsertVerifiedTransaction(tx, userId);
    const tier = boundUserId ? await recomputeUserTier(boundUserId) : 'free';

    const grant = deriveGrant(tx);
    res.json({
      status: grant.status,
      subscriptionTier: tier,
      productId: tx.productId,
      originalTransactionId: tx.originalTransactionId,
      environment: tx.environment,
    });
  } catch (err) {
    next(err);
  }
});

// GET /v1/billing/subscriptions — VERIFIED data only. Legacy `purchases`
// rows (verified=FALSE, the pre-verification era) are invisible here by design.
billingRouter.get('/subscriptions', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const pool = getPool();
    const result = await pool.query(
      `SELECT original_transaction_id as "originalTransactionId",
              transaction_id as "transactionId",
              product_id as "productId",
              environment,
              status,
              app_account_token as "appAccountToken",
              expires_at as "expiresAt",
              revocation_at as "revocationAt",
              updated_at as "updatedAt"
       FROM store_transactions WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );
    const tier = await recomputeUserTier(userId);
    res.json({ subscriptions: result.rows, subscriptionTier: tier });
  } catch (err) {
    next(err);
  }
});

// POST /v1/billing/restore — re-derive entitlements from VERIFIED
// transactions only (never from legacy purchases rows).
billingRouter.post('/restore', authMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const pool = getPool();
    const result = await pool.query(
      `SELECT signed_payload, status FROM store_transactions
       WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    if (result.rows.length === 0) {
      await recomputeUserTier(userId);
      return res.json({ restored: false, subscription: null });
    }
    const transactions = result.rows.map((r) => JSON.parse(r.signed_payload) as VerifiedAppStoreTransaction);
    const winning = selectWinningGrant(transactions, Date.now(), PRO_GRACE_MS);
    const restored =
      !!winning && (winning.status === 'active' || winning.status === 'grace');
    const tier = await recomputeUserTier(userId);
    return res.json({
      restored,
      subscriptionTier: tier,
      subscription: winning
        ? {
            productId: winning.productId,
            originalTransactionId: winning.originalTransactionId,
            status: winning.status,
            expiresAt: winning.expiresAt,
          }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /v1/billing/webhooks/:provider — ASNS v2 for `appstore`.
// The signedPayload is verified against Apple's certificate chain BEFORE any
// dedupe/handling; signature mismatches are rejected outright. Idempotent by
// notification identity (notificationUUID → webhook_dedupe). Legacy generic
// webhooks for other providers keep the previous dedupe+audit behavior.
billingRouter.post('/webhooks/:provider', async (req, res: Response, next) => {
  try {
    const provider = req.params.provider;
    const body = req.body || {};
    const pool = getPool();

    if (provider !== 'appstore') {
      // Legacy path: event-id dedupe + audit insert (unchanged behavior).
      const eventId = body.id || body.eventId || `evt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const eventType = body.type || body.eventType || 'unknown';
      const existing = await pool.query('SELECT event_id FROM webhook_dedupe WHERE event_id = $1', [eventId]);
      if (existing.rows.length > 0) {
        return res.status(200).json({ deduplicated: true });
      }
      await pool.query('INSERT INTO webhook_dedupe (event_id, provider, processed_at) VALUES ($1, $2, NOW())', [
        eventId,
        provider,
      ]);
      await pool.query(
        `INSERT INTO subscription_events (id, user_id, event_type, provider, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), body.userId || null, eventType, provider, JSON.stringify(body)]
      );
      return res.status(200).json({ received: true, eventId });
    }

    // ASNS v2: signature verification is mandatory.
    const rawSignedPayload = typeof body.signedPayload === 'string' ? body.signedPayload : '';
    if (!rawSignedPayload) {
      throw new AppError(400, 'missing_signed_payload', 'ASNS v2 requires a signedPayload JWS string');
    }
    const parsed = parseNotification(rawSignedPayload, jwsOptions());
    if (!parsed.ok) {
      throw new AppError(
        422,
        'verification_failed',
        `signedPayload rejected (${parsed.reason})`
      );
    }

    const idempotencyKey = notificationIdempotencyKey(rawSignedPayload, parsed.notification?.notificationUUID);
    const existing = await pool.query('SELECT event_id FROM webhook_dedupe WHERE event_id = $1', [idempotencyKey]);
    if (existing.rows.length > 0) {
      return res.status(200).json({ deduplicated: true });
    }

    // Unhandled-but-valid types are recorded + acknowledged.
    if (parsed.unhandledType || !parsed.notification) {
      await pool.query('INSERT INTO webhook_dedupe (event_id, provider, processed_at) VALUES ($1, $2, NOW())', [
        idempotencyKey,
        provider,
      ]);
      return res.status(200).json({ received: true, handled: false });
    }

    const notification = parsed.notification;
    const action = notificationAction(notification);

    // Record the notification identity before applying effects (replay-safe).
    await pool.query('INSERT INTO webhook_dedupe (event_id, provider, processed_at) VALUES ($1, $2, NOW())', [
      idempotencyKey,
      provider,
    ]);
    await pool.query(
      `INSERT INTO subscription_events (id, user_id, event_type, provider, payload_json, created_at)
       VALUES ($1, NULL, $2, 'appstore', $3, NOW())`,
      [uuidv4(), `${notification.notificationType}${notification.subtype ? `/${notification.subtype}` : ''}`, JSON.stringify({ notificationUUID: notification.notificationUUID })]
    );

    // Apply the embedded (verified) transaction state.
    const { boundUserId } = await upsertVerifiedTransaction(notification.transaction, null);

    if (action.tierAction === 'downgrade') {
      // Revocation/refund: drop the affected row to revoked, then re-derive
      // the owner's tier from their remaining verified transactions.
      if (boundUserId) await recomputeUserTier(boundUserId);
    } else if (action.tierAction === 'upgrade' && boundUserId) {
      await recomputeUserTier(boundUserId);
    }

    return res.status(200).json({ received: true, handled: true });
  } catch (err) {
    next(err);
  }
});
