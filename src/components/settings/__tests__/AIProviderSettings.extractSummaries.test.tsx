/**
 * Extract progressive-summary opt-in setting.
 *
 * Regression guard for the "extracts summarize themselves" complaint: the
 * toggle must exist in the Summarization section, must be off by default, and
 * must be operable independently of the unrelated "Auto-summarize long
 * extracts" control.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AISettings } from "../AIProviderSettings";
import { defaultSettings, useSettingsStore } from "../../../stores/settingsStore";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => true,
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

const LABEL = "Generate AI summaries for extracts during review";

describe("extract progressive-summary setting", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({ settings: JSON.parse(JSON.stringify(defaultSettings)) });
    useLLMProvidersStore.setState({ providers: [] });
  });

  it("renders the toggle in the Summarization section, off by default", () => {
    render(<AISettings onChange={vi.fn()} />);

    expect(screen.getByText("Summarization")).toBeInTheDocument();
    expect(
      screen.getByText("Control when AI summarizes your content")
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: LABEL })).not.toBeChecked();
  });

  it("opts in without touching the auto-summarize control", () => {
    render(<AISettings onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox", { name: LABEL }));

    const controls = useSettingsStore.getState().settings.ai.aiControls;
    expect(controls.extractProgressiveSummaries).toBe(true);
    expect(controls.autoSummarize).toBe(false);
    expect(screen.getByRole("checkbox", { name: LABEL })).toBeChecked();
  });

  it("stays operable while auto-summarize is off", () => {
    render(<AISettings onChange={vi.fn()} />);

    expect(screen.getByRole("checkbox", { name: LABEL })).not.toBeDisabled();
    // The dependent controls of the other summarization feature stay disabled...
    expect(screen.getByDisplayValue("Medium (~250 words)")).toBeDisabled();
    // ...but this toggle is independent of them.
    fireEvent.click(screen.getByRole("checkbox", { name: LABEL }));
    expect(
      useSettingsStore.getState().settings.ai.aiControls.extractProgressiveSummaries
    ).toBe(true);
  });
});
