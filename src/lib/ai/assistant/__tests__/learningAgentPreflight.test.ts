import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { preflightLearningAgent, createLearningAgentGuard } from "../learningAgent";
import { useLLMProvidersStore } from "../../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../../stores/settingsStore";

function setProvider(provider: Record<string, unknown>) {
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "cfg",
        name: "Configured",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
        ...provider,
      } as never,
    ],
  });
}

function setSettings(patch: {
  allowCloudFallback?: boolean;
  embeddingProvider?: string;
  ollamaBaseUrl?: string;
}) {
  useSettingsStore.setState((state) => ({
    settings: {
      ...state.settings,
      features: { ...state.settings.features, aiAgent: true },
      ai: {
        ...state.settings.ai,
        strictLocalOnly: false,
        allowCloudFallback: patch.allowCloudFallback ?? false,
      },
      embedding: {
        ...state.settings.embedding,
        provider: (patch.embeddingProvider ?? "ollama") as never,
        ollamaBaseUrl: patch.ollamaBaseUrl ?? "http://localhost:11434",
        paidEmbeddingsEnabled: false,
      },
    },
  }));
}

beforeEach(() => {
  disclosureAllowed.value = true;
  setSettings({});
});

describe("destination preflight", () => {
  it("treats a loopback Ollama endpoint as on-device (not off-device)", async () => {
    setProvider({ provider: "ollama", apiKey: "", baseUrl: "http://localhost:11434", model: "llama3" });
    setSettings({ ollamaBaseUrl: "http://localhost:11434" });
    const result = await preflightLearningAgent();
    expect(result.ok).toBe(true);
    expect(result.generation?.sendsOffDevice).toBe(false);
    expect(result.generation?.locality).toBe("loopback");
    expect(result.blockers).toHaveLength(0);
  });

  it("classifies a remote keyless endpoint as off-device and requires disclosure", async () => {
    setProvider({ provider: "ollama", apiKey: "", baseUrl: "http://192.168.1.50:11434", model: "llama3" });
    disclosureAllowed.value = false;
    const result = await preflightLearningAgent();
    expect(result.generation?.sendsOffDevice).toBe(true);
    expect(result.generation?.locality).toBe("lan");
    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain("privacy-denied");
  });

  it("blocks billable cloud generation without existing cost authorization", async () => {
    setProvider({ provider: "openai", apiKey: "sk-test", baseUrl: "", model: "gpt-4o" });
    setSettings({ allowCloudFallback: false });
    const result = await preflightLearningAgent();
    expect(result.generation?.sendsOffDevice).toBe(true);
    expect(result.generation?.billable).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.blockers.map((blocker) => blocker.code)).toContain("billing-required");
  });

  it("allows billable cloud generation with the existing authorization", async () => {
    setProvider({ provider: "openai", apiKey: "sk-test", baseUrl: "", model: "gpt-4o" });
    setSettings({ allowCloudFallback: true });
    const result = await preflightLearningAgent();
    expect(result.ok).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("degrades to lexical retrieval when embeddings are not authorized", async () => {
    setProvider({ provider: "ollama", apiKey: "", baseUrl: "http://localhost:11434", model: "llama3" });
    setSettings({ embeddingProvider: "openai", allowCloudFallback: false });
    const result = await preflightLearningAgent({ promptDisclosure: false });
    expect(result.ok).toBe(true);
    expect(result.embedding?.config).toBeUndefined();
    expect(result.embedding?.authorized).toBe(false);
    expect(result.limitations).toContain("ai.limitation.lexicalRetrieval");
  });
});

describe("run guard", () => {
  it("blocks when an attached source changed after the freeze", () => {
    const run = {
      runId: "r",
      conversationId: "c",
      ownerRevision: 1,
      intent: "i",
      scope: "document" as const,
      sources: [
        {
          attachmentId: "doc:a",
          kind: "document" as const,
          libraryId: "a",
          title: "Paper A",
          contentVersion: "v1",
          origin: "active-view" as const,
          role: "required" as const,
        },
      ],
      sourceRevision: "rev",
      retrievalDocumentIds: ["a"],
      primaryDocumentId: "a",
      capabilityRevision: "cap",
      generation: {
        providerId: "ollama",
        kind: "cloud" as const,
        destination: {
          providerClass: "ollama-local" as const,
          locality: "loopback" as const,
          keyless: true,
          billable: false,
          sendsOffDevice: false,
          requiresDisclosure: false,
          requiresCostConsent: false,
        },
      },
      createdAt: 1,
    };
    const guard = createLearningAgentGuard(run, {
      getDocumentSnapshot: () => ({ contentVersion: "v2" }),
      getProviderSnapshot: () => ({ providerId: "ollama", kind: "cloud", baseUrl: "http://localhost:11434" }),
      isFeatureEnabled: () => true,
    });
    expect(guard()?.reason).toBe("source-changed");
  });

  it("blocks a provider endpoint change instead of silently switching destination", () => {
    const run = {
      runId: "r",
      conversationId: "c",
      ownerRevision: 1,
      intent: "i",
      scope: "document" as const,
      sources: [],
      sourceRevision: "rev",
      retrievalDocumentIds: [],
      capabilityRevision: "cap",
      generation: {
        providerId: "ollama",
        kind: "cloud" as const,
        destination: {
          providerClass: "ollama-local" as const,
          locality: "loopback" as const,
          keyless: true,
          billable: false,
          sendsOffDevice: false,
          requiresDisclosure: false,
          requiresCostConsent: false,
        },
      },
      createdAt: 1,
    };
    let url = "http://localhost:11434";
    const guard = createLearningAgentGuard(run, {
      getDocumentSnapshot: () => null,
      getProviderSnapshot: () => ({ providerId: "ollama", kind: "cloud", baseUrl: url }),
      isFeatureEnabled: () => true,
    });
    expect(guard()).toBeNull();
    url = "http://192.168.1.9:11434";
    expect(guard()?.reason).toBe("destination-changed");
  });

  it("blocks when the feature flag is turned off mid-run", () => {
    const run = {
      runId: "r",
      conversationId: "c",
      ownerRevision: 1,
      intent: "i",
      scope: "document" as const,
      sources: [],
      sourceRevision: "rev",
      retrievalDocumentIds: [],
      capabilityRevision: "cap",
      generation: {
        providerId: "ollama",
        kind: "ondevice" as const,
        destination: {
          providerClass: "unknown" as const,
          locality: "device" as const,
          keyless: true,
          billable: false,
          sendsOffDevice: false,
          requiresDisclosure: false,
          requiresCostConsent: false,
        },
      },
      createdAt: 1,
    };
    let enabled = true;
    const guard = createLearningAgentGuard(run, {
      getDocumentSnapshot: () => null,
      isFeatureEnabled: () => enabled,
    });
    expect(guard()).toBeNull();
    enabled = false;
    expect(guard()?.reason).toBe("feature-disabled");
  });
});
