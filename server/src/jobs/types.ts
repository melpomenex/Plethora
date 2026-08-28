import type { z } from 'zod';
import type { StorageBackend } from '../storage/types.js';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobContext {
  jobId: string;
  userId: string;
  params: Record<string, unknown>;
  storage: StorageBackend;
  updateProgress(current: number, total: number, unit?: string): Promise<void>;
  isCancelled(): Promise<boolean>;
}

export interface JobResult {
  result?: Record<string, unknown>;
  resultRef?: string;
}

export interface JobKindDefinition {
  kind: string;
  paramsSchema: z.ZodType<Record<string, unknown>>;
  timeoutMs: number;
  maxAttempts: number;
  capability?: string;
  handler(ctx: JobContext): Promise<JobResult>;
}
