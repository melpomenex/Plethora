import { create } from "zustand";
import { listen, isTauri } from "../lib/tauri";
import {
  GpuInstallFinished,
  GpuInstallProgress,
  GpuRuntimeStatus,
  getGpuRuntimeStatus,
} from "../api/gpuRuntime";

interface GpuRuntimeState {
  status: GpuRuntimeStatus | null;
  /** Live install progress while `status.installing` (null otherwise). */
  installProgress: GpuInstallProgress | null;
  /** Set when the last install finished unsuccessfully; cleared on retry. */
  installError: string | null;

  refresh: () => Promise<void>;
  setInstallProgress: (progress: GpuInstallProgress | null) => void;
  setInstallError: (error: string | null) => void;
}

export const useGpuRuntimeStore = create<GpuRuntimeState>((set) => ({
  status: null,
  installProgress: null,
  installError: null,

  refresh: async () => {
    try {
      const status = await getGpuRuntimeStatus();
      set((state) => ({
        status,
        installProgress: status?.installing ? state.installProgress : null,
      }));
    } catch (err) {
      console.warn("[GpuRuntimeStore] Failed to read GPU runtime status:", err);
    }
  },

  setInstallProgress: (installProgress) => set({ installProgress }),

  setInstallError: (installError) => set({ installError }),
}));

// Event wiring (Tauri only). The backend emits:
//   gpu-runtime://install-progress — live weighted progress across all artifacts
//   gpu-runtime://install-finished — {ok, message} terminal event
//   gpu-runtime://status-changed   — fresh GpuRuntimeStatus after transitions
if (isTauri()) {
  const gpuRuntimeListeners: Promise<() => void>[] = [];

  function safeListen<T>(event: string, handler: (event: { payload: T }) => void) {
    gpuRuntimeListeners.push(
      listen(event, handler).catch((err) => {
        console.warn(`[GpuRuntimeStore] Failed to register listener for "${event}":`, err);
        return () => {};
      })
    );
  }

  safeListen<GpuInstallProgress>("gpu-runtime://install-progress", (event) => {
    // Sub-integer deltas re-render for nothing — snap to integers.
    const progress = event.payload;
    const rounded = {
      ...progress,
      percent: Math.round(progress.percent),
    };
    useGpuRuntimeStore.getState().setInstallProgress(rounded);
  });

  safeListen<GpuInstallFinished>("gpu-runtime://install-finished", (event) => {
    const { ok, message } = event.payload;
    if (!ok && !/cancel/i.test(message)) {
      useGpuRuntimeStore.getState().setInstallError(message);
    }
    useGpuRuntimeStore.getState().setInstallProgress(null);
    void useGpuRuntimeStore.getState().refresh();
  });

  safeListen<GpuRuntimeStatus>("gpu-runtime://status-changed", (event) => {
    useGpuRuntimeStore.setState((state) => ({
      status: event.payload,
      installProgress: event.payload.installing ? state.installProgress : null,
    }));
  });

  (globalThis as any).__gpuRuntimeListeners = gpuRuntimeListeners;
}
