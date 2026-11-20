/**
 * Backward-compatible conversation session migration (assistant-conversation-scopes):
 * existing `assistant-panel-conversations-v1` payloads without a `scope` field
 * restore as Chat, explicit scopes round-trip, and messages/drafts never drop.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import { ThemeProvider } from "../../../contexts/ThemeContext";
import { useLLMProvidersStore } from "../../../stores/llmProvidersStore";
import { useAccountStore } from "../../../stores/accountStore";
import { podcastEpisodeConversationId } from "../../../lib/ai/assistant/podcastConversation";

const tauriMocks = vi.hoisted(() => ({
  enabled: false,
  invokeCommand: vi.fn(async () => null as string | null),
}));
const turnMocks = vi.hoisted(() => ({ runAssistantTurn: vi.fn() }));
const mcpMocks = vi.hoisted(() => ({
  callAppMCPTool: vi.fn(async () => ({ isError: false, content: [] })),
  getAppMCPTools: vi.fn(async () => [] as Array<{ name: string; description?: string }>),
}));

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => tauriMocks.enabled,
    isNativeMobile: () => false,
    invokeCommand: tauriMocks.invokeCommand,
  };
});

vi.mock("../../../api/llm", () => ({
  chatWithContext: vi.fn(),
}));

vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: mcpMocks.callAppMCPTool,
  getAppMCPTools: mcpMocks.getAppMCPTools,
}));

vi.mock("../../../lib/ai/assistant/orchestrator", () => ({
  runAssistantTurn: turnMocks.runAssistantTurn,
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
    tauriMocks.enabled = false;
    tauriMocks.invokeCommand.mockReset();
    tauriMocks.invokeCommand.mockResolvedValue(null);
    turnMocks.runAssistantTurn.mockReset();
    mcpMocks.callAppMCPTool.mockReset();
    mcpMocks.callAppMCPTool.mockResolvedValue({ isError: false, content: [] });
    mcpMocks.getAppMCPTools.mockReset();
    mcpMocks.getAppMCPTools.mockResolvedValue([]);
    useAccountStore.setState({ isAuthenticated: false, user: null });
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
      expect(screen.getByRole("button", { name: "Answer from: General knowledge" })).toBeInTheDocument();
    });
    expect(screen.getByText("kept legacy message")).toBeInTheDocument();
  });

  it("restores an explicitly persisted Library scope with the conversation", async () => {
    seedConversation({ scope: "library" });
    render(<AssistantPanel context={documentContext} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Answer from: My library" })).toBeInTheDocument();
    });
    expect(screen.getByText("kept legacy message")).toBeInTheDocument();
  });

  it("restores a strict document policy and the unsent draft under the new source label", async () => {
    seedConversation({ scope: "document", input: "keep this draft" });
    render(<AssistantPanel context={documentContext} />);
    expect(await screen.findByRole("button", { name: "Answer from: This document only" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("keep this draft");
    expect(screen.getByText("kept legacy message")).toBeInTheDocument();
  });

  it("isolates podcast episode drafts and restores each episode's saved state", async () => {
    const keyA = "podcast:episode:episode-a";
    const keyB = "podcast:episode:episode-b";
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({
      [keyA]: {
        scope: "document",
        input: "A's unsent follow-up",
        messages: [
          { id: "a-user", role: "user", content: "Question about A", timestamp: 1 },
          { id: "a-assistant", role: "assistant", content: "Answer about A", timestamp: 2 },
        ],
        updatedAt: 2,
      },
    }));
    const context = { type: "document" as const, content: "same title transcript", metadata: { title: "Same title" } };

    const first = render(<AssistantPanel conversationKey={keyA} conversationId={keyA} context={context} />);
    expect(await screen.findByText("Answer about A")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("A's unsent follow-up");
    first.unmount();

    const second = render(<AssistantPanel conversationKey={keyB} conversationId={keyB} context={context} />);
    expect(screen.queryByText("Answer about A")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    second.unmount();

    render(<AssistantPanel conversationKey={keyA} conversationId={keyA} context={context} />);
    expect(await screen.findByText("Answer about A")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("A's unsent follow-up");
  });

  it("keeps same-title episode history out of prompts and uses a refreshed transcript for follow-ups", async () => {
    const keyA = "podcast:episode:same-title-a";
    const keyB = "podcast:episode:same-title-b";
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({
      [keyA]: {
        scope: "document",
        input: "A-only draft",
        messages: [
          { id: "a-user", role: "user", content: "Question only about A", timestamp: 1 },
          { id: "a-assistant", role: "assistant", content: "Answer only about A", timestamp: 2 },
        ],
        updatedAt: 2,
      },
    }));
    turnMocks.runAssistantTurn
      .mockResolvedValueOnce({ rawContent: "Answer about B" })
      .mockResolvedValueOnce({ rawContent: "Follow-up answer about refreshed B" });
    const firstContext = {
      type: "document" as const,
      content: "Transcript version one for episode B",
      metadata: { title: "Same episode title" },
    };
    const view = render(<AssistantPanel conversationKey={keyB} conversationId={keyB} context={firstContext} />);
    expect(screen.queryByText("Answer only about A")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Question about B" } });
    fireEvent.click(view.container.querySelector("[data-agent-send]")!);
    expect(await screen.findByText("Answer about B")).toBeInTheDocument();
    expect(turnMocks.runAssistantTurn.mock.calls[0][0]).toMatchObject({
      sourceContent: "Transcript version one for episode B",
      history: [],
    });

    view.rerender(
      <AssistantPanel
        conversationKey={keyB}
        conversationId={keyB}
        context={{ ...firstContext, content: "Transcript version two for episode B" }}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Follow up using that answer" } });
    fireEvent.click(view.container.querySelector("[data-agent-send]")!);
    expect(await screen.findByText("Follow-up answer about refreshed B")).toBeInTheDocument();
    const followUpPlan = turnMocks.runAssistantTurn.mock.calls[1][0];
    expect(followUpPlan.sourceContent).toBe("Transcript version two for episode B");
    expect(followUpPlan.history.map((message: { content: string }) => message.content)).toEqual([
      "Question about B",
      "Answer about B",
    ]);
    expect(JSON.stringify(followUpPlan.history)).not.toContain("episode A");
  });

  it("does not let a stale SQLite snapshot replace a newer podcast draft", async () => {
    const key = "podcast:episode:stale-hydration";
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({
      [key]: { scope: "document", input: "saved draft", messages: [], updatedAt: 10 },
    }));
    let resolveSqlite: ((value: string) => void) | undefined;
    tauriMocks.enabled = true;
    tauriMocks.invokeCommand.mockImplementation(() => new Promise<string | null>((resolve) => {
      resolveSqlite = (value) => resolve(value);
    }));

    render(
      <AssistantPanel
        conversationKey={key}
        conversationId={key}
        context={{ type: "document", content: "transcript", metadata: { title: "Episode" } }}
      />,
    );
    const input = await screen.findByDisplayValue("saved draft");
    fireEvent.change(input, { target: { value: "newer local draft" } });
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!)[key]?.input).toBe("newer local draft");
    });

    await act(async () => {
      resolveSqlite?.(JSON.stringify({
        [key]: {
          scope: "chat",
          input: "stale SQLite draft",
          messages: [{ id: "old", role: "user", content: "stale SQLite message", timestamp: 1 }],
          updatedAt: 100,
        },
      }));
    });

    expect(screen.getByRole("textbox")).toHaveValue("newer local draft");
    expect(screen.queryByText("stale SQLite message")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!)[key]?.input).toBe("newer local draft");
  });

  it("keeps a submitted podcast turn pending across panel unmount and commits one detached reply", async () => {
    const key = "podcast:episode:detached-reply";
    let resolveTurn: ((value: { rawContent: string }) => void) | undefined;
    turnMocks.runAssistantTurn.mockImplementation(() => new Promise((resolve) => {
      resolveTurn = resolve;
    }));
    const context = { type: "document" as const, content: "episode transcript", metadata: { title: "Episode" } };

    const first = render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "question while listening" } });
    fireEvent.click(first.container.querySelector("[data-agent-send]")!);
    await waitFor(() => expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    expect(await screen.findByText("question while listening")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop response" })).toBeInTheDocument();
    expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveTurn?.({ rawContent: "answer completed after dismissal" });
    });
    expect(await screen.findByText("answer completed after dismissal")).toBeInTheDocument();
    expect(screen.getAllByText("question while listening")).toHaveLength(1);
    expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1);
  });

  it("restores persisted pending podcast turns as interrupted and offers explicit retry", async () => {
    const key = "podcast:episode:interrupted-reload";
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({
      [key]: {
        scope: "document",
        input: "",
        updatedAt: 10,
        messages: [{
          id: "pending-question",
          role: "user",
          content: "recover this question",
          timestamp: 1,
          podcastTurn: { attemptId: "lost-attempt", status: "pending" },
        }],
      },
    }));

    render(<AssistantPanel conversationKey={key} conversationId={key} context={documentContext} />);
    expect(await screen.findByText("Reply interrupted")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(turnMocks.runAssistantTurn).not.toHaveBeenCalled();
  });

  it("records a detached provider failure and retries the same user turn once", async () => {
    const key = "podcast:episode:detached-failure";
    let rejectTurn: ((error: Error) => void) | undefined;
    turnMocks.runAssistantTurn
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectTurn = reject; }))
      .mockResolvedValueOnce({ rawContent: "recovered answer" });
    const context = { type: "document" as const, content: "transcript", metadata: { title: "Episode" } };

    const first = render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "retry this question" } });
    fireEvent.click(first.container.querySelector("[data-agent-send]")!);
    await waitFor(() => expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1));
    first.unmount();

    await act(async () => { rejectTurn?.(new Error("provider offline")); });
    render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    expect(await screen.findByText("Reply failed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("recovered answer")).toBeInTheDocument();
    expect(screen.getAllByText("retry this question")).toHaveLength(1);
    expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(2);
  });

  it("stops a detached reply and ignores its late result", async () => {
    const key = "podcast:episode:stopped-reply";
    let resolveTurn: ((value: { rawContent: string }) => void) | undefined;
    turnMocks.runAssistantTurn.mockImplementation(() => new Promise((resolve) => { resolveTurn = resolve; }));
    const context = { type: "document" as const, content: "transcript", metadata: { title: "Episode" } };

    const first = render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "stop this question" } });
    fireEvent.click(first.container.querySelector("[data-agent-send]")!);
    await waitFor(() => expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    fireEvent.click(await screen.findByRole("button", { name: "Stop response" }));
    expect(await screen.findByText("Reply stopped")).toBeInTheDocument();
    await act(async () => { resolveTurn?.({ rawContent: "must not be committed" }); });
    expect(screen.queryByText("must not be committed")).not.toBeInTheDocument();
    expect(screen.getAllByText("stop this question")).toHaveLength(1);
  });

  it("clears and invalidates a pending episode turn", async () => {
    const key = "podcast:episode:cleared-reply";
    let resolveTurn: ((value: { rawContent: string }) => void) | undefined;
    turnMocks.runAssistantTurn.mockImplementation(() => new Promise((resolve) => { resolveTurn = resolve; }));
    const context = { type: "document" as const, content: "transcript", metadata: { title: "Episode" } };
    const view = render(<AssistantPanel conversationKey={key} conversationId={key} context={context} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "clear this question" } });
    fireEvent.click(view.container.querySelector("[data-agent-send]")!);
    await waitFor(() => expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1));

    fireEvent.contextMenu(view.container.querySelector("[data-assistant-panel]")!);
    fireEvent.click(await screen.findByRole("menuitem", { name: /clear/i }));
    expect(screen.queryByText("clear this question")).not.toBeInTheDocument();
    await act(async () => { resolveTurn?.({ rawContent: "cleared result" }); });
    expect(screen.queryByText("cleared result")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!)[key].messages).toEqual([]);
  });

  it("keeps profile podcast threads separate and discards a reply after the profile changes", async () => {
    const profileA = "account-a";
    const profileB = "account-b";
    const keyA = podcastEpisodeConversationId("profile-race", profileA);
    const keyB = podcastEpisodeConversationId("profile-race", profileB);
    expect(keyA).not.toBe(keyB);
    useAccountStore.setState({
      isAuthenticated: true,
      user: { id: profileA, email: "a@example.test", subscriptionTier: "free" },
    });
    let resolveTurn: ((value: { rawContent: string }) => void) | undefined;
    turnMocks.runAssistantTurn.mockImplementation(() => new Promise((resolve) => { resolveTurn = resolve; }));
    const context = { type: "document" as const, content: "transcript", metadata: { title: "Episode" } };
    const view = render(<AssistantPanel conversationKey={keyA} conversationId={keyA} context={context} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "account A question" } });
    fireEvent.click(view.container.querySelector("[data-agent-send]")!);
    await waitFor(() => expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1));

    act(() => {
      useAccountStore.setState({
        isAuthenticated: true,
        user: { id: profileB, email: "b@example.test", subscriptionTier: "free" },
      });
    });
    view.rerender(<AssistantPanel conversationKey={keyB} conversationId={keyB} context={context} />);
    await act(async () => { resolveTurn?.({ rawContent: "must remain with account A" }); });

    expect(screen.queryByText("account A question")).not.toBeInTheDocument();
    expect(screen.queryByText("must remain with account A")).not.toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!);
    expect(stored[keyB]?.messages ?? []).toEqual([]);
    const originalQuestion = stored[keyA].messages.find((message: { content: string }) => message.content === "account A question");
    expect(originalQuestion?.podcastTurn.status).toBe("interrupted");
  });

  it("does not execute a detached tool reply or write it into the newly active episode", async () => {
    const originalKey = "podcast:episode:detached-tool-origin";
    const activeKey = "podcast:episode:newly-active";
    mcpMocks.getAppMCPTools.mockResolvedValue([{ name: "create_extract", description: "Create an extract" }]);
    let resolveTurn: ((value: { rawContent: string }) => void) | undefined;
    turnMocks.runAssistantTurn.mockImplementation(() => new Promise((resolve) => { resolveTurn = resolve; }));
    const context = { type: "document" as const, content: "episode transcript", metadata: { title: "Episode" } };

    const origin = render(<AssistantPanel conversationKey={originalKey} conversationId={originalKey} context={context} />);
    await waitFor(() => expect(mcpMocks.getAppMCPTools).toHaveBeenCalled());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "make an extract" } });
    fireEvent.click(origin.container.querySelector("[data-agent-send]")!);
    await waitFor(() => expect(turnMocks.runAssistantTurn).toHaveBeenCalledTimes(1));
    origin.unmount();

    render(<AssistantPanel conversationKey={activeKey} conversationId={activeKey} context={context} />);
    await act(async () => {
      resolveTurn?.({ rawContent: '```tool_calls\n[{"name":"create_extract","arguments":{"title":"Detached","content":"Save this quote"}}]\n```' });
    });

    const stored = JSON.parse(localStorage.getItem(CONVERSATIONS_KEY)!);
    expect((stored[activeKey]?.messages ?? []).filter((message: { role: string }) => message.role !== "system")).toEqual([]);
    expect(stored[originalKey].messages.some((message: { toolCalls?: Array<{ name: string; status: string }> }) =>
      message.toolCalls?.some((call) => call.name === "create_extract" && call.status === "pending"),
    )).toBe(true);
    expect(mcpMocks.callAppMCPTool).not.toHaveBeenCalled();
  });

  it("renders stored completed tool results without replaying the tool", async () => {
    const key = "podcast:episode:restored-tool-result";
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify({
      [key]: {
        scope: "document",
        input: "",
        updatedAt: 10,
        messages: [
          { id: "saved-user", role: "user", content: "save an extract", timestamp: 1, podcastTurn: { attemptId: "finished-attempt", status: "complete" } },
          {
            id: "saved-assistant",
            role: "assistant",
            content: "Extract saved",
            timestamp: 2,
            podcastResponseAttemptId: "finished-attempt",
            toolCalls: [{ name: "create_extract", parameters: { title: "Saved", content: "Previously saved" }, status: "success", result: { id: "extract-1" } }],
          },
        ],
      },
    }));

    render(<AssistantPanel conversationKey={key} conversationId={key} context={documentContext} />);
    expect(await screen.findByText("Extract saved")).toBeInTheDocument();
    expect(mcpMocks.callAppMCPTool).not.toHaveBeenCalled();
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
    expect(screen.getByRole("button", { name: "Answer from: My library" })).toBeInTheDocument();
    expect(screen.getByText("global second turn")).toBeInTheDocument();
    unmount();
    render(<AssistantPanel {...mobileProps} context={{ type: "general" }} />);
    expect(await screen.findByDisplayValue("in memory edit")).toBeInTheDocument();
    expect(screen.getByText("global first turn")).toBeInTheDocument();
  });

  it("New conversation resets only the mobile key to Chat", async () => {
    seedMobile();
    render(<ThemeProvider><AssistantPanel {...mobileProps} context={documentContext} /></ThemeProvider>);
    await screen.findByText("global first turn");
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByText("global first turn")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Answer from: General knowledge" })).toBeInTheDocument();
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

  it("restores a video conversation when reopened with document context before video metadata loads", async () => {
    localStorage.setItem(
      CONVERSATIONS_KEY,
      JSON.stringify({
        "video:vid-42": {
          messages: [
            { id: "u1", role: "user", content: "Explain this video", timestamp: 1 },
            { id: "a1", role: "assistant", content: "Saved video assistant output", timestamp: 2 },
          ],
          scope: "document",
          input: "",
          updatedAt: 2,
        },
      }),
    );

    render(<AssistantPanel context={{ type: "document", documentId: "vid-42", metadata: { title: "Video 42" } }} />);
    expect(await screen.findByText("Saved video assistant output")).toBeInTheDocument();
  });
});
