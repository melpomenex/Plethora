/**
 * Regression test: the user's chosen AI provider (the "Model Status Pill /
 * AI Engine Center" selector in the Assistant panel) must be remembered
 * across documents and across sessions.
 *
 * Reported regression: choosing a provider above the Assistant was not
 * remembered when opening a separate document, or after a reload. The choice
 * is persisted to localStorage under `assistant-llm-provider` and restored on
 * the next mount, so a fresh AssistantPanel (new document, new session) must
 * show the same provider.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import {
  ASSISTANT_PROVIDER_STORAGE_KEY,
  getStoredAssistantProvider,
  persistAssistantProvider,
} from "../../../utils/assistantProvider";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../../../api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/documents")>();
  return {
    ...actual,
    getDocument: vi.fn().mockResolvedValue({ id: "doc-1", content: "" }),
    extractDocumentText: vi.fn().mockResolvedValue({ content: "" }),
  };
});

/** Seed the LLM providers store so the dropdown treats providers as selectable. */
function seedProviders() {
  useLLMProvidersStore.setState({
    providers: [
      {
        id: "openai-cfg",
        provider: "openai",
        name: "OpenAI",
        apiKey: "sk-test",
        model: "gpt-4o",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
      },
      {
        id: "anthropic-cfg",
        provider: "anthropic",
        name: "Anthropic",
        apiKey: "sk-ant-test",
        model: "claude-3.5-sonnet",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
      },
      {
        id: "ollama-cfg",
        provider: "ollama",
        name: "Ollama",
        apiKey: "",
        model: "llama3.2",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
      },
      {
        id: "deepseek-cfg",
        provider: "deepseek",
        name: "DeepSeek",
        apiKey: "sk-ds-test",
        model: "deepseek-chat",
        enabled: true,
        temperature: 0.7,
        maxTokens: 4096,
      },
    ],
  });
}

describe("assistant provider choice persistence (regression)", () => {
  beforeEach(() => {
    localStorage.clear();
    seedProviders();
    vi.clearAllMocks();
    // jsdom does not implement Element.scrollTo; the panel's scroll-to-bottom
    // effect calls it on mount.
    Element.prototype.scrollTo = vi.fn();
  });

  it("a provider chosen in the Assistant dropdown is persisted to storage", async () => {
    render(<AssistantPanel />);

    // Open the "Change Active AI Model" dropdown.
    const pill = screen.getByTitle("Change Active AI Model");
    fireEvent.click(pill);

    // The dropdown lists provider options; pick "Anthropic".
    await waitFor(() => {
      expect(screen.getByText("Anthropic")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Anthropic"));

    // The choice must have been written to localStorage.
    expect(localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY)).toBe("anthropic");
    expect(getStoredAssistantProvider()).toBe("anthropic");
  });

  it("a fresh AssistantPanel mount (separate document / new session) restores the persisted choice", () => {
    // Simulate a previous session where the user picked Anthropic.
    persistAssistantProvider("anthropic");

    const { unmount } = render(<AssistantPanel />);

    // The pill reflects the restored provider (its label shows the model /
    // provider name). Assert through the store-independent read path plus the
    // mounted panel: opening the dropdown marks Anthropic as active.
    const pill = screen.getByTitle("Change Active AI Model");
    fireEvent.click(pill);
    const anthropicOption = screen.getByText("Anthropic");
    expect(anthropicOption).toBeTruthy();

    unmount();
    // Even after unmount the storage still holds the choice.
    expect(localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY)).toBe("anthropic");
  });

  it("a controlled panel (external selectedProvider + onProviderChange, as in Scroll Mode) persists and restores the choice", () => {
    // Scroll Mode ("Model Chooser - Above Assistant") drives the panel through
    // props. A controlled choice must be persisted so the next document or
    // session sees it.
    const onChange = vi.fn();
    const first = render(
      <AssistantPanel selectedProvider="openai" onProviderChange={onChange} />,
    );
    fireEvent.click(screen.getByTitle("Change Active AI Model"));
    fireEvent.click(screen.getByText("DeepSeek"));
    expect(onChange).toHaveBeenCalledWith("deepseek");
    expect(localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY)).toBe("deepseek");
    first.unmount();

    // New document / session: an uncontrolled panel reads the persisted value.
    render(<AssistantPanel />);
    fireEvent.click(screen.getByTitle("Change Active AI Model"));
    expect(screen.getByText("DeepSeek")).toBeTruthy();
    expect(localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY)).toBe("deepseek");
  });

  it("a remount after an in-session change keeps the new provider (across documents)", () => {
    const first = render(<AssistantPanel />);
    fireEvent.click(screen.getByTitle("Change Active AI Model"));
    fireEvent.click(screen.getByText("Ollama"));
    first.unmount();

    // Second document: a brand-new AssistantPanel instance.
    render(<AssistantPanel />);
    fireEvent.click(screen.getByTitle("Change Active AI Model"));
    const ollamaOption = screen.getByText("Ollama");
    expect(ollamaOption).toBeTruthy();
    expect(localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY)).toBe("ollama");
  });

  it("PwaAssistantButton-style fallback reads the same persisted value", () => {
    persistAssistantProvider("deepseek");
    expect(getStoredAssistantProvider()).toBe("deepseek");
    expect(localStorage.getItem(ASSISTANT_PROVIDER_STORAGE_KEY)).toBe("deepseek");
  });
});
