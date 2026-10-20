import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelActiveFeatureSmoke,
  clearFeatureSmokeAdapters,
  getFeatureSmokeAdapter,
  getFeatureSmokeRecord,
  isFeatureSmokeRunning,
  MAX_SMOKE_DURATION_MS,
  registerFeatureSmokeAdapter,
  runFeatureSmoke,
  type FeatureSmokeAdapter,
  type FeatureSmokeContext,
} from "../diagnostics/featureSmoke";
import {
  registerDefaultFeatureSmokeAdapters,
  resetDefaultFeatureSmokeAdaptersForTests,
} from "../diagnostics/smokeAdapters";
import { clearAllDiagnostics, getFeatureSummary } from "../diagnostics";

function adapter(overrides: Partial<FeatureSmokeAdapter> = {}): FeatureSmokeAdapter {
  return {
    featureId: "learn-this",
    stages: ["generation", "validation", "preview"],
    fixtureId: "fixture-learn-this-v1",
    maxDurationMs: 1_000,
    destinations: ["device"],
    mutatesUserData: false,
    requiresConsent: false,
    run: async (context: FeatureSmokeContext) => {
      context.reportStage("generation", "success", { durationMs: 5 });
      context.reportStage("validation", "success", { durationMs: 1 });
      context.reportStage("preview", "success", { durationMs: 1 });
      return { outcome: "success", stages: ["generation", "validation", "preview"] };
    },
    ...overrides,
  };
}

describe("feature smoke runner", () => {
  beforeEach(() => {
    clearFeatureSmokeAdapters();
    resetDefaultFeatureSmokeAdaptersForTests();
    clearAllDiagnostics();
  });

  it("reports not-run/unsupported when no adapter exists", () => {
    expect(getFeatureSmokeRecord("learn-this").state).toBe("unsupported");
    registerFeatureSmokeAdapter(adapter());
    expect(getFeatureSmokeRecord("learn-this").state).toBe("not-run");
    expect(getFeatureSmokeAdapter("learn-this")).toBeDefined();
  });

  it("runs one bounded case and records stage-scoped evidence", async () => {
    registerFeatureSmokeAdapter(adapter());
    const record = await runFeatureSmoke("learn-this", {
      capabilityRevision: "rev-1",
      runId: "smoke-1",
    });
    expect(record.state).toBe("passed");
    expect(record.stages).toEqual(["generation", "validation", "preview"]);
    expect(isFeatureSmokeRunning()).toBe(false);

    const summary = getFeatureSummary("learn-this", "rev-1")!;
    expect(summary.stages.generation?.outcome).toBe("success");
    expect(summary.stages.preview?.outcome).toBe("success");
    expect(summary.smoke?.outcome).toBe("success");
  });

  it("requires explicit consent for a remote fixture and skips on denial", async () => {
    registerFeatureSmokeAdapter(
      adapter({ destinations: ["remote"], requiresConsent: true })
    );
    const authorize = vi.fn(async () => false);
    const record = await runFeatureSmoke("learn-this", {
      capabilityRevision: "rev-1",
      runId: "smoke-1",
      authorize,
    });
    expect(authorize).toHaveBeenCalledOnce();
    expect(record.state).toBe("consent-required");
    expect(record.outcome).toBeUndefined();
    expect(getFeatureSummary("learn-this")!.stages.preview).toBeUndefined();
  });

  it("aborts on timeout and suppresses late success", async () => {
    registerFeatureSmokeAdapter(
      adapter({
        maxDurationMs: 20,
        run: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          // Simulates a native call that cannot abort immediately; the runner
          // must not turn this into a pass.
          context.reportStage("generation", "success");
          return { outcome: "success", stages: ["generation"] };
        },
      })
    );
    const record = await runFeatureSmoke("learn-this", {
      capabilityRevision: "rev-1",
      runId: "smoke-1",
    });
    expect(record.state).toBe("cancelled");
    expect(record.recoveryCode).toBe("smoke_timeout");
  });

  it("stops a running case and never reports passed", async () => {
    let started: (() => void) | undefined;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    registerFeatureSmokeAdapter(
      adapter({
        maxDurationMs: 5_000,
        run: async (context) => {
          started?.();
          await new Promise((resolve) => {
            context.signal.addEventListener("abort", resolve, { once: true });
          });
          return { outcome: "success", stages: ["generation"] };
        },
      })
    );
    const promise = runFeatureSmoke("learn-this", {
      capabilityRevision: "rev-1",
      runId: "smoke-1",
    });
    await startedPromise;
    expect(isFeatureSmokeRunning()).toBe(true);
    cancelActiveFeatureSmoke();
    const record = await promise;
    expect(record.state).toBe("cancelled");
    expect(record.outcome).toBe("cancelled");
  });

  it("enforces single-flight across features", async () => {
    let release: (() => void) | undefined;
    registerFeatureSmokeAdapter(
      adapter({
        maxDurationMs: 5_000,
        run: async () => {
          await new Promise<void>((resolve) => (release = resolve));
          return { outcome: "success", stages: ["generation"] };
        },
      })
    );
    registerFeatureSmokeAdapter(
      adapter({ featureId: "learning-agent", fixtureId: "fixture-agent-v1" })
    );
    const first = runFeatureSmoke("learn-this", { capabilityRevision: "r", runId: "a" });
    const second = await runFeatureSmoke("learning-agent", { capabilityRevision: "r", runId: "b" });
    expect(second.state).toBe("not-run");
    release?.();
    await first;
  });

  it("rejects an over-budget or mutating adapter", () => {
    expect(() =>
      registerFeatureSmokeAdapter(adapter({ maxDurationMs: MAX_SMOKE_DURATION_MS + 1 }))
    ).toThrow();
    expect(() =>
      registerFeatureSmokeAdapter(adapter({ mutatesUserData: true as never }))
    ).toThrow();
  });

  it("registers the bundled production smoke adapters without running them", () => {
    registerDefaultFeatureSmokeAdapters();
    for (const featureId of [
      "learn-this",
      "library-rag",
      "answer-assessment",
      "extract-worthiness",
      "learning-agent",
      "knowledge-relationships",
    ]) {
      expect(getFeatureSmokeAdapter(featureId as never), featureId).toBeDefined();
    }
    // Registration itself starts nothing.
    expect(isFeatureSmokeRunning()).toBe(false);
    for (const record of [
      getFeatureSmokeRecord("learn-this"),
      getFeatureSmokeRecord("learning-agent"),
      getFeatureSmokeRecord("knowledge-relationships"),
    ]) {
      expect(record.state).toBe("not-run");
    }
  });
});
