import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AISettings } from "../AIProviderSettings";
import { defaultSettings, useSettingsStore, mergeFeaturePreferences } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import type { FeatureReadiness } from "../../../lib/ai/features/types";

const invokeMock = vi.fn().mockResolvedValue(undefined);

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
  isNativeMobile: () => false,
  invokeCommand: (...args: unknown[]) => invokeMock(...args),
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

vi.mock("../../../api/ai", () => ({
  getAIConfig: vi.fn().mockResolvedValue(null),
  setApiKey: vi.fn().mockResolvedValue(undefined),
  isMaskedKey: vi.fn(() => false),
}));

vi.mock("../OnDeviceAiPanel", () => ({
  OnDeviceAiPanel: () => null,
}));

const readinessRows: FeatureReadiness[] = [
  {
    featureId: "learn-this",
    enabled: true,
    status: "unavailable-platform",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev",
    dependencies: [{ code: "platform", state: "unsupported", reasonKey: "ai.reason.platformUnsupported" }],
    operations: [],
    recoveryActions: [],
    limitations: [],
  },
  {
    featureId: "learning-agent",
    enabled: true,
    status: "model-download-required",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev",
    dependencies: [{ code: "model", state: "missing", reasonKey: "ai.reason.modelDownloadRequired" }],
    operations: [],
    recoveryActions: [],
    limitations: [],
  },
  {
    featureId: "library-rag",
    enabled: true,
    status: "ready",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev",
    dependencies: [],
    operations: [],
    recoveryActions: [],
    limitations: ["ai.limitation.lexicalRetrieval"],
  },
  {
    featureId: "semantic-index",
    enabled: true,
    status: "setup-required",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev",
    dependencies: [
      { code: "embeddings", state: "missing", reasonKey: "ai.reason.paidEmbeddingsConsent" },
    ],
    operations: [],
    recoveryActions: [
      { targetId: "embeddings.index", labelKey: "ai.feature.recovery.index", kind: "authorize" },
    ],
    limitations: [],
  },
];

vi.mock("../../../lib/ai/features/useFeatureReadiness", () => ({
  useFeatureReadiness: () => ({
    rows: readinessRows,
    context: null,
    loading: false,
    checkedAt: 1,
    revision: "rev",
    refresh: vi.fn(),
  }),
}));

describe("capability-aware Enable All", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    localStorage.clear();
    useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
    useLLMProvidersStore.setState({ providers: [] });
  });

  it("keeps an unsupported preference and never touches unrelated consent/mode", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        features: {
          ...useSettingsStore.getState().settings.features,
          aiLearnThis: false,
          aiAgent: false,
          aiOcclusionFreeform: false,
        },
        ai: { ...useSettingsStore.getState().settings.ai, activeRecallMode: "off" },
      },
    });

    render(<AISettings onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable All AI Learning Features" }));

    const settings = useSettingsStore.getState().settings;
    // Unsupported feature keeps its explicit false.
    expect(settings.features.aiLearnThis).toBe(false);
    // Supported features are enabled by preference (setup remains explicit).
    expect(settings.features.aiAgent).toBe(true);
    // Never touched.
    expect(settings.features.aiOcclusionFreeform).toBe(false);
    expect(settings.ai.activeRecallMode).toBe("off");
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining("download"),
      expect.anything()
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining("enqueue"),
      expect.anything()
    );
  });

  it("separates ready from setup in the summary", () => {
    render(<AISettings onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Enable All AI Learning Features" }));
    expect(screen.getAllByText(/1 ready/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/need setup/).length).toBeGreaterThan(0);
  });

  it("keeps prerequisite and concept-link preferences independent", () => {
    useSettingsStore.setState({
      settings: {
        ...useSettingsStore.getState().settings,
        features: {
          ...useSettingsStore.getState().settings.features,
          aiPrerequisites: true,
          aiConceptLinks: true,
        },
      },
    });

    render(<AISettings onChange={vi.fn()} />);
    const prerequisites = screen.getByRole("checkbox", { name: "Prerequisite analysis" });
    const links = screen.getByRole("checkbox", { name: "Concept link proposals" });

    fireEvent.click(prerequisites);
    let features = useSettingsStore.getState().settings.features;
    expect(features.aiPrerequisites).toBe(false);
    expect(features.aiConceptLinks).toBe(true);

    fireEvent.click(links);
    features = useSettingsStore.getState().settings.features;
    expect(features.aiPrerequisites).toBe(false);
    expect(features.aiConceptLinks).toBe(false);
  });

  it("renders readiness rows with text status and limitations", () => {
    render(<AISettings onChange={vi.fn()} />);
    expect(screen.getByText("Feature readiness")).toBeInTheDocument();
    expect(screen.getByText("Learn this")).toBeInTheDocument();
    expect(screen.getByText("Unavailable on this profile")).toBeInTheDocument();
    expect(screen.getByText(/Lexical evidence only/)).toBeInTheDocument();
  });

  it("offers recovery navigation without starting setup", () => {
    render(<AISettings onChange={vi.fn()} />);
    const recovery = screen.getByRole("button", { name: "Open indexing controls" });
    fireEvent.click(recovery);
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining("download"),
      expect.anything()
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining("enqueue"),
      expect.anything()
    );
    expect(invokeMock).not.toHaveBeenCalledWith(
      expect.stringContaining("index_status"),
      expect.anything()
    );
  });
});

describe("settings feature reconciliation", () => {
  it("applies defaults only to absent keys", () => {
    const merged = mergeFeaturePreferences({ aiAgent: false } as never);
    expect(merged.aiAgent).toBe(false);
    expect(merged.aiLearnThis).toBe(defaultSettings.features.aiLearnThis);
  });

  it("preserves explicit false and repairs corrupted values", () => {
    const merged = mergeFeaturePreferences({
      aiLearnThis: false,
      aiLibraryRag: "false" as never,
      aiAgent: 1 as never,
    } as never);
    expect(merged.aiLearnThis).toBe(false);
    // Corrupted values fall back to the default instead of becoming truthy.
    expect(merged.aiLibraryRag).toBe(defaultSettings.features.aiLibraryRag);
    expect(merged.aiAgent).toBe(defaultSettings.features.aiAgent);
  });

  it("tolerates a missing or non-object persisted features blob", () => {
    expect(mergeFeaturePreferences(undefined)).toEqual(defaultSettings.features);
    expect(mergeFeaturePreferences(null as never)).toEqual(defaultSettings.features);
  });
});
