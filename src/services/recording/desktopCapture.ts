/**
 * Disk-backed Desktop Audio Capture Adapter.
 *
 * Implements bounded streaming capture:
 * - Probes getUserMedia / MediaRecorder / supported MIME types.
 * - Streams bounded chunks directly to append_recording_part over IPC.
 * - Caps in-flight writes to at most 2 concurrent parts (no full-session PCM or chunk arrays in memory).
 * - Implements pause, resume, finish, backpressure, and honest recovery reporting.
 */

import {
  appendRecordingPart,
  finalizeRecordingSession,
} from "../../api/recordingSessions";
import type {
  CaptureCapabilities,
  CaptureHandle,
  RecordingHealth,
  RecordingState,
  SessionOperationErrorCode,
} from "../../types/recordingSession";

export const SUPPORTED_CAPTURE_MIMES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
  "audio/wav",
] as const;

export const MAX_CONCURRENT_WRITES = 2;
export const MAX_PENDING_BYTES = 8 * 1024 * 1024; // 8 MiB backpressure cap
export const DEFAULT_TIMESLICE_MS = 1000;

export interface MediaRecorderLike {
  state: "inactive" | "recording" | "paused";
  stream: MediaStream;
  mimeType: string;
  start(timeslice?: number): void;
  stop(): void;
  pause(): void;
  resume(): void;
  ondataavailable: ((event: { data: Blob | ArrayBuffer }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onstop: (() => void) | null;
}

export interface DesktopCaptureParams {
  sessionId: string;
  writerEpoch?: string;
  preferredMime?: string;
  timesliceMs?: number;
  expectedVersion?: number;
  onHealthChange?: (health: RecordingHealth) => void;
  onStateChange?: (state: RecordingState) => void;
  // Injection hooks for deterministic unit testing
  stream?: MediaStream;
  recorderFactory?: (stream: MediaStream, options: { mimeType: string }) => MediaRecorderLike;
  appendPartFn?: typeof appendRecordingPart;
  finalizeSessionFn?: typeof finalizeRecordingSession;
}

/**
 * Checks system audio capture support and returns probe capabilities.
 */
export async function probeDesktopCaptureCapabilities(): Promise<CaptureCapabilities> {

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return {
      available: false,
      pause: false,
      background: false,
      liveCaptions: false,
      reason: "UnsupportedCapture",
    };
  }

  const mr =
    typeof MediaRecorder !== "undefined"
      ? MediaRecorder
      : typeof window !== "undefined"
        ? window.MediaRecorder
        : undefined;

  if (!mr) {
    return {
      available: false,
      pause: false,
      background: false,
      liveCaptions: false,
      reason: "UnsupportedCapture",
    };
  }

  const supportedMime = SUPPORTED_CAPTURE_MIMES.find((mime) => {
    try {
      return mr.isTypeSupported(mime);
    } catch {
      return false;
    }
  });

  if (!supportedMime) {
    return {
      available: false,
      pause: false,
      background: false,
      liveCaptions: false,
      reason: "UnsupportedCodec",
    };
  }

  const hasSpeechRec =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  return {
    available: true,
    pause: true,
    background: false, // Desktop background recording not certified
    liveCaptions: Boolean(hasSpeechRec),
  };
}

export const getDesktopCaptureCapabilities = probeDesktopCaptureCapabilities;

/**
 * Resolves the best supported MIME type for desktop capture.
 */
export function resolveBestSupportedMime(preferred?: string): string {
  const mr =
    typeof MediaRecorder !== "undefined"
      ? MediaRecorder
      : typeof window !== "undefined"
        ? window.MediaRecorder
        : undefined;

  if (
    preferred &&
    mr &&
    typeof mr.isTypeSupported === "function" &&
    mr.isTypeSupported(preferred)
  ) {
    return preferred;
  }

  if (mr && typeof mr.isTypeSupported === "function") {
    for (const mime of SUPPORTED_CAPTURE_MIMES) {
      if (mr.isTypeSupported(mime)) {
        return mime;
      }
    }
  }

  return "audio/webm;codecs=opus";
}

interface QueuedPart {
  sequence: number;
  startMs: number;
  durationMs: number;
  bytes: Uint8Array;
}

/**
 * Starts a disk-backed recording session with bounded in-flight memory.
 */
export async function startDesktopCapture(params: DesktopCaptureParams): Promise<CaptureHandle> {
  const {
    sessionId,
    writerEpoch = crypto.randomUUID ? crypto.randomUUID() : `epoch-${Date.now()}`,
    timesliceMs = DEFAULT_TIMESLICE_MS,
    expectedVersion = 1,
    onHealthChange,
    onStateChange,
    appendPartFn = appendRecordingPart,
    finalizeSessionFn = finalizeRecordingSession,
  } = params;

  const mime = resolveBestSupportedMime(params.preferredMime);

  // Acquire or use injected stream
  let stream = params.stream;
  if (!stream) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw {
        code: "UnsupportedCapture" as SessionOperationErrorCode,
        stage: "capture",
        sessionId,
        retryable: false,
        messageKey: "recording.unsupportedCapture",
      };
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 48000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch {
      throw {
        code: "PermissionDenied" as SessionOperationErrorCode,
        stage: "capture",
        sessionId,
        retryable: false,
        messageKey: "recording.permissionDenied",
      };
    }
  }

