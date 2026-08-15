/**
 * Cloud-fallback guard tests (design D27 / ai-task-architecture spec).
 *
 * The automatic on-device → cloud retry inside `runTask` must be a SILENT
 * no-op unless the user allows cloud fallback at all, and must never re-send
 * content after a user cancellation or an on-device safety refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../providers/types";

const { allowCloudFallbackMock, routingMock } = vi.hoisted(() => ({
  allowCloudFallbackMock: vi.fn((): boolean => true),
  routingMock: { providers: [] as AIProvider[] },
}));

vi.mock("../provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider")>()),
  allowCloudFallback: allowCloudFallbackMock,
}));

vi.mock("../providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../providers")>()),
  getRoutingProviders: () => routingMock.providers,
}));

import { runTask } from "../tasks/runTask";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../tasks/containment";
import { AIError } from "../errors";
import { clearTaskDiagnostics } from "../diagnostics";
import type { AITaskDefinition } from "../tasks/types";

function task(): AITaskDefinition<{ q: string }, string> {
  return {
    id: `fallback-${Math.random().toString(36).slice(2, 7)}`,
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nAnswer briefly.`,
    buildInput: (input) => ({ text: `Question: ${input.q}` }),
    outputKind: "text",
    maxOutputTokens: 128,
    timeoutMs: 5000,
  };
}

/** A routing table whose on-device slot fails with `error` and whose cloud
 * slot answers `cloudAnswer`. */
function route(error: Error, cloudAnswer: string) {
  const onDevice = new FakeAIProvider({ kind: "ondevice", responses: [error] });
  const cloud = new FakeAIProvider({
    kind: "cloud",
    responses: [{ requestId: "cloud-1", text: cloudAnswer }],
  });
  routingMock.providers = [onDevice, cloud];
  return { onDevice, cloud };
}

beforeEach(() => {
  clearTaskDiagnostics();
  allowCloudFallbackMock.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTask on-device → cloud fallback guard", () => {
  it("retries on the cloud provider when fallback is allowed", async () => {
    const { cloud } = route(new Error("on-device exploded"), "cloud answer");
    const result = await runTask(task(), { q: "x" });
    expect(result.output).toBe("cloud answer");
    expect(cloud.callCount).toBe(1);
  });

  it("never touches a cloud provider when allowCloudFallback is off", async () => {
    allowCloudFallbackMock.mockReturnValue(false);
    const { cloud } = route(new Error("on-device exploded"), "cloud answer");

    await expect(runTask(task(), { q: "x" })).rejects.toMatchObject({
      category: "GenerationFailed",
    });
    expect(cloud.callCount).toBe(0);
  });

  it("never re-sends content the on-device model refused (SafetyBlocked)", async () => {
    const { cloud } = route(
      new AIError("SafetyBlocked", "blocked by on-device safety filters"),
      "cloud answer"
    );

    await expect(runTask(task(), { q: "x" })).rejects.toMatchObject({
      category: "SafetyBlocked",
    });
    expect(cloud.callCount).toBe(0);
  });

  it("never falls back for cancellations", async () => {
    const { cloud } = route(new AIError("Cancelled", "user aborted"), "cloud answer");

    await expect(runTask(task(), { q: "x" })).rejects.toMatchObject({
      category: "Cancelled",
    });
    expect(cloud.callCount).toBe(0);
  });
});
