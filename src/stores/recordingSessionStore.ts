/**
 * Recording Session Store.
 *
 * Implements D3 recording lifecycle state machine and active session tracking:
 * - Authoritative root capture state across navigation and view minimization.
 * - Enforces D3 transition reducer rules.
 * - Tracks acknowledged persistence health and error details.
 */

import { create } from "zustand";
import type {
  RecordingHealth,
  RecordingState,
  SessionOperationError,
} from "../types/recordingSession";

export type RecordingTransitionEvent =
  | { type: "START" }
  | { type: "MIC_READY" }
  | { type: "INIT_FAILED" }
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "INTERRUPT" }
  | { type: "FINISH" }
  | { type: "SAVE_SUCCESS" }
  | { type: "SAVE_FAILED" }
  | { type: "CONTINUE" }
  | { type: "DISCARD" }
  | { type: "RESET" };

/**
 * Validates and reduces recording state transitions per D3 state machine:
 *
 * idle -> requesting-permission
 * requesting-permission -> recording | failed
 * recording -> paused | interrupted | finalizing
 * paused -> recording | finalizing
 * interrupted -> recording (new part) | finalizing
 * finalizing -> saved | recoverable
 * recoverable -> saved | recording (continue) | discarded
 * (terminal / reset states: saved, failed, discarded -> idle)
 */
export function reduceRecordingState(
  current: RecordingState,
  event: RecordingTransitionEvent
): RecordingState {
  switch (event.type) {
    case "START":
      if (
        current === "idle" ||
        current === "failed" ||
        current === "saved" ||
        current === "discarded" ||
        current === "interrupted" ||
        current === "recoverable"
      ) {
        return "requesting-permission";
      }
      return current;

    case "MIC_READY":
      if (current === "requesting-permission") {
        return "recording";
      }
      return current;

    case "INIT_FAILED":
      if (current === "requesting-permission") {
        return "failed";
      }
      return current;

    case "PAUSE":
      if (current === "recording") {
        return "paused";
      }
      return current;

    case "RESUME":
      if (current === "paused" || current === "interrupted" || current === "recoverable") {
        return "recording";
      }
      return current;

    case "INTERRUPT":
      if (current === "recording" || current === "paused") {
        return "interrupted";
      }
      return current;

    case "FINISH":
      if (current === "recording" || current === "paused" || current === "interrupted") {
        return "finalizing";
      }
      return current;

    case "SAVE_SUCCESS":
      if (current === "finalizing" || current === "recoverable") {
        return "saved";
      }
      return current;

    case "SAVE_FAILED":
      if (current === "finalizing") {
        return "recoverable";
      }
      return current;

    case "CONTINUE":
      if (current === "recoverable" || current === "interrupted") {
        return "recording";
      }
      return current;

    case "DISCARD":
      if (current === "recoverable" || current === "interrupted" || current === "failed") {
        return "discarded";
      }
      return current;

    case "RESET":
      return "idle";

    default:
      return current;
  }
}

export interface RecordingSessionStoreState {
  state: RecordingState;
  activeSessionId: string | null;
  activeAssetId: string | null;
  writerEpoch: string | null;
  health: RecordingHealth;
  error: SessionOperationError | null;
  isMinimized: boolean;
  isOpen: boolean;

  // Actions
  transition: (event: RecordingTransitionEvent) => void;
  setState: (state: RecordingState) => void;
  setHealth: (health: Partial<RecordingHealth>) => void;
  setError: (error: SessionOperationError | null) => void;
  setActiveSession: (
    sessionId: string | null,
    assetId?: string | null,
    epoch?: string | null
  ) => void;
  setMinimized: (minimized: boolean) => void;
  setOpen: (open: boolean) => void;
  reset: () => void;
}

const initialHealth: RecordingHealth = {
  acknowledgedMs: 0,
  pendingBytes: 0,
  lastCommitAt: undefined,
  state: "idle",
};

export const useRecordingSessionStore = create<RecordingSessionStoreState>(
  (set) => ({
    state: "idle",
    activeSessionId: null,
    activeAssetId: null,
    writerEpoch: null,
    health: initialHealth,
    error: null,
    isMinimized: false,
    isOpen: false,

    transition: (event: RecordingTransitionEvent) =>
      set((prev) => ({
        state: reduceRecordingState(prev.state, event),
      })),

    setState: (state: RecordingState) => set({ state }),

    setHealth: (health: Partial<RecordingHealth>) =>
      set((prev) => ({
        health: { ...prev.health, ...health },
      })),

    setError: (error: SessionOperationError | null) => set({ error }),

    setActiveSession: (
      sessionId: string | null,
      assetId?: string | null,
      epoch?: string | null
    ) =>
      set((prev) => ({
        activeSessionId: sessionId,
        activeAssetId: assetId !== undefined ? assetId : prev.activeAssetId,
        writerEpoch: epoch !== undefined ? epoch : prev.writerEpoch,
      })),

    setMinimized: (minimized: boolean) => set({ isMinimized: minimized }),

    setOpen: (open: boolean) => set({ isOpen: open }),

    reset: () =>
      set({
        state: "idle",
        activeSessionId: null,
        activeAssetId: null,
        writerEpoch: null,
        health: initialHealth,
        error: null,
        isMinimized: false,
        isOpen: false,
      }),
  })
);