  // Create recorder
  let recorder: MediaRecorderLike;
  if (params.recorderFactory) {
    recorder = params.recorderFactory(stream, { mimeType: mime });
  } else {
    recorder = new MediaRecorder(stream, { mimeType: mime }) as unknown as MediaRecorderLike;
  }

  let state: RecordingState = "recording";
  let inFlightWrites = 0;
  let nextSequence = 0;
  let acknowledgedMs = 0;
  let pendingBytes = 0;
  let lastCommitAt: string | undefined;
  let currentPartStartMs = 0;
  let isBackpressured = false;
  let finishPromise: Promise<{ assetId: string; incomplete: boolean }> | null = null;

  const queue: QueuedPart[] = [];
  const writeErrors: unknown[] = [];

  const updateState = (newState: RecordingState) => {
    state = newState;
    onStateChange?.(newState);
    reportHealth();
  };

  const reportHealth = (errorCode?: SessionOperationErrorCode) => {
    onHealthChange?.({
      acknowledgedMs,
      pendingBytes,
      lastCommitAt,
      state,
      errorCode,
    });
  };

  const processQueue = () => {
    while (inFlightWrites < MAX_CONCURRENT_WRITES && queue.length > 0) {
      const part = queue.shift();
      if (!part) break;

      inFlightWrites++;

      appendPartFn({
        sessionId,
        writerEpoch,
        sequence: part.sequence,
        startMs: part.startMs,
        durationMs: part.durationMs,
        formatJson: JSON.stringify({ mime }),
        bytes: part.bytes,
      })
        .then((committed) => {
          inFlightWrites--;
          pendingBytes -= part.bytes.byteLength;
          acknowledgedMs = Math.max(acknowledgedMs, committed.startMs + committed.durationMs);
          lastCommitAt = committed.committedAt;

          // Check if backpressure can be relieved
          if (isBackpressured && pendingBytes < MAX_PENDING_BYTES / 2) {
            isBackpressured = false;
            if (recorder.state === "paused" && state === "recording") {
              try {
                recorder.resume();
              } catch {
                // Ignore resume errors if recorder was stopped
              }
            }
          }

          reportHealth();
          processQueue();
        })
        .catch((err) => {
          inFlightWrites--;
          pendingBytes -= part.bytes.byteLength;
          writeErrors.push(err);
          reportHealth("StorageUnavailable");
          processQueue();
        });
    }
  };

  const handleBlob = async (blobOrBuffer: Blob | ArrayBuffer) => {
    let bytes: Uint8Array;
    if (blobOrBuffer instanceof ArrayBuffer) {
      bytes = new Uint8Array(blobOrBuffer);
    } else if (typeof blobOrBuffer.arrayBuffer === "function") {
      bytes = new Uint8Array(await blobOrBuffer.arrayBuffer());
    } else {
      return;
    }

    if (bytes.byteLength === 0) return;

    const sequence = nextSequence++;
    const startMs = currentPartStartMs;
    // Approximate duration from timeslice or calculated delta
    const durationMs = timesliceMs;
    currentPartStartMs += durationMs;

    pendingBytes += bytes.byteLength;
    queue.push({ sequence, startMs, durationMs, bytes });

    // Apply backpressure if write queue exceeds bound
    if (pendingBytes >= MAX_PENDING_BYTES && !isBackpressured) {
      isBackpressured = true;
      if (recorder.state === "recording") {
        try {
          recorder.pause();
        } catch {
          // Ignore
        }
      }
    }

    reportHealth();
    processQueue();
  };

  recorder.ondataavailable = (event) => {
    if (event.data) {
      void handleBlob(event.data);
    }
  };

  recorder.onerror = () => {
    reportHealth("StorageUnavailable");
  };

  try {
    recorder.start(timesliceMs);
    updateState("recording");
  } catch (err) {
    stream.getTracks().forEach((track) => track.stop());
    throw err;
  }

  const handle: CaptureHandle = {
    sessionId,
    writerEpoch,

    async pause() {
      if (state === "recording" && recorder.state === "recording") {
        recorder.pause();
        updateState("paused");
      }
    },

    async resume() {
      if (state === "paused" && recorder.state === "paused") {
        recorder.resume();
        updateState("recording");
      }
    },

    async finish() {
      if (finishPromise) {
        return finishPromise;
      }

      finishPromise = (async () => {
        updateState("finalizing");

        // Stop recorder and wait for final data
        if (recorder.state !== "inactive") {
          await new Promise<void>((resolve) => {
            recorder.onstop = () => resolve();
            try {
              recorder.stop();
            } catch {
              resolve();
            }
          });
        }

        // Stop media tracks
        stream.getTracks().forEach((track) => track.stop());

        // Drain queue and in-flight writes
        while (inFlightWrites > 0 || queue.length > 0) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }

        // Finalize recording session in SQLite
        const finalSession = await finalizeSessionFn(sessionId, expectedVersion);
        const incomplete =
          finalSession.captureState === "recoverable" ||
          finalSession.ingestionState === "partial" ||
          writeErrors.length > 0;

        updateState(incomplete ? "recoverable" : "saved");

        return {
          assetId: finalSession.mediaAssetId ?? "",
          incomplete,
        };
      })();

      return finishPromise;
    },
  };

  return handle;
}
