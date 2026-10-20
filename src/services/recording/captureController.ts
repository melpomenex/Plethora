/**
 * Central Recording Capture Controller.
 *
 * Implements unified capture coordination across platforms:
 * - Single mic lease via captureOwner (authoritative token/epoch).
 * - Routes to Desktop, Android, or Apple iOS disk-first capture adapters.
 * - Enforces D3 lifecycle transitions and race-free state management.
 * - Double-start protection, finish deduplication, and honest interruption handling.
 * - Safe-stop on background/device policy, never silently discarding committed audio.
 * - Preserves active recording across navigation, component unmount, and view minimization.
 */

import {
  acquireAudioCapture,
} from "../../lib/speech/captureOwner";
import {
  useRecordingSessionStore,
} from "../../stores/recordingSessionStore";
import type {
  CaptureCapabilities,
  CaptureHandle,
  RecordingHealth,
  RecordingState,
  SessionOperationError,
} from "../../types/recordingSession";
import {
  createRecordingSession,
  finalizeRecordingSession,
  isRecordingPersistenceAvailable,
  recoverRecordingSession,
} from "../../api/recordingSessions";
import {
  getDesktopCaptureCapabilities,
  startDesktopCapture,
} from "./desktopCapture";
import {
  getAndroidCaptureCapabilities,
  isAndroidCaptureAvailable,
  startAndroidCapture,
} from "./androidCapture";
import {
  getAppleCaptureCapabilities,
  isAppleCaptureAvailable,
  startAppleCapture,
} from "./appleCapture";

export interface StartCaptureOptions {
  sessionId?: string;
  documentId?: string;
  title?: string;
  contentType?: string;
  sampleRate?: number;
  channels?: number;
}

export class CaptureController {
  private activeHandle: CaptureHandle | null = null;
  private releaseLease: (() => void) | null = null;
  private activeEpoch: string | null = null;
  private finishPromise: Promise<{ assetId: string; incomplete: boolean }> | null = null;

  /** Platform probe */
  public async getCapabilities(): Promise<CaptureCapabilities> {
    if (isAndroidCaptureAvailable()) {
      return getAndroidCaptureCapabilities();
    }
    if (isAppleCaptureAvailable()) {
      return getAppleCaptureCapabilities();
    }
    return getDesktopCaptureCapabilities();
  }

  public get state(): RecordingState {
    return useRecordingSessionStore.getState().state;
  }

  public get activeSessionId(): string | null {
    return useRecordingSessionStore.getState().activeSessionId;
  }

  /**
   * Start a new recording or continue an existing session with a new part.
   * Guarded against double-start and concurrent requests.
   */
  public async start(options: StartCaptureOptions = {}): Promise<CaptureHandle> {
    const store = useRecordingSessionStore.getState();

    // Double-start protection: if already recording or requesting permission, return active handle
    if (store.state === "recording" || store.state === "requesting-permission") {
      if (this.activeHandle) {
        return this.activeHandle;
      }
      throw new Error("Recording is already in progress");
    }

    const sessionId = options.sessionId || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const epoch = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.activeEpoch = epoch;

    // Transition to requesting-permission
    store.transition({ type: "START" });
    store.setActiveSession(sessionId, null, epoch);
    store.setHealth({ acknowledgedMs: 0, pendingBytes: 0, lastCommitAt: undefined });
    store.setError(null);

    // Acquire exclusive microphone lease
    let lease: () => void;
    try {
      lease = acquireAudioCapture({
        owner: "recording",
        sessionId,
        epoch,
      });
      this.releaseLease = lease;
    } catch (err) {
      store.transition({ type: "INIT_FAILED" });
      const opError: SessionOperationError = {
        code: "CaptureBusy",
        stage: "capture",
        sessionId,
        retryable: true,
        messageKey: "recording.captureBusy",
      };
      store.setError(opError);
      throw err;
    }

    // Persist recording session row if supported and not already created
    if (isRecordingPersistenceAvailable() && !options.sessionId) {
      try {
        await createRecordingSession({
          id: sessionId,
          documentId: options.documentId,
          title: options.title || `Recording ${new Date().toLocaleString()}`,
          contentType: options.contentType || "lecture",
          origin: "recorded",
          profileJson: "{}",
        });
      } catch (err) {
        console.warn("[CaptureController] Failed to persist initial session row:", err);
      }
    }

    // Launch appropriate platform capture adapter
    try {
      let handle: CaptureHandle;

      const onHealthChange = (health: RecordingHealth) => {
        // Drop stale callbacks from old epochs
        if (this.activeEpoch !== epoch) return;
        store.setHealth(health);
      };

      const onStateChange = (state: RecordingState) => {
        // Drop stale callbacks from old epochs
        if (this.activeEpoch !== epoch) return;
        if (state === "recording") {
          store.transition({ type: "MIC_READY" });
        } else if (state === "paused") {
          store.transition({ type: "PAUSE" });
        } else if (state === "failed") {
          store.transition({ type: "INIT_FAILED" });
        }
      };

      if (isAndroidCaptureAvailable()) {
        handle = await startAndroidCapture({
          sessionId,
          writerEpoch: epoch,
          sampleRate: options.sampleRate,
          channels: options.channels,
          onHealthChange,
          onStateChange,
        });
      } else if (isAppleCaptureAvailable()) {
        handle = await startAppleCapture({
          sessionId,
          writerEpoch: epoch,
          sampleRate: options.sampleRate,
          channels: options.channels,
          onHealthChange,
          onStateChange,
        });
      } else {
        handle = await startDesktopCapture({
          sessionId,
          writerEpoch: epoch,
          onHealthChange,
          onStateChange,
        });
      }

      this.activeHandle = handle;
      store.transition({ type: "MIC_READY" });
      return handle;
    } catch (err) {
      this.safeReleaseLease();
      store.transition({ type: "INIT_FAILED" });
      const opError: SessionOperationError = {
        code: "PermissionDenied",
        stage: "capture",
        sessionId,
        retryable: true,
        messageKey: "recording.permissionDenied",
      };
      store.setError(opError);
      throw err;
    }
  }

