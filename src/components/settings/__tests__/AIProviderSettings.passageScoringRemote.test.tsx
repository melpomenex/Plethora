import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AISettings } from "../AIProviderSettings";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { resetPassageScoringPolicyForTests } from "../../viewer/passageScoring/policy";
import { resetRemoteAuthorizationPersistenceForTests } from "../../viewer/passageScoring/authorizationSettings";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
  invokeCommand: vi.fn().mockResolvedValue(undefined),
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

vi.mock("../../../lib/ai/features/useFeatureReadiness", () => ({
  useFeatureReadiness: () => ({
    rows: [],
    context: null,
    loading: false,
    checkedAt: 1,
    revision: "rev",
    refresh: vi.fn(),
  }),
}));

function resetStores(): void {
  localStorage.clear();
  useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
  useLLMProvidersStore.setState({ providers: [] });
  resetPassageScoringPolicyForTests();
  resetRemoteAuthorizationPersistenceForTests();
}

describe("remote passage-scoring Settings control", () => {
  beforeEach(resetStores);

  it("is unavailable with an explanation when no cloud provider exists", () => {
    render(<AISettings onChange={vi.fn()} />);

    const toggle = screen.getByLabelText("Remote passage suggestions");
    expect(toggle).toBeDisabled();
    expect(
      screen.getByText("Add a cloud AI provider to allow remote suggestions.")
    ).toBeTruthy();
  });

  it("grants a finite allowance and revokes it", () => {
    useLLMProvidersStore.setState({
      providers: [
        {
          id: "p1",
          provider: "openai",
          name: "openai",
          apiKey: "sk-test",
          model: "test-model",
          enabled: true,
          temperature: 0.7,
          maxTokens: 1024,
        },
      ],
    });
    const onChange = vi.fn();
    render(<AISettings onChange={onChange} />);

    const toggle = screen.getByLabelText("Remote passage suggestions");
    expect(toggle).toBeEnabled();

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().settings.ai.remotePassageScoring).toMatchObject({
      providerId: "cloud-llm",
      sourceScope: "*",
      maxClassifications: 10,
    });
    expect(onChange).toHaveBeenCalled();
    expect(
      screen.getByTestId("remote-passage-scoring-usage").textContent
    ).toContain("0 of 10 passages used");

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().settings.ai.remotePassageScoring).toBeNull();
  });

  it("explains when the configured destination already runs on-device", () => {
    useLLMProvidersStore.setState({
      providers: [
        {
          id: "p1",
          provider: "ollama",
          name: "ollama",
          apiKey: "",
          baseUrl: "http://localhost:11434",
          model: "llama3",
          enabled: true,
          temperature: 0.7,
          maxTokens: 1024,
        },
      ],
    });
    render(<AISettings onChange={vi.fn()} />);

    expect(
      screen.getByText(
        "Your AI provider runs on this device, so no remote allowance is needed."
      )
    ).toBeTruthy();
    expect(screen.getByLabelText("Remote passage suggestions")).toBeDisabled();
  });
});
