/**
 * Controller-level tests for `useRecallPrompts` (task 5.5): the eligibility
 * loop, chunk sampling, fingerprint dedup against history, recording, and
 * the answer → feedback transition. All side-effectful dependencies are
 * injected; the recall/assessment tasks are mocked at module level.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useRecallPrompts, type RecallPromptDeps } from "../useRecallPrompts";
import type { RecallPromptRecord } from "../../../api/recall-history";

const runRecallQuestion = vi.fn();
vi.mock("../../../lib/ai/tasks/definitions/recallTask", () => ({
  runRecallQuestion: (...args: unknown[]) => runRecallQuestion(...args),
}));

const runAssessAnswer = vi.fn();
vi.mock("../../../lib/ai/tasks/definitions/assessmentTask", () => ({
  runAssessAnswer: (...args: unknown[]) => runAssessAnswer(...args),
}));

const P1 =
  "Virtual memory lets a process address more memory than is physically installed by mapping virtual addresses onto a mix of RAM and disk-backed pages.";
const P2 =
  "A page fault occurs when a process touches a virtual page that is not currently mapped in physical RAM; the kernel loads it from disk and resumes the instruction.";
const DOC = `${P1}\n\n${P2}`;

const proposal = {
  question: "Why can virtual memory exceed physical RAM?",
  expectedAnswer: "Address spaces map onto RAM and disk.",
  conceptKeys: ["virtual memory"],
  chunkRefs: ["approx-fn1"],
};

function deps(overrides: Partial<RecallPromptDeps> = {}): RecallPromptDeps {
  return {
    fetchRecentPrompts: vi.fn().mockResolvedValue([]),
    recordPrompt: vi
      .fn()
      .mockResolvedValue({ id: "rp-1" } as RecallPromptRecord),
    setOutcome: vi.fn().mockResolvedValue(true),
    retrieveChunks: vi.fn().mockResolvedValue([]),
    readDocumentText: () => DOC,
    now: () => new Date("2026-08-15T10:00:00Z"),
    tickMs: 5,
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    mode: "adaptive" as const,
    aiAvailable: true,
    documentId: "doc-1",
    documentTitle: "OS",
    isSelecting: false,
    isReflowActive: false,
    isPlaybackActive: false,
    getScrollPercent: () => 100,
    ...overrides,
  };
}

beforeEach(() => {
  runRecallQuestion.mockReset();
  runAssessAnswer.mockReset();
  runRecallQuestion.mockResolvedValue({ proposal, run: { providerId: "fake" } });
  localStorage.clear();
});

/** Wait for at least one eligibility tick (tickMs is 5ms in these tests). */
async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("useRecallPrompts controller", () => {
  it("never starts the loop when the mode is off (kill switch)", async () => {
    const d = deps();
    renderHook(() => useRecallPrompts(options({ mode: "off" }), d));
    tick();
    tick();
    expect(runRecallQuestion).not.toHaveBeenCalled();
    expect(d.recordPrompt).not.toHaveBeenCalled();
  });

  it("never runs when the feature flag is disabled or AI is unavailable", () => {
    for (const overrides of [{ enabled: false }, { aiAvailable: false }] as Record<string, unknown>[]) {
      const d = deps();
      renderHook(() => useRecallPrompts(options(overrides), d));
      tick();
      expect(runRecallQuestion).not.toHaveBeenCalled();
    }
  });

  it("generates from already-read chunks, records the prompt, and shows it", async () => {
    const d = deps();
    const { result } = renderHook(() => useRecallPrompts(options(), d));
    await waitFor(() => expect(result.current.phase).toBe("prompt"), { timeout: 2000 });

    // Grounded in the sampled read text (approx chunk ids).
    expect(runRecallQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        documentTitle: "OS",
        chunks: expect.arrayContaining([
          expect.objectContaining({ id: expect.stringMatching(/^approx-/) }),
        ]),
      })
    );
    expect(d.recordPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        fingerprint: expect.any(String),
        question: proposal.question,
        outcome: "asked",
      })
    );
    expect(result.current.prompt?.question).toBe(proposal.question);
    expect(result.current.prompt?.expectedAnswer).toBe(proposal.expectedAnswer);
  });

  it("suppresses during active selection / playback", async () => {
    for (const overrides of [
      { isSelecting: true },
      { isPlaybackActive: true },
      { isReflowActive: true },
    ] as Record<string, unknown>[]) {
      const d = deps();
      renderHook(() => useRecallPrompts(options(overrides), d));
      await tick();
      await tick();
      expect(runRecallQuestion).not.toHaveBeenCalled();
    }
  });

  it("discards a near-duplicate of recent history and shows no prompt", async () => {
    const history = [
      {
        id: "old-1",
        documentId: "doc-1",
        chunkIds: ["approx-fn1"],
        fingerprint: "00000000",
        question: "Why can virtual memory exceed the physical RAM?",
        askedAt: new Date().toISOString(),
        outcome: "answered",
      },
    ];
    const d = deps({ fetchRecentPrompts: vi.fn().mockResolvedValue(history) });
    const { result } = renderHook(() => useRecallPrompts(options(), d));
    // Attempts exhaust (dup filtered, chunk removed) without showing anything.
    await waitFor(() => expect(runRecallQuestion).toHaveBeenCalled());
    await waitFor(() => expect(result.current.phase).toBe("idle"));
    expect(d.recordPrompt).not.toHaveBeenCalled();
  });

  it("assesses a submitted answer and moves to feedback", async () => {
    runAssessAnswer.mockResolvedValue({
      assessment: {
        classification: "partial",
        score: 0.5,
        completeness: 0.5,
        missingConcepts: ["page table"],
        feedback: "partly",
        confidence: 0.8,
      },
      run: { providerId: "fake" },
    });
    const d = deps();
    const { result } = renderHook(() => useRecallPrompts(options(), d));
    await waitFor(() => expect(result.current.phase).toBe("prompt"), { timeout: 2000 });

    await act(async () => {
      await result.current.submitAnswer("because disk");
    });
    expect(runAssessAnswer).toHaveBeenCalledWith(
      expect.objectContaining({
        question: proposal.question,
        expectedAnswer: proposal.expectedAnswer,
        userAnswer: "because disk",
      })
    );
    expect(result.current.phase).toBe("feedback");
    expect(result.current.assessment?.classification).toBe("partial");
    expect(d.setOutcome).toHaveBeenCalledWith("rp-1", "answered");
  });

  it("dismissal resets to idle; 'not today' blocks until the next day", async () => {
    let clock = new Date("2026-08-15T10:00:00Z");
    const d = deps({ now: () => clock });
    const { result } = renderHook(() => useRecallPrompts(options(), d));
    await waitFor(() => expect(result.current.phase).toBe("prompt"), { timeout: 2000 });

    act(() => result.current.notToday());
    expect(result.current.phase).toBe("idle");
    expect(localStorage.getItem("incrementum-recall-dismissed-until")).toBe("2026-08-15");

    // Same day: no new prompts even after the interval elapses.
    await tick();
    await tick();
    expect(runRecallQuestion).toHaveBeenCalledTimes(1);

    // Next day: eligible again.
    clock = new Date("2026-08-16T09:00:00Z");
    await waitFor(() => expect(runRecallQuestion).toHaveBeenCalledTimes(2), { timeout: 2000 });
  });

  it("keepQuestion returns the promotion payload and marks the outcome promoted", async () => {
    const d = deps();
    const { result } = renderHook(() => useRecallPrompts(options(), d));
    await waitFor(() => expect(result.current.phase).toBe("prompt"), { timeout: 2000 });

    let payload: ReturnType<typeof result.current.keepQuestion> = null;
    act(() => {
      payload = result.current.keepQuestion();
    });
    expect(payload).not.toBeNull();
    expect(payload!.question).toBe(proposal.question);
    expect(payload!.expectedAnswer).toBe(proposal.expectedAnswer);
    expect(payload!.passage).toContain("Virtual memory");
    expect(result.current.phase).toBe("idle");
    expect(d.setOutcome).toHaveBeenCalledWith("rp-1", "promoted");
  });

  it("resets the session when the document changes", async () => {
    const d = deps();
    const { result, rerender } = renderHook(
      ({ documentId }: { documentId: string }) => useRecallPrompts(options({ documentId }), d),
      { initialProps: { documentId: "doc-1" } }
    );
    await waitFor(() => expect(result.current.phase).toBe("prompt"), { timeout: 2000 });
    rerender({ documentId: "doc-2" });
    expect(result.current.phase).toBe("idle");
    expect(result.current.prompt).toBeNull();
  });
});
