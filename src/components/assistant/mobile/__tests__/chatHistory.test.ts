import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteMobileChatFromHistory,
  deriveMobileChatSourceTitle,
  deriveMobileChatTitle,
  MAX_MOBILE_CHAT_HISTORY,
  MOBILE_CHAT_HISTORY_KEY,
  readMobileChatHistory,
  saveMobileChatToHistory,
  writeMobileChatHistory,
  type MobileChatMessage,
} from "../chatHistory";

const makeMessage = (
  id: string,
  role: MobileChatMessage["role"],
  content: string,
  timestamp = 1000,
  sourceTitle?: string
): MobileChatMessage => ({
  id,
  role,
  content,
  timestamp,
  ...(sourceTitle ? { provenance: { documentIds: [], sourceTitle } } : {}),
});

describe("mobile chatHistory storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("derives titles from the first user message, falling back to assistant or untitled", () => {
    expect(
      deriveMobileChatTitle([
        makeMessage("1", "system", "System prompt"),
        makeMessage("2", "user", "  Explain   spaced   repetition  "),
        makeMessage("3", "assistant", "Sure!"),
      ])
    ).toBe("Explain spaced repetition");

    expect(
      deriveMobileChatTitle([makeMessage("1", "assistant", "Hello there")])
    ).toBe("Hello there");

    expect(deriveMobileChatTitle([], "Untitled chat")).toBe("Untitled chat");

    const longText = "a".repeat(100);
    const truncated = deriveMobileChatTitle([makeMessage("1", "user", longText)]);
    expect(truncated.length).toBeLessThanOrEqual(72);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("derives the most recent non-empty source title", () => {
    expect(
      deriveMobileChatSourceTitle([
        makeMessage("1", "user", "First", 1, "Older Book"),
        makeMessage("2", "assistant", "Second", 2, "Newer Article"),
      ])
    ).toBe("Newer Article");
  });

  it("ignores empty or system-only chats", () => {
    expect(
      saveMobileChatToHistory({
        messages: [makeMessage("sys", "system", "hidden")],
        scope: "chat",
        input: "unsent draft",
      })
    ).toBeNull();
    expect(readMobileChatHistory()).toEqual([]);
  });

  it("saves, updates by id without duplicating, and deletes chats", () => {
    const id = saveMobileChatToHistory({
      messages: [makeMessage("1", "user", "First question", 10)],
      scope: "document",
      input: "follow-up",
      updatedAt: 100,
    });
    expect(id).toBeTruthy();

    saveMobileChatToHistory({
      id: id!,
      messages: [
        makeMessage("1", "user", "First question", 10),
        makeMessage("2", "assistant", "First answer", 20),
      ],
      scope: "document",
      input: "",
      updatedAt: 200,
    });

    const entries = readMobileChatHistory();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
    expect(entries[0].messages).toHaveLength(2);
    expect(entries[0].updatedAt).toBe(200);

    const remaining = deleteMobileChatFromHistory(id!);
    expect(remaining).toEqual([]);
    expect(readMobileChatHistory()).toEqual([]);
  });

  it("enforces MAX_MOBILE_CHAT_HISTORY keeping the most recent chats", () => {
    for (let i = 1; i <= MAX_MOBILE_CHAT_HISTORY + 5; i += 1) {
      saveMobileChatToHistory({
        id: `chat-${i}`,
        messages: [makeMessage(`m-${i}`, "user", `Question ${i}`, i)],
        scope: "chat",
        input: "",
        updatedAt: i * 1000,
      });
    }

    const entries = readMobileChatHistory();
    expect(entries).toHaveLength(MAX_MOBILE_CHAT_HISTORY);
    expect(entries[0].id).toBe(`chat-${MAX_MOBILE_CHAT_HISTORY + 5}`);
    expect(entries.at(-1)?.id).toBe("chat-6");
  });

  it("strips agentRun sourceRefs text when persisting", () => {
    saveMobileChatToHistory({
      id: "agent-chat",
      messages: [
        {
          id: "m1",
          role: "assistant",
          content: "Proposals",
          timestamp: 10,
          agentRun: {
            proposals: [
              {
                id: "p1",
                sourceRefs: [{ id: "s1", text: "huge body text" }],
              },
            ],
          },
        },
      ],
      scope: "chat",
      input: "",
      updatedAt: 500,
    });

    const stored = JSON.parse(localStorage.getItem(MOBILE_CHAT_HISTORY_KEY)!);
    expect(stored[0].messages[0].agentRun.proposals[0].sourceRefs[0].text).toBe("");
  });

  it("handles corrupt storage and quota-limited writes gracefully", () => {
    localStorage.setItem(MOBILE_CHAT_HISTORY_KEY, "{not valid json");
    expect(readMobileChatHistory()).toEqual([]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const originalSetItem = Storage.prototype.setItem.bind(localStorage);
    let attempts = 0;
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation((key, value) => {
        attempts += 1;
        if (attempts === 1) throw new Error("QuotaExceededError");
        originalSetItem(key, value);
      });

    try {
      const saved = writeMobileChatHistory([
        {
          id: "a",
          title: "Newer",
          messages: [makeMessage("1", "user", "Newer", 2)],
          scope: "chat",
          input: "",
          updatedAt: 200,
        },
        {
          id: "b",
          title: "Older",
          messages: [makeMessage("2", "user", "Older", 1)],
          scope: "chat",
          input: "",
          updatedAt: 100,
        },
      ]);
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe("a");
    } finally {
      setItem.mockRestore();
      warn.mockRestore();
    }
  });
});
