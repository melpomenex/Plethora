import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AIDiagnosticsModal } from "../AIDiagnosticsModal";
import { clearAllDiagnostics, recordTaskDiagnostic } from "../../../lib/ai/diagnostics";
import {
  clearFeatureSmokeAdapters,
  registerFeatureSmokeAdapter,
} from "../../../lib/ai/diagnostics/featureSmoke";
import type { FeatureReadiness } from "../../../lib/ai/features/types";

const readinessRows: FeatureReadiness[] = [
  {
    featureId: "learning-agent",
    enabled: true,
    status: "ready",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev-1",
    dependencies: [],
    operations: [{ operationId: "agent-run", labelKey: "ai.feature.operation.agentRun", status: "ready", dependencies: [] }],
    provider: { providerClass: "ollama-local", destination: "loopback" },
    recoveryActions: [],
    limitations: [],
  },
  {
    featureId: "semantic-index",
    enabled: true,
    status: "setup-required",
    checkedAt: 1,
    checking: false,
    dependencyRevision: "rev-1",
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
    revision: "rev-1",
    refresh: vi.fn(),
  }),
}));

vi.mock("../../../lib/ai/diagnostics/smokeAdapters", () => ({
  registerDefaultFeatureSmokeAdapters: vi.fn(),
}));

vi.mock("../../../lib/ai/onDeviceAI", () => ({
  isOnDeviceAiSupportedPlatform: () => false,
  getOnDeviceAiCapabilities: vi.fn(async () => null),
}));

vi.mock("../../../lib/platformCapabilities", () => ({
  resolveCurrentAppPlatform: () => "desktop",
}));

vi.mock("../../../lib/ai/windows/capabilities", () => ({
  isWindowsDesktop: () => false,
}));

describe("AIDiagnosticsModal", () => {
  beforeEach(() => {
    clearAllDiagnostics();
    clearFeatureSmokeAdapters();
    recordTaskDiagnostic({
      taskId: "learn-this",
      taskType: "prompt",
      providerId: "cloud-llm",
      errorCategory: "GenerationFailed",
      errorCode: "sk-live-CANARY-123",
      chunkIds: ["private-chunk-id"],
      baseModelName: "private-model-path",
    });
    recordTaskDiagnostic({
      taskId: "PRIVATE_PROMPT_CANARY",
      taskType: "prompt",
    });
  });

  it("shows feature readiness, evidence level and recovery without side effects", () => {
    render(<AIDiagnosticsModal isOpen onClose={vi.fn()} />);
    expect(screen.getByText("Learning Feature Readiness & Evidence")).toBeInTheDocument();
    expect(screen.getByText("Learning agent")).toBeInTheDocument();
    expect(screen.getByText("Semantic indexing")).toBeInTheDocument();
    expect(screen.getByText("Setup required")).toBeInTheDocument();
    expect(screen.getByText("ollama-local · Local endpoint (loopback)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open indexing controls" })).toBeInTheDocument();
    // Opening diagnostics never runs a smoke test.
    expect(screen.getByRole("button", { name: /Run selected/ })).toBeDisabled();
  });

  it("exports a redacted report after explicit preview", async () => {
    render(<AIDiagnosticsModal isOpen onClose={vi.fn()} />);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Redacted report preview" }));
    });
    await waitFor(() => {
      expect(screen.getByText(/ai-diagnostics-report-v1/)).toBeInTheDocument();
    });
    const preview = screen.getByText(/ai-diagnostics-report-v1/).textContent ?? "";
    expect(preview).not.toContain("sk-live-CANARY-123");
    expect(preview).not.toContain("PRIVATE_PROMPT_CANARY");
    expect(preview).not.toContain("private-chunk-id");
    expect(preview).not.toContain("private-model-path");
    expect(preview).toContain('"scope": "session"');
  });

  it("runs one explicitly selected fixture smoke and reports stage scope", async () => {
    registerFeatureSmokeAdapter({
      featureId: "learn-this",
      stages: ["generation", "validation"],
      unverifiedStages: ["preview", "persistence"],
      fixtureId: "fixture-learn-this-v1",
      maxDurationMs: 1_000,
      destinations: ["device"],
      mutatesUserData: false,
      requiresConsent: false,
      run: async (context) => {
        context.reportStage("generation", "success", { durationMs: 1 });
        context.reportStage("validation", "success", { durationMs: 1 });
        return { outcome: "success", stages: ["generation", "validation"] };
      },
    });
    render(<AIDiagnosticsModal isOpen onClose={vi.fn()} />);
    // The modal refreshes smoke records on open.
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "learn-this" } });
    fireEvent.click(screen.getByRole("button", { name: /Run selected/ }));
    await waitFor(() => {
      const row = document.querySelector('[data-smoke-feature="learn-this"]');
      expect(row?.getAttribute("data-smoke-state")).toBe("passed");
    });
    expect(screen.getByText(/preview, persistence \(unverified\)/)).toBeInTheDocument();
  });
});
