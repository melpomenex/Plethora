/**
 * Progress and cancellation for a multi-chunk on-device run.
 *
 * Holds run phase and chunk progress for user-visible feedback.
 */

import { create } from "zustand";

export type OnDeviceRunPhase =
  | "idle"
  | "queued"
  | "warming"
  | "generating"
  | "retrying"
  | "cancelling"
  | "chunking";

export interface OnDeviceRunState {
  /** Human label for the running action, or null when nothing is running. */
  label: string | null;
  /** Current phase of the on-device run. */
  phase: OnDeviceRunPhase;
  /** 1-based chunk index. */
  chunk: number;
  /** Total chunks. 1 means a single-shot run with nothing to show. */
  total: number;
  /** Aborts the run; null when nothing is running. */
  cancel: (() => void) | null;

  begin: (label: string, cancel: () => void) => void;
  setPhase: (phase: OnDeviceRunPhase) => void;
  report: (chunk: number, total: number, phase?: OnDeviceRunPhase) => void;
  end: () => void;
}

export const useOnDeviceRunStore = create<OnDeviceRunState>((set) => ({
  label: null,
  phase: "idle",
  chunk: 0,
  total: 0,
  cancel: null,

  begin: (label, cancel) => set({ label, phase: "queued", cancel, chunk: 0, total: 0 }),
  setPhase: (phase) => set({ phase }),
  report: (chunk, total, phase = "chunking") => set({ chunk, total, phase }),
  end: () => set({ label: null, phase: "idle", cancel: null, chunk: 0, total: 0 }),
}));

/**
 * Run an on-device action with progress reporting and a cancel handle
 * published to the store, clearing them however it ends.
 */
export async function withOnDeviceRun<T>(
  label: string,
  fn: (options: {
    signal: AbortSignal;
    onProgress: (chunk: number, total: number) => void;
    setPhase: (phase: OnDeviceRunPhase) => void;
  }) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const store = useOnDeviceRunStore.getState();
  store.begin(label, () => {
    useOnDeviceRunStore.getState().setPhase("cancelling");
    controller.abort();
  });
  try {
    return await fn({
      signal: controller.signal,
      onProgress: (chunk, total) => useOnDeviceRunStore.getState().report(chunk, total),
      setPhase: (phase) => useOnDeviceRunStore.getState().setPhase(phase),
    });
  } finally {
    useOnDeviceRunStore.getState().end();
  }
}
