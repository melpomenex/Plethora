/**
 * Tests for the "Ask library" mode of the search page (task 4.10): flag-gated
 * tab, provider indicator, ask wiring through `useAskLibrary`, evidence badge
 * and source chips (navigation is delegated to `openLibrarySource`).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ask: vi.fn(async () => {}),
  reset: vi.fn(),
  ftsSearch: vi.fn(async () => []),
  openLibrarySource: vi.fn(async () => {}),
  result: null as unknown,
  path: "ondevice" as "ondevice" | "cloud" | "none",
}));

vi.mock("../../api/ftsSearch", () => ({
  ftsSearch: mocks.ftsSearch,
}));

vi.mock("../../lib/ai/useAskLibrary", () => ({
  useAskLibrary: () => ({
    running: false,
    error: null,
    result: mocks.result,
    ask: mocks.ask,
    reset: mocks.reset,
  }),
}));

vi.mock("../../lib/ai/useAiAvailability", () => ({
  useAiAvailability: () => ({ path: mocks.path, available: true, loading: false }),
}));

vi.mock("../../utils/openLibrarySource", () => ({
  openLibrarySource: mocks.openLibrarySource,
}));

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import { SearchPage } from "../SearchPage";
import { useSettingsStore } from "../../stores/settingsStore";

function setFlag(enabled: boolean) {
  useSettingsStore.setState((s) => ({
    settings: {
      ...s.settings,
      features: { ...s.settings.features, aiLibraryRag: enabled },
    },
  }));
}

describe("SearchPage ask-library mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.result = null;
    mocks.path = "ondevice";
  });

  it("hides the ask tab while the aiLibraryRag flag is off", () => {
    setFlag(false);
    render(<SearchPage />);
    expect(screen.queryByText("aiLibrary.tabAsk")).toBeNull();
    expect(screen.getByPlaceholderText("search.placeholder")).toBeTruthy();
  });

  it("switches to ask mode and submits the query", async () => {
    setFlag(true);
    render(<SearchPage />);
    fireEvent.click(screen.getByText("aiLibrary.tabAsk"));
    const input = screen.getByPlaceholderText("aiLibrary.placeholder");
    fireEvent.change(input, { target: { value: "Where did I read about osmosis?" } });
    fireEvent.click(screen.getByText("aiLibrary.ask"));
    await waitFor(() =>
      expect(mocks.ask).toHaveBeenCalledWith("Where did I read about osmosis?")
    );
    // The on-device/cloud indicator is visible (spec: privacy indicator).
    expect(screen.getByText("aiLibrary.onDevice")).toBeTruthy();
  });

  it("renders evidence badge and navigable source chips from the result", async () => {
    mocks.result = {
      answer: {
        answer: "In your biology notes [1].",
        sourceRefs: [{ refId: "c1", quote: "osmosis" }],
        evidenceLevel: "supported",
      },
      sources: [
        {
          chunkId: "c1",
          documentId: "doc-1",
          documentTitle: "Biology Notes",
          sourceType: "document",
          text: "Osmosis is the diffusion of water across a membrane.",
          headingPath: ["Chapter 2"],
          location: {
            sourceType: "pdf",
            documentId: "doc-1",
            ordinal: 0,
            pageNumber: 3,
            startOffset: 0,
            endOffset: 50,
          },
          score: 0.9,
        },
      ],
      droppedChunks: 0,
      mode: "semantic",
      candidatesScanned: 12,
      run: {},
    };
    setFlag(true);
    render(<SearchPage />);
    fireEvent.click(screen.getByText("aiLibrary.tabAsk"));
    expect(await screen.findByText("aiLibrary.evidence_supported")).toBeTruthy();
    expect(screen.getByText("aiLibrary.semanticMode")).toBeTruthy();
    fireEvent.click(screen.getByText("Biology Notes"));
    await waitFor(() =>
      expect(mocks.openLibrarySource).toHaveBeenCalledWith(
        "doc-1",
        "Osmosis is the diffusion of water across a membrane.",
        expect.objectContaining({ pageNumber: 3 })
      )
    );
  });
});
