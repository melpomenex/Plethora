import { Router, Response } from 'express';
import { getPool } from '../../db/connection.js';
import { authMiddleware, type AuthRequest } from '../../middleware/auth.js';

export const usageRouter = Router();

usageRouter.use(authMiddleware);

// GET /v1/usage
usageRouter.get('/', async (req: AuthRequest, res: Response, next) => {
  try {
    const userId = req.userId!;
    const pool = getPool();

    // Fetch quota states
    const quotaRes = await pool.query(
      `SELECT capability, used, limit_val as "limit", "window", resets_at as "resetsAt"
       FROM quota_state WHERE user_id = $1`,
      [userId]
    );

    const capabilities: Record<
      string,
      { used: number; limit: number; window: string; resetsAt?: string }
    > = {};

    let totalLimit = 0;
    let totalUsed = 0;

    for (const q of quotaRes.rows) {
      const used = Number(q.used);
      const limit = Number(q.limit);
      totalUsed += used;
      totalLimit += limit;
      capabilities[q.capability] = {
        used,
        limit,
        window: q.window,
        resetsAt: q.resetsAt ? new Date(q.resetsAt).toISOString() : undefined,
      };
    }

    // Compute today's cost usage
    const todayCostRes = await pool.query(
      `SELECT COALESCE(SUM(cost_usd_micros), 0) as "dailyCostUsdMicros"
       FROM usage_records
       WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
      [userId]
    );
    const dailyCostUsdMicros = Number(todayCostRes.rows[0]?.dailyCostUsdMicros || 0);

    // Set quota headers
    res.setHeader('X-Quota-Limit', String(totalLimit));
    res.setHeader('X-Quota-Used', String(totalUsed));
    res.setHeader('X-Quota-Remaining', String(Math.max(0, totalLimit - totalUsed)));

    res.json({
      capabilities,
      dailyCostUsdMicros,
      date: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});
