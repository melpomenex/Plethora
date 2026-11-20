import { create } from "zustand";
import { healthApi } from "../api/health";
import type { HealthAnalysisRange } from "../types/health";

export type HealthView = "overview" | "sleep-chart" | "learning-performance" | "personal-patterns" | "data-sources";

interface HealthViewState {
  view: HealthView;
  range: HealthAnalysisRange | null;
  demo: boolean;
  includeLearning: boolean;
  plan: string;
  revision: number;
  setPlan: (plan: string) => void;
  setView: (view: HealthView) => void;
  setRange: (range: HealthAnalysisRange) => void;
  setIncludeLearning: (includeLearning: boolean) => void;
  setDemo: (demo: boolean) => Promise<void>;
  invalidate: () => void;
  wipe: () => Promise<void>;
}

// Keep measurements and provider records in the native vault. This store holds
// only the dashboard's session preferences and a signal to refresh its queries.
export const useHealthStore = create<HealthViewState>((set) => ({
  view: "overview",
  range: null,
  demo: false,
  includeLearning: false,
  plan: "",
  setPlan: (plan) => set({ plan }),
  revision: 0,
  setView: (view) => set({ view }),
  setRange: (range) => set({ range }),
  setIncludeLearning: (includeLearning) => set({ includeLearning }),
  setDemo: async (demo) => {
    await (demo ? healthApi.loadDemo() : healthApi.clearDemo());
    set((state) => ({ demo, revision: state.revision + 1 }));
  },
  invalidate: () => set((state) => ({ revision: state.revision + 1 })),
  wipe: async () => {
    await healthApi.wipeAllData();
    set((state) => ({ demo: false, revision: state.revision + 1 }));
  },
}));
