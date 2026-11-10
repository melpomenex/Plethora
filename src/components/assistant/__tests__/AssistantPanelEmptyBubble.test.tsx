import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("../../../api/llm", () => ({
  chatWithContext: vi.fn(),
}));

vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([]),
}));

describe("AssistantPanel empty message and bubble suppression", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
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
      ],
    });
  });

  it("suppresses assistant message when content is whitespace only and no tools or artifacts exist", async () => {
    const sessionKey = "general";
    const storedConversations = {
      [sessionKey]: {
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "Hello",
            timestamp: Date.now(),
          },
          {
            id: "msg-2",
            role: "assistant",
            content: "   ",
            timestamp: Date.now() + 100,
          },
          {
            id: "msg-3",
            role: "assistant",
            content: "Real response",
            timestamp: Date.now() + 200,
          },
        ],
        updatedAt: Date.now(),
      },
    };
    localStorage.setItem("assistant-panel-conversations-v1", JSON.stringify(storedConversations));

    let container: HTMLElement;
    await act(async () => {
      const rendered = render(<AssistantPanel />);
      container = rendered.container;
    });

    // User message and real response should be rendered
    expect(screen.getByText("Hello")).toBeDefined();
    expect(screen.getByText("Real response")).toBeDefined();

    // msg-2 (whitespace only) should NOT be rendered in DOM
    const emptyMsgEl = container!.querySelector('[data-assistant-message-id="msg-2"]');
    expect(emptyMsgEl).toBeNull();

    // msg-3 should be rendered
    const realMsgEl = container!.querySelector('[data-assistant-message-id="msg-3"]');
    expect(realMsgEl).not.toBeNull();
  });

  it("suppresses the chat bubble when assistant message only has tool calls, but renders tool calls", async () => {
    const sessionKey = "general";
    const storedConversations = {
      [sessionKey]: {
        messages: [
          {
            id: "msg-tool-only",
            role: "assistant",
            content: "",
            timestamp: Date.now(),
            toolCalls: [
              {
                id: "call-1",
                name: "search_library",
                parameters: { query: "vitamins" },
                status: "success",
              },
            ],
          },
        ],
        updatedAt: Date.now(),
      },
    };
    localStorage.setItem("assistant-panel-conversations-v1", JSON.stringify(storedConversations));

    let container: HTMLElement;
    await act(async () => {
      const rendered = render(<AssistantPanel />);
      container = rendered.container;
    });

    // Message container is rendered because tool calls exist
    const msgEl = container.querySelector('[data-assistant-message-id="msg-tool-only"]');
    expect(msgEl).not.toBeNull();

    // Tool name is rendered
    expect(screen.getByText("search_library")).toBeDefined();

    // But the chat bubble (bg-muted text-foreground) is suppressed
    const bubbleEl = msgEl?.querySelector(".bg-muted.text-foreground");
    expect(bubbleEl).toBeNull();
  });
});
