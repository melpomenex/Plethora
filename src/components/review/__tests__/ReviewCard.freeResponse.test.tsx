/**
 * ReviewCard free-response rendering tests (task 5.8, spec
 * flashcard-review-session): the card renders the optional input and the
 * assessment panel PURELY from the props the session hands it (state lives
 * in `useCardAnswerAssessment` so it survives the reveal remount), and
 * renders NOTHING extra when the props are absent — the flag-off flow is
 * byte-for-byte the pre-feature experience.
 *
 * The full session-level flow (assessment on reveal, persistence after
 * grading, unchanged submitReview payload) is covered by
 * ReviewSession.assessment.test.tsx.
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ReviewCard } from "../ReviewCard";
import { useSettingsStore } from "../../../stores/settingsStore";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

vi.mock("../../../hooks/useTTS", () => ({
  useTTS: () => ({
    speak: vi.fn(),
    stop: vi.fn(),
    isSpeaking: false,
    isPaused: false,
    pause: vi.fn(),
    resume: vi.fn(),
    isSupported: false,
  }),
}));

vi.mock("../../../api/image-registry", () => ({
  getImageAssetById: vi.fn(),
}));

const baseCard = {
  id: "card-1",
  item_type: "flashcard" as const,
  question: "Why can virtual memory exceed physical RAM?",
  answer: "Per-process virtual address spaces map onto RAM and disk-backed pages.",
  difficulty: 3,
  interval: 1,
  ease_factor: 2.5,
  due_date: new Date().toISOString(),
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  review_count: 0,
  lapses: 0,
  state: "new" as const,
  is_suspended: false,
  tags: [],
};

const assessment = {
  classification: "misconception" as const,
  score: 0.1,
  completeness: 0.1,
  missingConcepts: ["virtual address space", "disk-backed paging"],
  misconception: "Confuses virtual memory with memory compression.",
  feedback: "Virtual memory works via address-space mapping, not compression.",
  suggestedCorrection: "Pages map to RAM or disk-backed paging space.",
  confidence: 0.9,
};

describe("ReviewCard free-response prop rendering", () => {
  it("renders nothing extra without the assessment props (flag-off flow)", () => {
    const { container } = render(
      <ReviewCard card={baseCard as never} showAnswer={false} onShowAnswer={() => {}} />
    );
    expect(container.querySelector("[data-free-response-input]")).toBeNull();
    expect(container.querySelector("[data-assessment-panel]")).toBeNull();
  });

  it("renders the skippable input when the session enables it", () => {
    const onChange = vi.fn();
    render(
      <ReviewCard
        card={baseCard as never}
        showAnswer={false}
        onShowAnswer={() => {}}
        freeResponse={{ value: "", onChange }}
      />
    );
    expect(screen.getByLabelText(/answer from memory first/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/answer from memory first/i), {
      target: { value: "typed from memory" },
    });
    expect(onChange).toHaveBeenCalledWith("typed from memory");
  });

  it("hides the input once the answer is revealed", () => {
    const { container } = render(
      <ReviewCard
        card={baseCard as never}
        showAnswer
        onShowAnswer={() => {}}
        freeResponse={{ value: "typed", onChange: () => {} }}
      />
    );
    expect(container.querySelector("[data-free-response-input]")).toBeNull();
  });

  it("renders the assessment panel beside the revealed answer", () => {
    render(
      <ReviewCard
        card={baseCard as never}
        showAnswer
        onShowAnswer={() => {}}
        assessmentPanel={{ assessment, error: null, pending: false }}
      />
    );
    expect(screen.getByText("Misconception")).toBeInTheDocument();
    expect(screen.getByText(/Confuses virtual memory with memory compression/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Missing: virtual address space, disk-backed paging/i)
    ).toBeInTheDocument();
    expect(screen.getByText(baseCard.answer)).toBeInTheDocument();
  });

  it("renders the pending state while the assessment runs", () => {
    render(
      <ReviewCard
        card={baseCard as never}
        showAnswer
        onShowAnswer={() => {}}
        assessmentPanel={{ assessment: null, error: null, pending: true }}
      />
    );
    expect(document.querySelector('[data-assessment-state="pending"]')).not.toBeNull();
  });

  it("renders the neutral note on assessment error without blocking the answer", () => {
    render(
      <ReviewCard
        card={baseCard as never}
        showAnswer
        onShowAnswer={() => {}}
        assessmentPanel={{ assessment: null, error: "boom", pending: false }}
      />
    );
    expect(document.querySelector('[data-assessment-state="error"]')).not.toBeNull();
    expect(screen.getByText(baseCard.answer)).toBeInTheDocument();
  });
});
