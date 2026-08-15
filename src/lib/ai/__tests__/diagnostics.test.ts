import { beforeEach, describe, expect, it } from "vitest";
import {
  clearTaskDiagnostics,
  getAiDiagnosticsDebugSummary,
  getTaskDiagnostics,
  recordTaskDiagnostic,
} from "../diagnostics";

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

  it("records the design-D8 task-layer fields", () => {
    const diag = recordTaskDiagnostic({
      taskId: "passage-qa",
      taskType: "passage-qa",
      modelClass: "full",
      requestedModelClass: "reasoning",
      providerId: "ondevice-gemini-nano",
      providerKind: "ondevice",
      capabilityHash: "ab12cd34",
      retrievalCount: 3,
      chunkIds: ["chunk-1", "chunk-2", "chunk-3"],
      validationOutcome: "repaired",
      fallbackPath: "reasoning-fallback",
      firstTokenLatencyMs: 120,
    });

    expect(diag.modelClass).toBe("full");
    expect(diag.requestedModelClass).toBe("reasoning");
    expect(diag.providerId).toBe("ondevice-gemini-nano");
    expect(diag.providerKind).toBe("ondevice");
    expect(diag.capabilityHash).toBe("ab12cd34");
    expect(diag.retrievalCount).toBe(3);
    expect(diag.chunkIds).toEqual(["chunk-1", "chunk-2", "chunk-3"]);
    expect(diag.validationOutcome).toBe("repaired");
    expect(diag.fallbackPath).toBe("reasoning-fallback");
    expect(diag.firstTokenLatencyMs).toBe(120);
  });

  it("drops unknown fields by construction (no-user-content allowlist)", () => {
    const diag = recordTaskDiagnostic({
      taskId: "t",
      taskType: "prompt",
      // Adversarial extra fields must not survive the sanitizer.
      prompt: "SECRET PROMPT",
      completion: "SECRET COMPLETION",
      documentText: "SECRET DOC",
      ...( { text: "SECRET TEXT" } as unknown as Record<string, never>),
    } as Parameters<typeof recordTaskDiagnostic>[0]);

    const serialized = JSON.stringify(diag);
    expect(serialized).not.toContain("SECRET");
    expect(Object.keys(diag)).not.toContain("prompt");
  });

  it("records the error category for failed runs", () => {
    const diag = recordTaskDiagnostic({
      taskId: "cards",
      taskType: "prompt",
      errorCategory: "InvalidStructuredOutput",
      errorCode: "invalid_structured_output",
      validationOutcome: "invalid-structured-output",
    });
    expect(diag.errorCategory).toBe("InvalidStructuredOutput");
    expect(diag.validationOutcome).toBe("invalid-structured-output");
  });
});

describe("getAiDiagnosticsDebugSummary", () => {
  it("aggregates content-free statistics for the debug panel", () => {
    recordTaskDiagnostic({
      taskId: "passage-qa",
      taskType: "passage-qa",
      totalLatencyMs: 100,
      validationOutcome: "text",
    });
    recordTaskDiagnostic({
      taskId: "passage-qa",
      taskType: "passage-qa",
      totalLatencyMs: 300,
      validationOutcome: "strict-json",
    });
    recordTaskDiagnostic({
      taskId: "cards",
      taskType: "prompt",
      errorCategory: "ModelUnavailable",
      totalLatencyMs: 50,
    });

    const summary = getAiDiagnosticsDebugSummary();
    expect(summary.total).toBe(3);
    expect(summary.byTaskId).toEqual({ "passage-qa": 2, cards: 1 });
    expect(summary.byErrorCategory).toEqual({ ModelUnavailable: 1 });
    expect(summary.byValidationOutcome).toEqual({ text: 1, "strict-json": 1 });
    expect(summary.meanTotalLatencyMs).toBe(200); // failures excluded
    expect(summary.recent.length).toBe(3);
  });

  it("returns an empty summary after clearing", () => {
    expect(getAiDiagnosticsDebugSummary().total).toBe(0);
    expect(getAiDiagnosticsDebugSummary().meanTotalLatencyMs).toBeUndefined();
  });
});
