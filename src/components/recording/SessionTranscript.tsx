import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import {
  MagnifyingGlass,
  CaretDown,
  CaretUp,
  X,
  Play,
  User,
  Scroll,
  ArrowsClockwise,
  WarningCircle,
  Clock,
  Quotes,
  Cards,
  PencilSimple,
  Check,
} from "@phosphor-icons/react";
import type {
  RecordingSession,
  SessionTranscriptSegment,
  SessionSegmentPage,
  SessionSourceEvidence,
} from "../../types/recordingSession";
import type { SessionTranscriptSelectionContext } from "../../types/selection";
import {
  getSessionSegments,
  correctSessionSegment,
  updateSessionSpeaker,
} from "../../api/recordingSessions";
import { createExtract } from "../../api/extracts";
import { useToastStore, ToastType } from "../common/Toast";
import { formatTime } from "./SessionPlayer";
import { cn } from "../../utils/cn";
import { useI18n } from "../../lib/i18n";

export interface SessionTranscriptProps {
  session: RecordingSession;
  currentTimeSec?: number;
  onSeek?: (timeSec: number) => void;
  onSelectSegment?: (
    segment: SessionTranscriptSegment,
    selection?: { startUtf16: number; endUtf16: number; quote: string }
  ) => void;
  selectedSegmentKey?: string | null;
  onCreateCard?: (quote: string) => void;
  className?: string;
}

const PAGE_SIZE = 200;

