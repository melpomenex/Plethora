import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, renderHook, act } from "@testing-library/react";
import React from "react";
import { SelectionActionBar } from "../SelectionActionBar";
import { useToastExtract } from "../../../../hooks/useToastExtract";
import { useInlineExtraction } from "../../../../hooks/useInlineExtraction";

const mocks = vi.hoisted(() => ({
  dispatchPriorityCommit: vi.fn().mockResolvedValue({ slider: 15 }),
  createExtract: vi.fn().mockResolvedValue({ id: "ext-new", content: "monotonic clock drift", priority_slider: 20 }),
  createClozeFromExtract: vi.fn().mockResolvedValue({ id: "card-1" }),
  loadExtracts: vi.fn().mockResolvedValue(undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../../../services/priority/priorityCommit", () => ({
  dispatchPriorityCommit: mocks.dispatchPriorityCommit,
}));

vi.mock("../../../../api/extracts", () => ({
  createExtract: mocks.createExtract,
}));

vi.mock("../../../../api/extract-review", () => ({
  createClozeFromExtract: mocks.createClozeFromExtract,
}));

vi.mock("../../../../stores/extractStore", () => ({
  useExtractStore: () => ({
    lastHighlightColor: "yellow",
    setLastHighlightColor: vi.fn(),
    loadExtracts: mocks.loadExtracts,
  }),
}));

vi.mock("../../../../components/common/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));

vi.mock("../../../../utils/aiExtractUtils", () => ({
  handleAutoGeneration: vi.fn().mockResolvedValue(undefined),
  handleAutoSummarization: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../../../lib/feedback/orchestrator", () => ({
  createFeedbackInteractionId: () => "fb-1",
  emitUserInteraction: vi.fn(),
}));

vi.mock("../../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../../contexts/PresentationContext", () => ({
  usePresentation: () => ({ reducedMotion: false }),
}));

vi.mock("../../../../hooks/useOverlayDismissal", () => ({
  useOverlayDismissal: vi.fn(),
}));

vi.mock("../../../../hooks/useMobileShell", () => ({
  useMobileShell: () => false,
}));

vi.mock("../../../../stores/settingsStore", () => ({
  useSettingsStore: (selector: (s: { settings: { features: { askSheetMobile: boolean } } }) => boolean) =>
    selector({ settings: { features: { askSheetMobile: false } } }),
}));

describe("UX01-T05 SelectionActionBar, priority nudge & Chained Cloze", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("displays inherited priority chip, nudges ±5% on Shift+Wheel, and triggers Chained Cloze", () => {
    const onNudgePriority = vi.fn();
    const onChainedCloze = vi.fn();

    render(
      <SelectionActionBar
        placement={{ top: 100, left: 120, maxWidth: 600, placement: "above" }}
        onAction={vi.fn()}
        onOverflow={vi.fn()}
        onDismiss={vi.fn()}
        prioritySlider={20}
        priorityExplicitlySet={false}
        parentTitle="Distributed Systems"
        onNudgePriority={onNudgePriority}
        onChainedCloze={onChainedCloze}
      />
    );

    const chip = document.querySelector("[data-priority-inheritance-chip='true']") as HTMLElement;
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("P20 • Inherited from Distributed Systems");

    fireEvent.wheel(chip, { shiftKey: true, deltaY: -100 });
    expect(onNudgePriority).toHaveBeenCalledWith(15, -5);

    fireEvent.wheel(chip, { shiftKey: true, deltaY: 100 });
    expect(onNudgePriority).toHaveBeenCalledWith(25, 5);

    const clozeBtn = screen.getByRole("button", { name: "Chained Cloze" });
    fireEvent.click(clozeBtn);
    expect(onChainedCloze).toHaveBeenCalledTimes(1);
  });

  it("nudges newly created extract priority by -5 on ArrowUp within 4s window", async () => {
    const { result } = renderHook(() => useToastExtract());

    await act(async () => {
      await result.current.createInstantExtract({
        documentId: "doc-1",
        text: "monotonic clock drift",
        parentPrioritySlider: 20,
      });
    });

    expect(result.current.nudgeWindow?.prioritySlider).toBe(20);

    await act(async () => {
      fireEvent.keyDown(window, { key: "ArrowUp" });
    });

    expect(mocks.dispatchPriorityCommit).toHaveBeenCalledWith(
      { kind: "extract", id: "ext-new" },
      15
    );
    expect(result.current.nudgeWindow?.prioritySlider).toBe(15);
  });

  it("createChainedClozeFromSelection creates extract and cloze card while preserving scrollTop", async () => {
    const { result } = renderHook(() =>
      useInlineExtraction({ documentId: "doc-1" })
    );

    const scrollContainer = document.createElement("div");
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 1420,
      writable: true,
    });

    await act(async () => {
      await result.current.createChainedClozeFromSelection({
        documentId: "doc-1",
        text: "monotonic clock drift",
        scrollContainer,
        parentPrioritySlider: 20,
      });
    });

    expect(mocks.createExtract).toHaveBeenCalledWith({
      document_id: "doc-1",
      content: "monotonic clock drift",
      page_number: undefined,
    });
    expect(mocks.createClozeFromExtract).toHaveBeenCalledWith(
      "ext-new",
      "monotonic clock drift",
      [[0, 21]]
    );
    expect(scrollContainer.scrollTop).toBe(1420);
  });
});
