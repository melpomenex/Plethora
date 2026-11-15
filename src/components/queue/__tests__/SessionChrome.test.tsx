import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { ScrollOverlayControls } from "../ScrollOverlayControls";
import { SESSION_CHROME_BOUNDS } from "../SessionChromeHeader";
import { FlashcardScrollItem } from "../../review/FlashcardScrollItem";
import { ExtractScrollItem } from "../../review/ExtractScrollItem";
import type { LearningItem } from "../../../api/learning-items";
import type { Extract } from "../../../api/extracts";

const baseOverlayProps = {
  showControls: true,
  currentIndex: 0,
  totalItems: 10,
  sessionOffset: 0,
  itemTitle: "Test Item",
  itemDocumentId: "doc-1",
  isNewDocument: false,
  isRating: false,
  scrollViewMode: "document",
  isMobile: false,
  ratingOrbsPosition: "bottom" as const,
  onUpdateRatingOrbsPosition: vi.fn(),
  onExit: vi.fn(),
  onShowSettings: vi.fn(),
  onShowRssSettings: vi.fn(),
  onSetScrollViewMode: vi.fn(),
  onOpenExtractDialog: vi.fn(),
  onRate: vi.fn(),
  onDismiss: vi.fn(),
  onGoToNext: vi.fn(),
  onGoToPrevious: vi.fn(),
};

describe("UX01-T01 Interleaved Session Chrome Standardization", () => {
  it("keeps [data-queue-header] invariant across flashcard, document, extract, and video-extract types", () => {
    const itemTypes = ["flashcard", "document", "extract", "video-extract"] as const;
    const { container, rerender } = render(
      <ScrollOverlayControls {...baseOverlayProps} itemType={itemTypes[0]} />
    );

    const headerClasses = new Set<string>();
    const rowClasses = new Set<string>();

    for (const type of itemTypes) {
      rerender(<ScrollOverlayControls {...baseOverlayProps} itemType={type} />);
      const header = container.querySelector<HTMLElement>("[data-queue-header]");
      const row = container.querySelector<HTMLElement>("[data-session-chrome-row='true']");
      expect(header).toBeInTheDocument();
      expect(header?.dataset.chromeStandardized).toBe("true");
      expect(header?.dataset.itemType).toBe(type);
      // Mode toolbar must NOT live inside [data-queue-header] so header bounds remain invariant.
      expect(header?.querySelector("[data-queue-modes]")).toBeNull();
      expect(row?.className).toContain("h-12");
      expect(row?.className).toContain("min-h-[48px]");

      headerClasses.add(header?.className ?? "");
      rowClasses.add(row?.className ?? "");

      const dock = container.querySelector<HTMLElement>("[data-rating-dock]");
      expect(dock).toBeInTheDocument();
      expect(dock?.dataset.dockStandardized).toBe("true");
      expect(dock?.className).toContain("min-h-[56px]");
      expect(dock?.className).toContain("bottom-6");
      expect(dock?.className).toContain("z-30");
    }

    expect(headerClasses.size).toBe(1);
    expect(rowClasses.size).toBe(1);
  });

  it("renders FlashcardScrollItem with standardized top/bottom safe padding and non-colliding in-flow header", () => {
    const mockCard: LearningItem = {
      id: "card-1",
      extract_id: "ext-1",
      document_id: "doc-1",
      item_type: "Qa",
      question: "What preserves chrome coordinates?",
      answer: "Shared session chrome constants.",
      state: "Review",
      due_date: new Date().toISOString(),
      interval: 5,
      ease_factor: 2.5,
      difficulty: 4,
      lapses: 0,
      review_count: 2,
      tags: [],
      date_created: new Date().toISOString(),
      date_modified: new Date().toISOString(),
      is_suspended: false,
      memory_state: { stability: 10, difficulty: 4 },
    };

    const { container } = render(
      <FlashcardScrollItem learningItem={mockCard} onRate={vi.fn()} onEdit={vi.fn()} />
    );

    const surface = container.querySelector<HTMLElement>("[data-flashcard-scroll-surface='true']");
    expect(surface).toBeInTheDocument();
    expect(surface?.className).toContain("pt-[68px]");
    expect(surface?.className).toContain("pb-[92px]");
    expect(screen.getByTestId("review-card-edit")).toBeInTheDocument();
    // Ensure edit button is no longer trapped in absolute top-6 corner overlapping header
    expect(screen.getByTestId("review-card-edit").closest(".absolute.top-6")).toBeNull();
  });

  it("renders ExtractScrollItem with matching safe-area chrome clearance", () => {
    const mockExtract: Extract = {
      id: "ext-1",
      document_id: "doc-1",
      content: "Deterministic extract content",
      highlight_color: "yellow",
      tags: [],
      category: undefined,
      notes: "",
      date_created: new Date().toISOString(),
      date_modified: new Date().toISOString(),
      review_count: 1,
      reps: 1,
      progressive_disclosure_level: 0,
      max_disclosure_level: 0,
      is_dismissed: false,
    };

    const { container } = render(
      <ExtractScrollItem
        extract={mockExtract}
        documentTitle="Systems Architecture"
        onRate={vi.fn()}
        onCreateCloze={vi.fn()}
        onCreateQA={vi.fn()}
      />
    );

    const surface = container.querySelector<HTMLElement>("[data-extract-scroll-surface='true']");
    expect(surface).toBeInTheDocument();
    expect(surface?.className).toContain(SESSION_CHROME_BOUNDS.SAFE_CONTENT_CLASS);
  });
});
