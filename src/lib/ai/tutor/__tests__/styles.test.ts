/**
 * Tutor opening-style and policy-limit tests (task 2.2).
 *
 * Verifies the three lesson styles produce one focal question per turn, that
 * preludes never duplicate or replace the question, that hint/probe limits are
 * enforced by the shared policy machine, and that a style change never mutates
 * historical turns.
 */

import { describe, expect, it, vi } from "vitest";
import { TutorSession, enforceTutorPolicy, type TutorSessionConfig } from "../session";
import type { TutorRunTurn } from "../session";
import type { AITaskResult } from "../../tasks/types";
import type { TutorTurn } from "../../schemas/tutorTurn";

function questionTurn(): AITaskResult<TutorTurn> {
  return {
    output: { move: "question", content: "What is the key trade-off?", hintLevel: 0, stuckDetected: false },
    taskId: "tutor-turn",
    providerId: "test",
    providerKind: "ondevice",
    requestedModelClass: "full",
    servedModelClass: "full",
    fallbackPath: "none",
    validationOutcome: "native-structured",
    text: "",
  };
}

function hintTurn(): AITaskResult<TutorTurn> {
  return {
    output: { move: "hint", content: "Consider the throughput side.", hintLevel: 1, stuckDetected: false },
    taskId: "tutor-turn",
    providerId: "test",
    providerKind: "ondevice",
    requestedModelClass: "full",
    servedModelClass: "full",
    fallbackPath: "none",
    validationOutcome: "native-structured",
    text: "",
  };
}

async function startWith(style: TutorSessionConfig["openingStyle"], runner: TutorRunTurn) {
  const session = await TutorSession.start(
    { topic: "Replication", material: "Raft passage", openingStyle: style },
    {
      retrieve: vi.fn().mockResolvedValue({
        results: [],
        mode: "lexicalOnly",
        candidatesScanned: 0,
      }),
      runTurn: runner,
    }
  );
  return session;
}

describe("Tutor opening styles", () => {
  it("guided opens with exactly one focal question", async () => {
    const runner = vi.fn().mockResolvedValue(questionTurn());
    const session = await startWith("guided", runner as never);
    const transcript = session.getTranscript();
    const tutorTurns = transcript.filter((t) => t.role === "tutor");
    expect(tutorTurns).toHaveLength(1);
    expect(tutorTurns[0].move).toBe("question");
    // The opening question is one focal question, not a list.
    expect(tutorTurns[0].text).toContain("?");
  });

  it("explain-check starts with a short explanation prelude, then one question", async () => {
    const runner = vi.fn().mockResolvedValue(questionTurn());
    const session = await startWith("explain-check", runner as never);
    const transcript = session.getTranscript();
    const tutorTurns = transcript.filter((t) => t.role === "tutor");
    expect(tutorTurns).toHaveLength(2);
    expect(tutorTurns[0].move).toBe("explain");
    expect(tutorTurns[0].text).toMatch(/explain/i);
    expect(tutorTurns[1].move).toBe("question");
  });

  it("challenge frames an application scenario before the focal question", async () => {
    const runner = vi.fn().mockResolvedValue(questionTurn());
    const session = await startWith("challenge", runner as never);
    const transcript = session.getTranscript();
    const tutorTurns = transcript.filter((t) => t.role === "tutor");
    expect(tutorTurns).toHaveLength(2);
    expect(tutorTurns[0].text).toMatch(/apply|scenario/i);
    expect(tutorTurns[1].move).toBe("question");
  });

  it("enforces the hint cap (3 hints → forced explain-and-check)", () => {
    // Pure policy checks (deterministic, no session orchestration).
    const askedTwice = enforceTutorPolicy(
      { move: "question", content: "Still stuck?", hintLevel: 0, stuckDetected: true },
      { stuckCounter: 2, hintThread: { level: 0, consecutiveHints: 0 }, forcedExplain: false, tutorTurnCount: 2, ended: false }
    );
    expect(askedTwice.overrides).toContain("stuck-question-hint");
    expect(askedTwice.turn.move).toBe("hint");

    const thirdHint = enforceTutorPolicy(
      { move: "hint", content: "Consider the throughput side.", hintLevel: 1, stuckDetected: false },
      { stuckCounter: 1, hintThread: { level: 1, consecutiveHints: 2 }, forcedExplain: false, tutorTurnCount: 5, ended: false }
    );
    expect(thirdHint.overrides).toContain("hint-cap-explain");
    expect(thirdHint.turn.move).toBe("explain");
  });

  it("a style switch on a new lesson never mutates an existing transcript", async () => {
    const runner = vi.fn().mockResolvedValue(questionTurn());
    const guided = await startWith("guided", runner as never);
    const before = guided.getTranscript();
    // A different style applies to a different session; the guided session's
    // history stays byte-for-byte identical.
    await startWith("challenge", runner as never);
    expect(guided.getTranscript()).toEqual(before);
    expect(guided.openingStyle).toBe("guided");
  });
});
