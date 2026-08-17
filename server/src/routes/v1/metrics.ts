import { Router, Request, Response, NextFunction } from 'express';

export const metricsRouter = Router();

interface MetricCounter {
  [labelKey: string]: number;
}

// In-memory Prometheus-compatible metric counters (content-free by construction)
const requestCounts: MetricCounter = {};
const jobCounts: MetricCounter = {};
const quotaExhaustionCounts: MetricCounter = {};

export function recordHttpRequest(method: string, route: string, statusCode: number): void {
  // Normalize high-cardinality routes (IDs/UUIDs replaced with :id)
  const normalizedRoute = route.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id');
  const key = `method="${method}",route="${normalizedRoute}",status="${statusCode}"`;
  requestCounts[key] = (requestCounts[key] || 0) + 1;
}

export function recordCloudJob(kind: string, status: 'succeeded' | 'failed'): void {
  const key = `kind="${kind}",status="${status}"`;
  jobCounts[key] = (jobCounts[key] || 0) + 1;
}

export function recordQuotaExhaustion(capability: string): void {
  const key = `capability="${capability}"`;
  quotaExhaustionCounts[key] = (quotaExhaustionCounts[key] || 0) + 1;
}

// Express middleware for automatic HTTP metrics tracking
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const route = req.baseUrl + (req.route?.path || req.path || '');
    recordHttpRequest(req.method, route, res.statusCode);
  });

  next();
}

// GET /metrics - Prometheus exposition format
metricsRouter.get('/', (_req: Request, res: Response): void => {
  const lines: string[] = [
    '# HELP plethora_http_requests_total Total number of HTTP requests processed.',
    '# TYPE plethora_http_requests_total counter',
  ];

  for (const [labels, count] of Object.entries(requestCounts)) {
    lines.push(`plethora_http_requests_total{${labels}} ${count}`);
  }

  lines.push('');
  lines.push('# HELP plethora_cloud_jobs_total Total number of background cloud compute jobs.');
  lines.push('# TYPE plethora_cloud_jobs_total counter');
  for (const [labels, count] of Object.entries(jobCounts)) {
    lines.push(`plethora_cloud_jobs_total{${labels}} ${count}`);
  }

  lines.push('');
  lines.push('# HELP plethora_quota_exhaustions_total Total quota exhaustion events.');
  lines.push('# TYPE plethora_quota_exhaustions_total counter');
  for (const [labels, count] of Object.entries(quotaExhaustionCounts)) {
    lines.push(`plethora_quota_exhaustions_total{${labels}} ${count}`);
  }

  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(lines.join('\n') + '\n');
});
