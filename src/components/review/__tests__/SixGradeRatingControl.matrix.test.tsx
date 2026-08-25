/**
 * Matrix + pipeline tests for the shared six-grade rating control (change
 * unified-rating-ux):
 *
 * - Control matrix: view (Queue overlay, Queue flashcard, shared control) ×
 *   platform (desktop, touch) × algorithm (Adaptive, Precision, fsrs) — which rating
 *   UI renders.
 * - Per-grade pipeline: selecting each of grades 0-5 produces the expected
 *   (rating, grade) pair in both Queue surfaces and the Review button grid,
 *   all sourced from the same shared semantics — Queue ≡ Review, with no
 *   4-grade normalization.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import React from "react";
import { SixGradeRatingControl } from "../SixGradeRatingControl";
import { RatingButtons } from "../RatingButtons";
import { FlashcardScrollItem } from "../FlashcardScrollItem";
import { ScrollOverlayControls } from "../../queue/ScrollOverlayControls";
import { useSettingsStore } from "../../../stores/settingsStore";
import {
  SIX_GRADES,
  gradeToRating,
  getRatingSchema,
} from "../../../lib/rating-grades";

// Desktop by default; individual tests override for the touch matrix.
const formFactorMock = vi.hoisted(() => ({ value: "desktop" as string }));
vi.mock("../../../hooks/useFormFactor", () => ({
  useFormFactor: () => formFactorMock.value,
}));

function setAlgorithm(algorithm: "fsrs" | "adaptive" | "precision") {
  useSettingsStore.setState((state) => ({
    settings: { ...state.settings, learning: { ...state.settings.learning, algorithm } },
  }));
}

const baseLearningItem = {
  id: "item-1",
  item_type: "Flashcard" as const,
  question: "Question?",
  answer: "Answer",
  difficulty: 3,
  interval: 0,
  ease_factor: 2.5,
  due_date: new Date().toISOString(),
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  review_count: 0,
  lapses: 0,
  state: "New" as const,
  is_suspended: false,
  tags: [],
  image_asset_ids: [],
};

const gradeButtons = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>("[data-review-rating]"));

beforeEach(() => {
  formFactorMock.value = "desktop";
  setAlgorithm("fsrs");
});

afterEach(() => {
  setAlgorithm("fsrs");
});

describe("SixGradeRatingControl control matrix", () => {
  it("desktop renders the six explicit grade buttons in grade order", () => {
    const { container } = render(<SixGradeRatingControl onSelect={vi.fn()} />);
    const values = gradeButtons(container).map((b) => b.getAttribute("data-review-rating"));
    expect(values).toEqual(["0", "1", "2", "3", "4", "5"]);
  });

  it("touch renders the six buttons AND wires the joystick gesture to the touch area", () => {
    formFactorMock.value = "phone";
    const touchAreaRef = React.createRef<HTMLDivElement | null>();
    const onSelect = vi.fn();
    const { container } = render(
      <div ref={touchAreaRef}>
        <SixGradeRatingControl onSelect={onSelect} touchAreaRef={touchAreaRef} />
      </div>,
    );
    // Button grid still present (accessible fallback)…
    expect(gradeButtons(container)).toHaveLength(6);
    // …and the joystick gesture commits through the shared area.
    const el = touchAreaRef.current!;
    const touch = (type: string, x: number, y: number) => {
      const event = new Event(type, { cancelable: true, bubbles: true }) as TouchEvent;
      Object.defineProperty(event, "touches", {
        value: [{ clientX: x, clientY: y }],
        configurable: true,
      });
      el.dispatchEvent(event);
    };
    act(() => {
      touch("touchstart", 200, 200);
    });
    act(() => {
      touch("touchmove", 200, 140);
    });
    act(() => {
      touch("touchend", 200, 140);
    });
    expect(onSelect).toHaveBeenCalledWith(3, 4);
  });
});

describe("Queue flashcard matrix (view × platform × algorithm)", () => {
  it("Adaptive/Precision flashcards render the six-grade control after reveal", () => {
    for (const algorithm of ["adaptive", "precision"] as const) {
      setAlgorithm(algorithm);
      const { container } = render(
        <FlashcardScrollItem learningItem={baseLearningItem} onRate={vi.fn()} />,
      );
      // Before reveal: rating UI hidden.
      expect(gradeButtons(container)).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
      const values = gradeButtons(container).map((b) => b.getAttribute("data-review-rating"));
      expect(values).toEqual(["0", "1", "2", "3", "4", "5"]);
    }
  });

  it("fsrs flashcards keep the four-rating buttons", () => {
    setAlgorithm("fsrs");
    render(<FlashcardScrollItem learningItem={baseLearningItem} onRate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(gradeButtons(document.body)).toHaveLength(0);
    for (const label of ["Again", "Hard", "Good", "Easy"]) {
      expect(screen.getByRole("button", { name: new RegExp(label, "i") })).toBeInTheDocument();
    }
  });

  it("six-grade UI never appears for four-grade algorithms under any platform", () => {
    formFactorMock.value = "phone";
    setAlgorithm("fsrs");
    const { container } = render(
      <FlashcardScrollItem learningItem={baseLearningItem} onRate={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    expect(gradeButtons(container)).toHaveLength(0);
    expect(screen.getByRole("button", { name: /Again/i })).toBeInTheDocument();
  });
});

describe("Queue overlay matrix (desktop documents)", () => {
  const overlayProps = {
    showControls: true,
    showRatingControls: true,
    currentIndex: 0,
    totalItems: 5,
    sessionOffset: 0,
    itemType: "document",
    itemTitle: "Doc",
    itemDocumentId: "doc-1",
    isNewDocument: false,
    isRating: false,
    scrollViewMode: "document",
    isMobile: false,
    ratingOrbsPosition: "right" as const,
    onExit: vi.fn(),
    onShowSettings: vi.fn(),
    onShowRssSettings: vi.fn(),
    onSetScrollViewMode: vi.fn(),
    onOpenExtractDialog: vi.fn(),
    onDismiss: vi.fn(),
    onGoToNext: vi.fn(),
    onGoToPrevious: vi.fn(),
  };

  it("documents keep the four-orb rail even under Adaptive/Precision (no grade buttons)", () => {
    // Documents are scheduled by the four-grade FSRS-6 engagement scheduler
    // regardless of the flashcard algorithm — the 0-5 UI must never leak
    // into the document overlay. Regression test for the overlay branch that
    // once rendered six grade buttons here.
    for (const algorithm of ["adaptive", "precision", "fsrs"] as const) {
      setAlgorithm(algorithm);
      const onRate = vi.fn();
      const { container } = render(
        <ScrollOverlayControls {...overlayProps} onRate={onRate} />,
      );
      const panel = within(container);
      expect(gradeButtons(container)).toHaveLength(0);
      for (const title of ["Again", "Hard", "Good", "Easy"]) {
        expect(panel.getByTitle(title)).toBeInTheDocument();
      }
      // Orbs submit plain 1-4 ratings with no grade.
      fireEvent.click(panel.getByTitle("Again"));
      fireEvent.click(panel.getByTitle("Easy"));
      expect(onRate.mock.calls).toEqual([[1], [4]]);
    }
  });
});

describe("per-grade pipeline: Queue ≡ Review, no 4-grade normalization", () => {
  it("each grade 0-5 in the Queue flashcard submits the exact grade + equivalent rating", () => {
    for (const algorithm of ["adaptive", "precision"] as const) {
      setAlgorithm(algorithm);
      for (const { grade, rating } of SIX_GRADES) {
        const onRate = vi.fn();
        const { container } = render(
          <FlashcardScrollItem learningItem={baseLearningItem} onRate={onRate} />,
        );
        fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
        fireEvent.click(container.querySelector(`[data-review-rating='${grade}']`)!);
        expect(onRate).toHaveBeenCalledTimes(1);
        expect(onRate).toHaveBeenCalledWith(rating, grade);
      }
    }
  });

  it("keyboard grades 0-5 on a revealed Queue flashcard submit rating+grade pairs", () => {
    for (const algorithm of ["adaptive", "precision"] as const) {
      setAlgorithm(algorithm);
      for (const { grade, rating } of SIX_GRADES) {
        const onRate = vi.fn();
        const { container } = render(
          <FlashcardScrollItem learningItem={baseLearningItem} onRate={onRate} />,
        );
        fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
        // Keydown with focus inside the card container (the card's own
        // handler is container-scoped).
        fireEvent.keyDown(container.firstElementChild as HTMLElement, {
          key: String(grade),
        });
        expect(onRate).toHaveBeenCalledTimes(1);
        expect(onRate).toHaveBeenCalledWith(rating, grade);
      }
    }
  });

  it("keyboard on a four-grade flashcard keeps plain 1-4 ratings; 0/5 inert", () => {
    setAlgorithm("fsrs");
    const onRate = vi.fn();
    const { container } = render(
      <FlashcardScrollItem learningItem={baseLearningItem} onRate={onRate} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /show answer/i }));
    const card = container.firstElementChild as HTMLElement;
    for (const key of ["1", "2", "3", "4"]) {
      fireEvent.keyDown(card, { key });
      expect(onRate).toHaveBeenLastCalledWith(Number(key));
    }
    expect(onRate).toHaveBeenCalledTimes(4);
    for (const key of ["0", "5", "6", "9"]) {
      fireEvent.keyDown(card, { key });
    }
    expect(onRate).toHaveBeenCalledTimes(4);
  });

  it("the Review grade grid submits the identical (rating, grade) pairs (Queue ≡ Review)", () => {
    const onSelectRating = vi.fn();
    const { container } = render(
      <RatingButtons onSelectRating={onSelectRating} gradeScale />,
    );
    for (const { grade } of SIX_GRADES) {
      fireEvent.click(container.querySelector(`[data-review-rating='${grade}']`)!);
    }
    expect(onSelectRating.mock.calls).toEqual(
      SIX_GRADES.map((g) => [g.rating, g.grade]),
    );
  });

  it("the equivalent rating always matches the shared gradeToRating mapping", () => {
    for (const { grade, rating } of SIX_GRADES) {
      expect(rating).toBe(gradeToRating(grade));
      // The schema declares all six grades for six-grade schedulers.
      expect(getRatingSchema("precision").grades).toContain(grade);
    }
  });
});
