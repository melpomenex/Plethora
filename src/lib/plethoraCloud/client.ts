import { PLETHORA_API_URL } from '../../config/product';
import { useAccountStore } from '../../stores/accountStore';
import { isTauri, invoke } from '../tauri';
import type { QuotaState } from '../../types/entitlements';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface JobProgress {
  current: number;
  total: number;
  unit: string;
}

export interface CloudJob<TParams = unknown, TResult = unknown> {
  id: string;
  kind: string;
  status: JobStatus;
  params: TParams;
  progress?: JobProgress;
  result?: TResult;
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}

export interface UsageResponse {
  capabilities: Record<string, QuotaState>;
  dailyCostUsdMicros: number;
  date: string;
}

function getAuthHeader(): Record<string, string> {
  const tokens = useAccountStore.getState().tokens;
  if (tokens?.accessToken) {
    return { Authorization: `Bearer ${tokens.accessToken}` };
  }
  return {};
}

export async function submitCloudJob<TParams extends Record<string, unknown>, TResult = unknown>(
  kind: string,
  params: TParams,
  idempotencyKey?: string
): Promise<CloudJob<TParams, TResult>> {
  if (isTauri()) {
    try {
      const job = await invoke<CloudJob<TParams, TResult>>('cloud_job_submit', {
        kind,
        params,
        idempotencyKey,
      });
      if (job) return job;
    } catch {
      // Fallback to fetch
    }
  }

  const res = await fetch(`${PLETHORA_API_URL}/v1/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
    },
    body: JSON.stringify({ kind, params, idempotencyKey }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Job submission failed (${res.status})`);
  }

  return res.json();
}

export async function getCloudJobStatus<TParams = unknown, TResult = unknown>(
  jobId: string
): Promise<CloudJob<TParams, TResult>> {
  if (isTauri()) {
    try {
      const job = await invoke<CloudJob<TParams, TResult> | null>('cloud_job_get_status', { jobId });
      if (job) return job;
    } catch {
      // Fallback to fetch
    }
  }

  const res = await fetch(`${PLETHORA_API_URL}/v1/jobs/${jobId}`, {
    headers: getAuthHeader(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch job (${res.status})`);
  }

  return res.json();
}

export async function cancelCloudJob(jobId: string): Promise<boolean> {
  if (isTauri()) {
    try {
      const ok = await invoke<boolean>('cloud_job_cancel', { jobId });
      if (ok) return true;
    } catch {
      // Fallback to fetch
    }
  }

  const res = await fetch(`${PLETHORA_API_URL}/v1/jobs/${jobId}`, {
    method: 'DELETE',
    headers: getAuthHeader(),
  });

  return res.ok;
}

export async function getCloudUsage(): Promise<UsageResponse> {
  const res = await fetch(`${PLETHORA_API_URL}/v1/usage`, {
    headers: getAuthHeader(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Failed to fetch usage (${res.status})`);
  }

  return res.json();
}
