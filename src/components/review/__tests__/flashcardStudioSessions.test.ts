import { beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  MAX_SESSIONS,
  MAX_MESSAGES_PER_SESSION,
  MAX_DRAFTS_PER_SESSION,
  createSession,
  loadSessions,
  saveSessions,
  getSession,
  getActiveSessionId,
  setActiveSessionId,
  updateSession,
  renameSession,
  deleteSession,
  ensureActiveSession,
  migrateLegacyState,
  deriveSessionTitle,
  isPlaceholderTitle,
} from "../flashcardStudioSessions";
import type { ChatMessage, DraftCard } from "../FlashcardStudioModal";

const userMsg = (content: string, id = "m1"): ChatMessage => ({
  id,
  role: "user",
  content,
  timestamp: 1_000,
});
const assistantMsg = (content: string, id = "m2"): ChatMessage => ({
  id,
  role: "assistant",
  content,
  timestamp: 2_000,
});
const draft = (id = "d1"): DraftCard => ({
  id,
  type: "qa",
  question: "Q?",
  answer: "A.",
  selected: true,
  createdAt: 1_000,
  tags: [],
});

beforeEach(() => {
  localStorage.clear();
});

describe("createSession", () => {
  it("creates a blank session with a generated id and placeholder title", () => {
    const s = createSession();
    expect(s.id).toBeTruthy();
    expect(s.title).toBe("New session");
    expect(s.messages).toEqual([]);
    expect(s.draftCards).toEqual([]);
    expect(s.cardCount).toBe(0);
    expect(s.createdAt).toBe(s.updatedAt);
  });

  it("derives a title from the first user message when none given", () => {
    const s = createSession({ messages: [userMsg("Create cards about photosynthesis")] });
    expect(s.title).toBe("Create cards about photosynthesis");
  });

  it("derives a title from the document name when no messages", () => {
    const s = createSession({ documentName: "Biology Textbook" });
    expect(s.title).toBe("Biology Textbook");
  });

  it("respects an explicitly provided title", () => {
    const s = createSession({ title: "My custom title", messages: [userMsg("ignored")] });
    expect(s.title).toBe("My custom title");
  });

  it("coerces malformed messages/drafts to safe arrays", () => {
    const s = createSession({
      messages: [{ bogus: true }] as unknown as ChatMessage[],
      draftCards: [{ id: 5 }] as unknown as DraftCard[],
    });
    expect(s.messages).toEqual([]);
    expect(s.draftCards).toEqual([]);
  });
});

describe("deriveSessionTitle", () => {
  it("truncates long prompts with an ellipsis", () => {
    const long = "x".repeat(80);
    expect(deriveSessionTitle([userMsg(long)])).toBe("x".repeat(60) + "…");
  });

  it("collapses whitespace in the title", () => {
    expect(deriveSessionTitle([userMsg("hello\n\n  world")])).toBe("hello world");
  });

  it("falls back to document name when no user messages", () => {
    expect(deriveSessionTitle([assistantMsg("hi")], "Doc")).toBe("Doc");
  });

  it("falls back to placeholder when nothing is available", () => {
    expect(deriveSessionTitle([], undefined)).toBe("New session");
  });

  it("ignores empty/whitespace prompts", () => {
    expect(deriveSessionTitle([userMsg("   ")], "Doc")).toBe("Doc");
  });
});

describe("isPlaceholderTitle", () => {
  it("recognizes the placeholder and empty strings", () => {
    expect(isPlaceholderTitle("New session")).toBe(true);
    expect(isPlaceholderTitle("")).toBe(true);
  });
  it("treats real titles as non-placeholder", () => {
    expect(isPlaceholderTitle("My session")).toBe(false);
  });
});

