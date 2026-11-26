import { describe, expect, it, beforeEach, vi } from "vitest";
import { useTutorSessionsStore, TUTOR_SESSION_HISTORY_LIMIT } from "../languageTutorSessionsStore";
import type { TutorSessionEntry } from "../languageTutorSessionsStore";

function makeEntry(overrides: Partial<TutorSessionEntry> = {}): Omit<TutorSessionEntry, "id" | "createdAt"> {
  return {
    profileId: "profile-1",
    mode: "explain",
    promptExcerpt: "Explain this sentence",
    responseExcerpt: "The sentence uses the subjunctive mood.",
    attribution: "grounded",
    privacyPath: "local",
    ...overrides,
  };
}

describe("languageTutorSessionsStore", () => {
  beforeEach(() => {
    useTutorSessionsStore.setState({ entries: [] });
    vi.restoreAllMocks();
  });

  it("records sessions newest-first with excerpts bounded", () => {
    const { addSession } = useTutorSessionsStore.getState();
    addSession(makeEntry({ promptExcerpt: "  short  prompt  " }));
    addSession(makeEntry({ mode: "correction", responseExcerpt: "x".repeat(600) }));
    const entries = useTutorSessionsStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]!.mode).toBe("correction");
    expect(entries[0]!.responseExcerpt.length).toBeLessThanOrEqual(400);
    expect(entries[1]!.promptExcerpt).toBe("short prompt");
    expect(entries[1]!.attribution).toBe("grounded");
  });

  it("ignores empty responses", () => {
    useTutorSessionsStore.getState().addSession(makeEntry({ responseExcerpt: "   " }));
    expect(useTutorSessionsStore.getState().entries).toHaveLength(0);
  });

  it("evicts oldest entries beyond the limit", () => {
    for (let index = 0; index < TUTOR_SESSION_HISTORY_LIMIT + 5; index += 1) {
      useTutorSessionsStore.getState().addSession(makeEntry({ mode: "explain" }));
    }
    const entries = useTutorSessionsStore.getState().entries;
    expect(entries).toHaveLength(TUTOR_SESSION_HISTORY_LIMIT);
  });

  it("deletes a single session and clears all", () => {
    const { addSession, deleteSession, clearSessions } = useTutorSessionsStore.getState();
    addSession(makeEntry({ mode: "explain" }));
    addSession(makeEntry({ mode: "translate" }));
    const [translateId, explainId] = useTutorSessionsStore.getState().entries.map((entry) => entry.id);
    deleteSession(translateId);
    expect(useTutorSessionsStore.getState().entries).toHaveLength(1);
    expect(useTutorSessionsStore.getState().entries[0]!.id).toBe(explainId);
    expect(useTutorSessionsStore.getState().entries[0]!.mode).toBe("explain");
    clearSessions();
    expect(useTutorSessionsStore.getState().entries).toHaveLength(0);
  });

  it("exports all sessions as JSON and never mutates on export", () => {
    const { addSession, exportSessions } = useTutorSessionsStore.getState();
    addSession(makeEntry({ mode: "grammar" }));
    const exported = exportSessions();
    const parsed = JSON.parse(exported) as TutorSessionEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.mode).toBe("grammar");
    expect(useTutorSessionsStore.getState().entries).toHaveLength(1);
  });
});
