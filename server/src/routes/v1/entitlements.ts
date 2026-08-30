import { Router, Response } from 'express';
import { getPool } from '../../db/connection.js';
import { optionalAuthMiddleware, type AuthRequest } from '../../middleware/auth.js';
import { getTranscriptionQuota, TRANSCRIPTION_CAPABILITY } from '../../quota/transcription.js';

export const entitlementsRouter = Router();

// 18 canonical capability IDs from proposal 2
const ALL_CAPABILITIES = [
  'cloud_sync',
  'cloud_backup',
  'library_intelligence',
  'semantic_connections',
  'knowledge_graph',
  'knowledge_gap_detection',
  'adaptive_learning_paths',
  'ai_tutoring',
  'enhanced_card_generation',
  'card_optimizer',
  'advanced_analytics',
  'cloud_document_processing',
  'premium_tts',
  'transcription',
  'web_capture',
  'integrations',
  'automation',
  'api_access',
];

// GET /v1/entitlements
entitlementsRouter.get('/', optionalAuthMiddleware, async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId;

    // A presented-but-rejected bearer is an authentication failure, not an
    // anonymous request: answering 200-Free here used to let an expired
    // access token masquerade as an authoritative downgrade to Free on the
    // client. Genuinely anonymous requests (no bearer) keep the 200 Free
    // snapshot.
    if (!userId && req.authRejected) {
      res.status(401).json({
        error: {
          code: req.authError ?? 'invalid_token',
          message:
            req.authError === 'token_expired'
              ? 'Access token has expired'
              : 'Access token is invalid',
        },
      });
      return;
    }

    if (!userId) {
      // Anonymous user: Free default snapshot
      const capabilities: Record<string, { enabled: boolean; reason?: string }> = {};
      for (const cap of ALL_CAPABILITIES) {
        capabilities[cap] = {
          enabled: false,
          reason: 'plan',
        };
      }
      return res.json({
        accountId: null,
        plan: 'free',
        capabilities,
        fetchedAt: new Date().toISOString(),
        expiresAt: null,
        source: 'server',
      });
    }

    const pool = getPool();
    const userRes = await pool.query('SELECT subscription_tier FROM users WHERE id = $1', [userId]);
    const tier = userRes.rows[0]?.subscription_tier || 'free';
    const isPro = tier === 'pro';

    // Fetch custom capability grants if overridden in DB
    const grantsRes = await pool.query('SELECT capability, enabled, reason FROM capability_grants WHERE user_id = $1', [
      userId,
    ]);
    const grantOverrides = new Map<string, { enabled: boolean; reason?: string }>();
    for (const row of grantsRes.rows) {
      grantOverrides.set(row.capability, { enabled: row.enabled, reason: row.reason || undefined });
    }

    // Fetch quota states
    const quotaRes = await pool.query(
      'SELECT capability, used, limit_val as "limit", "window", resets_at as "resetsAt" FROM quota_state WHERE user_id = $1',
      [userId]
    );
    const quotas = new Map<string, unknown>();
    for (const q of quotaRes.rows) {
      quotas.set(q.capability, {
        used: Number(q.used),
        limit: Number(q.limit),
        window: q.window,
        resetsAt: q.resetsAt ? new Date(q.resetsAt).toISOString() : undefined,
      });
    }

    if (isPro && !quotas.has(TRANSCRIPTION_CAPABILITY)) {
      try {
        const transcriptionQuota = await getTranscriptionQuota(userId);
        quotas.set(TRANSCRIPTION_CAPABILITY, {
          used: transcriptionQuota.used,
          limit: transcriptionQuota.limit,
          window: transcriptionQuota.window,
          resetsAt: transcriptionQuota.resetsAt,
        });
      } catch {
        // Quota row initialization is best-effort for entitlement display.
      }
    }

    const capabilities: Record<string, { enabled: boolean; reason?: string; quota?: unknown }> = {};
    for (const cap of ALL_CAPABILITIES) {
      if (grantOverrides.has(cap)) {
        const override = grantOverrides.get(cap)!;
        capabilities[cap] = {
          enabled: override.enabled,
          reason: override.reason,
          quota: quotas.get(cap),
        };
      } else {
        capabilities[cap] = {
          enabled: isPro,
          reason: isPro ? undefined : 'plan',
          quota: quotas.get(cap),
        };
      }
    }

    res.json({
      accountId: userId,
      plan: tier,
      capabilities,
      fetchedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      source: 'server',
    });
  } catch (err) {
    next(err);
  }
});