describe("load/save sessions + active id", () => {
  it("round-trips sessions through localStorage", () => {
    const a = createSession({ messages: [userMsg("A")] });
    const b = createSession({ messages: [userMsg("B")] });
    saveSessions([a, b]);
    const loaded = loadSessions();
    expect(loaded).toHaveLength(2);
    expect(loaded.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("returns [] when nothing persisted", () => {
    expect(loadSessions()).toEqual([]);
  });

  it("sorts sessions most-recently-updated first", () => {
    const old = createSession({ messages: [userMsg("old")] });
    // Force the older record to have an earlier updatedAt.
    old.updatedAt = 1_000;
    const recent = createSession({ messages: [userMsg("recent")] });
    saveSessions([old, recent]);
    const loaded = loadSessions();
    expect(loaded[0].id).toBe(recent.id);
    expect(loaded[1].id).toBe(old.id);
  });

  it("gets and sets the active session id", () => {
    expect(getActiveSessionId()).toBeNull();
    setActiveSessionId("abc");
    expect(getActiveSessionId()).toBe("abc");
  });
});

describe("getSession", () => {
  it("returns the matching session or null", () => {
    const s = createSession({ messages: [userMsg("find me")] });
    saveSessions([s]);
    expect(getSession(s.id)?.title).toBe("find me");
    expect(getSession("does-not-exist")).toBeNull();
  });
});

describe("updateSession", () => {
  it("merges a patch, bumps updatedAt, and recomputes cardCount", () => {
    const s = createSession();
    saveSessions([s]);
    const before = getSession(s.id)!;
    const updated = updateSession(s.id, { draftCards: [draft("d1"), draft("d2")] })!;
    expect(updated.draftCards).toHaveLength(2);
    expect(updated.cardCount).toBe(2);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(before.updatedAt);
  });

  it("re-derives a placeholder title from new messages, but preserves user titles", () => {
    const s = createSession(); // placeholder title
    saveSessions([s]);
    const derived = updateSession(s.id, { messages: [userMsg("first prompt")] })!;
    expect(derived.title).toBe("first prompt");

    const renamed = updateSession(derived.id, { title: "Keep this" })!;
    const afterNewMsg = updateSession(renamed.id, { messages: [userMsg("another prompt")] })!;
    expect(afterNewMsg.title).toBe("Keep this");
  });

  it("returns null for an unknown id", () => {
    expect(updateSession("nope", { title: "x" })).toBeNull();
  });
});

describe("renameSession", () => {
  it("renames and persists, ignoring blank titles", () => {
    const s = createSession();
    saveSessions([s]);
    expect(renameSession(s.id, "   ")).toBeNull();
    const renamed = renameSession(s.id, "  Renamed  ")!;
    expect(renamed.title).toBe("Renamed");
    expect(getSession(s.id)?.title).toBe("Renamed");
  });
});

describe("deleteSession", () => {
  it("removes a non-active session and leaves the active id unchanged", () => {
    const a = createSession();
    const b = createSession();
    saveSessions([a, b]);
    setActiveSessionId(a.id);
    const active = deleteSession(b.id);
    expect(active).toBe(a.id);
    expect(getSession(b.id)).toBeNull();
    expect(getSession(a.id)).not.toBeNull();
  });

  it("creates a fresh empty active session when deleting the active one", () => {
    const a = createSession({ messages: [userMsg("active")] });
    saveSessions([a]);
    setActiveSessionId(a.id);
    const newActive = deleteSession(a.id);
    expect(newActive).not.toBe(a.id);
    expect(getSession(a.id)).toBeNull();
    expect(getSession(newActive)).not.toBeNull();
    expect(getSession(newActive)?.messages).toEqual([]);
  });
});

describe("ensureActiveSession", () => {
  it("creates and activates an empty session when none is active", () => {
    const id = ensureActiveSession();
    expect(id).toBeTruthy();
    expect(getActiveSessionId()).toBe(id);
    expect(getSession(id)?.messages).toEqual([]);
  });

  it("is a no-op when an active session already exists", () => {
    const s = createSession();
    saveSessions([s]);
    setActiveSessionId(s.id);
    expect(ensureActiveSession()).toBe(s.id);
  });
});

describe("caps enforcement", () => {
  it("caps the number of stored sessions", () => {
    const many = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => {
      const s = createSession({ messages: [userMsg(`s${i}`)] });
      s.updatedAt = 1_000 + i; // ascending age
      return s;
    });
    saveSessions(many);
    expect(loadSessions()).toHaveLength(MAX_SESSIONS);
  });

  it("caps messages and drafts per session on save", () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_SESSION + 10 }, (_, i) =>
      userMsg(`m${i}`, `m${i}`),
    );
    const drafts = Array.from({ length: MAX_DRAFTS_PER_SESSION + 10 }, (_, i) =>
      draft(`d${i}`),
    );
    const s = createSession();
    s.messages = messages;
    s.draftCards = drafts;
    saveSessions([s]);
    const loaded = getSession(s.id)!;
    expect(loaded.messages).toHaveLength(MAX_MESSAGES_PER_SESSION);
    expect(loaded.draftCards).toHaveLength(MAX_DRAFTS_PER_SESSION);
    // messages keep the most recent (tail), drafts keep the head
    expect(loaded.messages[0].id).toBe(`m${10}`);
    expect(loaded.draftCards[0].id).toBe("d0");
  });
});

