/**
 * Backward-compatible conversation session migration (assistant-conversation-scopes):
 * existing `assistant-panel-conversations-v1` payloads without a `scope` field
 * restore as Chat, explicit scopes round-trip, and messages/drafts never drop.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

const CONVERSATIONS_KEY = "assistant-panel-conversations-v1";

const documentContext = {
  type: "document" as const,
  documentId: "doc-1",
  content: "document body",
  metadata: { title: "Doc One" },
};

function seedConversation(payload: Record<string, unknown>) {
  localStorage.setItem(
    CONVERSATIONS_KEY,
    JSON.stringify({
      "document:doc-1": {
        messages: [
          { id: "m-1", role: "user", content: "kept legacy message", timestamp: 1 },
        ],
        input: "",
        updatedAt: Date.now(),
        ...payload,
      },
    }),
  );
}

describe("AssistantPanel per-session scope persistence", () => {
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

  it("restores legacy conversations without a scope as Chat and keeps messages", async () => {
    seedConversation({});
    render(<AssistantPanel context={documentContext} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByText("kept legacy message")).toBeInTheDocument();
  });

  it("restores an explicitly persisted Library scope with the conversation", async () => {
    seedConversation({ scope: "library" });
    render(<AssistantPanel context={documentContext} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByText("kept legacy message")).toBeInTheDocument();
  });
});
