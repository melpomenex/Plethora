/**
 * Explicit selection + pinning (change 2.1–2.4): the Assistant's picker
 * choice must necessarily serve every turn; blockers name the selection; the
 * guard compares the frozen snapshot; serving provenance is exposed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const privacyCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);
const readyContext = vi.hoisted(() => ({
  revision: "rev-1",
  checkedAt: 1,
  checking: false,
  flags: { aiAgent: true },
  activeRecallMode: "off",
  platform: { os: "linux", mobile: false },
  generation: {
    state: "available",
    detail: { providerClass: "configured-external", destination: "remote", reasoning: false, vision: false },
  },
  embeddings: {
    state: "available",
    detail: { providerClass: "ollama-local", destination: "loopback", lexicalFallback: true },
  },
  ocr: { state: "available" },
  index: { state: "ready", detail: { completeness: "partial" } },
  relationships: { state: "available", detail: { prerequisites: false, links: false } },
  passageAdapter: { state: "available" },
  source: { state: "available" },
  disclosure: { state: "available" },
  billing: { state: "available" },
}));
const disclosureAllowed = vi.hoisted(() => ({ value: true }));

vi.mock("../../features/probe", () => ({
  computeDependencyRevision: () => "rev-1",
  getFeatureDependencyContext: async () => readyContext,
  buildFeatureDependencyContext: async () => readyContext,
}));
vi.mock("../../provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../provider")>();
  return { ...actual, resolveAiPath: async () => "cloud" };
});
vi.mock("../../../privacy/cloudAiDisclosure", () => ({
  ensureCloudAiDisclosure: async () => disclosureAllowed.value,
}));
vi.mock("../privacyGate", () => ({
  enforceAssistantPrivacyAndConsent: async (args: Record<string, unknown>) => {
    privacyCalls.push(args);
    return { allowed: true };
  },
}));
vi.mock("../../../../utils/aiBillingConsent", () => ({
  requestPaidConsent: async () => true,
}));

import { FakeAIProvider } from "../../__fixtures__/FakeAIProvider";
import {
  createLearningAgentGuard,
  preflightLearningAgent,
  resolveLearningAgentScope,
  runLearningAgent,
  type LearningAgentRouteSelection,
} from "../learningAgent";
import { useLLMProvidersStore, type LLMProviderConfig } from "../../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../../stores/settingsStore";

function baseConfig(overrides: Partial<LLMProviderConfig>): LLMProviderConfig {
  return {
    id: "cfg",
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

function setProviders(providers: LLMProviderConfig[]) {
  useLLMProvidersStore.setState({ providers: providers as never });
}

function setSettings() {
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
}

function cloudRun() {
  return {
    runId: "r",
    conversationId: "c",
    ownerRevision: 1,
    intent: "Cards from this paper",
    scope: "document" as const,
    sources: [],
    sourceRevision: "rev",
    retrievalDocumentIds: [],
    capabilityRevision: "cap",
    generation: {
      providerId: "cloud-llm:cfg",
      kind: "cloud" as const,
      destination: {
        providerClass: "configured-external" as const,
        locality: "remote" as const,
        keyless: false,
        billable: false,
        sendsOffDevice: true,
        requiresDisclosure: false,
        requiresCostConsent: false,
      },
    },
    createdAt: 1,
  };
}

beforeEach(() => {
  disclosureAllowed.value = true;
  privacyCalls.length = 0;
  setSettings();
});

describe("preflight with an explicit selection", () => {
  it("serves the picked provider, never the first-enabled row", async () => {
    const ollama = baseConfig({ id: "ollama-cfg", provider: "ollama", model: "llama3" });
    const gemini = baseConfig({ id: "gemini-cfg", provider: "gemini", apiKey: "sk", model: "gemini-2.0-flash" });
    setProviders([ollama, gemini]);
    const selection: LearningAgentRouteSelection = {
      providerId: "gemini",
      config: { ...gemini },
      kind: "cloud",
    };
    const result = await preflightLearningAgent({ selection });
    expect(result.ok).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.provider?.id).toBe("cloud-llm:gemini-cfg");
    expect(result.providerId).toBe("cloud-llm:gemini-cfg");
    // Privacy/consent received the selection's destination facts.
    const privacy = privacyCalls[privacyCalls.length - 1];
    expect(privacy.model).toBe("gemini-2.0-flash");
    expect(privacy.baseUrl).toBe(gemini.baseUrl);
  });

  it("blocks with a typed no-provider blocker when the selection row is missing", async () => {
    setProviders([baseConfig({ id: "ollama-cfg" })]);
    const selection: LearningAgentRouteSelection = {
      providerId: "gemini",
      config: baseConfig({ id: "gone", provider: "gemini", apiKey: "sk" }),
      kind: "cloud",
    };
    const result = await preflightLearningAgent({ selection });
    expect(result.ok).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain("no-provider");
    expect(result.blockers[0].message).toContain("gemini");
    expect(result.provider).toBeUndefined();
  });

  it("blocks when the selected row is disabled", async () => {
    const gemini = baseConfig({ id: "gemini-cfg", provider: "gemini", apiKey: "sk", enabled: false });
    setProviders([gemini]);
    const selection: LearningAgentRouteSelection = {
      providerId: "gemini",
      config: { ...gemini },
      kind: "cloud",
    };
    const result = await preflightLearningAgent({ selection });
    expect(result.ok).toBe(false);
    expect(result.blockers.map((b) => b.code)).toContain("no-model");
  });

  it("an explicit cloud retry keeps the selection", async () => {
    const gemini = baseConfig({ id: "gemini-cfg", provider: "gemini", apiKey: "sk", model: "gemini-2.0-flash" });
    setProviders([baseConfig({ id: "ollama-cfg" }), gemini]);
    const selection: LearningAgentRouteSelection = {
      providerId: "gemini",
      config: { ...gemini },
      kind: "cloud",
    };
    const result = await preflightLearningAgent({ selection, forceKind: "cloud", explicitDestinationRetry: true });
    expect(result.provider?.id).toBe("cloud-llm:gemini-cfg");
    expect(result.destinationChangeRequiresConsent).toBe(true);
  });
});

describe("guard with a pinned selection", () => {
  const selection: LearningAgentRouteSelection = {
    providerId: "gemini",
    config: baseConfig({ id: "gemini-cfg", provider: "gemini", apiKey: "sk", model: "gemini-2.0-flash" }),
    kind: "cloud",
  };

  it("stops on a mid-run edit of the selected config", () => {
    const gemini = { ...selection.config, model: "gemini-2.5-flash" };
    setProviders([gemini]);
    const guard = createLearningAgentGuard(cloudRun() as never, {
      selection,
      getDocumentSnapshot: () => null,
      isFeatureEnabled: () => true,
    });
    expect(guard()?.reason).toBe("destination-changed");
  });

  it("does not false-stop on unrelated rows enabled/disabled mid-run", () => {
    const gemini = { ...selection.config };
    setProviders([gemini, baseConfig({ id: "ollama-cfg", provider: "ollama", enabled: false })]);
    const guard = createLearningAgentGuard(cloudRun() as never, {
      selection,
      getDocumentSnapshot: () => null,
      isFeatureEnabled: () => true,
    });
    expect(guard()).toBeNull();
    // Enable an unrelated row: still no stop.
    setProviders([gemini, baseConfig({ id: "ollama-cfg", provider: "ollama", enabled: true })]);
    expect(guard()).toBeNull();
  });

  it("stops when the selected row is removed mid-run", () => {
    setProviders([baseConfig({ id: "ollama-cfg" })]);
    const guard = createLearningAgentGuard(cloudRun() as never, {
      selection,
      getDocumentSnapshot: () => null,
      isFeatureEnabled: () => true,
    });
    expect(guard()?.reason).toBe("destination-changed");
  });
});

describe("runLearningAgent serving provenance", () => {
  it("exposes the served model + selection facts on the run result", async () => {
    const gemini = baseConfig({ id: "gemini-cfg", provider: "gemini", apiKey: "sk", model: "gemini-2.0-flash" });
    setProviders([gemini]);
    const prepared = resolveLearningAgentScope({
      conversationId: "conv-1",
      ownerRevision: 1,
      intent: "Cards from this paper",
      scope: "document",
      documents: [{ id: "paper-a", title: "Paper A" }],
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const provider = new FakeAIProvider({
      kind: "cloud",
      capabilities: { contextTokens: 32000 },
      responses: [{ requestId: "t1", text: JSON.stringify({ finalAnswer: "done" }), baseModelName: "gemini-2.0-flash" }],
    });
    const outcome = await runLearningAgent(prepared.run, {
      provider,
      selection: { providerId: "gemini", config: { ...gemini }, kind: "cloud" },
      wallClockMs: 5_000,
      guard: () => null,
    });
    expect(outcome.result.endReason).toBe("final-answer");
    expect(outcome.result.servedModel).toBe("gemini-2.0-flash");
    expect(outcome.result.selectedProviderId).toBe("gemini");
    expect(outcome.result.selectedModel).toBe("gemini-2.0-flash");
    expect(outcome.result.diagnostics?.route.servedModel).toBe("gemini-2.0-flash");
  });
});
