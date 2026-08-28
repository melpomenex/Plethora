import type { Request, Response, NextFunction } from 'express';
import { getConfig } from '../config/env.js';

/**
 * Protect /metrics with bearer token in production-like environments.
 */
export function metricsAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const config = getConfig();
  const isProdLike = config.plethoraEnv === 'production' || config.plethoraEnv === 'staging';

  if (!isProdLike || !config.metricsToken) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Metrics endpoint requires authentication' } });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (token !== config.metricsToken) {
    res.status(403).json({ error: { code: 'forbidden', message: 'Invalid metrics token' } });
    return;
  }

  next();
}
