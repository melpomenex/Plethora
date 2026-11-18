import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../AssistantPanel";
import { ThemeProvider } from "../../../contexts/ThemeContext";
import {
  MOBILE_CHAT_HISTORY_KEY,
  MAX_MOBILE_CHAT_HISTORY,
  readMobileChatHistory,
  saveMobileChatToHistory,
} from "../mobile/chatHistory";
import {
  registerOverlayDismissal,
  requestOverlayBack,
  resetOverlayStackForTests,
} from "../../../lib/overlayStack";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return {
    ...actual,
    isTauri: () => false,
    isNativeMobile: () => false,
    invokeCommand: vi.fn().mockResolvedValue([]),
  };
});
vi.mock("../../../api/llm", () => ({ chatWithContext: vi.fn() }));
vi.mock("../../../api/mcp", () => ({
  callAppMCPTool: vi.fn(),
  getAppMCPTools: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../lib/ai/assistant/orchestrator", () => ({ runAssistantTurn: vi.fn() }));
vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({
  ensureCloudAiDisclosure: vi.fn().mockResolvedValue(true),
}));

const CONVERSATIONS_KEY = "assistant-panel-conversations-v1";

const mobileProps = {
  conversationKey: "mobile:global",
  mobilePresentation: { visible: true },
  fillContainer: true,
  appendContextMessages: false,
  context: { type: "general" as const },
};

function seedActiveMobileChat(messages: Array<{ id: string; role: "user" | "assistant"; content: string; timestamp: number }>, input = "", scope: "chat" | "library" = "chat") {
  localStorage.setItem(
    CONVERSATIONS_KEY,
    JSON.stringify({
      "mobile:global": {
        scope,
        input,
        messages,
        updatedAt: Date.now(),
      },
    })
  );
}

describe("mobile assistant chat history and clean new chat", () => {
  beforeEach(() => {
    localStorage.clear();
    resetOverlayStackForTests();
    Element.prototype.scrollTo = vi.fn();
  });

  it("archives the active chat when starting a new chat from the toolbar and lets the user return to it", async () => {
    seedActiveMobileChat(
      [
        { id: "u1", role: "user", content: "What is FSRS?", timestamp: 10 },
        { id: "a1", role: "assistant", content: "FSRS is a spaced repetition algorithm.", timestamp: 20 },
      ],
      "follow-up draft",
      "library"
    );

    render(
      <ThemeProvider>
        <AssistantPanel {...mobileProps} />
      </ThemeProvider>
    );

    expect(await screen.findByText("What is FSRS?")).toBeInTheDocument();

    // Start a clean new chat from the toolbar button
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    expect(screen.queryByText("What is FSRS?")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Answer from: General knowledge" })).toBeInTheDocument();

    // Previous chat was archived
    const archived = readMobileChatHistory();
    expect(archived).toHaveLength(1);
    expect(archived[0].title).toBe("What is FSRS?");

    // Open Recent chats from the toolbar
    fireEvent.click(screen.getByRole("button", { name: "Recent chats" }));
    expect(document.querySelector("[data-assistant-mobile-history]")).not.toBeNull();
    expect(screen.getByText("What is FSRS?")).toBeInTheDocument();

    // Select the archived chat to return to it
    fireEvent.click(screen.getByRole("button", { name: /^What is FSRS\?/ }));

    expect(document.querySelector("[data-assistant-mobile-history]")).toBeNull();
    expect(await screen.findByText("What is FSRS?")).toBeInTheDocument();
    expect(screen.getByText("FSRS is a spaced repetition algorithm.")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("follow-up draft");
    expect(screen.getByRole("button", { name: "Answer from: My library" })).toBeInTheDocument();
  });

  it("preserves the current chat when switching directly to an older chat without losing either", async () => {
    saveMobileChatToHistory({
      id: "old-chat",
      messages: [
        { id: "o1", role: "user", content: "Older chat question", timestamp: 5 },
        { id: "o2", role: "assistant", content: "Older chat answer", timestamp: 6 },
      ],
      scope: "chat",
      input: "",
      updatedAt: 1000,
    });

    seedActiveMobileChat([
      { id: "c1", role: "user", content: "Current chat question", timestamp: 50 },
    ]);

    render(
      <ThemeProvider>
        <AssistantPanel {...mobileProps} />
      </ThemeProvider>
    );

    expect(await screen.findByText("Current chat question")).toBeInTheDocument();

    // Open Recent chats via the + menu
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    const menu = document.querySelector<HTMLElement>("[data-assistant-composer-menu]")!;
    fireEvent.click(within(menu).getByRole("button", { name: "Recent chats" }));

    fireEvent.click(screen.getByRole("button", { name: /^Older chat question/ }));
    expect(await screen.findByText("Older chat answer")).toBeInTheDocument();

    // The previously active chat was automatically saved to history
    const history = readMobileChatHistory();
    expect(history.map((e) => e.title)).toContain("Current chat question");
    expect(history.map((e) => e.title)).toContain("Older chat question");
  });

  it("updates an existing archived chat instead of duplicating it when starting a new chat again", async () => {
    saveMobileChatToHistory({
      id: "chat-1",
      messages: [{ id: "m1", role: "user", content: "Resumed topic", timestamp: 10 }],
      scope: "chat",
      input: "",
      updatedAt: 1000,
    });

    render(
      <ThemeProvider>
        <AssistantPanel {...mobileProps} />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Recent chats" }));
    fireEvent.click(screen.getByRole("button", { name: /^Resumed topic/ }));
    expect(await screen.findByText("Resumed topic")).toBeInTheDocument();

    // Edit draft and start a new chat again
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "saved draft" } });
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    const history = readMobileChatHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("chat-1");
    expect(history[0].input).toBe("saved draft");
  });

  it("allows deleting an archived chat from Recent chats", async () => {
    saveMobileChatToHistory({
      id: "delete-me",
      messages: [{ id: "m1", role: "user", content: "Temporary question", timestamp: 10 }],
      scope: "chat",
      input: "",
      updatedAt: 1000,
    });

    render(
      <ThemeProvider>
        <AssistantPanel {...mobileProps} />
      </ThemeProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "Recent chats" }));
    expect(screen.getByText("Temporary question")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete chat Temporary question" }));
    expect(screen.queryByText("Temporary question")).not.toBeInTheDocument();
    expect(screen.getByText("No previous chats yet")).toBeInTheDocument();
    expect(localStorage.getItem(MOBILE_CHAT_HISTORY_KEY)).toBe("[]");
  });

  it("closes Recent chats on Back before the sheet and restores focus to the trigger", () => {
    const sheetDismiss = vi.fn();
    let cleanup: () => void;
    render(
      <ThemeProvider>
        <AssistantPanel {...mobileProps} />
      </ThemeProvider>
    );
    act(() => {
      cleanup = registerOverlayDismissal(sheetDismiss, { priority: 60 });
    });

    const trigger = screen.getByRole("button", { name: "Recent chats" });
    fireEvent.click(trigger);
    expect(document.querySelector("[data-assistant-mobile-history]")).not.toBeNull();
    expect(screen.getByText(`Up to ${MAX_MOBILE_CHAT_HISTORY} recent chats are kept on this device.`)).toBeInTheDocument();

    act(() => {
      expect(requestOverlayBack()).toBe(true);
    });
    expect(document.querySelector("[data-assistant-mobile-history]")).toBeNull();
    expect(sheetDismiss).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();

    act(() => {
      expect(requestOverlayBack()).toBe(true);
    });
    expect(sheetDismiss).toHaveBeenCalledOnce();
    act(() => cleanup());
  });
});
