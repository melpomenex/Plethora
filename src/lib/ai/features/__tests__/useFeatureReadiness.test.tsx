/**
 * Integration test for the shared readiness hook: the probe consumes real
 * stores and read-only adapters, deduplicates across consumers, and never
 * starts inference, a download or an index job.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { defaultSettings, useSettingsStore } from "../../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../../stores/llmProvidersStore";
import { invalidateFeatureReadiness } from "../probe";
import { useFeatureReadiness } from "../useFeatureReadiness";

const indexStatus = {
  aggregate: {
    totalDocuments: 1,
    indexedDocuments: 1,
    queuedDocuments: 0,
    indexingDocuments: 0,
    staleDocuments: 0,
    failedDocuments: 0,
    totalChunks: 10,
    totalEmbeddings: 10,
    embeddingStorageBytes: 1024,
    embeddingModels: [],
    paused: false,
    pendingDocuments: 0,
  },
  documents: [],
};

vi.mock("../../../../api/ai-learning", () => ({
  getAIIndexStatus: vi.fn(async () => indexStatus),
}));

const ocrState = vi.hoisted(() => ({ delayMs: 0 }));

vi.mock("../../../../api/ocrCommands", () => ({
  getAvailableOCRProviders: vi.fn(async () => {
    if (ocrState.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, ocrState.delayMs));
    }
    return ["tesseract"];
  }),
}));

describe("useFeatureReadiness", () => {
  beforeEach(() => {
    invalidateFeatureReadiness();
    localStorage.clear();
    useSettingsStore.setState({
      settings: JSON.parse(JSON.stringify(defaultSettings)) as typeof defaultSettings,
    });
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        ai: { ...useSettingsStore.getState().settings.ai, preferOnDevice: false },
        embedding: {
          ...useSettingsStore.getState().settings.embedding,
          provider: "ollama",
          ollamaBaseUrl: "http://127.0.0.1:11434",
        },
      },
    });
    useLLMProvidersStore.setState({
      providers: [
        {
          id: "p1",
          provider: "ollama",
          name: "Local",
          apiKey: "",
          baseUrl: "http://127.0.0.1:11434",
          model: "llama3.2",
          enabled: true,
          temperature: 0.7,
          maxTokens: 2048,
        },
      ],
    });
  });

  it("evaluates all ten features from read-only probes", async () => {
    const { result } = renderHook(() => useFeatureReadiness());
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    const byId = new Map(result.current.rows.map((row) => [row.featureId, row]));
    expect(byId.get("learn-this")!.status).toBe("ready");
    expect(byId.get("semantic-index")!.status).toBe("ready");
    expect(byId.get("extract-worthiness")!.status).toBe("ready");
    expect(byId.get("knowledge-relationships")!.status).toBe("ready");
    expect(result.current.checkedAt).not.toBeNull();
    expect(result.current.revision.length).toBeGreaterThan(0);
  });

  it("shares one probe between concurrent consumers", async () => {
    const first = renderHook(() => useFeatureReadiness());
    const second = renderHook(() => useFeatureReadiness());
    await waitFor(() => expect(first.result.current.rows).toHaveLength(10));
    await waitFor(() => expect(second.result.current.rows).toHaveLength(10));
    expect(first.result.current.revision).toBe(second.result.current.revision);
  });

  it("marks readiness checking while a new provider revision is probed", async () => {
    const { result } = renderHook(() => useFeatureReadiness());
    await waitFor(() => expect(result.current.rows).toHaveLength(10));
    expect(result.current.rows.every((row) => !row.checking)).toBe(true);

    ocrState.delayMs = 80;
    useLLMProvidersStore.setState({ providers: [] });
    await waitFor(() => expect(result.current.rows.some((row) => row.checking)).toBe(true));
    ocrState.delayMs = 0;
    await waitFor(() => expect(result.current.rows.every((row) => !row.checking)).toBe(true));
  });
});
