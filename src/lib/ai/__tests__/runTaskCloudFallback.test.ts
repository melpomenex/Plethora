/**
 * Cloud-fallback guard tests (design D27 / ai-task-architecture spec).
 *
 * The automatic on-device → cloud retry inside `runTask` must never re-send
 * content without explicit consent (ai-billing-safety #14): a paid cloud
 * retry proceeds only when the consent surface is approved (or the persisted
 * opt-in is set), a denial stops the operation, and neither user cancellations
 * nor on-device safety refusals are ever retried.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../providers/types";

const { requestCloudFallbackMock, routingMock } = vi.hoisted(() => ({
  requestCloudFallbackMock: vi.fn((): Promise<boolean> => Promise.resolve(true)),
  routingMock: { providers: [] as AIProvider[] },
}));

vi.mock("../provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../provider")>()),
  requestCloudFallback: requestCloudFallbackMock,
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
  requestCloudFallbackMock.mockClear();
  requestCloudFallbackMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTask on-device → cloud fallback guard", () => {
  it("retries on the cloud provider when fallback consent is granted", async () => {
    const { cloud } = route(new Error("on-device exploded"), "cloud answer");
    const result = await runTask(task(), { q: "x" });
    expect(result.output).toBe("cloud answer");
    expect(cloud.callCount).toBe(1);
    expect(requestCloudFallbackMock).toHaveBeenCalled();
  });

  it("never touches a cloud provider when fallback consent is denied", async () => {
    requestCloudFallbackMock.mockResolvedValue(false);
    const { cloud } = route(new Error("on-device exploded"), "cloud answer");

    await expect(runTask(task(), { q: "x" })).rejects.toMatchObject({
      category: "GenerationFailed",
    });
    expect(cloud.callCount).toBe(0);
  });

  it("does not consult the consent gate for a user cancellation", async () => {
    requestCloudFallbackMock.mockResolvedValue(false);
    const { cloud } = route(new AIError("Cancelled", "user aborted"), "cloud answer");

    await expect(runTask(task(), { q: "x" })).rejects.toMatchObject({
      category: "Cancelled",
    });
    expect(cloud.callCount).toBe(0);
    expect(requestCloudFallbackMock).not.toHaveBeenCalled();
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
    expect(requestCloudFallbackMock).not.toHaveBeenCalled();
  });

  it("never falls back for cancellations", async () => {
    const { cloud } = route(new AIError("Cancelled", "user aborted"), "cloud answer");

    await expect(runTask(task(), { q: "x" })).rejects.toMatchObject({
      category: "Cancelled",
    });
    expect(cloud.callCount).toBe(0);
  });
});
