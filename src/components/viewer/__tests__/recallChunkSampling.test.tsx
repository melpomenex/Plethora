/**
 * Unit tests for the "already-read" chunk approximation helpers (task 5.5)
 * and the RecallPromptOverlay render (question / answer / feedback / keep /
 * not-today states).
 */

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  approximateReadParagraphs,
  buildApproxChunks,
  chunkTextOverlapsRead,
  chooseRecallChunks,
  estimateConceptDensity,
  splitParagraphs,
} from "../recallChunkSampling";
import { RecallPromptOverlay } from "../RecallPromptOverlay";
import type { ActiveRecallPrompt } from "../useRecallPrompts";

const P1 = "Virtual memory lets a process address more memory than is physically installed by mapping virtual addresses onto a mix of RAM and disk-backed pages.";
const P2 = "A page fault occurs when a process touches a virtual page that is not currently mapped in physical RAM, and the kernel handles it by loading the page from disk.";
const P3 = "The page table is the per-process data structure that maps virtual page numbers to physical frame numbers, plus permission bits.";
const DOC = [P1, P2, P3].join("\n\n");

describe("splitParagraphs", () => {
  it("keeps substantial paragraphs and drops trivia", () => {
    const parts = splitParagraphs(`${P1}\n\nshort\n\n${P2}`);
    expect(parts).toEqual([P1, P2]);
  });

  it("collapses internal whitespace runs", () => {
    const parts = splitParagraphs(P1.replace("memory", "  memory  \n "));
    expect(parts[0]).toBe(P1);
  });
});

describe("approximateReadParagraphs", () => {
  it("includes the first (visible) paragraph at scroll zero but nothing beyond", () => {
    // The opening paragraph is on screen at scroll 0 — encountered, not
    // upcoming. Everything below stays out.
    expect(approximateReadParagraphs(DOC, 0)).toEqual([P1]);
  });

  it("cuts at the read fraction — never upcoming content", () => {
    // 34% read: only the first paragraph is (partially) included, P3 never.
    const early = approximateReadParagraphs(DOC, 0.34);
    expect(early.join(" ")).not.toContain("page table");
    // 100% read: everything may be sampled, capped by maxChars.
    const all = approximateReadParagraphs(DOC, 1);
    expect(all.length).toBeGreaterThan(0);
    expect(all.join(" ").length).toBeLessThanOrEqual(2400 + P1.length);
  });

  it("clamps out-of-range fractions", () => {
    expect(approximateReadParagraphs(DOC, 5).length).toBeGreaterThan(0);
    expect(approximateReadParagraphs(DOC, -1)).toEqual([P1]);
  });
});

describe("buildApproxChunks", () => {
  it("derives stable deterministic ids from the text", () => {
    const a = buildApproxChunks([P1]);
    const b = buildApproxChunks([P1]);
    expect(a).toEqual(b);
    expect(a[0].id).toMatch(/^approx-[0-9a-f]{8}$/);
    expect(a[0].text).toBe(P1);
  });

  it("truncates oversized paragraphs to the chunk budget", () => {
    const long = "x".repeat(2000);
    const [chunk] = buildApproxChunks([long]);
    expect(chunk.text.length).toBe(900);
  });
});

describe("chunkTextOverlapsRead", () => {
  it("accepts a chunk whose tokens appeared in the read region", () => {
    expect(chunkTextOverlapsRead(P2, `${P1}\n\n${P2}`)).toBe(true);
  });

  it("rejects a chunk from unread content", () => {
    expect(chunkTextOverlapsRead(P3, P1)).toBe(false);
  });
});

describe("chooseRecallChunks", () => {
  it("picks the most recent chunks, newest first, capped at 3", () => {
    const chunks = [1, 2, 3, 4, 5];
    expect(chooseRecallChunks(chunks)).toEqual([5, 4, 3]);
    expect(chooseRecallChunks([1, 2])).toEqual([2, 1]);
    expect(chooseRecallChunks([])).toEqual([]);
  });
});

