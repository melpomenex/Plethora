/**
 * Truncation-repair tests for structured model output (device reports:
 * "learn-this … Unterminated string in JSON at position 605" and
 * "tutor-turn-full … at position 74").
 */
import { describe, expect, it } from "vitest";
import { repairTruncatedJson } from "../schemas/jsonRepair";

describe("repairTruncatedJson", () => {
  it("returns valid JSON unchanged", () => {
    expect(repairTruncatedJson('{"a":1}')).toEqual({ a: 1 });
    expect(repairTruncatedJson('```json\n{"a":[1,2]}\n```')).toEqual({ a: [1, 2] });
  });

  it("closes an unterminated string (the tutor-turn failure shape)", () => {
    const truncated = '{"move":"question","content":"Why does multiplying a vector by';
    expect(repairTruncatedJson(truncated)).toEqual({
      move: "question",
      content: "Why does multiplying a vector by",
    });
  });

  it("closes unterminated strings and braces (the learn-this failure shape)", () => {
    const truncated =
      '{"importance":0.8,"knowledgeType":"definition","concepts":["entropy"],"suggestedCards":[{"cardType":"qa","question":"What is entropy?","answer":"A measure';
    const repaired = repairTruncatedJson(truncated) as {
      suggestedCards: unknown[];
      importance: number;
    };
    expect(repaired).not.toBeNull();
    expect(repaired.importance).toBe(0.8);
    // The half-written card cannot be completed, so it is dropped — a
    // proposal missing its last entry beats no proposal.
    expect(Array.isArray(repaired.suggestedCards)).toBe(true);
  });

  it("drops the incomplete trailing array element but keeps earlier ones", () => {
    const truncated =
      '{"items":[{"q":"a","a":"1"},{"q":"b","a":"2"},{"q":"c","an';
    const repaired = repairTruncatedJson(truncated) as { items: Array<{ q: string }> };
    expect(repaired.items).toHaveLength(2);
    expect(repaired.items[1].q).toBe("b");
  });

  it("handles a cut after a key's colon (mid-property)", () => {
    const truncated = '{"move":"hint","content":"try again","hintLevel":';
    expect(repairTruncatedJson(truncated)).toEqual({
      move: "hint",
      content: "try again",
    });
  });

  it("handles a dangling escape inside the cut string", () => {
    const truncated = '{"content":"a very long ans';
    const repaired = repairTruncatedJson(truncated + "\\") as { content: string };
    expect(repaired.content).toBe("a very long ans");
  });

  it("returns null for non-JSON; a bare opener repairs to an empty object", () => {
    expect(repairTruncatedJson("no json here")).toBeNull();
    expect(repairTruncatedJson("")).toBeNull();
    // "{" closes to "{}" — technically valid JSON; the task validator is the
    // gate that turns it into a repairable validation failure.
    expect(repairTruncatedJson("{")).toEqual({});
  });
});
