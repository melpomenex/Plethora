import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import React from "react";
import { useUIStore, UI_DENSITY_STORAGE_KEY } from "../uiStore";
import { FlashcardScrollItem } from "../../components/review/FlashcardScrollItem";
import type { LearningItem } from "../../api/learning-items";

vi.mock("../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock("../../hooks/useHapticFeedback", () => ({
  useHapticFeedback: () => ({ trigger: vi.fn() }),
}));

vi.mock("../../lib/feedback/orchestrator", () => ({
  emitUserInteraction: vi.fn(),
}));

vi.mock("../../lib/rating-grades", () => ({
  gradeToRating: (g: number) => g,
  useRatingSchema: () => ({ type: "four-button" }),
}));

vi.mock("../../components/review/SixGradeRatingControl", () => ({
  SixGradeRatingControl: () => React.createElement("div"),
}));

vi.mock("../../components/review/ReviewCardContent", () => ({
  ReviewCardContent: ({ text }: { text: string }) => React.createElement("div", null, text),
}));

const sampleCard: LearningItem = {
  id: "card-1",
  item_type: "Flashcard",
  question: "What is Raft?",
  answer: "A consensus algorithm.",
  difficulty: 5.1,
  interval: 14,
  ease_factor: 2.5,
  due_date: "2026-11-16T00:00:00Z",
  date_created: "2026-10-01T00:00:00Z",
  date_modified: "2026-11-01T00:00:00Z",
  review_count: 3,
  lapses: 0,
  state: "Review",
  is_suspended: false,
  tags: [],
  memory_state: {
    stability: 14.2,
    difficulty: 5.1,
  },
};

describe("UX02-T01 uiStore densityMode", () => {
  beforeEach(() => {
    window.localStorage.removeItem(UI_DENSITY_STORAGE_KEY);
    useUIStore.getState().setDensityMode("zen");
  });

  it("defaults to zen, toggles between zen and architect, and persists to localStorage", () => {
    expect(useUIStore.getState().densityMode).toBe("zen");

    act(() => {
      useUIStore.getState().toggleDensityMode();
    });
    expect(useUIStore.getState().densityMode).toBe("architect");
    expect(window.localStorage.getItem(UI_DENSITY_STORAGE_KEY)).toBe("architect");

    act(() => {
      useUIStore.getState().toggleDensityMode();
    });
    expect(useUIStore.getState().densityMode).toBe("zen");
    expect(window.localStorage.getItem(UI_DENSITY_STORAGE_KEY)).toBe("zen");
  });

  it("hides [data-architect-telemetry='true'] in zen mode and reveals it in architect mode", () => {
    const { rerender } = render(
      React.createElement(FlashcardScrollItem, { learningItem: sampleCard, onRate: vi.fn() })
    );

    expect(document.querySelector("[data-architect-telemetry='true']")).not.toBeInTheDocument();

    act(() => {
      useUIStore.getState().setDensityMode("architect");
    });

    rerender(React.createElement(FlashcardScrollItem, { learningItem: sampleCard, onRate: vi.fn() }));

    const telemetry = document.querySelector("[data-architect-telemetry='true']");
    expect(telemetry).toBeInTheDocument();
    expect(telemetry).toHaveTextContent("S 14.2d");
    expect(telemetry).toHaveTextContent("D 5.1");
  });
});
