import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLUSH_INTERVAL_MS } from "../useActiveTimeTracker";
import { useReadingSessionTracker } from "../useReadingSessionTracker";

/**
 * A stand-in for the backend that behaves the way the Rust side does:
 * `record_active_time` accumulates into the document's cumulative total, and
 * the summary reads that total back. That makes this an end-to-end check of
 * "read a document without rating it and its reported time goes up", rather
 * than an assertion that some function was called.
 */
const backend = vi.hoisted(() => {
  const totals = new Map<string, number>();
  const sessions = new Map<string, { documentId: string; seconds: number; ended: boolean }>();
  let nextSessionId = 1;

  return {
    totals,
    sessions,
    reset() {
      totals.clear();
      sessions.clear();
      nextSessionId = 1;
    },
    startReadingSession: vi.fn(async (documentId: string, _progressStart: number) => {
      const id = `sess-${nextSessionId++}`;
      sessions.set(id, { documentId, seconds: 0, ended: false });
      return { id, documentId, startedAt: new Date().toISOString(), durationSeconds: 0 };
    }),
    endReadingSession: vi.fn(async (sessionId: string) => {
      const session = sessions.get(sessionId);
      if (session) session.ended = true;
    }),
    getDocumentProgress: vi.fn(async () => 0),
    recordActiveTime: vi.fn(
      async (
        _itemType: string,
        itemId: string,
        _surface: string,
        activeSeconds: number,
        sessionId?: string | null,
      ) => {
        totals.set(itemId, (totals.get(itemId) ?? 0) + activeSeconds);
        if (sessionId) {
          const session = sessions.get(sessionId);
          // A closed session absorbs nothing, exactly like the SQL predicate.
          if (session && !session.ended) session.seconds += activeSeconds;
        }
      },
    ),
    getItemStatsSummary: vi.fn(async (_itemType: string, itemId: string) => ({
      totalActiveSeconds: totals.has(itemId)
        ? ({ state: "value", value: totals.get(itemId)! } as const)
        : ({ state: "untracked" } as const),
    })),
  };
});

vi.mock("../../api/position", () => ({
  startReadingSession: backend.startReadingSession,
  endReadingSession: backend.endReadingSession,
  getDocumentProgress: backend.getDocumentProgress,
}));

vi.mock("../../api/item-stats", () => ({
  recordActiveTime: backend.recordActiveTime,
  getItemStatsSummary: backend.getItemStatsSummary,
}));

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useReadingSessionTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-08-13T09:00:00Z"));
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    backend.reset();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reading a document without rating it increases its reported cumulative time", async () => {
    const { result, unmount } = renderHook(() =>
      useReadingSessionTracker({ documentId: "doc-1", isActive: true }),
    );

    await waitFor(() => expect(result.current.getSessionId()).toBe("sess-1"));

    // Before reading, the document has no recorded time at all — "not
    // recorded", not zero.
    await expect(backend.getItemStatsSummary("document", "doc-1")).resolves.toMatchObject({
      totalActiveSeconds: { state: "untracked" },
    });

    // Ten active minutes of reading, kept alive by engagement, then leave
    // without ever rating the document.
    for (let i = 0; i < 20; i += 1) {
      advance(FLUSH_INTERVAL_MS);
      act(() => {
        window.dispatchEvent(new Event("pointermove"));
      });
    }
    act(() => {
      unmount();
    });

    await waitFor(() => expect(backend.endReadingSession).toHaveBeenCalledWith("sess-1", 0));

    const summary = await backend.getItemStatsSummary("document", "doc-1");
    expect(summary.totalActiveSeconds).toEqual({ state: "value", value: 600 });
    expect(backend.sessions.get("sess-1")).toMatchObject({ seconds: 600, ended: true });
  });

  it("attributes flushes to the open session so the reader's history is one row", async () => {
    const { result, unmount } = renderHook(() =>
      useReadingSessionTracker({ documentId: "doc-1", isActive: true }),
    );
    await waitFor(() => expect(result.current.getSessionId()).toBe("sess-1"));

    advance(FLUSH_INTERVAL_MS);

    await waitFor(() =>
      expect(backend.recordActiveTime).toHaveBeenCalledWith(
        "document",
        "doc-1",
        "reader",
        30,
        "sess-1",
      ),
    );

    act(() => {
      unmount();
    });
  });

  it("accrues nothing for a document that is not the foreground one", async () => {
    renderHook(() => useReadingSessionTracker({ documentId: "doc-bg", isActive: false }));

    advance(FLUSH_INTERVAL_MS * 4);

    expect(backend.recordActiveTime).not.toHaveBeenCalled();
    expect(backend.totals.get("doc-bg")).toBeUndefined();
  });

  it("ends the previous document's session when the reader switches documents", async () => {
    const { result, rerender } = renderHook(
      ({ documentId }) => useReadingSessionTracker({ documentId, isActive: true }),
      { initialProps: { documentId: "doc-1" } },
    );
    await waitFor(() => expect(result.current.getSessionId()).toBe("sess-1"));

    advance(FLUSH_INTERVAL_MS);
    act(() => {
      rerender({ documentId: "doc-2" });
    });

    await waitFor(() => expect(backend.endReadingSession).toHaveBeenCalledWith("sess-1", 0));
    await waitFor(() => expect(result.current.getSessionId()).toBe("sess-2"));

    // The first document keeps its time; the second starts from nothing.
    expect(backend.totals.get("doc-1")).toBe(30);
    expect(backend.totals.get("doc-2")).toBeUndefined();
  });

  it("starts no session when there is no document", () => {
    renderHook(() => useReadingSessionTracker({ documentId: null, isActive: true }));

    advance(FLUSH_INTERVAL_MS * 2);

    expect(backend.startReadingSession).not.toHaveBeenCalled();
    expect(backend.recordActiveTime).not.toHaveBeenCalled();
  });
});
