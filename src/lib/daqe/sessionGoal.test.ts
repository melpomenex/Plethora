import { describe, expect, it } from "vitest";
import {
  MAX_RECENT_GOALS,
  MAX_SESSION_GOAL_LENGTH,
  applySessionGoal,
  coerceRecentGoals,
  coerceSessionGoal,
  normalizeSessionGoal,
  validateSessionGoal,
} from "./sessionGoal";

describe("normalizeSessionGoal", () => {
  it("trims surrounding whitespace", () => {
    expect(normalizeSessionGoal("  Exam Review  ")).toBe("Exam Review");
  });

  it("treats a whitespace-only field as no goal rather than an empty goal", () => {
    expect(normalizeSessionGoal("   ")).toBeUndefined();
    expect(normalizeSessionGoal("\t\n ")).toBeUndefined();
    expect(normalizeSessionGoal("")).toBeUndefined();
  });

  it("reports a non-string as no goal", () => {
    expect(normalizeSessionGoal(undefined)).toBeUndefined();
    expect(normalizeSessionGoal(null)).toBeUndefined();
    expect(normalizeSessionGoal(42)).toBeUndefined();
  });

  it("keeps interior spacing intact", () => {
    expect(normalizeSessionGoal("Exam Review & CS Foundations")).toBe(
      "Exam Review & CS Foundations",
    );
  });
});

describe("validateSessionGoal", () => {
  it("accepts ordinary text", () => {
    expect(validateSessionGoal("Reducibility Proofs").ok).toBe(true);
  });

  it("accepts a goal of exactly the maximum length", () => {
    const exact = "x".repeat(MAX_SESSION_GOAL_LENGTH);
    expect(validateSessionGoal(exact).ok).toBe(true);
  });

  it("refuses an over-long goal rather than accepting a truncated one", () => {
    const overlong = "x".repeat(MAX_SESSION_GOAL_LENGTH + 1);
    const result = validateSessionGoal(overlong);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(String(MAX_SESSION_GOAL_LENGTH));
  });

  it("measures length after trimming, so padding does not cause a refusal", () => {
    const padded = `  ${"x".repeat(MAX_SESSION_GOAL_LENGTH)}  `;
    expect(validateSessionGoal(padded).ok).toBe(true);
  });

  it("explains a refusal to an empty field", () => {
    expect(validateSessionGoal("   ").error).toBeTruthy();
  });
});

describe("applySessionGoal", () => {
  it("returns the trimmed goal", () => {
    expect(applySessionGoal("  Exam Review  ")?.goal).toBe("Exam Review");
  });

  it("refuses an over-long goal, so the caller keeps the previous one", () => {
    expect(applySessionGoal("x".repeat(MAX_SESSION_GOAL_LENGTH + 1))).toBeNull();
  });

  it("records a committed goal in the history", () => {
    expect(applySessionGoal("Linear Algebra", [])?.recentGoals).toEqual([
      "Linear Algebra",
    ]);
  });

  it("puts the newest goal first", () => {
    const first = applySessionGoal("Linear Algebra", []);
    const second = applySessionGoal("Topology", first!.recentGoals);
    expect(second?.recentGoals).toEqual(["Topology", "Linear Algebra"]);
  });

  it("deduplicates case-insensitively and keeps the newest casing", () => {
    const first = applySessionGoal("Linear Algebra", []);
    const second = applySessionGoal("LINEAR ALGEBRA", first!.recentGoals);
    expect(second?.recentGoals).toEqual(["LINEAR ALGEBRA"]);
  });

  it("moves an existing goal to the front instead of duplicating it", () => {
    const history = ["Topology", "Linear Algebra"];
    expect(applySessionGoal("Topology", history)?.recentGoals).toEqual([
      "Topology",
      "Linear Algebra",
    ]);
  });

  it("caps the history, dropping the least recently used", () => {
    let history: string[] = [];
    for (let index = 0; index < MAX_RECENT_GOALS + 3; index += 1) {
      history = applySessionGoal(`Goal ${index}`, history)!.recentGoals;
    }
    expect(history).toHaveLength(MAX_RECENT_GOALS);
    expect(history[0]).toBe(`Goal ${MAX_RECENT_GOALS + 2}`);
    expect(history).not.toContain("Goal 0");
  });

  it("clears the goal without touching the history when the field is emptied", () => {
    const history = ["Topology", "Linear Algebra"];
    expect(applySessionGoal("   ", history)).toEqual({
      goal: "",
      recentGoals: history,
    });
  });
});

describe("coerceSessionGoal", () => {
  it("reads a pre-existing blob with no goal as empty", () => {
    expect(coerceSessionGoal(undefined)).toBe("");
  });

  it("trims a stored goal", () => {
    expect(coerceSessionGoal(" Exam Review ")).toBe("Exam Review");
  });

  it("drops a stored over-long goal rather than truncating it", () => {
    expect(coerceSessionGoal("x".repeat(MAX_SESSION_GOAL_LENGTH + 1))).toBe("");
  });

  it("rejects a stored non-string", () => {
    expect(coerceSessionGoal({ goal: "Exam Review" })).toBe("");
  });
});

describe("coerceRecentGoals", () => {
  it("reads a pre-existing blob with no history as empty", () => {
    expect(coerceRecentGoals(undefined)).toEqual([]);
  });

  it("drops entries that are not usable text", () => {
    expect(coerceRecentGoals(["Exam Review", "", "   ", null, 7])).toEqual([
      "Exam Review",
    ]);
  });

  it("drops an over-long entry, which would set a goal the field refuses", () => {
    expect(
      coerceRecentGoals(["x".repeat(MAX_SESSION_GOAL_LENGTH + 1), "Exam Review"]),
    ).toEqual(["Exam Review"]);
  });

  it("deduplicates case-insensitively and preserves order", () => {
    expect(coerceRecentGoals(["a", "B", "A", "b", "c"])).toEqual(["a", "B", "c"]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_RECENT_GOALS + 4 }, (_, i) => `g${i}`);
    expect(coerceRecentGoals(many)).toHaveLength(MAX_RECENT_GOALS);
  });

  it("rejects a non-array", () => {
    expect(coerceRecentGoals({ goals: ["a"] })).toEqual([]);
  });
});