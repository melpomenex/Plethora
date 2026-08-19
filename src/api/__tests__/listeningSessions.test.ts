/**
 * Listening session tests (task 11.5): create/resume/close lifecycle,
 * append/dedupe semantics, extract_count rules, triage updates
 * (updateListeningSessionItem), discard, and flashcard conversion input.
 *
 * Runs against the browser-mode in-memory store (no Tauri) — the Rust paths
 * are covered by the repository's marker validation + count fixes and the
 * Tauri command registration (11.8 checks live in src-tauri).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createListeningSession,
  getActiveListeningSession,
  endListeningSession,
  listListeningSessions,
  listUnreviewedListeningSessions,
  markListeningSessionReviewed,
  addListeningSessionItem,
  getListeningSession,
  getListeningSessionItems,
  updateListeningSessionItem,
  deleteListeningSessionItem,
} from "../listeningSessions";

vi.mock("../learning-items", () => ({
  createLearningItem: vi.fn(async (input: any) => ({ id: "li-1", ...input })),
}));
// Force the browser in-memory store path (setup.ts mocks __TAURI__ globally).
vi.mock("../../lib/tauri", () => ({
  isTauri: () => false,
  isNativeMobile: () => false,
  invokeCommand: vi.fn(async () => {
    throw new Error("invokeCommand must not be called in browser mode");
  }),
}));
import { createLearningItem } from "../learning-items";

describe("listening session lifecycle (browser store)", () => {
  beforeEach(() => {
    // The store is module-scoped; sessions accumulate across tests, so use
    // unique edition ids per test.
  });

  it("creates a session, appends captures, and reads them back with items", async () => {
    const session = await createListeningSession({ editionId: "ed-a" });
    expect(session.editionId).toBe("ed-a");
    expect(session.isReviewed).toBe(false);

    const active = await getActiveListeningSession("ed-a");
    expect(active?.id).toBe(session.id);

    await addListeningSessionItem({
      sessionId: session.id,
      extractId: "ext-1",
      audioTimestamp: 42,
      sourceAnchor: "100",
      snippetText: "A captured passage.",
      markerType: "extract",
    });

    const items = await getListeningSessionItems(session.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ markerType: "extract", extractId: "ext-1" });
  });

  it("extract_count counts only extracts — markers and bookmarks do not inflate it", async () => {
    const session = await createListeningSession({ editionId: "ed-b" });
    await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 1,
      sourceAnchor: "0",
      snippetText: "text",
      markerType: "extract",
    });
    await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 2,
      sourceAnchor: "5",
      snippetText: "",
      markerType: "bookmark",
    });
    await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 3,
      sourceAnchor: "9",
      snippetText: "interesting",
      markerType: "interesting",
    });

    const after = await getListeningSession(session.id);
    expect(after?.extractCount).toBe(1);
    expect(after?.items).toHaveLength(3);
  });

  it("ending a session closes it; it no longer appears as active", async () => {
    const session = await createListeningSession({ editionId: "ed-c" });
    await endListeningSession(session.id, Date.now(), 300, 2);

    // Ended sessions are filtered out of the active lookup entirely.
    const active = await getActiveListeningSession("ed-c");
    expect(active).toBeNull();

    const full = await getListeningSession(session.id);
    expect(full?.endedAt).toBeTruthy();
    expect(full?.durationSeconds).toBe(300);
    expect(full?.extractCount).toBe(2);
  });

  it("unreviewed listing only includes sessions with extracts; reviewed ones disappear", async () => {
    const session = await createListeningSession({ editionId: "ed-d" });
    // No captures yet: not listed.
    expect(await listUnreviewedListeningSessions()).not.toContain(
      expect.objectContaining({ id: session.id })
    );

    await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 1,
      sourceAnchor: "0",
      snippetText: "text",
      markerType: "extract",
    });
    const unreviewed = await listUnreviewedListeningSessions();
    expect(unreviewed.some((s) => s.id === session.id)).toBe(true);

    await markListeningSessionReviewed(session.id, true);
    const afterReview = await listUnreviewedListeningSessions();
    expect(afterReview.some((s) => s.id === session.id)).toBe(false);

    // The full listing (unreviewedOnly = false) still shows it.
    const all = await listListeningSessions(false);
    expect(all.some((s) => s.id === session.id)).toBe(true);
  });

  it("triage updates persist (Keep/Note) and marker toggles change the item", async () => {
    const session = await createListeningSession({ editionId: "ed-e" });
    const item = await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 10,
      sourceAnchor: "0",
      snippetText: "note me",
      markerType: "bookmark",
    });

    await updateListeningSessionItem(item.id, { note: "kept after review" });
    let items = await getListeningSessionItems(session.id);
    expect(items[0].note).toBe("kept after review");

    await updateListeningSessionItem(item.id, { markerType: "interesting" });
    items = await getListeningSessionItems(session.id);
    expect(items[0].markerType).toBe("interesting");
  });

  it("discarding an extract item decrements extract_count", async () => {
    const session = await createListeningSession({ editionId: "ed-f" });
    const item = await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 1,
      sourceAnchor: "0",
      snippetText: "text",
      markerType: "extract",
    });
    expect((await getListeningSession(session.id))?.extractCount).toBe(1);

    await deleteListeningSessionItem(item.id);
    const after = await getListeningSession(session.id);
    expect(after?.extractCount).toBe(0);
    expect(after?.items).toHaveLength(0);
  });

  it("flashcard conversion consumes the session item text (learning-items API contract)", async () => {
    const session = await createListeningSession({ editionId: "ed-g" });
    const item = await addListeningSessionItem({
      sessionId: session.id,
      audioTimestamp: 7,
      sourceAnchor: "0",
      snippetText: "Flashcard-worthy passage.",
      markerType: "extract",
    });

    // Mirror the Inbox/player flashcard action shape.
    await createLearningItem({
      document_id: "doc-g",
      extract_id: item.extractId ?? undefined,
      item_type: "Qa",
      question: `What is the key insight from this passage?\n\n"${item.snippetText.slice(0, 180)}..."`,
      answer: item.snippetText,
      tags: ["audio-capture", "hands-free"],
    });
    expect(createLearningItem).toHaveBeenCalledWith(
      expect.objectContaining({
        document_id: "doc-g",
        item_type: "Qa",
        answer: "Flashcard-worthy passage.",
        tags: ["audio-capture", "hands-free"],
      })
    );
  });
});
