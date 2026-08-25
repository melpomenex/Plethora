import type { GenerateSpeechResult } from "../tts";

const inflight = new Map<string, Promise<GenerateSpeechResult>>();

export function hasTTSGeneration(key: string): boolean {
  return inflight.has(key);
}

/** Live in-flight generation count (diagnostics snapshot, task 3.5). */
export function getTTSInFlightCount(): number {
  return inflight.size;
}

export function getOrCreateTTSGeneration(key: string, factory: () => Promise<GenerateSpeechResult>, signal?: AbortSignal): Promise<GenerateSpeechResult> {
  const existing = inflight.get(key);
  if (existing) return existing;
  let p = factory();
  if (signal) {
    const abortWrap = new Promise<GenerateSpeechResult>((_, reject) => {
      if (signal.aborted) reject(new DOMException("Aborted", "AbortError"));
      else signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    p = Promise.race([p, abortWrap]) as Promise<GenerateSpeechResult>;
  }
  inflight.set(key, p);
  p.finally(() => { if (inflight.get(key) === p) inflight.delete(key); }).catch(() => {});
  return p;
}

export function clearTTSDeduper(): void {
  inflight.clear();
}
