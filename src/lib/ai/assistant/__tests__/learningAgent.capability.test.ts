/**
 * Capability negotiation + protocol probe (change 10.4): declared context
 * support is checked before transmission; the deterministic probe is bounded,
 * consented (run-submit-triggered), persisted per (provider, model, contract
 * revision), and repeated failures surface a typed warning.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import {
  clearProtocolProbes,
  getProtocolProbe,
  runProtocolProbe,
  PROTOCOL_PROBE_PROMPT,
} from "../../agent/protocolProbe";
import {
  preflightLearningAgent,
  resolveLearningAgentScope,
  runLearningAgent,
  type LearningAgentRouteSelection,
} from "../learningAgent";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../../stores/settingsStore";
import type { AgentEnvironment } from "../../agent/tools/types";

function cfg(overrides: Partial<LLMProviderConfig>): LLMProviderConfig {
  return {
    id: "cfg-1",
    provider: "ollama",
    name: "Config",
    apiKey: "",
    baseUrl: "http://localhost:11434",
    model: "llama3",
    enabled: true,
    temperature: 0.7,
    maxTokens: 4096,
    ...overrides,
  } as LLMProviderConfig;
}

function env(): AgentEnvironment {
  return {
    sourceScope: "global",
    retrieve: async () => ({ results: [], mode: "none" }),
    getDocument: () => ({ id: "d1", title: "Doc", fileType: "pdf" }),
    getSelection: () => null,
    getRecentExtracts: async () => [],
    getCards: async () => [],
    getDueCards: async () => [],
    getReviewStats: async () => ({
      totalItems: 0,
      totalReviews: 0,
      totalLapses: 0,
      avgInterval: 0,
      retentionEstimate: 0,
      dueToday: 0,
      dueWeek: 0,
      dueMonth: 0,
    }),
    getImageAsset: async () => null,
  };
}

beforeEach(() => {
  clearProtocolProbes();
  useLLMProvidersStore.setState({ providers: [cfg({})] as never });
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      features: { ...state.settings.features, aiAgent: true },
      ai: { ...state.settings.ai, strictLocalOnly: false, allowCloudFallback: true },
      embedding: {
        ...state.settings.embedding,
        provider: "ollama",
        ollamaBaseUrl: "http://localhost:11434",
        paidEmbeddingsEnabled: false,
      },
    },
  }));
});

describe("protocol probe unit behavior", () => {
  it("passes on a contract-compliant response and persists the result", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        {
          requestId: "probe",
          text: JSON.stringify({ toolCalls: [], finalAnswer: "smoke ok" }),
          baseModelName: "llama3",
        },
      ],
    });
    const result = await runProtocolProbe(p);
    expect(result.ok).toBe(true);
    expect(result.model).toBe("llama3");
    expect(p.requests[0].text).toBe(PROTOCOL_PROBE_PROMPT);
    expect(getProtocolProbe(p.id, "llama3")?.ok).toBe(true);
  });

  it("fails on non-compliant output and persists the failure", async () => {
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [{ requestId: "probe", text: "nope", baseModelName: "llama3" }],
    });
    const result = await runProtocolProbe(p);
    expect(result.ok).toBe(false);
    expect(getProtocolProbe(p.id, "llama3")?.ok).toBe(false);
  });
});

describe("preflight context negotiation", () => {
  it("blocks before transmission when the selected context is too small", async () => {
    useLLMProvidersStore.setState({
      providers: [cfg({ provider: "ollama", contextWindowTokens: 1500 })] as never,
    });
    const selection: LearningAgentRouteSelection = {
      providerId: "ollama",
      config: cfg({ provider: "ollama", contextWindowTokens: 1500 }),
      kind: "cloud",
    };
    const result = await preflightLearningAgent({ selection });
    expect(result.ok).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain("no-model");
    expect(result.blockers[0].message.toLowerCase()).toContain("context");
  });
});

describe("runLearningAgent protocol probe wiring", () => {
  it("repeated probe failure surfaces a typed compatibility note (no silent run)", async () => {
    const prepared = resolveLearningAgentScope({
      conversationId: "conv-1",
      ownerRevision: 1,
      intent: "Cards from this paper",
      scope: "document",
      documents: [{ id: "paper-a", title: "Paper A" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const selection: LearningAgentRouteSelection = {
      providerId: "ollama",
      config: cfg({}),
      kind: "cloud",
    };
    const probeProvider = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "probe", text: "nope", baseModelName: "llama3" },
        { requestId: "t1", text: JSON.stringify({ finalAnswer: "done" }) },
      ],
    });
    // First probe failure is recorded but does not block the run.
    const first = await runLearningAgent(prepared.run, {
      provider: probeProvider,
      env: env(),
      selection,
      protocolProbe: true,
      wallClockMs: 5_000,
      guard: () => null,
    });
    expect(first.result.endReason).toBe("final-answer");
    expect(getProtocolProbe(probeProvider.id, "llama3")?.ok).toBe(false);
    // Second run with a still-failing probe ends typed (fresh provider so the
    // probe script replays from index 0).
    const againProvider = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "probe", text: "nope", baseModelName: "llama3" },
        { requestId: "t1", text: JSON.stringify({ finalAnswer: "done" }) },
      ],
    });
    const again = await runLearningAgent(prepared.run, {
      provider: againProvider,
      env: env(),
      selection,
      protocolProbe: true,
      wallClockMs: 5_000,
      guard: () => null,
    });
    expect(again.result.endReason).toBe("error");
    expect(again.result.error?.category).toBe("CapabilityUnavailable");
  });

  it("probe is skipped entirely when not wired", async () => {
    const prepared = resolveLearningAgentScope({
      conversationId: "conv-2",
      ownerRevision: 1,
      intent: "Cards from this paper",
      scope: "document",
      documents: [{ id: "paper-a", title: "Paper A" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const p = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [
        { requestId: "t1", text: JSON.stringify({ finalAnswer: "done" }) },
      ],
    });
    const outcome = await runLearningAgent(prepared.run, {
      provider: p,
      env: env(),
      wallClockMs: 5_000,
      guard: () => null,
    });
    expect(outcome.result.endReason).toBe("final-answer");
    expect(p.requests.length).toBe(1);
    expect(getProtocolProbe(p.id, "llama3")).toBeUndefined();
  });
});
