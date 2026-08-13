import { useCallback, useEffect, useRef } from "react";
import { endReadingSession, getDocumentProgress, startReadingSession } from "../api/position";
import { recordActiveTime } from "../api/item-stats";
import { useActiveTimeTracker, type ActiveTimeTracker } from "./useActiveTimeTracker";

/**
 * Records time spent reading a document in the Reader.
 *
 * `reading_sessions`, its commands, and its API wrappers were fully built but
 * had no call sites, so reading outside the Queue was never recorded — and the
 * `daily_reading_stats` view the streak and goals features read from was
 * therefore empty. This hook is that missing call site.
 *
 * Opening a document starts a session, active reading feeds it on the
 * tracker's cadence, and navigating away ends it. Because each flush is
 * persisted as it happens, a crash keeps the time accrued so far and never
 * adds the gap that followed.
 */

export interface UseReadingSessionTrackerOptions {
  documentId: string | null | undefined;
  /**
   * Whether this document is the foreground one. A document open in a
   * background tab must not accrue time.
   */
  isActive: boolean;
  enabled?: boolean;
}

export interface ReadingSessionTracker extends ActiveTimeTracker {
  /** The open session's id, once the backend has returned it. */
  getSessionId: () => string | null;
}

export function useReadingSessionTracker({
  documentId,
  isActive,
  enabled = true,
}: UseReadingSessionTrackerOptions): ReadingSessionTracker {
  const sessionIdRef = useRef<string | null>(null);

  const handleFlush = useCallback(
    (activeSeconds: number) => {
      if (!documentId) return;
      // Fire-and-forget: a failed flush must not interrupt reading. The
      // session id may still be in flight, in which case the accrual lands as
      // a standalone activity row rather than being lost.
      void recordActiveTime(
        "document",
        documentId,
        "reader",
        activeSeconds,
        sessionIdRef.current,
      ).catch(() => {});
    },
    [documentId],
  );

  const tracker = useActiveTimeTracker({
    isActive,
    onFlush: handleFlush,
    itemKey: documentId ?? undefined,
    enabled: enabled && Boolean(documentId),
  });

  const flush = tracker.flush;

  useEffect(() => {
    if (!enabled || !documentId) return;

    let cancelled = false;

    void (async () => {
      try {
        const progress = (await getDocumentProgress(documentId)) ?? 0;
        const session = await startReadingSession(documentId, progress);
        if (cancelled) {
          // The reader closed while the session was being created. Close it
          // immediately rather than leaving a row that startup recovery has
          // to clean up later.
          void endReadingSession(session.id, progress).catch(() => {});
          return;
        }
        sessionIdRef.current = session.id;
      } catch {
        // No session means reading still accrues to the document's total via
        // the activity log — degraded, not broken.
      }
    })();

    return () => {
      cancelled = true;
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;

      // Bank the tail before closing, so the last seconds land inside the
      // session rather than after it.
      flush();

      if (!sessionId) return;
      void (async () => {
        try {
          const progress = (await getDocumentProgress(documentId)) ?? 0;
          await endReadingSession(sessionId, progress);
        } catch {
          // Startup recovery closes it at its last heartbeat instead.
        }
      })();
    };
  }, [documentId, enabled, flush]);

  return {
    ...tracker,
    getSessionId: () => sessionIdRef.current,
  };
}
