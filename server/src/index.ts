import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { authRouter as v1AuthRouter } from './routes/v1/auth.js';
import { entitlementsRouter as v1EntitlementsRouter } from './routes/v1/entitlements.js';
import { jobsRouter as v1JobsRouter } from './routes/v1/jobs.js';
import { usageRouter as v1UsageRouter } from './routes/v1/usage.js';
import { billingRouter as v1BillingRouter } from './routes/v1/billing.js';
import { syncRouter as v1SyncRouter } from './routes/v1/sync.js';
import { apiRouter as v1ApiRouter } from './routes/v1/api.js';
import { authRouter as legacyAuthRouter } from './routes/auth.js';
import { oauthRouter as legacyOauthRouter } from './routes/oauth.js';
import { syncRouter } from './routes/sync.js';
import { filesRouter } from './routes/files.js';
import { documentsRouter } from './routes/documents.js';
import { videoExtractsRouter } from './routes/video-extracts.js';
import { errorHandler } from './middleware/error.js';
import { initDatabase } from './db/connection.js';

const app = express();
const PORT = process.env.PORT || 3000;

const corsOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://localhost:15173',
  'http://localhost:8765',
];

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(compression());
app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Plethora Cloud API v1 routes
app.use('/v1/auth', v1AuthRouter);
app.use('/v1/entitlements', v1EntitlementsRouter);
app.use('/v1/jobs', v1JobsRouter);
app.use('/v1/usage', v1UsageRouter);
app.use('/v1/billing', v1BillingRouter);
app.use('/v1/sync', v1SyncRouter);
app.use('/v1/api', v1ApiRouter);

// Legacy routes (during transition)
app.use('/auth', legacyAuthRouter);
app.use('/auth', legacyOauthRouter);
app.use('/sync', syncRouter);
app.use('/files', filesRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/video-extracts', videoExtractsRouter);

// Error handler
app.use(errorHandler);

async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Plethora Cloud server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  start();
}

export { app };
