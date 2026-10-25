/**
 * Mobile AI-engine picker (fix-mobile-assistant-model-menu).
 *
 * The reported defect: the model menu drew past the sheet and could not be
 * scrolled, so lower providers were unreachable. These tests pin the in-sheet
 * body presentation, accessible provider controls, dismissal priority, and
 * draft/focus preservation. Real-browser clipping and scroll reachability are
 * covered by `src/visual/assistant-model-picker.visual.spec.ts`.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useTabsStore } from "../../../stores";
import { loadLocale } from "../../../lib/i18n";
import { registerOverlayDismissal, requestOverlayBack, resetOverlayStackForTests } from "../../../lib/overlayStack";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, isTauri: () => false, isNativeMobile: () => false, invokeCommand: vi.fn().mockResolvedValue([]) };
});
vi.mock("../../../api/llm", () => ({ chatWithContext: vi.fn() }));
vi.mock("../../../api/mcp", () => ({ callAppMCPTool: vi.fn(), getAppMCPTools: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/ai/assistant/orchestrator", () => ({ runAssistantTurn: vi.fn() }));
vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({ ensureCloudAiDisclosure: vi.fn().mockResolvedValue(true) }));
vi.mock("../../../lib/ai/apple/capabilities", () => ({
  getAppleIntelligenceSnapshot: vi.fn().mockResolvedValue({ foundationModels: { status: "unavailable" } }),
  isAppleOsPlatform: () => false,
}));
vi.mock("../../../lib/ai/apple/foundation", () => ({ appleFmAvailability: vi.fn().mockResolvedValue({ status: "unavailable" }) }));
vi.mock("../../../hooks/useComposerDictation", () => ({
  useComposerDictation: () => ({
    phase: "idle", error: null, needsConsent: false, disabled: false, capability: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), onEdit: vi.fn(),
  }),
}));
vi.mock("../mobile/MobileAssistantCommands", () => ({
  useAssistantCommandMatches: () => [],
  MobileAssistantCommands: () => null,
}));

function seedProviders() {
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "ollama-cfg", provider: "ollama", name: "Ollama", apiKey: "",
        model: "llama3.2", enabled: true, temperature: 0.7, maxTokens: 4096,
      },
      {
        id: "openrouter-cfg", provider: "openrouter", name: "OpenRouter", apiKey: "sk-or-test",
        model: "openrouter/free", enabled: true, temperature: 0.7, maxTokens: 4096,
      },
      {
        id: "deepseek-cfg", provider: "deepseek", name: "DeepSeek", apiKey: "sk-ds-test",
        model: "deepseek-chat", enabled: true, temperature: 0.7, maxTokens: 4096,
      },
    ],
  });
}

const sheet = {
  detent: "partial" as const,
  hasPartial: true,
  onClose: vi.fn(),
  onToggleDetent: vi.fn(),
  closeRef: { current: null },
};

const mobileProps = {
  conversationKey: "mobile:global",
  mobilePresentation: { visible: true, sheet },
  fillContainer: true,
  appendContextMessages: false,
  context: { type: "general" as const },
};

function pickerElement() {
  return document.querySelector<HTMLElement>("[data-assistant-model-picker]");
}

describe("mobile source and model menu coordination", () => {
  beforeEach(() => {
    localStorage.clear();
    resetOverlayStackForTests();
    seedProviders();
    Element.prototype.scrollTo = vi.fn();
  });

  it("expands a partial sheet for sources and closes sources when opening the model picker", async () => {
    render(<AssistantPanel {...mobileProps} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Keep my draft" } });
    const source = screen.getByRole("button", { name: /^Answer from:/ });
    fireEvent.click(source);
    expect(sheet.onToggleDetent).toHaveBeenCalled();
    expect(screen.getByRole("menu", { name: "Answer from" })).toBeInTheDocument();
    await openPicker();
    expect(screen.queryByRole("menu", { name: "Answer from" })).toBeNull();
    expect(input).toHaveValue("Keep my draft");
  });

  it("closes source options before the host and restores focus and the draft", () => {
    const hostDismiss = vi.fn();
    const unregister = registerOverlayDismissal(hostDismiss, { priority: 60 });
    render(<AssistantPanel {...mobileProps} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Unsent" } });
    const source = screen.getByRole("button", { name: /^Answer from:/ });
    fireEvent.click(source);
    act(() => { requestOverlayBack(); });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(hostDismiss).not.toHaveBeenCalled();
    expect(source).toHaveFocus();
    expect(input).toHaveValue("Unsent");
    unregister();
  });
});

function modelTrigger() {
  return screen.getByTitle("Change Active AI Model");
}

async function openPicker() {
  fireEvent.click(modelTrigger());
  await waitFor(() => expect(pickerElement()).not.toBeNull());
  return pickerElement()!;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("assistant-llm-provider", "ollama");
  resetOverlayStackForTests();
  seedProviders();
  sheet.onClose.mockClear();
  sheet.onToggleDetent.mockClear();
  useSettingsStore.setState((state) => ({
    ...state,
    settings: {
      ...state.settings,
      general: { ...state.settings.general, language: "en" },
      ai: { ...state.settings.ai, assistantUseAppleFoundation: false },
    },
  }));
  Element.prototype.scrollTo = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("desktop AI-engine picker", () => {
  it.each(["left", "right"] as const)("selects a provider in the %s panel without losing the draft", async (position) => {
    render(<AssistantPanel position={position} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Unsent desktop draft" } });
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek, deepseek-chat, Active" }));
    await waitFor(() => expect(pickerElement()).toBeNull());
    expect(localStorage.getItem("assistant-llm-provider")).toBe("deepseek");
    expect(input).toHaveValue("Unsent desktop draft");
    expect(modelTrigger()).toHaveFocus();
  });

  it.each(["Escape", "outside"])("dismisses using %s and restores focus without changing providers", async (action) => {
    const { container } = render(<AssistantPanel />);
    await openPicker();
    if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
    else fireEvent.click(container.querySelector("[data-assistant-model-backdrop]")!);
    await waitFor(() => expect(pickerElement()).toBeNull());
    expect(modelTrigger()).toHaveFocus();
    expect(localStorage.getItem("assistant-llm-provider")).toBe("ollama");
  });

  it.each(["Manage AI providers", "OpenAI, Setup, Click to configure API key"])("opens settings using %s without changing providers", async (name) => {
    const addTab = vi.spyOn(useTabsStore.getState(), "addTab");
    render(<AssistantPanel />);
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name }));
    await waitFor(() => expect(pickerElement()).toBeNull());
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ type: "settings" }));
    expect(localStorage.getItem("plethora_settings_initial_tab")).toBe("ai");
    expect(localStorage.getItem("assistant-llm-provider")).toBe("ollama");
  });
});

describe("mobile AI-engine picker", () => {
  it("opens as an in-flow sheet body, expands the partial detent, and focuses its heading", async () => {
    const { container } = render(<AssistantPanel {...mobileProps} />);
    const picker = await openPicker();

    expect(picker.dataset.variant).toBe("mobile");
    expect(picker.className).toContain("flex-1");
    expect(picker.className).not.toContain("absolute");
    expect(sheet.onToggleDetent).toHaveBeenCalledTimes(1);

    const list = picker.querySelector("[data-assistant-model-list]");
    expect(list).not.toBeNull();
    expect(list!.className).toContain("overflow-y-auto");
    expect(list!.className).toContain("overscroll-contain");
    expect(list!.className).toContain("flex-1");

    expect(container.querySelector("[data-assistant-composer]")!.className).toContain("hidden");
    await waitFor(() => expect(screen.getByRole("heading", { name: "AI Engine Center" })).toHaveFocus());
  });

  it("does not expand the sheet when it is already expanded", async () => {
    const expandedSheet = { ...sheet, detent: "expanded" as const };
    render(<AssistantPanel {...mobileProps} mobilePresentation={{ visible: true, sheet: expandedSheet }} />);
    await openPicker();
    expect(expandedSheet.onToggleDetent).not.toHaveBeenCalled();
  });

  it("renders every provider as an operable button with status and active selection", async () => {
    render(<AssistantPanel {...mobileProps} />);
    await openPicker();

    expect(screen.getByRole("button", { name: "Ollama, llama3.2, Active" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "OpenRouter, openrouter/free, Active" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "OpenAI, Setup, Click to configure API key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anthropic, Setup, Click to configure API key" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close model picker" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage AI providers" })).toBeInTheDocument();
  });

  it("selects another configured provider, closes, restores focus, and keeps the draft", async () => {
    render(<AssistantPanel {...mobileProps} />);
    const textarea = screen.getByPlaceholderText(/Ask about your document/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Keep this draft" } });

    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek, deepseek-chat, Active" }));

    await waitFor(() => expect(pickerElement()).toBeNull());
    await waitFor(() => expect(localStorage.getItem("assistant-llm-provider")).toBe("deepseek"));
    expect(modelTrigger()).toHaveAttribute("aria-label", "Model: DeepSeek Chat");
    expect(textarea.value).toBe("Keep this draft");
    await waitFor(() => expect(modelTrigger()).toHaveFocus());
  });

  it("routes an unconfigured provider to AI settings without changing the active provider", async () => {
    const addTab = vi.spyOn(useTabsStore.getState(), "addTab");
    render(<AssistantPanel {...mobileProps} />);

    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "OpenAI, Setup, Click to configure API key" }));

    await waitFor(() => expect(pickerElement()).toBeNull());
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({ title: "Settings", type: "settings" }));
    expect(localStorage.getItem("plethora_settings_initial_tab")).toBe("ai");
    expect(localStorage.getItem("assistant-llm-provider")).toBe("ollama");
    expect(modelTrigger()).toHaveAttribute("aria-label", "Model: Llama 3.2");
  });

  it("closes the picker before the sheet on Back and restores focus", async () => {
    const sheetDismiss = vi.fn();
    registerOverlayDismissal(sheetDismiss, { priority: 60 });
    render(<AssistantPanel {...mobileProps} />);
    await openPicker();

    act(() => { requestOverlayBack(); });
    expect(pickerElement()).toBeNull();
    expect(sheetDismiss).not.toHaveBeenCalled();
    await waitFor(() => expect(modelTrigger()).toHaveFocus());

    act(() => { requestOverlayBack(); });
    expect(sheetDismiss).toHaveBeenCalledTimes(1);
  });

  it("closes on Escape without dismissing the sheet", async () => {
    const sheetDismiss = vi.fn();
    registerOverlayDismissal(sheetDismiss, { priority: 60 });
    render(<AssistantPanel {...mobileProps} />);
    await openPicker();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(pickerElement()).toBeNull());
    expect(sheetDismiss).not.toHaveBeenCalled();
    await waitFor(() => expect(modelTrigger()).toHaveFocus());
  });

  it("closes the picker when the mobile presentation is hidden", async () => {
    const { rerender } = render(<AssistantPanel {...mobileProps} />);
    await openPicker();

    rerender(<AssistantPanel {...mobileProps} mobilePresentation={{ visible: false, sheet }} />);

    await waitFor(() => expect(pickerElement()).toBeNull());
  });

  it("keeps the desktop presentation anchored and out of the mobile expansion path", async () => {
    render(<AssistantPanel selectedProvider="ollama" />);
    fireEvent.click(screen.getByTitle("Change Active AI Model"));

    const picker = pickerElement();
    expect(picker).not.toBeNull();
    expect(picker!.dataset.variant).toBe("desktop");
    expect(picker!.className).not.toContain("flex-1");
    expect(picker!.querySelector("[data-assistant-model-list]")!.className).toContain("max-h-");
    expect(sheet.onToggleDetent).not.toHaveBeenCalled();
  });

  it("localizes picker labels in a non-English locale", async () => {
    await loadLocale("de");
    useSettingsStore.setState((state) => ({
      ...state,
      settings: { ...state.settings, general: { ...state.settings.general, language: "de" } },
    }));
    render(<AssistantPanel {...mobileProps} />);
    await openPicker();

    expect(screen.getByRole("heading", { name: "KI-Engine-Center" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ollama, llama3.2, Aktiv" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modellauswahl schließen" })).toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });
});
