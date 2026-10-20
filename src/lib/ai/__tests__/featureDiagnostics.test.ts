import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllDiagnostics,
  clearFeatureDiagnostics,
  getFeatureSummaries,
  getFeatureSummary,
  getTaskDiagnostics,
  recordFeatureObservation,
  recordTaskDiagnostic,
} from "../diagnostics";
import {
  buildRedactedDiagnosticsReport,
  normalizeErrorCategory,
  normalizeProviderClass,
  serializeRedactedDiagnosticsReport,
  MAX_REPORT_BYTES,
} from "../diagnostics/featureReport";
import { FEATURE_IDS } from "../features/types";
import { evaluateFeatureReadiness } from "../features/registry";

function ctx(overrides: Record<string, unknown> = {}) {
  return {
    revision: "rev-1",
    checkedAt: 1,
    checking: false,
    flags: {
      aiLearnThis: true,
      aiLibraryRag: true,
      aiSocraticTutor: true,
      aiOcclusionAssist: true,
      aiSemanticIndex: true,
      aiAnswerAssessment: true,
      aiPrerequisites: true,
      aiConceptLinks: true,
      aiExtractWorthiness: true,
      aiAgent: true,
      aiActiveRecall: true,
    },
    activeRecallMode: "auto",
    platform: { os: "linux", mobile: false },
    generation: { state: "available", detail: { providerClass: "ollama-local", destination: "loopback", reasoning: true, vision: false } },
    embeddings: { state: "available", detail: { providerClass: "ollama-local", destination: "loopback", lexicalFallback: true } },
    ocr: { state: "available" },
    index: { state: "ready", detail: { completeness: "complete" } },
    relationships: { state: "available", detail: { prerequisites: true, links: true } },
    passageAdapter: { state: "available" },
    source: { state: "available" },
    disclosure: { state: "available" },
    billing: { state: "available" },
    ...overrides,
  } as never;
}

describe("feature observations", () => {
  beforeEach(() => clearAllDiagnostics());

  it("records a sanitized observation and correlates stages", () => {
    const observation = recordFeatureObservation({
      featureId: "learning-agent",
      runId: "run-1",
      stage: "generation",
      level: "operational",
      outcome: "success",
      durationMs: 120,
      capabilityRevision: "rev-1",
      providerClass: "ollama-local",
      modelClass: "full",
      smoke: false,
    });
    expect(observation).toBeDefined();
    expect(observation!.timestamp).toBeGreaterThan(0);

    recordFeatureObservation({
      featureId: "learning-agent",
      runId: "run-1",
      stage: "preview",
      level: "operational",
      outcome: "failed",
      durationMs: 5,
      capabilityRevision: "rev-1",
      errorCategory: "InvalidStructuredOutput",
      recoveryCode: "preview_invalid",
    });

    const summary = getFeatureSummary("learning-agent", "rev-1")!;
    expect(summary.stages.generation?.outcome).toBe("success");
    expect(summary.stages.preview?.outcome).toBe("failed");
    expect(summary.lastErrorAt).toBeGreaterThan(0);
    expect(summary.lastSuccessAt).toBeGreaterThan(0);
    expect(summary.stale).toBe(false);
  });

  it("marks evidence stale when the capability revision changes", () => {
    recordFeatureObservation({
      featureId: "learn-this",
      runId: "run-1",
      stage: "persistence",
      level: "operational",
      outcome: "success",
      durationMs: 1,
      capabilityRevision: "rev-1",
    });
    expect(getFeatureSummary("learn-this", "rev-2")!.stale).toBe(true);
    expect(getFeatureSummary("learn-this")!.stale).toBe(false);
  });

  it("drops observations with unknown feature/stage and unsafe raw strings", () => {
    expect(
      recordFeatureObservation({
        featureId: "not-a-feature" as never,
        runId: "run",
        stage: "generation",
        level: "operational",
        outcome: "success",
        capabilityRevision: "rev",
      })
    ).toBeUndefined();
    expect(
      recordFeatureObservation({
        featureId: "learn-this",
        runId: "run",
        stage: "bogus-stage" as never,
        level: "operational",
        outcome: "success",
        capabilityRevision: "rev",
      })
    ).toBeUndefined();

    const observation = recordFeatureObservation({
      featureId: "learn-this",
      runId: "run with spaces and /private/path",
      stage: "generation",
      level: "operational",
      outcome: "failed",
      capabilityRevision: "rev 1",
      errorCategory: "Error: token sk-live-SECRET /Users/me/private.pdf",
    })!;
    expect(observation.runId).toBe("run-unknown");
    expect(observation.capabilityRevision).toBe("unknown");
    expect(observation.errorCategory).toBeUndefined();
  });

  it("is session-local and bounded to the ten feature groups", () => {
    for (const featureId of FEATURE_IDS) {
      recordFeatureObservation({
        featureId,
        runId: `run-${featureId}`,
        stage: "generation",
        level: "operational",
        outcome: "success",
        durationMs: 1,
        capabilityRevision: "rev-1",
      });
    }
    expect(getFeatureSummaries()).toHaveLength(10);
    clearFeatureDiagnostics();
    expect(getFeatureSummaries()).toHaveLength(0);
  });

  it("keeps the existing task ring working alongside feature summaries", () => {
    recordTaskDiagnostic({ taskId: "learn-this-task", taskType: "prompt" });
    expect(getTaskDiagnostics()).toHaveLength(1);
    clearAllDiagnostics();
    expect(getTaskDiagnostics()).toHaveLength(0);
    expect(getFeatureSummaries()).toHaveLength(0);
  });
});

