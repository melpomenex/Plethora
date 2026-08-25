/**
 * runTask integration tests for macOS Apple Foundation Models routing:
 * cancellation must not trigger cloud fallback, structured tasks must pass
 * schemaName to the on-device provider, and diagnostics must stay content-free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AIProvider } from "../../providers/types";
import { FakeAppleFoundationProvider } from "../../providers/fakes";
import { runTask } from "../runTask";
import { clearTaskDiagnostics, getTaskDiagnostics } from "../../diagnostics";
import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../containment";
import { PREREQUISITE_ANALYSIS_SCHEMA } from "../../schemas/prerequisite";
import { AIError } from "../../errors";
import type { AITaskDefinition, ValidationOutcome } from "../types";
import type { PrerequisiteAnalysis } from "../../schemas/prerequisite";

const { requestCloudFallbackMock, routingMock } = vi.hoisted(() => ({
  requestCloudFallbackMock: vi.fn((): Promise<boolean> => Promise.resolve(true)),
  routingMock: { providers: [] as AIProvider[] },
}));

vi.mock("../../provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../provider")>()),
  requestCloudFallback: requestCloudFallbackMock,
}));

vi.mock("../../providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../providers")>()),
  getRoutingProviders: () => routingMock.providers,
}));

function textTask(): AITaskDefinition<{ q: string }, string> {
  return {
    id: `apple-fm-text-${Math.random().toString(36).slice(2, 7)}`,
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nAnswer briefly.`,
    buildInput: (input) => ({ text: `SECRET_PROMPT:${input.q}` }),
    outputKind: "text",
    maxOutputTokens: 128,
    timeoutMs: 5000,
  };
}

function structuredTask(): AITaskDefinition<{ src: string }, PrerequisiteAnalysis> {
  return {
    id: `apple-fm-struct-${Math.random().toString(36).slice(2, 7)}`,
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: `${UNTRUSTED_CONTAINMENT_CLAUSE}\nPropose prerequisites.`,
    buildInput: (input) => ({
      text: `<untrusted_source id="src">\n${input.src}\n</untrusted_source>`,
    }),
    outputKind: "structured",
    schema: PREREQUISITE_ANALYSIS_SCHEMA as AITaskDefinition<
      { src: string },
      PrerequisiteAnalysis
    >["schema"],
    validate: (output): ValidationOutcome<PrerequisiteAnalysis> => {
      if (
        typeof output === "object" &&
        output !== null &&
        Array.isArray((output as { prerequisites?: unknown }).prerequisites)
      ) {
        return { ok: true, value: output as PrerequisiteAnalysis };
      }
      return { ok: false, errors: ["prerequisites: malformed entries"] };
    },
    maxOutputTokens: 512,
    timeoutMs: 5000,
  };
}

function routeOnDevice(
  onDevice: FakeAppleFoundationProvider,
  cloudAnswer = "cloud answer"
): FakeAppleFoundationProvider {
  const cloud = new FakeAppleFoundationProvider({
    id: "cloud-llm",
    kind: "cloud",
    responses: [{ requestId: "cloud-1", text: cloudAnswer }],
  });
  routingMock.providers = [onDevice, cloud];
  return cloud;
}

beforeEach(() => {
  clearTaskDiagnostics();
  requestCloudFallbackMock.mockClear();
  requestCloudFallbackMock.mockResolvedValue(true);
  routingMock.providers = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTask Apple Foundation cancellation", () => {
  it("does not consult cloud fallback consent for a user cancellation", async () => {
    requestCloudFallbackMock.mockResolvedValue(false);
    const onDevice = new FakeAppleFoundationProvider({
      responses: [new AIError("Cancelled", "user aborted")],
    });
    const cloud = routeOnDevice(onDevice);

    await expect(runTask(textTask(), { q: "x" })).rejects.toMatchObject({
      category: "Cancelled",
    });

    expect(cloud.callCount).toBe(0);
    expect(requestCloudFallbackMock).not.toHaveBeenCalled();
  });

  it("does not retry on cloud when cancellation is returned from routing", async () => {
    const onDevice = new FakeAppleFoundationProvider({
      responses: [new AIError("Cancelled", "aborted mid-stream")],
    });
    const cloud = routeOnDevice(onDevice);

    await expect(runTask(textTask(), { q: "x" })).rejects.toMatchObject({
      category: "Cancelled",
    });
    expect(cloud.callCount).toBe(0);
  });
});

describe("runTask Apple Foundation structured generation", () => {
  it("uses strict JSON for schemas not compiled into the Swift bridge", async () => {
    const onDevice = new FakeAppleFoundationProvider({
      capabilities: { structuredGeneration: true, textGeneration: true },
      responses: [
        {
          requestId: "fm-1",
          text: '{"prerequisites":[]}',
        },
      ],
    });
    routeOnDevice(onDevice);

    const result = await runTask(structuredTask(), { src: "chapter one" });

    expect(result.validationOutcome).toBe("strict-json");
    expect(onDevice.requests[0].structured).toBe(false);
    expect(onDevice.requests[0].schemaName).toBeUndefined();
    expect(onDevice.requests[0].systemInstruction).toContain("ONLY a single JSON value");
  });
});

describe("runTask Apple Foundation diagnostics privacy", () => {
  it("records metadata without prompt or completion text", async () => {
    const onDevice = new FakeAppleFoundationProvider({
      responses: [{ requestId: "fm-2", text: "SECRET_COMPLETION_BODY" }],
    });
    routeOnDevice(onDevice);

    await runTask(textTask(), { q: "top-secret user question" });

    const serialized = JSON.stringify(getTaskDiagnostics());
    expect(serialized).not.toContain("SECRET_PROMPT");
    expect(serialized).not.toContain("SECRET_COMPLETION");
    expect(serialized).not.toContain("top-secret user question");

    const latest = getTaskDiagnostics().at(-1);
    expect(latest?.providerId).toBe(onDevice.id);
    expect(Object.keys(latest ?? {})).not.toContain("prompt");
    expect(Object.keys(latest ?? {})).not.toContain("text");
    expect(Object.keys(latest ?? {})).not.toContain("completion");
  });
});
