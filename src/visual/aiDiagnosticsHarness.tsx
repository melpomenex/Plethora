/**
 * Harness for the AI Diagnostics modal (diagnostics task 5.2).
 *
 * Mounts the REAL modal in a plain browser with deterministic dependency
 * fixtures: a ready semantic index, a detected OCR backend, no generation
 * provider (so most features show setup blockers), and a fixture-only
 * learn-this smoke adapter that is slow enough to exercise Stop. The real
 * smoke runner, feature summaries and redacted export code paths run.
 *
 * See `src/visual/ai-diagnostics.visual.spec.ts`.
 */

import { createRoot } from "react-dom/client";
import "../index.css";
import { AIDiagnosticsModal } from "../components/settings/AIDiagnosticsModal";
import { useSettingsStore } from "../stores/settingsStore";
import { useLLMProvidersStore } from "../stores/llmProvidersStore";
import { recordTaskDiagnostic } from "../lib/ai/diagnostics";
import {
  registerDefaultFeatureSmokeAdapters,
} from "../lib/ai/diagnostics/smokeAdapters";
import { registerFeatureSmokeAdapter } from "../lib/ai/diagnostics/featureSmoke";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
    aiDiagnosticsHarness?: {
      readonly invokes: string[];
      canary: string;
    };
  }
}

const indexStatus = {
  aggregate: {
    totalDocuments: 1,
    indexedDocuments: 1,
    queuedDocuments: 0,
    indexingDocuments: 0,
    staleDocuments: 0,
    failedDocuments: 0,
    totalChunks: 4,
    totalEmbeddings: 4,
    embeddingStorageBytes: 1024,
    embeddingModels: [],
    paused: false,
    pendingDocuments: 0,
  },
  documents: [],
};

const harnessState = {
  invokes: [] as string[],
};

window.__TAURI_INTERNALS__ = {
  invoke: async (command: string) => {
    harnessState.invokes.push(command);
    if (command === "wait_for_backend_ready") return null;
    if (command === "ai_learning_index_status") return indexStatus;
    if (command === "get_available_ocr_providers") return ["tesseract"];
    return null;
  },
};

window.aiDiagnosticsHarness = {
  get invokes() {
    return harnessState.invokes;
  },
  canary: "sk-live-CANARY-51H8",
};

useSettingsStore.setState((state) => ({
  settings: {
    ...state.settings,
    general: { ...state.settings.general, language: "en" },
    ai: { ...state.settings.ai, preferOnDevice: false },
    embedding: {
      ...state.settings.embedding,
      provider: "ollama",
      ollamaBaseUrl: "http://127.0.0.1:11434",
    },
  },
}));
useLLMProvidersStore.setState({ providers: [] });

// A canary in a diagnostic string must never reach the exported report.
recordTaskDiagnostic({
  taskId: "learn-this",
  taskType: "prompt",
  providerId: "cloud-llm",
  errorCategory: "GenerationFailed",
  errorCode: "sk-live-CANARY-51H8",
  chunkIds: ["private-chunk-id"],
  baseModelName: "private-model-path",
});

registerDefaultFeatureSmokeAdapters();

// Slow enough for the E2E to press Stop, abort-aware so cancellation is real.
registerFeatureSmokeAdapter({
  featureId: "learn-this",
  stages: ["generation", "validation"],
  unverifiedStages: ["preview", "persistence"],
  fixtureId: "fixture-harness-learn-this-v1",
  maxDurationMs: 10_000,
  destinations: ["device"],
  mutatesUserData: false,
  requiresConsent: false,
  run: async (context) => {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      context.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
    if (context.signal.aborted) {
      return { outcome: "cancelled", stages: [], recoveryCode: "smoke_cancelled" };
    }
    context.reportStage("generation", "success", { durationMs: 2_000 });
    context.reportStage("validation", "success", { durationMs: 0 });
    return { outcome: "success", stages: ["generation", "validation"] };
  },
});

createRoot(document.getElementById("root")!).render(
  <AIDiagnosticsModal isOpen onClose={() => undefined} />
);
