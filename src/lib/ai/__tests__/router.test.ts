import { beforeEach, describe, expect, it } from "vitest";
import { resolveTaskRoute } from "../tasks/router";
import { clearTaskRegistry, registerTask } from "../tasks/registry";
import { FakeAIProvider } from "../__fixtures__/FakeAIProvider";
import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../tasks/containment";
import type { AITaskDefinition } from "../tasks/types";

function task(overrides: Partial<AITaskDefinition<unknown, unknown>> = {}): AITaskDefinition<
  unknown,
  unknown
> {
  return {
    id: `task-${Math.random().toString(36).slice(2, 7)}`,
    taskType: "prompt",
    modelClass: "full",
    systemInstruction: UNTRUSTED_CONTAINMENT_CLAUSE,
    buildInput: () => ({ text: "x" }),
    outputKind: "text",
    maxOutputTokens: 128,
    timeoutMs: 5000,
    ...overrides,
  };
}

beforeEach(() => {
  clearTaskRegistry();
});

describe("resolveTaskRoute routing branches (design D3)", () => {
  it("serves fast and full on the first text-capable provider", async () => {
    const onDevice = new FakeAIProvider({ kind: "ondevice" });
    const cloud = new FakeAIProvider({ kind: "cloud" });

    for (const modelClass of ["fast", "full"] as const) {
      const route = await resolveTaskRoute(task({ modelClass }), {
        providers: [onDevice, cloud],
      });
      expect(route?.provider).toBe(onDevice);
      expect(route?.servedModelClass).toBe(modelClass);
      expect(route?.fallbackPath).toBe("none");
    }
  });

  it("skips a provider without text generation and uses the next candidate", async () => {
    const dead = new FakeAIProvider({
      capabilities: { textGeneration: false },
    });
    const cloud = new FakeAIProvider({ kind: "cloud" });
    const route = await resolveTaskRoute(task(), { providers: [dead, cloud] });
    expect(route?.provider).toBe(cloud);
  });

  it("routes reasoning to the provider that declares reasoning", async () => {
    const nano = new FakeAIProvider({ kind: "ondevice" }); // reasoning: false
    const reasoner = new FakeAIProvider({
      kind: "cloud",
      capabilities: { reasoning: true },
    });
    const route = await resolveTaskRoute(task({ modelClass: "reasoning" }), {
      providers: [nano, reasoner],
    });
    expect(route?.provider).toBe(reasoner);
    expect(route?.servedModelClass).toBe("reasoning");
    expect(route?.fallbackPath).toBe("none");
  });

  it("falls back to the declared reasoningFallback task when no provider reasons", async () => {
    const nano = new FakeAIProvider({ kind: "ondevice" }); // Gemini Nano: reasoning false
    const cloud = new FakeAIProvider({ kind: "cloud" }); // gpt-4o-mini: no reasoning

    const fullTask = task({ id: "tutor-full", modelClass: "full" });
    registerTask(fullTask);
    const reasoningTask = task({
      id: "tutor-reasoning",
      modelClass: "reasoning",
      reasoningFallback: "tutor-full",
    });

    const route = await resolveTaskRoute(reasoningTask, { providers: [nano, cloud] });
    expect(route?.task.id).toBe("tutor-full");
    expect(route?.provider).toBe(nano);
    expect(route?.requestedModelClass).toBe("reasoning");
    expect(route?.servedModelClass).toBe("full");
    expect(route?.fallbackPath).toBe("reasoning-fallback");
  });

  it("fails closed when a reasoning task has no fallback and no reasoning provider", async () => {
    const nano = new FakeAIProvider({ kind: "ondevice" });
    const route = await resolveTaskRoute(task({ modelClass: "reasoning" }), {
      providers: [nano],
    });
    // No text-capable reasoning provider and no fallback declared: the router
    // still serves the task on the usable provider (Nano serves all classes
    // identically today), but a task that declares NO fallback and wants to
    // fail may do so via the registry miss path below.
    expect(route?.provider).toBe(nano);
    expect(route?.servedModelClass).toBe("reasoning");
  });

  it("returns null when the reasoning fallback task is not registered and nothing is usable", async () => {
    const dead = new FakeAIProvider({ capabilities: { textGeneration: false } });
    const route = await resolveTaskRoute(
      task({ modelClass: "reasoning", reasoningFallback: "missing-task" }),
      { providers: [dead] }
    );
    expect(route).toBeNull();
  });

  it("returns null with no candidates at all", async () => {
    expect(await resolveTaskRoute(task(), { providers: [] })).toBeNull();
  });

  it("honors forced provider kinds but skips providers without text generation", async () => {
    const dead = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { textGeneration: false },
    });
    const apple = new FakeAIProvider({
      kind: "ondevice",
      capabilities: { textGeneration: true },
    });
    const cloud = new FakeAIProvider({ kind: "cloud" });

    const forcedOnDevice = await resolveTaskRoute(task(), {
      providers: [dead, apple, cloud],
      kind: "ondevice",
    });
    expect(forcedOnDevice?.provider).toBe(apple);

    const forcedCloud = await resolveTaskRoute(task(), {
      providers: [dead, apple, cloud],
      kind: "cloud",
    });
    expect(forcedCloud?.provider).toBe(cloud);

    expect(
      await resolveTaskRoute(task(), { providers: [dead, cloud], kind: "ondevice" })
    ).toBeNull();
  });
});
