/**
 * Store for the Hugging Face speech-model manager (requirement #19).
 *
 * Holds installed HF models, per-install download progress, and the active
 * inspection. Progress events are wired to the backend `hf://install-progress`
 * / `hf://install-finished` events so the UI stays live during downloads.
 */
import { create } from "zustand";
import { listen, isTauri } from "../lib/tauri";
import {
  getInstalledHfModels,
  hfCancelInstall,
  hfInstallModel,
  hfInspectModel,
  hfUninstallModel,
  type HfInspection,
  type HfInstallProgress,
  type HfRuntime,
  type InstalledHfModel,
} from "../api/hfModels";

export type HfInstallState =
  | "idle"
  | "inspecting"
  | "installing"
  | "error";

interface HfModelState {
  installedModels: InstalledHfModel[];
  progress: Record<string, HfInstallProgress>;
  installing: Record<string, boolean>;
  inspection: HfInspection | null;
  installState: HfInstallState;
  error: string | null;
  lastRepo: string;

  fetchInstalled: () => Promise<void>;
  inspect: (repoInput: string) => Promise<HfInspection>;
  install: (repoInput: string, runtime: HfRuntime, artifactKind: string) => Promise<InstalledHfModel>;
  cancelInstall: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  clearInspection: () => void;
  setProgress: (p: HfInstallProgress) => void;
  setInstallState: (s: HfInstallState, error?: string | null) => void;
}

export const useHfModelStore = create<HfModelState>((set, get) => ({
  installedModels: [],
  progress: {},
  installing: {},
  inspection: null,
  installState: "idle",
  error: null,
  lastRepo: "",

  fetchInstalled: async () => {
    const installedModels = await getInstalledHfModels();
    set({ installedModels });
  },

  inspect: async (repoInput) => {
    set({ installState: "inspecting", error: null, lastRepo: repoInput });
    const inspection = await hfInspectModel(repoInput);
    set({ inspection, installState: "idle" });
    return inspection;
  },

  install: async (repoInput, runtime, artifactKind) => {
    set({ installState: "installing", error: null });
    try {
      const model = await hfInstallModel(repoInput, runtime, artifactKind);
      await get().fetchInstalled();
      set({ installState: "idle" });
      return model;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ installState: "error", error: message });
      throw e;
    }
  },

  cancelInstall: async (id) => {
    await hfCancelInstall(id);
    set((state) => {
      const progress = { ...state.progress };
      delete progress[id];
      const installing = { ...state.installing };
      delete installing[id];
      return { progress, installing };
    });
  },

  uninstall: async (id) => {
    await hfUninstallModel(id);
    await get().fetchInstalled();
  },

  clearInspection: () => set({ inspection: null, error: null, installState: "idle" }),

  setProgress: (p) => {
    set((state) => ({
      progress: { ...state.progress, [p.id]: p },
      installing: { ...state.installing, [p.id]: true },
    }));
  },

  setInstallState: (s, error) => set({ installState: s, error: error ?? null }),
}));

// Wire backend events (Tauri only).
if (isTauri()) {
  const hfListeners: Promise<() => void>[] = [];

  function safeListen<T>(event: string, handler: (event: { payload: T }) => void) {
    hfListeners.push(
      listen(event, handler).catch((err) => {
        console.warn(`[HfModelStore] Failed to register listener for "${event}":`, err);
        return () => {};
      })
    );
  }

  safeListen<HfInstallProgress>("hf://install-progress", (event) => {
    useHfModelStore.getState().setProgress(event.payload);
  });

  safeListen<{ id: string; ok: boolean; message: string }>("hf://install-finished", (event) => {
    const state = useHfModelStore.getState();
    state.setProgress({ ...state.progress[event.payload.id], percent: event.payload.ok ? 100 : 0 });
    void state.fetchInstalled().finally(() => {
      useHfModelStore.setState((prev) => {
        const progress = { ...prev.progress };
        delete progress[event.payload.id];
        const installing = { ...prev.installing };
        delete installing[event.payload.id];
        return { progress, installing };
      });
    });
  });

  (globalThis as any).__hfModelListeners = hfListeners;
}
