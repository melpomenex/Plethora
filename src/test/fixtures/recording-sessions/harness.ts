/** Test-only injectable seams; no native runtime, network or wall-clock waits. */
import type { SessionTranscriptSegment } from "../../../types/recordingSession";

export function createRecordingTestClock(initialMs = 0) {
  let current = initialMs;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

export type RecordingIOOperation = "write" | "sync" | "rename" | "manifest" | "database";

/** Files and DB acknowledgements are independent so tests can crash between them. */
export function createRecordingTestIO() {
  const files = new Map<string, Uint8Array>();
  const acknowledgements = new Set<string>();
  let nextFailure: RecordingIOOperation | undefined;
  const checkpoint = (operation: RecordingIOOperation) => {
    if (nextFailure !== operation) return;
    nextFailure = undefined;
    throw new Error(`Injected ${operation} failure`);
  };
  return {
    files,
    acknowledgements,
    failNext: (operation: RecordingIOOperation) => { nextFailure = operation; },
    write(path: string, bytes: Uint8Array) {
      checkpoint("write");
      files.set(path, bytes.slice());
    },
    sync() { checkpoint("sync"); },
    rename(from: string, to: string) {
      checkpoint("rename");
      const bytes = files.get(from);
      if (!bytes) throw new Error("Missing staged file");
      files.set(to, bytes);
      files.delete(from);
    },
    replaceManifest(path: string, bytes: Uint8Array) {
      checkpoint("manifest");
      files.set(path, bytes.slice());
    },
    acknowledge(key: string) {
      checkpoint("database");
      acknowledgements.add(key);
    },
  };
}

/** Provider responses resolve only when a test explicitly releases them. */
export function createRecordingTestProvider() {
  const calls: { unitKey: string; signal?: AbortSignal }[] = [];
  const pending: {
    resolve: (segments: SessionTranscriptSegment[]) => void;
    reject: (reason: Error) => void;
  }[] = [];
  return {
    calls,
    transcribe(unitKey: string, signal?: AbortSignal): Promise<SessionTranscriptSegment[]> {
      calls.push({ unitKey, signal });
      return new Promise((resolve, reject) => { pending.push({ resolve, reject }); });
    },
    completeNext(segments: SessionTranscriptSegment[]) {
      const request = pending.shift();
      if (!request) throw new Error("No pending provider request");
      request.resolve(structuredClone(segments));
    },
    failNext(error: Error) {
      const request = pending.shift();
      if (!request) throw new Error("No pending provider request");
      request.reject(error);
    },
  };
}

/** Lazy event stream: 90 minutes allocates one small chunk at a time. */
export function* recordingTimeline(durationMs = 90 * 60_000, partMs = 5_000) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 0 || !Number.isSafeInteger(partMs) || partMs <= 0) {
    throw new Error("Invalid recording timeline duration");
  }
  for (let startMs = 0, sequence = 0; startMs < durationMs; startMs += partMs, sequence += 1) {
    yield { sequence, startMs, durationMs: Math.min(partMs, durationMs - startMs), bytes: new Uint8Array(320) };
  }
}
