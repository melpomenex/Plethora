import 'dotenv/config';
import { initDatabase, getPool, closeDatabase } from './db/connection.js';
import { initStorage, getStorage } from './storage/index.js';
import { getConfig, validateProductionConfig } from './config/env.js';
import { listJobKinds, getJobKind } from './jobs/registry.js';
import './jobs/kinds/index.js';
import {
  claimNextJob,
  markJobSucceeded,
  markJobFailed,
  isJobCancelled,
  updateJobProgress,
  getTimeoutMs,
} from './jobs/queue.js';
import type { JobContext } from './jobs/types.js';
import { recordCloudJob } from './routes/v1/metrics.js';

const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '1000', 10);
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);

let running = true;
let activeJobs = 0;

async function executeJob(job: Awaited<ReturnType<typeof claimNextJob>>): Promise<void> {
  if (!job) return;

  const pool = getPool();
  const def = getJobKind(job.kind);
  if (!def) {
    await markJobFailed(pool, job.id, { code: 'unknown_kind', message: `Unknown kind ${job.kind}` }, false);
    recordCloudJob(job.kind, 'failed');
    return;
  }

  const ctx: JobContext = {
    jobId: job.id,
    userId: job.userId,
    params: def.paramsSchema.parse(job.params),
    storage: getStorage(),
    updateProgress: (current, total, unit = 'items') => updateJobProgress(pool, job.id, current, total, unit),
    isCancelled: () => isJobCancelled(pool, job.id),
  };

  const timeoutMs = getTimeoutMs(def);

  try {
    const result = await Promise.race([
      def.handler(ctx),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Job timeout')), timeoutMs)
      ),
    ]);

    if (await isJobCancelled(pool, job.id)) {
      await markJobFailed(pool, job.id, { code: 'cancelled', message: 'Job was cancelled' }, false);
      recordCloudJob(job.kind, 'failed');
      return;
    }

    await markJobSucceeded(pool, job.id, result.result ?? {}, result.resultRef);
    recordCloudJob(job.kind, 'succeeded');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Job failed';
    const requeue = job.attempts < job.maxAttempts;
    await markJobFailed(pool, job.id, { code: 'job_failed', message }, requeue);
    recordCloudJob(job.kind, 'failed');
  }
}

async function pollLoop(): Promise<void> {
  const kinds = listJobKinds();
  if (kinds.length === 0) {
    console.warn('[worker] No job kinds registered');
    return;
  }

  while (running) {
    while (activeJobs < CONCURRENCY && running) {
      const pool = getPool();
      const job = await claimNextJob(pool, kinds);
      if (!job) break;

      activeJobs++;
      void executeJob(job).finally(() => {
        activeJobs--;
      });
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  while (activeJobs > 0) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main(): Promise<void> {
  const config = getConfig();
  const errors = validateProductionConfig(config);
  if (errors.length > 0 && config.plethoraEnv === 'production') {
    console.error('[worker] Config validation failed:', errors);
    process.exit(1);
  }

  await initDatabase();
  initStorage();

  console.log(`[worker] Started (concurrency=${CONCURRENCY}, kinds=${listJobKinds().join(',')})`);

  process.on('SIGTERM', () => {
    console.log('[worker] SIGTERM received, draining...');
    running = false;
  });
  process.on('SIGINT', () => {
    running = false;
  });

  await pollLoop();
  await closeDatabase();
  console.log('[worker] Stopped');
  process.exit(0);
}

if (process.env.NODE_ENV !== 'test') {
  main().catch((err) => {
    console.error('[worker] Fatal error:', err);
    process.exit(1);
  });
}

export { pollLoop, executeJob };
