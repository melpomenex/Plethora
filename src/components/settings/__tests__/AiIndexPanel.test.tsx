/**
 * Tests for the library semantic-index settings panel (task 4.8): the
 * flag-gated enable CTA, the aggregate dashboard fed by
 * `ai_learning_index_status`, the retrieval-mode probe, and the lifecycle
 * controls (pause / per-document cancel / reset) wired to the TS wrappers.
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
      embeddingModels: [{ model: "embedding-gemma", embeddingVersion: 2, chunks: 1200 }],
      paused: false,
      activeDocument: "doc-active",
      pendingDocuments: 2,
      ...overrides,
    },
    documents: [
      {
        documentId: "doc-queued",
        state: "queued",
        chunksIndexed: 0,
        totalChunks: 40,
        error: null,
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        documentId: "doc-failed",
        state: "failed",
        chunksIndexed: 3,
        totalChunks: 9,
        error: "boom",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
  };
}

function setFlag(enabled: boolean) {
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      features: { ...s.settings.features, aiSemanticIndex: enabled },
      embedding: { ...s.settings.embedding, provider: "ollama", ollamaModel: "nomic-embed-text" },
    },
  }));
}

describe("AiIndexPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDocumentStore.setState({ documents: [] });
    mocks.getAIIndexStatus.mockResolvedValue(statusResponse());
    mocks.retrieveFromLibrary.mockResolvedValue({
      results: [],
      mode: "semantic",
      candidatesScanned: 0,
    });
  });

  it("shows the enable CTA while the aiSemanticIndex flag is off", async () => {
    setFlag(false);
    render(<AiIndexPanel />);
    expect(await screen.findByText("aiLibrary.indexEnable")).toBeTruthy();
    // The status dashboard is not fetched behind the CTA.
    expect(mocks.getAIIndexStatus).not.toHaveBeenCalled();
  });

  it("enabling calls the bulk backfill with the charging constraint", async () => {
    setFlag(false);
    render(<AiIndexPanel />);
    const button = await screen.findByText("aiLibrary.indexEnable");
    fireEvent.click(button);
    await waitFor(() => expect(mocks.enqueueAllAIDocuments).toHaveBeenCalledWith(true));
    // The flag flipped on in the same action.
    expect(useSettingsStore.getState().settings.features.aiSemanticIndex).toBe(true);
  });

  it("respects unchecking the charging constraint", async () => {
    setFlag(false);
    render(<AiIndexPanel />);
    await screen.findByText("aiLibrary.indexEnable");
    fireEvent.click(screen.getByLabelText("aiLibrary.indexRequireCharging"));
    fireEvent.click(screen.getByText("aiLibrary.indexEnable"));
    await waitFor(() => expect(mocks.enqueueAllAIDocuments).toHaveBeenCalledWith(false));
  });

  it("renders aggregate counts, storage, provider and the probed mode", async () => {
    setFlag(true);
    render(<AiIndexPanel />);
    expect(await screen.findByText("aiLibrary.indexStatIndexed")).toBeTruthy();
    expect(mocks.getAIIndexStatus).toHaveBeenCalled();
    // Storage formatted in MB.
    expect(screen.getByText(/4\.6 MB/)).toBeTruthy();
    // Stored embedding model row from the status payload.
    expect(screen.getByText(/embedding-gemma · v2 · 1200/)).toBeTruthy();
    // Configured provider row.
    expect(screen.getByText(/ollama/)).toBeTruthy();
    expect(screen.getByText(/nomic-embed-text/)).toBeTruthy();
    // Probe retrieve decided the mode indicator.
    await waitFor(() => expect(mocks.retrieveFromLibrary).toHaveBeenCalled());
    expect(await screen.findByText("aiLibrary.indexModeSemantic")).toBeTruthy();
  });

  it("surfaces the lexical-only fallback as the mode", async () => {
    mocks.retrieveFromLibrary.mockResolvedValue({
      results: [],
      mode: "lexicalOnly",
      candidatesScanned: 0,
    });
    setFlag(true);
    render(<AiIndexPanel />);
    await screen.findByText("aiLibrary.indexModeLexical");
  });

  it("pause control calls the wrapper and refetches", async () => {
    setFlag(true);
    render(<AiIndexPanel />);
    const pause = await screen.findByText("aiLibrary.indexPause");
    fireEvent.click(pause);
    await waitFor(() => expect(mocks.pauseAIIndexing).toHaveBeenCalled());
  });

  it("shows resume when the indexer reports paused", async () => {
    mocks.getAIIndexStatus.mockResolvedValue(
      statusResponse({ paused: true, queuedDocuments: 3, indexingDocuments: 0, pendingDocuments: 0 })
    );
    setFlag(true);
    render(<AiIndexPanel />);
    const resume = await screen.findByText("aiLibrary.indexResume");
    fireEvent.click(resume);
    await waitFor(() => expect(mocks.resumeAIIndexing).toHaveBeenCalled());
  });

  it("per-document list shows state badges and cancels queued work", async () => {
    setFlag(true);
    render(<AiIndexPanel />);
    fireEvent.click(await screen.findByText("aiLibrary.indexShowDocuments"));
    expect(await screen.findByText("doc-queued")).toBeTruthy();
    expect(screen.getByText("doc-failed")).toBeTruthy();
    expect(screen.getByText("aiLibrary.indexState_failed")).toBeTruthy();
    expect(screen.getByText(/aiLibrary.indexError/)).toBeTruthy();

    const cancelButtons = screen.getAllByText("aiLibrary.indexCancelDocument");
    fireEvent.click(cancelButtons[0]);
    await waitFor(() => expect(mocks.cancelAIDocumentIndexing).toHaveBeenCalledWith("doc-queued"));
  });

  it("reset asks for confirmation before wiping the rebuildable index", async () => {
    confirmModal.mockResolvedValue(false);
    setFlag(true);
    render(<AiIndexPanel />);
    await screen.findByText("aiLibrary.indexStatIndexed");
    fireEvent.click(screen.getByText("aiLibrary.indexReset"));
    await waitFor(() =>
      expect(confirmModal).toHaveBeenCalledWith(
        "aiLibrary.indexResetConfirm",
        "aiLibrary.indexTitle"
      )
    );
    expect(mocks.resetAIIndex).not.toHaveBeenCalled();

    confirmModal.mockResolvedValue(true);
    fireEvent.click(screen.getByText("aiLibrary.indexReset"));
    await waitFor(() => expect(mocks.resetAIIndex).toHaveBeenCalled());
  });
});