describe("migrateLegacyState", () => {
  it("migrates a valid legacy blob into a default active session", () => {
    const legacy = {
      selectedProviderId: "prov-1",
      selectedNotebookId: "nb-1",
      selectedDocumentId: "doc-1",
      selectedDeckId: "deck-1",
      contextSelection: { mode: "full", chapters: [], pageRange: null, excerpt: "", searchQuery: "", searchResults: [], selectedSectionIds: [] },
      messages: [userMsg("legacy prompt")],
      draftCards: [draft("ld1")],
      viewMode: "chat",
    };
    localStorage.setItem(LEGACY_STORAGE_KEYS.state, JSON.stringify(legacy));

    const activeId = migrateLegacyState();

    expect(activeId).toBeTruthy();
    expect(getActiveSessionId()).toBe(activeId);
    const s = getSession(activeId)!;
    expect(s.selectedProviderId).toBe("prov-1");
    expect(s.selectedDocumentId).toBe("doc-1");
    expect(s.messages.map((m) => m.content)).toEqual(["legacy prompt"]);
    expect(s.draftCards).toHaveLength(1);
    expect(s.title).toBe("legacy prompt"); // derived from first user message
    // Legacy key is left intact (read-only migration).
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.state)).not.toBeNull();
  });

  it("falls back to an empty session when the legacy blob is malformed", () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.state, "{not valid json");
    const activeId = migrateLegacyState();
    expect(getSession(activeId)?.messages).toEqual([]);
    expect(getSession(activeId)?.draftCards).toEqual([]);
  });

  it("creates an empty session when no legacy state exists", () => {
    const activeId = migrateLegacyState();
    expect(getSession(activeId)?.messages).toEqual([]);
  });

  it("does not re-migrate when sessions already exist", () => {
    // Pre-existing sessions model.
    const s = createSession({ messages: [userMsg("existing")] });
    saveSessions([s]);
    setActiveSessionId(s.id);
    // Legacy data present too — must NOT be imported again.
    localStorage.setItem(
      LEGACY_STORAGE_KEYS.state,
      JSON.stringify({ messages: [userMsg("legacy")] }),
    );

    const activeId = migrateLegacyState();
    expect(activeId).toBe(s.id);
    expect(loadSessions()).toHaveLength(1);
  });

  it("activates the first existing session when sessions exist but none is active", () => {
    const s = createSession();
    saveSessions([s]);
    // no active id set
    const activeId = migrateLegacyState();
    expect(activeId).toBe(s.id);
  });
});

describe("STORAGE_KEYS constants", () => {
  it("exposes the v1 keys", () => {
    expect(STORAGE_KEYS.sessions).toBe("flashcard-studio-sessions-v1");
    expect(STORAGE_KEYS.activeSession).toBe("flashcard-studio-active-session-v1");
  });

  it("exposes the legacy keys", () => {
    expect(LEGACY_STORAGE_KEYS.state).toBe("flashcard-studio-state-v3");
    expect(LEGACY_STORAGE_KEYS.history).toBe("flashcard-studio-history");
  });
});
