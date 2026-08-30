import { PLETHORA_API_URL, isCloudApiEnabled } from "../../config/product";
import { useAccountStore } from "../../stores/accountStore";
import { TranscriptionError } from "./errors";

export interface TranscriptionQuotaSnapshot {
  used: number;
  limit: number;
  window: "monthly";
  resetsAt: string;
  remaining: number;
}

function authHeaders(): Record<string, string> {
  const token = useAccountStore.getState().tokens?.accessToken;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseQuotaResponse(res: Response): Promise<TranscriptionQuotaSnapshot> {
  if (res.status === 429) {
    const payload = await res.json().catch(() => ({}));
    const message =
      (payload as { error?: { message?: string } }).error?.message ??
      "Premium transcription quota exceeded for this period.";
    throw new TranscriptionError(message, "INSUFFICIENT_BALANCE", { recoverable: false });
  }
  if (res.status === 403) {
    throw new TranscriptionError(
      "Premium transcription requires an active Pro subscription.",
      "INSUFFICIENT_BALANCE",
      { recoverable: false },
    );
  }
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const message =
      (payload as { error?: { message?: string } }).error?.message ??
      `Premium quota request failed (${res.status})`;
    throw new TranscriptionError(message, "PROVIDER_UNAVAILABLE", { recoverable: true });
  }
  return res.json() as Promise<TranscriptionQuotaSnapshot>;
}

export function canUseServerPremiumQuota(): boolean {
  if (!isCloudApiEnabled()) return false;
  return useAccountStore.getState().isAuthenticated;
}

export async function fetchServerTranscriptionQuota(): Promise<TranscriptionQuotaSnapshot> {
  const res = await fetch(`${PLETHORA_API_URL}/v1/usage/transcription`, {
    headers: authHeaders(),
  });
  return parseQuotaResponse(res);
}

export async function checkServerPremiumTranscriptionQuota(
  durationSeconds: number,
): Promise<TranscriptionQuotaSnapshot> {
  const res = await fetch(`${PLETHORA_API_URL}/v1/usage/transcription/check`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({ durationSeconds }),
  });
  return parseQuotaResponse(res);
}

export async function meterServerPremiumTranscriptionUsage(
  durationSeconds: number,
  options: { providerId?: string; model?: string; idempotencyKey?: string } = {},
): Promise<TranscriptionQuotaSnapshot> {
  const res = await fetch(`${PLETHORA_API_URL}/v1/usage/transcription/meter`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      durationSeconds,
      providerId: options.providerId,
      model: options.model,
      idempotencyKey: options.idempotencyKey,
    }),
  });
  return parseQuotaResponse(res);
}