export const SessionTranscript: React.FC<SessionTranscriptProps> = ({
  session,
  currentTimeSec = 0,
  onSeek,
  onSelectSegment,
  selectedSegmentKey,
  onCreateCard,
  className,
}) => {
  const { t } = useI18n();
  const [segments, setSegments] = useState<SessionTranscriptSegment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);
  const [transcriptRevision, setTranscriptRevision] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // Auto-scroll / Auto-follow state
  const [autoScroll, setAutoScroll] = useState(true);
  const [followPausedByUser, setFollowPausedByUser] = useState(false);

  // Focused / active segment
  const [activeSegmentKey, setActiveSegmentKey] = useState<string | null>(null);

  // Active extract selection and preview modal state
  const [activeSelection, setActiveSelection] = useState<{
    segment: SessionTranscriptSegment;
    startUtf16: number;
    endUtf16: number;
    quote: string;
  } | null>(null);
  const [previewExtractOpen, setPreviewExtractOpen] = useState(false);
  const [extractNote, setExtractNote] = useState("");
  const [isSavingExtract, setIsSavingExtract] = useState(false);
  const addToast = useToastStore((s) => s.addToast);

  // Segment correction editing state
  const [editingSegmentKey, setEditingSegmentKey] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const [isSavingCorrection, setIsSavingCorrection] = useState(false);

  // Refs for scroll and DOM tracking
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const isProgrammaticScrollRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 1. Initial Page Load
  const loadFirstPage = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const page: SessionSegmentPage = await getSessionSegments(session.id, {
        limit: PAGE_SIZE,
      });
      setSegments(page.items || []);
      setNextCursor(page.nextCursor);
      setTranscriptRevision(page.revision);
    } catch (err) {
      console.warn("[SessionTranscript] Failed to load segments:", err);
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  // 2. Load Next Page (Pagination)
  const loadNextPage = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page: SessionSegmentPage = await getSessionSegments(session.id, {
        cursor: nextCursor,
        limit: PAGE_SIZE,
      });
      setSegments((prev) => [...prev, ...(page.items || [])]);
      setNextCursor(page.nextCursor);
    } catch (err) {
      console.warn("[SessionTranscript] Failed to load next segment page:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [session.id, nextCursor, isLoadingMore]);

  // 3. Indexed Timed Lookup: match currentTimeSec against timed segments
  useEffect(() => {
    if (currentTimeSec === undefined || currentTimeSec < 0) return;
    const currentMs = currentTimeSec * 1000;

    // Find segment where startMs <= currentMs < endMs
    const matched = segments.find(
      (s) =>
        s.timing &&
        s.timing.kind !== "none" &&
        s.timing.startMs <= currentMs &&
        currentMs < s.timing.endMs
    );

    if (matched && matched.segmentKey !== activeSegmentKey) {
      setActiveSegmentKey(matched.segmentKey);
    }
  }, [currentTimeSec, segments, activeSegmentKey]);

  // 4. Auto-Follow Active Segment
  useEffect(() => {
    if (!autoScroll || followPausedByUser || !activeSegmentKey) return;
    const el = segmentRefs.current.get(activeSegmentKey);
    const container = containerRef.current;
    if (!el || !container) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Check if element is already within comfortable middle band (20% - 80%)
    const inBand =
      elRect.top >= containerRect.top + containerRect.height * 0.2 &&
      elRect.bottom <= containerRect.bottom - containerRect.height * 0.2;

    if (!inBand) {
      isProgrammaticScrollRef.current = true;
      const targetScrollTop =
        el.offsetTop - container.offsetTop - containerRect.height * 0.25;

      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });

      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 500);
    }
  }, [activeSegmentKey, autoScroll, followPausedByUser]);

  // 5. Handle User Scroll to pause follow & check bottom boundary for paging
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!isProgrammaticScrollRef.current) {
      // User manual scroll paused follow
      if (autoScroll && !followPausedByUser) {
        setFollowPausedByUser(true);
      }
    }

    // Check if near bottom for infinite scroll / next page
    if (
      nextCursor &&
      !isLoadingMore &&
      container.scrollHeight - container.scrollTop - container.clientHeight < 400
    ) {
      void loadNextPage();
    }
  }, [autoScroll, followPausedByUser, nextCursor, isLoadingMore, loadNextPage]);

  // 6. Search Matches Computation
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    const matches: { segmentKey: string; segmentIndex: number }[] = [];
    segments.forEach((seg, idx) => {
      if (seg.text.toLowerCase().includes(query)) {
        matches.push({ segmentKey: seg.segmentKey, segmentIndex: idx });
      }
    });
    return matches;
  }, [segments, searchQuery]);

  // Reset or constrain match index when matches change
  useEffect(() => {
    if (searchMatches.length === 0) {
      setCurrentMatchIdx(0);
    } else if (currentMatchIdx >= searchMatches.length) {
      setCurrentMatchIdx(0);
    }
  }, [searchMatches, currentMatchIdx]);

  // Navigate to match
  const scrollToMatch = useCallback(
    (index: number) => {
      if (searchMatches.length === 0) return;
      const match = searchMatches[index];
      if (!match) return;

      const el = segmentRefs.current.get(match.segmentKey);
      if (el && containerRef.current) {
        isProgrammaticScrollRef.current = true;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
        scrollTimeoutRef.current = setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 500);
      }
    },
    [searchMatches]
  );

  const nextMatch = () => {
    if (searchMatches.length === 0) return;
    const next = (currentMatchIdx + 1) % searchMatches.length;
    setCurrentMatchIdx(next);
    scrollToMatch(next);
  };

  const prevMatch = () => {
    if (searchMatches.length === 0) return;
    const prev = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
    setCurrentMatchIdx(prev);
    scrollToMatch(prev);
  };

  // 7. Click segment cue / row
  const handleSegmentClick = (segment: SessionTranscriptSegment) => {
    if (segment.timing && segment.timing.kind !== "none" && onSeek) {
      onSeek(segment.timing.startMs / 1000);
    }
    setActiveSegmentKey(segment.segmentKey);
    onSelectSegment?.(segment);
  };

  // Segment Correction Handlers
  const handleStartEdit = (segment: SessionTranscriptSegment) => {
    setEditingSegmentKey(segment.segmentKey);
    setEditingText(segment.text);
  };

  const handleCancelEdit = () => {
    setEditingSegmentKey(null);
    setEditingText("");
  };

  const handleSaveCorrection = async (segment: SessionTranscriptSegment) => {
    if (editingText.trim() === segment.text) {
      setEditingSegmentKey(null);
      return;
    }
    setIsSavingCorrection(true);
    try {
      const newRev = await correctSessionSegment(
        session.id,
        segment.segmentKey,
        transcriptRevision,
        editingText
      );
      setTranscriptRevision(newRev);
      setSegments((prev) =>
        prev.map((s) =>
          s.segmentKey === segment.segmentKey
            ? { ...s, text: editingText, revision: newRev }
            : s
        )
      );
      setEditingSegmentKey(null);
      addToast({
        type: ToastType.Success,
        title: "Transcript updated",
        message: "Transcript segment updated successfully.",
      });
    } catch (err: any) {
      if (err?.code === "StaleRevision" || err?.message?.includes("StaleRevision")) {
        addToast({
          type: ToastType.Error,
          title: "Revision Conflict",
          message: "Conflict: transcript was edited concurrently. Reloading latest transcript...",
        });
        await loadFirstPage();
      } else {
        addToast({
          type: ToastType.Error,
          title: "Correction Failed",
          message: err?.message || "Failed to update transcript segment",
        });
      }
    } finally {
      setIsSavingCorrection(false);
    }
  };

  // Speaker editing state (Task 5.2)
  const [editingSpeaker, setEditingSpeaker] = useState<{
    originalSpeakerId: string;
    newSpeakerId: string;
  } | null>(null);
  const [isSavingSpeaker, setIsSavingSpeaker] = useState(false);

  const handleStartSpeakerEdit = (speakerId: string) => {
    setEditingSpeaker({
      originalSpeakerId: speakerId,
      newSpeakerId: speakerId,
    });
  };

  const handleSaveSpeaker = async () => {
    if (!editingSpeaker) return;
    const { originalSpeakerId, newSpeakerId } = editingSpeaker;
    const trimmed = newSpeakerId.trim();
    if (!trimmed || trimmed === originalSpeakerId) {
      setEditingSpeaker(null);
      return;
    }

    setIsSavingSpeaker(true);
    try {
      await updateSessionSpeaker(session.id, originalSpeakerId, trimmed);
      setSegments((prev) =>
        prev.map((s) => (s.speakerId === originalSpeakerId ? { ...s, speakerId: trimmed } : s))
      );
      addToast({
        type: ToastType.Success,
        title: "Speaker updated",
        message: `Updated speaker label to "${trimmed}" across the session.`,
      });
      setEditingSpeaker(null);
    } catch (err: any) {
      addToast({
        type: ToastType.Error,
        title: "Speaker Update Failed",
        message: err?.message || "Failed to update speaker",
      });
    } finally {
      setIsSavingSpeaker(false);
    }
  };

  // 8. Text Selection handling
  const handleMouseUp = (segment: SessionTranscriptSegment) => {
    const windowSelection = window.getSelection();
    if (!windowSelection || windowSelection.isCollapsed) return;

    const selectedText = windowSelection.toString().trim();
    if (!selectedText) return;

    // Check if selection falls within segment
    const segmentText = segment.text;
    const startIdx = segmentText.indexOf(selectedText);
    if (startIdx !== -1) {
      // Validate exact canonical quotation
      const exactQuote = segmentText.slice(startIdx, startIdx + selectedText.length);
      if (exactQuote === selectedText) {
        // Cap quote at 8,000 UTF-16 code units per spec D5
        const boundedQuote = exactQuote.slice(0, 8000);
        const selObj = {
          segment,
          startUtf16: startIdx,
          endUtf16: startIdx + boundedQuote.length,
          quote: boundedQuote,
        };
        setActiveSelection(selObj);
        onSelectSegment?.(segment, {
          startUtf16: selObj.startUtf16,
          endUtf16: selObj.endUtf16,
          quote: selObj.quote,
        });
      }
    }
  };

  const handleSaveExtract = async () => {
    if (!activeSelection) return;
    setIsSavingExtract(true);
    try {
      const { segment, startUtf16, endUtf16, quote } = activeSelection;
      const evidence: SessionSourceEvidence = {
        version: 1,
        documentId: session.documentId,
        sessionId: session.id,
        assetId: session.mediaAssetId || undefined,
        transcriptId: segment.transcriptId,
        transcriptRevision: segment.revision,
        segmentKeys: [segment.segmentKey],
        quote,
        ranges: [{ segmentKey: segment.segmentKey, startUtf16, endUtf16 }],
        time:
          segment.timing.kind !== "none"
            ? {
                startMs: segment.timing.startMs,
                endMs: segment.timing.endMs,
                kind: segment.timing.kind,
              }
            : undefined,
        speakerId: segment.speakerId,
        markerIds: [],
        precision: "segment",
        fingerprint: quote,
      };

      const selectionContext: SessionTranscriptSelectionContext = {
        type: "session_transcript",
        documentId: session.documentId,
        sessionId: session.id,
        transcriptId: segment.transcriptId,
        transcriptRevision: segment.revision,
        segmentKeys: [segment.segmentKey],
        ranges: [{ segmentKey: segment.segmentKey, startUtf16, endUtf16 }],
        selectedText: quote,
        evidence,
      };

      await createExtract({
        document_id: session.documentId,
        content: quote,
        note: extractNote.trim() || undefined,
        selection_context: selectionContext,
      });

      addToast({
        type: ToastType.Success,
        title: t("recording.extractSavedTitle", "Extract saved"),
        message: t("recording.extractSavedMessage", "Exact transcript quote saved to extracts."),
      });
      setPreviewExtractOpen(false);
      setExtractNote("");
      setActiveSelection(null);
    } catch (err) {
      console.error("[SessionTranscript] Failed to save extract:", err);
      addToast({
        type: ToastType.Error,
        title: t("recording.extractErrorTitle", "Failed to save extract"),
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSavingExtract(false);
    }
  };

  return (
    <div
      data-testid="session-transcript"
      className={cn(
        "relative flex flex-col h-full bg-card border border-border rounded-xl shadow-sm overflow-hidden",
        className
      )}
    >
      {/* Top Bar: Search & Auto-follow controls */}
      <div className="flex items-center justify-between gap-2 p-2.5 border-b border-border bg-muted/20">
        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search transcript..."
            aria-label="Search transcript"
            className="w-full pl-8 pr-16 py-1 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {searchQuery && (
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
              {searchMatches.length > 0 && (
                <span className="text-[10px] text-muted-foreground mr-1">
                  {currentMatchIdx + 1}/{searchMatches.length}
                </span>
              )}
              <button
                type="button"
                onClick={prevMatch}
                disabled={searchMatches.length <= 1}
                aria-label="Previous match"
                className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30"
              >
                <CaretUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={nextMatch}
                disabled={searchMatches.length <= 1}
                aria-label="Next match"
                className="p-0.5 rounded hover:bg-muted text-muted-foreground disabled:opacity-30"
              >
                <CaretDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="p-0.5 rounded hover:bg-muted text-muted-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Auto-scroll toggle */}
        <div className="flex items-center gap-2">
          {followPausedByUser && autoScroll && (
            <button
              type="button"
              onClick={() => {
                setFollowPausedByUser(false);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Scroll className="w-3 h-3" />
              Resume Follow
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setAutoScroll((prev) => !prev);
              setFollowPausedByUser(false);
            }}
            title={autoScroll ? "Pause auto-scroll" : "Enable auto-scroll"}
            className={cn(
              "p-1.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors",
              autoScroll
                ? "bg-primary/10 border-primary/20 text-primary"
                : "bg-background border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Scroll className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Follow</span>
          </button>
        </div>
      </div>

      {/* Main Segment List */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label="Transcript content"
        className="flex-1 overflow-y-auto p-4 space-y-2 outline-none focus:ring-1 focus:ring-primary/20"
      >
        {isLoading && segments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-muted-foreground gap-2">
            <ArrowsClockwise className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs">Loading transcript segments...</p>
          </div>
        ) : loadError && segments.length === 0 ? (
          <div className="p-4 text-center text-destructive space-y-2">
            <WarningCircle className="w-8 h-8 mx-auto" />
            <p className="text-sm font-medium">Failed to load transcript</p>
            <p className="text-xs opacity-80">{loadError}</p>
            <button
              type="button"
              onClick={() => void loadFirstPage()}
              className="px-3 py-1 text-xs bg-secondary rounded-md text-foreground hover:bg-secondary/80"
            >
              Retry
            </button>
          </div>
        ) : segments.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No segments found in this transcript.
          </div>
        ) : (
          segments.map((seg, idx) => {
            const isTimed = seg.timing && seg.timing.kind !== "none";
            const isActive = seg.segmentKey === activeSegmentKey;
            const isSelected = seg.segmentKey === selectedSegmentKey;
            const isSearchMatch =
              searchQuery.trim().length > 0 &&
              seg.text.toLowerCase().includes(searchQuery.toLowerCase());
            const isCurrentSearchFocus =
              searchMatches[currentMatchIdx]?.segmentKey === seg.segmentKey;

            return (
              <div
                key={seg.segmentKey || `seg-${seg.ordinal}-${idx}`}
                ref={(el) => {
                  if (el) segmentRefs.current.set(seg.segmentKey, el);
                  else segmentRefs.current.delete(seg.segmentKey);
                }}
                data-testid={`segment-${seg.segmentKey}`}
                data-segment-key={seg.segmentKey}
                onClick={() => handleSegmentClick(seg)}
                onMouseUp={() => handleMouseUp(seg)}
                className={cn(
                  "group relative flex items-start gap-3 p-2.5 rounded-lg border transition-all cursor-pointer select-text",
                  isActive
                    ? "bg-primary/10 border-primary/40 shadow-xs"
                    : isSelected
                    ? "bg-secondary/60 border-secondary-foreground/20"
                    : "border-transparent hover:bg-muted/30 hover:border-border/50",
                  isCurrentSearchFocus && "ring-2 ring-amber-500/80 bg-amber-500/10",
                  !isCurrentSearchFocus && isSearchMatch && "bg-amber-500/5"
                )}
              >
                {/* Left Indicator: Speaker & Timing */}
                <div className="flex flex-col items-start gap-1 shrink-0 w-24 pt-0.5 select-none">
                  {/* Speaker (only when real) */}
                  {seg.speakerId && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartSpeakerEdit(seg.speakerId!);
                      }}
                      title="Click to rename or merge speaker"
                      aria-label={`Edit speaker ${seg.speakerId}`}
                      className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
                    >
                      <User className="w-2.5 h-2.5" />
                      {seg.speakerId}
                    </button>
                  )}

                  {/* Timing: honest - only when timed */}
                  {isTimed ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onSeek) onSeek(seg.timing.startMs / 1000);
                      }}
                      title={`Jump to ${formatTime(seg.timing.startMs / 1000)}`}
                      aria-label={`Jump to ${formatTime(seg.timing.startMs / 1000)}`}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-muted-foreground hover:text-primary transition-colors group-hover:text-foreground"
                    >
                      <Play className="w-2.5 h-2.5 opacity-60 group-hover:opacity-100" />
                      {formatTime(seg.timing.startMs / 1000)}
                    </button>
                  ) : (
                    <span
                      title="Untimed segment"
                      className="inline-flex items-center gap-1 text-[10px] font-sans text-muted-foreground/40 italic"
                    >
                      untimed
                    </span>
                  )}
                </div>

                {/* Segment Content / Editor */}
                {editingSegmentKey === seg.segmentKey ? (
                  <div
                    className="flex-1 flex flex-col gap-2"
                    onClick={(e) => e.stopPropagation()}
                    data-testid={`edit-form-${seg.segmentKey}`}
                  >
                    <textarea
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveCorrection(seg);
                        } else if (e.key === "Escape") {
                          handleCancelEdit();
                        }
                      }}
                      rows={Math.max(2, Math.ceil(editingText.length / 60))}
                      className="w-full text-sm p-2 rounded-md border border-primary/50 bg-background text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary font-sans leading-relaxed resize-y"
                      autoFocus
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground select-none">
                      <span>Ctrl+Enter to save, Esc to cancel</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSavingCorrection}
                          className="px-2.5 py-1 rounded text-xs hover:bg-muted text-muted-foreground transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSaveCorrection(seg)}
                          disabled={isSavingCorrection || editingText.trim() === seg.text}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1 transition-colors"
                        >
                          {isSavingCorrection ? (
                            <ArrowsClockwise className="w-3 h-3 animate-spin" />
                          ) : (
                            <Check className="w-3 h-3" />
                          )}
                          Save correction
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 min-w-0 text-sm leading-relaxed text-foreground flex items-start justify-between gap-2">
                    <span>{seg.text}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(seg);
                      }}
                      title="Edit transcript segment"
                      aria-label={`Edit segment ${seg.segmentKey}`}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-opacity shrink-0"
                    >
                      <PencilSimple className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Load More Button / Paging status */}
        {nextCursor && (
          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => void loadNextPage()}
              disabled={isLoadingMore}
              className="px-4 py-1.5 text-xs font-medium rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {isLoadingMore && <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />}
              {isLoadingMore ? "Loading more..." : "Load next 200 segments"}
            </button>
          </div>
        )}

        {/* Footer info: Segments loaded & revision */}
        {segments.length > 0 && (
          <div className="text-[11px] text-center text-muted-foreground/60 pt-2 select-none">
            {segments.length} segments loaded · Revision {transcriptRevision}
          </div>
        )}
      </div>

      {/* Floating Selection Toolbar */}
      {activeSelection && !previewExtractOpen && (
        <div
          data-testid="transcript-selection-toolbar"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-popover/95 border border-border px-3 py-1.5 rounded-full shadow-lg backdrop-blur-sm"
        >
          <span className="text-xs font-medium text-foreground max-w-[200px] truncate">
            "{activeSelection.quote}"
          </span>
          <div className="h-3 w-px bg-border" />
          <button
            type="button"
            onClick={() => setPreviewExtractOpen(true)}
            className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded hover:bg-primary/10"
          >
            <Quotes className="w-3.5 h-3.5" />
            <span>Save Extract</span>
          </button>
          {onCreateCard && (
            <button
              type="button"
              onClick={() => {
                onCreateCard(activeSelection.quote);
                setActiveSelection(null);
              }}
              className="flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded hover:bg-primary/10"
            >
              <Cards className="w-3.5 h-3.5" />
              <span>Make Card</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(activeSelection.quote);
              addToast({
                type: ToastType.Info,
                title: "Copied",
                message: "Text copied to clipboard.",
              });
            }}
            className="text-xs text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
            title="Copy"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => setActiveSelection(null)}
            className="text-muted-foreground hover:text-foreground p-1 rounded-full hover:bg-muted"
            title="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Save Extract Modal with exact canonical quote preview and note */}
      {previewExtractOpen && activeSelection && (
        <div
          role="dialog"
          aria-label="Save Extract Preview"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md bg-card border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <Quotes className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-sm text-foreground">Save Extract</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewExtractOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Exact Canonical Quotation (truthful, read-only) */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Exact Quote
              </label>
              <blockquote
                data-testid="extract-exact-quote"
                className="p-3 bg-muted/30 border-l-2 border-primary rounded-r text-sm text-foreground leading-relaxed italic max-h-40 overflow-y-auto"
              >
                "{activeSelection.quote}"
              </blockquote>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-muted-foreground">
                {activeSelection.segment.timing.kind !== "none" && (
                  <span>
                    {formatTime(activeSelection.segment.timing.startMs / 1000)} –{" "}
                    {formatTime(activeSelection.segment.timing.endMs / 1000)}
                  </span>
                )}
                <span>•</span>
                <span>Segment: {activeSelection.segment.segmentKey}</span>
              </div>
            </div>

            {/* Optional Note / Summary */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider block mb-1">
                Note (optional)
              </label>
              <textarea
                value={extractNote}
                onChange={(e) => setExtractNote(e.target.value)}
                placeholder="Add your reflections, context, or summary..."
                rows={3}
                className="w-full p-2.5 text-xs bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                type="button"
                onClick={() => setPreviewExtractOpen(false)}
                className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingExtract}
                onClick={handleSaveExtract}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg shadow-sm transition-colors disabled:opacity-50"
              >
                {isSavingExtract ? (
                  <ArrowsClockwise className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Quotes className="w-3.5 h-3.5" />
                )}
                <span>Save Extract</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Speaker Rename / Merge Dialog (Task 5.2) */}
      {editingSpeaker && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-card border border-border rounded-xl p-5 max-w-sm w-full shadow-lg space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Rename or Merge Speaker</h3>
              <p className="text-xs text-muted-foreground mt-1">
                Updating &ldquo;{editingSpeaker.originalSpeakerId}&rdquo; will rename it across all transcript segments in this session.
              </p>
            </div>

            <div className="space-y-1">
              <label htmlFor="speaker-name-input" className="text-xs font-medium text-foreground">
                Speaker Name
              </label>
              <input
                id="speaker-name-input"
                type="text"
                value={editingSpeaker.newSpeakerId}
                onChange={(e) =>
                  setEditingSpeaker({ ...editingSpeaker, newSpeakerId: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSaveSpeaker();
                  } else if (e.key === "Escape") {
                    setEditingSpeaker(null);
                  }
                }}
                className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setEditingSpeaker(null)}
                disabled={isSavingSpeaker}
                className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveSpeaker}
                disabled={isSavingSpeaker || !editingSpeaker.newSpeakerId.trim()}
                className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 text-xs font-medium transition-opacity"
              >
                {isSavingSpeaker ? "Saving..." : "Save Speaker"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
