/**
 * Integration tests for the Flashcard Studio session flows.
 *
 * These exercise the exact store operations the modal's session handlers call
 * (createSession / updateSession / deleteSession / migrateLegacyState), in the
 * same sequence the UI performs them — covering the spec scenarios for new
 * session, resume, delete, and legacy migration without the heavy cost and
 * brittleness of mounting the full 5000-line modal with all its dependencies.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  STORAGE_KEYS,
  LEGACY_STORAGE_KEYS,
  createSession,
  loadSessions,
  saveSessions,
  getSession,
  getActiveSessionId,
  setActiveSessionId,
  updateSession,
  deleteSession,
  migrateLegacyState,
  ensureActiveSession,
} from "../flashcardStudioSessions";
import type { ChatMessage, DraftCard } from "../FlashcardStudioModal";

const userMsg = (content: string, id = "m1"): ChatMessage => ({
  id,
  role: "user",
  content,
  timestamp: 1_000,
});
const draft = (id: string, alreadyPersisted = false): DraftCard => ({
  id,
  type: "qa",
  question: `Q ${id}`,
  answer: "A",
  selected: true,
  createdAt: 1_000,
  tags: [],
  alreadyPersisted,
});

beforeEach(() => {
  localStorage.clear();
});

describe("new-session flow (spec: clear context window, preserve prior)", () => {
  it("creates a clean active session while keeping the prior one resumable", () => {
    // Simulate the modal having an active session with chat + drafts from Doc A.
    const docA = createSession({
      selectedDocumentId: "doc-a",
      documentName: "Document A",
      messages: [userMsg("cards about A")],
      draftCards: [draft("a1"), draft("a2")],
    });
    saveSessions([docA]);
    setActiveSessionId(docA.id);

    // The "New session" handler: create blank, make active, hydrate clean.
    const fresh = createSession({ contextSelection: { mode: "full", chapters: [], pageRange: null, excerpt: "", searchQuery: "", searchResults: [], selectedSectionIds: [] } });
    saveSessions([fresh, ...loadSessions()]);
    setActiveSessionId(fresh.id);

    // New session is active and clean.
    expect(getActiveSessionId()).toBe(fresh.id);
    expect(getSession(fresh.id)?.messages).toEqual([]);
    expect(getSession(fresh.id)?.draftCards).toEqual([]);

    // Prior session is preserved and resumable.
    const restored = getSession(docA.id);
    expect(restored).not.toBeNull();
    expect(restored?.documentName).toBe("Document A");
    expect(restored?.messages.map((m) => m.content)).toEqual(["cards about A"]);
    expect(restored?.draftCards).toHaveLength(2);
  });

  it("carries drafts into the new session when the user chooses 'Keep drafts'", () => {
    const docA = createSession({
      draftCards: [draft("a1"), draft("a2")],
      messages: [userMsg("old")],
    });
    saveSessions([docA]);
    setActiveSessionId(docA.id);

    // startFreshSession({ carryDrafts: true })
    const carriedDrafts = getSession(docA.id)!.draftCards;
    const fresh = createSession({ draftCards: carriedDrafts });
    saveSessions([fresh, ...loadSessions().filter((s) => s.id !== fresh.id)]);
    setActiveSessionId(fresh.id);

    expect(getSession(fresh.id)?.draftCards).toHaveLength(2);
    // The carried drafts are copies in the new session, not a reference to A.
    expect(getSession(docA.id)?.draftCards).toHaveLength(2);
  });
});

describe("resume flow (spec: restore full state + follow-up uses its history)", () => {
  it("switches active session and restores messages/drafts/context/document", () => {
    const a = createSession({ messages: [userMsg("A prompt")], draftCards: [draft("a1")] });
    const b = createSession({
      selectedDocumentId: "doc-b",
      documentName: "Document B",
      messages: [userMsg("B prompt 1"), userMsg("B prompt 2", "m2")],
      draftCards: [draft("b1"), draft("b2")],
      contextSelection: { mode: "sections", chapters: [], pageRange: null, excerpt: "", searchQuery: "", searchResults: [], selectedSectionIds: ["s1"] },
    });
    saveSessions([a, b]);
    setActiveSessionId(a.id);

    // handleResumeSession(b.id): flush a, activate b, hydrate from b.
    updateSession(a.id, { messages: [userMsg("A prompt")] }); // flush
    setActiveSessionId(b.id);
    const hydrated = getSession(b.id);

    expect(getActiveSessionId()).toBe(b.id);
    expect(hydrated?.selectedDocumentId).toBe("doc-b");
    expect(hydrated?.messages).toHaveLength(2);
    expect(hydrated?.draftCards).toHaveLength(2);
    expect(hydrated?.contextSelection.selectedSectionIds).toEqual(["s1"]);
  });

  it("follow-up save records against the resumed (now active) session", () => {
    const a = createSession({ messages: [userMsg("a")] });
    const b = createSession({ messages: [userMsg("b1")] });
    saveSessions([a, b]);
    setActiveSessionId(b.id); // resumed b

    // A new prompt/response is appended to b's messages only.
    updateSession(b.id, { messages: [...getSession(b.id)!.messages, userMsg("b2", "m2")] });

    expect(getSession(b.id)?.messages.map((m) => m.content)).toEqual(["b1", "b2"]);
    // a is untouched.
    expect(getSession(a.id)?.messages.map((m) => m.content)).toEqual(["a"]);
  });
});

describe("delete flow (spec: remove session, keep persisted items, fresh on active)", () => {
  it("deletes a non-active session leaving the active id intact", () => {
    const a = createSession();
    const b = createSession();
    saveSessions([a, b]);
    setActiveSessionId(a.id);

    const activeAfter = deleteSession(b.id);
    expect(activeAfter).toBe(a.id);
    expect(getSession(b.id)).toBeNull();
    expect(loadSessions().map((s) => s.id)).toEqual([a.id]);
  });

  it("deleting the active session creates and activates a fresh empty one", () => {
    const a = createSession({ messages: [userMsg("active")] });
    saveSessions([a]);
    setActiveSessionId(a.id);

    const newActive = deleteSession(a.id);
    expect(newActive).not.toBe(a.id);
    expect(getSession(a.id)).toBeNull();
    expect(getSession(newActive)?.messages).toEqual([]);
    expect(getActiveSessionId()).toBe(newActive);
  });
});

describe("migration (spec: legacy blob → default active session)", () => {
  it("migrates a valid legacy workspace into a resumable active session", () => {
    const legacy = {
      selectedDocumentId: "doc-legacy",
      selectedProviderId: "prov",
      contextSelection: { mode: "full", chapters: [], pageRange: null, excerpt: "", searchQuery: "", searchResults: [], selectedSectionIds: [] },
      messages: [userMsg("legacy prompt")],
      draftCards: [draft("ld1")],
      viewMode: "chat",
    };
    localStorage.setItem(LEGACY_STORAGE_KEYS.state, JSON.stringify(legacy));

    const activeId = migrateLegacyState();
    const s = getSession(activeId)!;

    expect(getActiveSessionId()).toBe(activeId);
    expect(s.selectedDocumentId).toBe("doc-legacy");
    expect(s.messages.map((m) => m.content)).toEqual(["legacy prompt"]);
    expect(s.draftCards).toHaveLength(1);
    expect(s.title).toBe("legacy prompt");
    // Legacy key preserved (read-only migration).
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.state)).not.toBeNull();
  });

  it("malformed legacy blob falls back to an empty session without throwing", () => {
    localStorage.setItem(LEGACY_STORAGE_KEYS.state, "}{not json");
    const activeId = migrateLegacyState();
    expect(getSession(activeId)?.messages).toEqual([]);
    expect(getSession(activeId)?.draftCards).toEqual([]);
  });

  it("no legacy data → fresh empty active session", () => {
    const activeId = migrateLegacyState();
    expect(getSession(activeId)).not.toBeNull();
    expect(getSession(activeId)?.messages).toEqual([]);
  });
});

describe("active-session guard (spec: missing id → empty session)", () => {
  it("ensureActiveSession creates one when the active id is missing", () => {
    const id = ensureActiveSession();
    expect(id).toBeTruthy();
    expect(getActiveSessionId()).toBe(id);
    expect(getSession(id)?.messages).toEqual([]);
  });

  it("load effect with a stale active id still resolves to a valid session via migration", () => {
    // Simulate a stale active id pointing at nothing.
    setActiveSessionId("stale-id");
    // migrateLegacyState sees no sessions and no legacy → creates a fresh one,
    // ignoring the stale id.
    const activeId = migrateLegacyState();
    expect(activeId).not.toBe("stale-id");
    expect(getSession(activeId)).not.toBeNull();
  });
});

describe("STORAGE_KEYS shape", () => {
  it("uses the v1 keys and no longer writes the legacy state blob", () => {
    const s = createSession({ messages: [userMsg("x")] });
    saveSessions([s]);
    expect(localStorage.getItem(STORAGE_KEYS.sessions)).not.toBeNull();
    // The new save path must NOT touch the legacy state key.
    expect(localStorage.getItem(LEGACY_STORAGE_KEYS.state)).toBeNull();
  });
});
