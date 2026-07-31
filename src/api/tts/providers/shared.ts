import { mapHttpError, readProviderMessage, TTSServiceError } from "../errors";

export const MAX_RETRIES = 2;

export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runWithRetry<T>(provider: string, operation: () => Promise<T>): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= MAX_RETRIES) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;
      const retryable = error instanceof TTSServiceError && error.recoverable && attempt <= MAX_RETRIES;
      if (!retryable) break;
      await wait(200 * attempt);
    }
  }
  if (lastError instanceof TTSServiceError) throw lastError;
  throw new TTSServiceError(`Network error while contacting ${provider}.`, "network", true);
}

export async function fetchJson(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<unknown> {
  return runWithRetry(provider, async () => {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new TTSServiceError(error instanceof Error ? error.message : "Network error", "network", true);
    }
    if (!response.ok) throw mapHttpError(provider, response.status, await readProviderMessage(response));
    try {
      return await response.json();
    } catch {
      throw new TTSServiceError(`${provider} returned an invalid JSON response.`, "provider", true);
    }
  });
}

export function audioMime(format: string): string {
  switch (format) {
    case "wav": return "audio/wav";
    case "pcm": return "audio/pcm";
    case "opus": return "audio/ogg; codecs=opus";
    case "aac": return "audio/aac";
    default: return "audio/mpeg";
  }
}

export async function fetchBinary(
  provider: string,
  url: string,
  init: RequestInit,
  format: string,
): Promise<{ data: ArrayBuffer; mimeType: string }> {
  return runWithRetry(provider, async () => {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      throw new TTSServiceError(error instanceof Error ? error.message : "Network error", "network", true);
    }
    if (!response.ok) throw mapHttpError(provider, response.status, await readProviderMessage(response));
    const data = await response.arrayBuffer();
    if (!data.byteLength) throw new TTSServiceError(`${provider} returned empty audio response.`, "provider", true);
    return { data, mimeType: response.headers?.get("content-type") || audioMime(format) };
  });
}

export function binaryResult(
  provider: string,
  model: string,
  format: string,
  data: ArrayBuffer,
  mimeType = audioMime(format),
) {
  const audioUrl = URL.createObjectURL(new Blob([data], { type: mimeType }));
  return {
    audioUrl,
    audioData: data,
    mimeType,
    rawOutput: { provider, model, format },
  };
}
