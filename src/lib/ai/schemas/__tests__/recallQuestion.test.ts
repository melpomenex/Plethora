import { describe, expect, it } from "vitest";
import {
  validateRecallQuestionProposal,
  validateGeneratedCard,
} from "../recallQuestion";
import { isFailedOutcome } from "../common";

describe("validateRecallQuestionProposal", () => {
  it("accepts valid recall question proposal", () => {
    const outcome = validateRecallQuestionProposal({
      question: "What is photosynthesis?",
      expectedAnswer: "Process by which plants convert sunlight to chemical energy.",
      conceptKeys: ["photosynthesis", "chlorophyll"],
      chunkRefs: ["chunk-1"],
    });
    expect(outcome.ok).toBe(true);
  });

  it("rejects missing chunkRefs", () => {
    const outcome = validateRecallQuestionProposal({
      question: "What is photosynthesis?",
      expectedAnswer: "Answer",
      conceptKeys: [],
      chunkRefs: [],
    });
    expect(outcome.ok).toBe(false);
  });
});

describe("validateGeneratedCard", () => {
  it("accepts valid qa card", () => {
    const outcome = validateGeneratedCard({
      type: "qa",
      question: "What is the capital of France?",
      answer: "Paris",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.type).toBe("qa");
      expect(outcome.value.question).toBe("What is the capital of France?");
      expect(outcome.value.answer).toBe("Paris");
    }
  });

  it("accepts valid cloze card with {{c1::...}} delimiter", () => {
    const outcome = validateGeneratedCard({
      type: "cloze",
      question: "Paris is the {{c1::capital}} of France.",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.type).toBe("cloze");
    }
  });

  it("accepts valid cloze card with hint", () => {
    const outcome = validateGeneratedCard({
      type: "cloze",
      question: "Paris is the {{c1::capital::city type}} of France.",
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.type).toBe("cloze");
    }
  });

  it("rejects cloze with unclosed delimiter", () => {
    const outcome = validateGeneratedCard({
      type: "cloze",
      question: "Paris is the {{c1::capital of France.",
    });
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.some((e) => e.includes("invalid cloze syntax"))).toBe(true);
    }
  });

  it("rejects cloze with malformed delimiter", () => {
    const outcome = validateGeneratedCard({
      type: "cloze",
      question: "Paris is the {{c::capital}} of France.",
    });
    expect(outcome.ok).toBe(false);
    if (isFailedOutcome(outcome)) {
      expect(outcome.errors.some((e) => e.includes("invalid cloze syntax"))).toBe(true);
    }
  });

  it("degrades 1-step ordered steps to qa", () => {
    const outcome = validateGeneratedCard({
      type: "ordered-steps",
      question: "How do you start the engine?",
      steps: ["Turn the key in the ignition clockwise."],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.type).toBe("qa");
      expect(outcome.value.answer).toBe("Turn the key in the ignition clockwise.");
    }
  });

  it("preserves multi-step ordered steps as process", () => {
    const outcome = validateGeneratedCard({
      type: "ordered-steps",
      question: "How do you start the engine?",
      steps: [
        "Step 1: Check neutral gear.",
        "Step 2: Turn the key in the ignition.",
      ],
    });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.type).toBe("process");
      expect(outcome.value.steps?.length).toBe(2);
    }
  });
});
