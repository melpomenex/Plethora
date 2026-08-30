import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import type { Server } from 'http';
import { authRouter as v1AuthRouter } from './routes/v1/auth.js';
import { entitlementsRouter as v1EntitlementsRouter } from './routes/v1/entitlements.js';
import { jobsRouter as v1JobsRouter } from './routes/v1/jobs.js';
import { usageRouter as v1UsageRouter } from './routes/v1/usage.js';
import { transcriptionUsageRouter as v1TranscriptionUsageRouter } from './routes/v1/transcriptionUsage.js';
import { billingRouter as v1BillingRouter } from './routes/v1/billing.js';
import { syncRouter as v1SyncRouter } from './routes/v1/sync.js';
import { blobsRouter as v1BlobsRouter } from './routes/v1/blobs.js';
import { apiRouter as v1ApiRouter } from './routes/v1/api.js';
import { captureRouter as v1CaptureRouter, inboxRouter as v1InboxRouter } from './routes/v1/capture.js';
import { metricsRouter, metricsMiddleware } from './routes/v1/metrics.js';
import { authRouter as legacyAuthRouter } from './routes/auth.js';
import { oauthRouter as legacyOauthRouter } from './routes/oauth.js';
import { syncRouter } from './routes/sync.js';
import { filesRouter } from './routes/files.js';
import { documentsRouter } from './routes/documents.js';
import { videoExtractsRouter } from './routes/video-extracts.js';
import { errorHandler } from './middleware/error.js';
import type { AuthRequest } from './middleware/auth.js';
import { metricsAuthMiddleware } from './middleware/metricsAuth.js';
import { dbRateLimit } from './middleware/dbRateLimit.js';
import { initDatabase, checkDatabaseHealth, closeDatabase } from './db/connection.js';
import { initStorage } from './storage/index.js';
import { createCorsOrigin } from './config/cors.js';
import { getConfig, validateProductionConfig } from './config/env.js';

const app = express();
const config = getConfig();
const PORT = config.port;

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(compression());
app.use(
  cors({
    origin: createCorsOrigin(config),
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(metricsMiddleware);
app.use(
  dbRateLimit({
    windowMs: 60_000,
    max: 300,
    keyPrefix: 'api',
    keyFn: (req) => req.ip || 'unknown',
  })
);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', async (_req, res) => {
  const dbOk = await checkDatabaseHealth();
  if (!dbOk) {
    res.status(503).json({ status: 'not_ready', reason: 'database_unavailable' });
    return;
  }
  res.json({ status: 'ready', timestamp: new Date().toISOString() });
});

app.use('/metrics', metricsAuthMiddleware, metricsRouter);

// Plethora Cloud API v1 routes
app.use('/v1/auth', dbRateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  keyPrefix: 'auth',
  keyFn: (req) => req.ip || 'unknown',
}), v1AuthRouter);
app.use('/v1/entitlements', v1EntitlementsRouter);
app.use('/v1/jobs', v1JobsRouter);
app.use('/v1/usage', v1UsageRouter);
app.use('/v1/usage/transcription', v1TranscriptionUsageRouter);
app.use('/v1/billing', v1BillingRouter);
app.use(
  '/v1/sync',
  dbRateLimit({
    windowMs: 60_000,
    max: 120,
    keyPrefix: 'sync',
    keyFn: (req) => (req as AuthRequest).userId || req.ip || 'unknown',
  }),
  v1SyncRouter
);
app.use(
  '/v1/blobs',
  dbRateLimit({
    windowMs: 60_000,
    max: 60,
    keyPrefix: 'blobs',
    keyFn: (req) => (req as AuthRequest).userId || req.ip || 'unknown',
  }),
  v1BlobsRouter
);
app.use('/v1/api', v1ApiRouter);
app.use('/v1/capture', v1CaptureRouter);
app.use('/v1/inbox', v1InboxRouter);

if (config.enableLegacyRoutes) {
  // Legacy Yjs sync (`/sync`) remains dev-only; `/v1/sync/*` is the supported path.
  app.use('/auth', legacyAuthRouter);
  app.use('/auth', legacyOauthRouter);
  app.use('/sync', syncRouter);
  app.use('/files', filesRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/video-extracts', videoExtractsRouter);
}

app.use(errorHandler);

let httpServer: Server | null = null;
const SHUTDOWN_TIMEOUT_MS = 30_000;

async function start(): Promise<void> {
  const validationErrors = validateProductionConfig(config);
  if (validationErrors.length > 0) {
    console.error('Production configuration validation failed:');
    for (const err of validationErrors) {
      console.error(`  - ${err.field}: ${err.message}`);
    }
    process.exit(1);
  }

  try {
    await initDatabase();
    initStorage();

    httpServer = app.listen(PORT, () => {
      console.log(
        `Plethora Cloud server listening on port ${PORT} (env=${config.plethoraEnv}, legacy=${config.enableLegacyRoutes})`
      );
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully...`);

  const forceExit = setTimeout(() => {
    console.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    if (httpServer) {
      await new Promise<void>((resolve, reject) => {
        httpServer!.close((err) => (err ? reject(err) : resolve()));
      });
    }
    await closeDatabase();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    clearTimeout(forceExit);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  void start();
}

export { app, start, shutdown };
