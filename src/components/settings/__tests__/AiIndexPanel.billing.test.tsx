/**
 * Paid-gate tests for the library index panel (ai-billing-safety #14):
 * a paid cloud embedding provider must not enqueue work without explicit
 * consent + pre-flight confirmation; local Ollama proceeds without either.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAIIndexStatus: vi.fn(),
  enqueueAllAIDocuments: vi.fn(async () => {}),
  pauseAIIndexing: vi.fn(async () => {}),
  resumeAIIndexing: vi.fn(async () => {}),
  resetAIIndex: vi.fn(async () => 0),
  cancelAIDocumentIndexing: vi.fn(async () => {}),
  retrieveFromLibrary: vi.fn(),
  resolveEmbeddingConfigForRag: vi.fn(async () => undefined),
}));

vi.mock("../../../api/ai-learning", () => ({
  getAIIndexStatus: mocks.getAIIndexStatus,
  enqueueAllAIDocuments: mocks.enqueueAllAIDocuments,
  pauseAIIndexing: mocks.pauseAIIndexing,
  resumeAIIndexing: mocks.resumeAIIndexing,
  resetAIIndex: mocks.resetAIIndex,
  cancelAIDocumentIndexing: mocks.cancelAIDocumentIndexing,
  retrieveFromLibrary: mocks.retrieveFromLibrary,
}));

vi.mock("../../assistant/ragConfig", () => ({
  resolveEmbeddingConfigForRag: mocks.resolveEmbeddingConfigForRag,
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

const confirmModal = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../../common/Modal", () => ({
  useModal: () => ({ confirm: confirmModal }),
}));

import { AiIndexPanel } from "../AiIndexPanel";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useDocumentStore } from "../../../stores/documentStore";
import type { Document } from "../../../types/document";
import {
  setPaidConsentHandler,
  clearPaidConsentDenials,
} from "../../../utils/aiBillingConsent";

function statusResponse(overrides: Record<string, unknown> = {}) {
  return {
    aggregate: {
      totalDocuments: 10,
      indexedDocuments: 7,
      queuedDocuments: 1,
      indexingDocuments: 1,
      staleDocuments: 1,
      failedDocuments: 1,
      totalChunks: 1234,
      totalEmbeddings: 1200,
      embeddingStorageBytes: 4_800_000,
      embeddingModels: [{ model: "text-embedding-3-small", embeddingVersion: 2, chunks: 1200 }],
      paused: false,
      activeDocument: "doc-active",
      pendingDocuments: 2,
      ...overrides,
    },
    documents: [],
  };
}

function setEmbedding(provider: string, paidEnabled: boolean) {
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      features: { ...s.settings.features, aiSemanticIndex: false },
      embedding: {
        ...s.settings.embedding,
        provider: provider as typeof s.settings.embedding.provider,
        paidEmbeddingsEnabled: paidEnabled,
      },
    },
  }));
}

describe("AiIndexPanel paid-gate (ai-billing-safety #14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPaidConsentDenials();
    setPaidConsentHandler(null);
    useDocumentStore.setState({
      documents: [
        {
          id: "doc-1",
          title: "Doc One",
          filePath: "/tmp/doc-1.txt",
          fileType: "markdown",
          content: "x".repeat(5000),
          tags: [],
          dateAdded: "2026-01-01T00:00:00Z",
          dateModified: "2026-01-01T00:00:00Z",
          extractCount: 0,
          learningItemCount: 0,
          priorityRating: 0,
          prioritySlider: 0,
          priorityScore: 0,
          isArchived: false,
          isFavorite: false,
        } as Document,
      ],
    });
    mocks.getAIIndexStatus.mockResolvedValue(statusResponse());
    confirmModal.mockResolvedValue(false);
  });

  it("blocks a paid cloud provider without consent — no request sent, opt-in requested", async () => {
    const consentHandler = vi.fn(async () => false);
    setPaidConsentHandler(consentHandler);
    setEmbedding("openai", false);

    render(<AiIndexPanel />);
    fireEvent.click(await screen.findByText("aiLibrary.indexEnable"));

    await waitFor(() => expect(consentHandler).toHaveBeenCalledTimes(1));
    expect(consentHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "embeddings", provider: "openai" })
    );
    expect(mocks.enqueueAllAIDocuments).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.features.aiSemanticIndex).toBe(false);
    // The block message surfaces so the user can opt in.
    expect(await screen.findByText("aiLibrary.indexConsentRequiredMessage")).toBeTruthy();
  });

  it("grants consent once and enqueues after the pre-flight confirmation", async () => {
    const consentHandler = vi.fn(async () => true);
    setPaidConsentHandler(consentHandler);
    confirmModal.mockResolvedValue(true);
    setEmbedding("openai", false);

    render(<AiIndexPanel />);
    fireEvent.click(await screen.findByText("aiLibrary.indexEnable"));

    await waitFor(() => expect(confirmModal).toHaveBeenCalled());
    // The confirmation includes the workload + cost estimate.
    expect(confirmModal).toHaveBeenCalledWith(
      "aiLibrary.indexConfirmMessage",
      "aiLibrary.indexConfirmTitle"
    );
    await waitFor(() => expect(mocks.enqueueAllAIDocuments).toHaveBeenCalled());
    expect(useSettingsStore.getState().settings.features.aiSemanticIndex).toBe(true);
  });

  it("does not enqueue when the pre-flight confirmation is declined", async () => {
    confirmModal.mockResolvedValue(false);
    setEmbedding("openai", true);

    render(<AiIndexPanel />);
    fireEvent.click(await screen.findByText("aiLibrary.indexEnable"));

    await waitFor(() => expect(confirmModal).toHaveBeenCalled());
    expect(mocks.enqueueAllAIDocuments).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.features.aiSemanticIndex).toBe(false);
  });

  it("local Ollama proceeds without consent or confirmation", async () => {
    setEmbedding("ollama", false);

    render(<AiIndexPanel />);
    fireEvent.click(await screen.findByText("aiLibrary.indexEnable"));

    await waitFor(() => expect(mocks.enqueueAllAIDocuments).toHaveBeenCalled());
    expect(confirmModal).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().settings.features.aiSemanticIndex).toBe(true);
  });

  it("shows the paid indicator when a cloud provider is configured", async () => {
    setEmbedding("openai", false);
    render(<AiIndexPanel />);
    expect(await screen.findByText("aiLibrary.indexPaidIndicatorDesc")).toBeTruthy();
    // Local Ollama shows no paid indicator.
    setEmbedding("ollama", false);
    render(<AiIndexPanel />);
    expect(screen.queryByText("aiLibrary.indexPaidIndicatorDesc")).toBeNull();
  });
});
