/**
 * Fresh-install / upgraded-profile lifecycle through the real readiness probe
 * and AI Settings (initialization task 4.1).
 *
 * Covers: partial Enable All against real dependency probes, explicit false
 * preferences surviving an upgrade, a restart re-probe, and zero
 * download/index/enqueue side effects from mounting or searching.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AISettings } from "../AIProviderSettings";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { invalidateFeatureReadiness } from "../../../lib/ai/features/probe";

const invokeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  invokeCommand: (...args: unknown[]) => invokeMock(...args),
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../../../api/ai", () => ({
  getAIConfig: vi.fn().mockResolvedValue(null),
  setApiKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../OnDeviceAiPanel", () => ({
  OnDeviceAiPanel: () => null,
}));

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

const getAIIndexStatus = vi.fn(async () => indexStatus);

vi.mock("../../../api/ai-learning", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAIIndexStatus: () => getAIIndexStatus(),
}));

vi.mock("../../../api/ocrCommands", () => ({
  getAvailableOCRProviders: vi.fn(async () => ["tesseract"]),
}));

function resetStores() {
  localStorage.clear();
  invalidateFeatureReadiness();
  getAIIndexStatus.mockClear();
  invokeMock.mockClear();
  useSettingsStore.setState({
    settings: JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings,
  });
  useSettingsStore.setState({
    settings: {
      ...useSettingsStore.getState().settings,
      // No generation route: most features need setup; semantic indexing is
      // independently ready because embeddings are local.
      ai: { ...useSettingsStore.getState().settings.ai, preferOnDevice: false },
      embedding: {
        ...useSettingsStore.getState().settings.embedding,
        provider: "ollama",
        ollamaBaseUrl: "http://127.0.0.1:11434",
      },
    },
  });
  useLLMProvidersStore.setState({ providers: [] });
}

function expectNoWorkloads() {
  for (const forbidden of ["download", "enqueue", "index_start", "ai_learning_enqueue", "infer"]) {
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining(forbidden),
      expect.anything()
    );
  }
}

describe("AI Settings lifecycle integration", () => {
  beforeEach(resetStores);

  it("shows partial readiness and enables supported preferences in one action", async () => {
    render(<AISettings onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText("Semantic indexing")).toBeInTheDocument();
      expect(screen.getAllByText("Setup required").length).toBeGreaterThan(0);
    });
    // Probe is read-only, even on mount.
    expect(getAIIndexStatus).toHaveBeenCalled();
    expectNoWorkloads();

    fireEvent.click(screen.getByRole("button", { name: "Enable All AI Learning Features" }));
    const features = useSettingsStore.getState().settings.features;
    expect(features.aiAgent).toBe(true);
    expect(features.aiLearnThis).toBe(true);
    // Consent/provider/freeform/recall-mode are not part of this action.
    expect(useSettingsStore.getState().settings.ai.activeRecallMode).toBe(
      defaultSettings.ai.activeRecallMode
    );
    expect(features.aiOcclusionFreeform).toBe(defaultSettings.features.aiOcclusionFreeform);
    expectNoWorkloads();
  });

  it("preserves explicit false preferences across an upgrade and re-probes after restart", async () => {
    localStorage.setItem(
      "plethora-settings",
      JSON.stringify({
        state: {
          settings: {
            features: { aiLearnThis: false, aiAgent: false },
          },
        },
        version: 15,
      })
    );
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().settings.features.aiLearnThis).toBe(false);
    expect(useSettingsStore.getState().settings.features.aiAgent).toBe(false);

    render(<AISettings onChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Learn this")).toBeInTheDocument());
    expect(screen.getAllByText("Off").length).toBeGreaterThanOrEqual(2);
    expectNoWorkloads();

    const callsBeforeRestart = getAIIndexStatus.mock.calls.length;
    // Simulate a restart: the UI cache is dropped and the panel re-probes the
    // current services; persisted false values are untouched.
    invalidateFeatureReadiness();
    fireEvent.click(screen.getByRole("button", { name: "Re-check feature readiness" }));
    await waitFor(() =>
      expect(getAIIndexStatus.mock.calls.length).toBeGreaterThan(callsBeforeRestart)
    );
    expect(useSettingsStore.getState().settings.features.aiLearnThis).toBe(false);
    expect(useSettingsStore.getState().settings.features.aiAgent).toBe(false);
    expectNoWorkloads();
  });
});
