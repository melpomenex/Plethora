import { beforeEach, describe, expect, it } from "vitest";
import { clearTaskDiagnostics, getTaskDiagnostics, recordTaskDiagnostic } from "../diagnostics";

beforeEach(() => {
  clearTaskDiagnostics();
});

describe("recordTaskDiagnostic", () => {
  it("records sanitized metadata without prompt or source text fields", () => {
    const diag = recordTaskDiagnostic({
      taskId: "task-123",
      taskType: "passage-qa",
      baseModelName: "gemini-nano",
      inputTokens: 100,
      outputTokens: 50,
      totalLatencyMs: 420,
      grounded: true,
      accepted: true,
    });

    expect(diag.taskId).toBe("task-123");
    expect(diag.taskType).toBe("passage-qa");
    expect(diag.totalLatencyMs).toBe(420);

    const keys = Object.keys(diag);
    expect(keys).not.toContain("text");
    expect(keys).not.toContain("prompt");
    expect(keys).not.toContain("completion");
    expect(keys).not.toContain("image");
    expect(keys).not.toContain("dataBase64");
  });

  it("maintains max entry history cap", () => {
    for (let i = 0; i < 60; i++) {
      recordTaskDiagnostic({ taskId: `t-${i}`, taskType: "prompt" });
    }

    const log = getTaskDiagnostics();
    expect(log.length).toBe(50);
    expect(log[0].taskId).toBe("t-10");
  });
});