  /**
   * Pause recording if supported.
   */
  public async pause(): Promise<void> {
    const store = useRecordingSessionStore.getState();
    if (store.state !== "recording" || !this.activeHandle) return;

    try {
      await this.activeHandle.pause();
      store.transition({ type: "PAUSE" });
    } catch (err) {
      console.warn("[CaptureController] Pause failed:", err);
    }
  }

  /**
   * Resume recording from paused or interrupted state.
   */
  public async resume(): Promise<void> {
    const store = useRecordingSessionStore.getState();
    if (!this.activeHandle) {
      if (store.state === "interrupted" || store.state === "recoverable") {
        // Continue capture as a new part
        await this.continueCapture();
        return;
      }
      return;
    }

    if (store.state === "paused") {
      try {
        await this.activeHandle.resume();
        store.transition({ type: "RESUME" });
      } catch (err) {
        console.warn("[CaptureController] Resume failed:", err);
      }
    }
  }

  /**
   * Finish recording and finalize durable assets.
   * Deduplicates concurrent finish calls to drain exactly once.
   */
  public finish(): Promise<{ assetId: string; incomplete: boolean }> {
    if (this.finishPromise) {
      return this.finishPromise;
    }

    const store = useRecordingSessionStore.getState();
    const handle = this.activeHandle;
    const sessionId = store.activeSessionId;

    if (!handle || !sessionId) {
      return Promise.resolve({ assetId: store.activeAssetId || "", incomplete: false });
    }

    store.transition({ type: "FINISH" });

    this.finishPromise = (async () => {
      try {
        const finishRes = await handle.finish();
        store.setActiveSession(sessionId, finishRes.assetId, this.activeEpoch);

        // Finalize session in SQLite database if supported
        if (isRecordingPersistenceAvailable()) {
          try {
            await finalizeRecordingSession(sessionId, 1);
          } catch (finalizeErr) {
            console.warn("[CaptureController] SQLite finalize notice:", finalizeErr);
          }
        }

        store.transition({ type: "SAVE_SUCCESS" });
        return finishRes;
      } catch (err) {
        console.error("[CaptureController] Finish error:", err);
        store.transition({ type: "SAVE_FAILED" });
        const opError: SessionOperationError = {
          code: "StorageUnavailable",
          stage: "capture",
          sessionId,
          retryable: true,
          messageKey: "recording.storageUnavailable",
        };
        store.setError(opError);
        throw err;
      } finally {
        this.safeReleaseLease();
        this.activeHandle = null;
        this.finishPromise = null;
      }
    })();

    return this.finishPromise;
  }

  /**
   * Handle external interruption (incoming phone call, background policy, audio disconnect).
   * Commits all audio buffered so far and transitions to interrupted state.
   */
  public handleInterruption(reason = "interrupted"): void {
    const store = useRecordingSessionStore.getState();
    if (store.state !== "recording" && store.state !== "paused") return;

    // Safe release microphone lease so external audio / phone call can use the mic
    this.safeReleaseLease();
    this.activeHandle = null;

    store.transition({ type: "INTERRUPT" });
    console.warn(`[CaptureController] Recording interrupted: ${reason}`);
  }

  /**
   * Explicitly continue capture after an interruption or recovery checkpoint.
   * Starts a brand new part and writer epoch without claiming continuity over the gap.
   */
  public async continueCapture(): Promise<CaptureHandle> {
    const store = useRecordingSessionStore.getState();
    if (store.state !== "interrupted" && store.state !== "recoverable") {
      throw new Error(`Cannot continue capture from state: ${store.state}`);
    }

    const sessionId = store.activeSessionId;
    if (!sessionId) {
      throw new Error("No active session to continue");
    }

    return this.start({ sessionId });
  }

  /**
   * Explicitly discard a recoverable or interrupted recording.
   * Navigation or unmount does NOT discard; only explicit user confirmation can discard.
   */
  public discard(): void {
    const store = useRecordingSessionStore.getState();
    this.safeReleaseLease();
    this.activeHandle = null;
    this.activeEpoch = null;
    this.finishPromise = null;
    store.transition({ type: "DISCARD" });
  }

  /**
   * Check for interrupted or unfinalized sessions on application restart / layout mount.
   */
  public async rehydrate(): Promise<void> {
    const store = useRecordingSessionStore.getState();
    // Do not disrupt an active in-memory recording
    if (store.state === "recording" || store.state === "requesting-permission") {
      return;
    }

    // Check if persistence is available to scan for recoverable sessions
    if (!isRecordingPersistenceAvailable()) return;

    if (store.activeSessionId && (store.state === "finalizing" || store.state === "idle")) {
      try {
        const report = await recoverRecordingSession(store.activeSessionId);
        if (report.verifiedParts > 0) {
          store.setState("recoverable");
          store.setHealth({
            acknowledgedMs: report.acknowledgedDurationMs,
            pendingBytes: 0,
          });
        }
      } catch (err) {
        console.warn("[CaptureController] Rehydration recovery check:", err);
      }
    }
  }

  private safeReleaseLease(): void {
    if (this.releaseLease) {
      try {
        this.releaseLease();
      } catch (e) {
        console.warn("[CaptureController] Release lease error:", e);
      }
      this.releaseLease = null;
    }
  }
}

/** Global singleton instance */
export const captureController = new CaptureController();