describe("estimateConceptDensity", () => {
  it("is chunks per minute with a half-minute floor", () => {
    expect(estimateConceptDensity(3, 1)).toBe(3);
    expect(estimateConceptDensity(2, 0)).toBe(4); // 2 chunks / 0.5 min floor
    expect(estimateConceptDensity(0, 5)).toBe(0);
  });
});

const prompt: ActiveRecallPrompt = {
  promptId: "rp-1",
  question: "Why can virtual memory exceed physical RAM?",
  expectedAnswer: "Per-process address spaces map onto RAM and disk-backed pages.",
  conceptKeys: ["virtual memory"],
  chunkIds: ["chunk-1"],
  chunkTexts: [P1],
  fingerprint: "ab12cd34",
};

describe("RecallPromptOverlay", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <RecallPromptOverlay
        open={false}
        prompt={null}
        phase="idle"
        assessment={null}
        assessmentError={null}
        onSubmitAnswer={() => {}}
        onDismiss={() => {}}
        onNotToday={() => {}}
        onKeep={() => {}}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the question with an answer input before submit", () => {
    render(
      <RecallPromptOverlay
        open
        prompt={prompt}
        phase="prompt"
        assessment={null}
        assessmentError={null}
        onSubmitAnswer={() => {}}
        onDismiss={() => {}}
        onNotToday={() => {}}
        onKeep={() => {}}
      />
    );
    expect(screen.getByText(prompt.question)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/answer from memory/i)).toBeInTheDocument();
    expect(screen.queryByText(/expected answer/i)).not.toBeInTheDocument();
  });

  it("submits the typed answer", () => {
    const onSubmitAnswer = vi.fn();
    render(
      <RecallPromptOverlay
        open
        prompt={prompt}
        phase="prompt"
        assessment={null}
        assessmentError={null}
        onSubmitAnswer={onSubmitAnswer}
        onDismiss={() => {}}
        onNotToday={() => {}}
        onKeep={() => {}}
      />
    );
    fireEvent.change(screen.getByPlaceholderText(/answer from memory/i), {
      target: { value: "because disk" },
    });
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(onSubmitAnswer).toHaveBeenCalledWith("because disk");
  });

  it("shows feedback with the classification, correction, and expected answer", () => {
    render(
      <RecallPromptOverlay
        open
        prompt={prompt}
        phase="feedback"
        assessment={{
          classification: "misconception",
          score: 0.1,
          completeness: 0.1,
          missingConcepts: ["page table"],
          misconception: "Confuses paging with compression.",
          feedback: "Virtual memory maps pages, it does not compress them.",
          suggestedCorrection: "Pages map to RAM or disk.",
          confidence: 0.9,
        }}
        assessmentError={null}
        onSubmitAnswer={() => {}}
        onDismiss={() => {}}
        onNotToday={() => {}}
        onKeep={() => {}}
      />
    );
    expect(screen.getByText("Misconception")).toBeInTheDocument();
    expect(screen.getByText(/Confuses paging with compression/i)).toBeInTheDocument();
    expect(screen.getByText(/Missing: page table/i)).toBeInTheDocument();
    expect(screen.getByText(prompt.expectedAnswer)).toBeInTheDocument();
  });

  it("exposes dismiss, not-today, and keep controls", () => {
    const onDismiss = vi.fn();
    const onNotToday = vi.fn();
    const onKeep = vi.fn();
    render(
      <RecallPromptOverlay
        open
        prompt={prompt}
        phase="feedback"
        assessment={null}
        assessmentError={null}
        onSubmitAnswer={() => {}}
        onDismiss={onDismiss}
        onNotToday={onNotToday}
        onKeep={onKeep}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /continue reading/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /keep this question/i }));
    expect(onKeep).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /don't ask me again today/i }));
    expect(onNotToday).toHaveBeenCalledTimes(1);
  });
});
