import type { GenerateSpeechResult } from "../tts";

interface Generation {
  promise: Promise<GenerateSpeechResult>;
  controller: AbortController;
  consumers: Set<symbol>;
}
const inflight = new Map<string, Generation>();

export function hasTTSGeneration(key: string): boolean {
  return inflight.has(key);
}
export function getTTSInFlightCount(): number {
  return inflight.size;
}

export function getOrCreateTTSGeneration(
  key: string,
  factory: (signal: AbortSignal) => Promise<GenerateSpeechResult>,
  signal?: AbortSignal
): Promise<GenerateSpeechResult> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  let generation = inflight.get(key);
  if (!generation) {
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      return factory(controller.signal);
    });
    generation = { promise, controller, consumers: new Set() };
    inflight.set(key, generation);
    const current = generation;
    void promise
      .finally(() => {
        if (inflight.get(key) === current) inflight.delete(key);
      })
      .catch(() => {});
  }
  const current = generation;
  const consumer = Symbol();
  current.consumers.add(consumer);
  return new Promise((resolve, reject) => {
    let settled = false;
    const release = () => {
      signal?.removeEventListener("abort", abort);
      current.consumers.delete(consumer);
      if (!current.consumers.size && inflight.get(key) === current) {
        inflight.delete(key);
        current.controller.abort();
      }
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      release();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    current.promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        release();
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        release();
        reject(error);
      }
    );
  });
}

export function clearTTSDeduper(): void {
  for (const generation of inflight.values()) generation.controller.abort();
  inflight.clear();
}