describe("redacted diagnostics report", () => {
  beforeEach(() => clearAllDiagnostics());

  const SECRETS = [
    "sk-live-51H8SECRETKEY",
    "PRIVATE_PROMPT_CANARY",
    "/Users/alice/Library/private-notes.pdf",
    "https://internal.example.com/v1/chat?key=abc",
    "<script>alert('xss')</script>",
    "source title canary",
  ];

  it("normalizes provider and error values to finite categories", () => {
    expect(normalizeProviderClass("ondevice-gemini-nano")).toBe("android-nano");
    expect(normalizeProviderClass("cloud-llm")).toBe("configured-provider");
    expect(normalizeProviderClass("some-arbitrary-provider-string")).toBe("unknown");
    expect(normalizeErrorCategory("Cancelled")).toBe("Cancelled");
    expect(normalizeErrorCategory("Error: boom sk-live")).toBe("Unknown");
  });

  it("never includes sensitive canaries in any branch", () => {
    recordTaskDiagnostic({
      taskId: SECRETS[0],
      taskType: "prompt",
      providerId: SECRETS[3],
      errorCategory: SECRETS[4],
      errorCode: SECRETS[1],
      baseModelName: SECRETS[2],
      chunkIds: [SECRETS[3]],
    });
    recordFeatureObservation({
      featureId: "learning-agent",
      runId: SECRETS[1],
      stage: "generation",
      level: "operational",
      outcome: "failed",
      durationMs: 1,
      capabilityRevision: SECRETS[2],
      errorCategory: SECRETS[4],
      recoveryCode: SECRETS[0],
      providerClass: SECRETS[3],
    });

    const rows = evaluateFeatureReadiness(ctx());
    const report = buildRedactedDiagnosticsReport({
      appVersion: "3.4.0",
      platformFamily: "linux",
      capabilityRevision: "rev-1",
      taskDiagnostics: getTaskDiagnostics(),
      featureReadiness: rows,
      featureSummaries: getFeatureSummaries(),
      currentRevision: "rev-1",
      now: 1_700_000_000_000,
    });
    const json = JSON.stringify(report);
    for (const secret of SECRETS) {
      expect(json).not.toContain(secret);
    }
    // Feature rows still cover all ten groups.
    expect(report.features).toHaveLength(10);
    expect(report.schemaVersion).toBe("ai-diagnostics-report-v1");
    expect(report.scope).toBe("session");
  });

  it("caps output size and reports truncation without cutting JSON", () => {
    for (let i = 0; i < 80; i += 1) {
      recordTaskDiagnostic({
        taskId: `task-${i}`,
        taskType: "prompt",
        totalLatencyMs: 10,
      });
    }
    const report = buildRedactedDiagnosticsReport({
      appVersion: "3.4.0",
      platformFamily: "android",
      taskDiagnostics: getTaskDiagnostics(),
      featureReadiness: evaluateFeatureReadiness(ctx()),
      featureSummaries: [],
      now: 1,
    });
    expect(report.tasks).toHaveLength(50);
    // The task ring itself is capped at 50, so nothing extra was omitted —
    // truncation applies when a caller supplies a larger set or a smaller cap.
    expect(report.truncation.tasksOmitted).toBe(0);

    const serialized = serializeRedactedDiagnosticsReport(report, 2_000);
    expect(serialized.bytes).toBeLessThanOrEqual(2_000);
    expect(serialized.truncated).toBe(true);
    // Never mid-string truncation: the output still parses.
    expect(() => JSON.parse(serialized.json)).not.toThrow();
  });

  it("uses the 256 KiB default cap", () => {
    const report = buildRedactedDiagnosticsReport({
      appVersion: "3.4.0",
      platformFamily: "windows",
      taskDiagnostics: [],
      featureReadiness: evaluateFeatureReadiness(ctx()),
      featureSummaries: [],
    });
    const serialized = serializeRedactedDiagnosticsReport(report);
    expect(serialized.bytes).toBeLessThan(MAX_REPORT_BYTES);
  });

  it("never turns a never-evaluated feature into ready", () => {
    const report = buildRedactedDiagnosticsReport({
      appVersion: "3.4.0",
      platformFamily: "linux",
      taskDiagnostics: [],
      featureReadiness: [],
      featureSummaries: [],
    });
    expect(report.features).toHaveLength(10);
    expect(report.features.every((f) => f.status !== "ready")).toBe(true);
  });
});
