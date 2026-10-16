/**
 * Backward-compatible conversation session migration (assistant-conversation-scopes):
 * existing `assistant-panel-conversations-v1` payloads without a `scope` field
 * restore as Chat, explicit scopes round-trip, and messages/drafts never drop.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
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


describe("AssistantPanel stable mobile session", () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollTo = vi.fn();
  });

  const mobileProps = { conversationKey: "mobile:global", fillContainer: true, mobilePresentation: { visible: true } };
  const seedMobile = () => localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({
    "mobile:global": { scope: "library", input: "saved mobile draft", messages: [
      { id: "global-1", role: "user", content: "global first turn", timestamp: 1 },
      { id: "global-2", role: "assistant", content: "global second turn", timestamp: 2 },
    ] },
    "document:doc-1": { scope: "document", input: "desktop draft", messages: [
      { id: "desktop", role: "user", content: "desktop history", timestamp: 1 },
    ] },
  }));

  it("preserves messages draft and scope across source, title and hidden presentation changes", async () => {
    seedMobile();
    const { rerender, unmount } = render(<AssistantPanel {...mobileProps} context={documentContext} />);
    expect(await screen.findByText("global first turn")).toBeInTheDocument();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "in memory edit" } });
    rerender(<AssistantPanel {...mobileProps} mobilePresentation={{ visible: false }} context={{ type: "video", documentId: "other", metadata: { title: "Changed title" }, position: { currentTime: 99 } }} />);
    expect(input).toHaveValue("in memory edit");
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("global second turn")).toBeInTheDocument();
    unmount();
    render(<AssistantPanel {...mobileProps} context={{ type: "general" }} />);
    expect(await screen.findByDisplayValue("in memory edit")).toBeInTheDocument();
    expect(screen.getByText("global first turn")).toBeInTheDocument();
  });

  it("New conversation resets only the mobile key to Chat", async () => {
    seedMobile();
    render(<AssistantPanel {...mobileProps} context={documentContext} />);
    await screen.findByText("global first turn");
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByText("global first turn")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Chat" })).toHaveAttribute("aria-pressed", "true");
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!);
    expect(stored["document:doc-1"].input).toBe("desktop draft");
    expect(stored["mobile:global"].messages).toEqual([]);
  });

  it("ignores remote hydration and selection handoff events", async () => {
    seedMobile();
    render(<AssistantPanel {...mobileProps} context={documentContext} />);
    await screen.findByText("global first turn");
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({ "mobile:global": { messages: [], input: "remote" } }));
    act(() => {
      window.dispatchEvent(new CustomEvent("plethora:synced-conversation", { detail: { key: "mobile:global" } }));
      window.dispatchEvent(new CustomEvent("plethora:selection-ask", { detail: { question: "selection question", snapshot: { excerpt: "secret" } } }));
    });
    expect(screen.getByRole("textbox")).toHaveValue("saved mobile draft");
    expect(screen.getByText("global first turn")).toBeInTheDocument();
  });

  it("rehydrates when explicit identity changes without overwriting another key", async () => {
    seedMobile();
    const { rerender } = render(<AssistantPanel {...mobileProps} context={documentContext} />);
    await screen.findByText("global first turn");
    rerender(<AssistantPanel {...mobileProps} conversationKey="document:doc-1" context={documentContext} />);
    expect(await screen.findByText("desktop history")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("desktop draft");
    expect(JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!)["mobile:global"].input).toBe("saved mobile draft");
  });

  it("keeps a working in-memory draft after corrupt or quota-limited storage", async () => {
    localStorage.setItem(CONVERSATIONS_KEY, "{broken");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { rerender } = render(<AssistantPanel {...mobileProps} />);
      fireEvent.change(screen.getByRole("textbox"), { target: { value: "retained despite quota" } });
      rerender(<AssistantPanel {...mobileProps} context={documentContext} />);
      expect(screen.getByRole("textbox")).toHaveValue("retained despite quota");
    } finally { setItem.mockRestore(); warning.mockRestore(); }
  });
});
