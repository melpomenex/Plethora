import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  Quotes,
  BookOpen,
  Play,
  Cards,
  Clock,
  Sparkle,
  Check,
  Trash,
  CircleNotch,
  X,
} from "@phosphor-icons/react";
import { getExtracts, type Extract } from "../../api/extracts";
import type {
  PersistedSessionLearningDraft,
  RecordingSession,
} from "../../types/recordingSession";
import {
  acceptSessionDrafts,
  listSessionLearningDrafts,
  rejectSessionLearningDrafts,
} from "../../api/recordingSessions";
import {
  buildAcceptanceInput,
  persistedDraftToExtractDraft,
  type SessionExtractDraft,
} from "../review/studio/sessionDraftAdapter";
import { cn } from "../../utils/cn";

export interface SessionExtractsProps {
  session: RecordingSession;
  documentId?: string;
  onSeek?: (timeSec: number) => void;
  onOpenTranscriptAt?: (timeSec?: number) => void;
  onCreateCard: (linkedExtractId?: string, excerpt?: string) => void;
  className?: string;
}

export const SessionExtracts: React.FC<SessionExtractsProps> = ({
  session,
  documentId = session.documentId,
  onSeek,
  onOpenTranscriptAt,
  onCreateCard,
  className,
}) => {
  const [extracts, setExtracts] = useState<Extract[]>([]);
  const [drafts, setDrafts] = useState<PersistedSessionLearningDraft[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter] = useState<"saved" | "proposed">("saved");
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // 1. Load domain extracts
  const loadSavedExtracts = useCallback(async () => {
    if (!documentId) {
      setExtracts([]);
      return;
    }
    try {
      const list = await getExtracts(documentId);
      setExtracts(list);
    } catch (err) {
      console.warn("[SessionExtracts] Failed to load saved extracts:", err);
    }
  }, [documentId]);

  // 2. Load durable draft extracts from SQLite
  const loadDraftExtracts = useCallback(async () => {
    if (!session.id) {
      setDrafts([]);
      return;
    }
    try {
      const page = await listSessionLearningDrafts(session.id, {
        kind: "extract",
        limit: 100,
      });
      setDrafts(page.items);

      // Pre-select proposed by default
      const proposed = new Set(
        page.items.filter((d) => d.status === "proposed").map((d) => d.id)
      );
      setSelectedDraftIds(proposed);
    } catch (err) {
      console.warn("[SessionExtracts] Failed to load draft extracts:", err);
    }
  }, [session.id]);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([loadSavedExtracts(), loadDraftExtracts()]);
    setIsLoading(false);
  }, [loadSavedExtracts, loadDraftExtracts]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Map to SessionExtractDraft models
  const extractDrafts: SessionExtractDraft[] = useMemo(() => {
    return drafts
      .filter((d) => d.status === "proposed")
      .map((d) => {
        const draft = persistedDraftToExtractDraft(d);
        draft.selected = selectedDraftIds.has(d.id);
        return draft;
      });
  }, [drafts, selectedDraftIds]);

  // Toggle selection
  const handleToggleSelectDraft = useCallback((id: string) => {
    setSelectedDraftIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Select all / none
  const handleSelectAllDrafts = useCallback(() => {
    if (selectedDraftIds.size === extractDrafts.length) {
      setSelectedDraftIds(new Set());
    } else {
      setSelectedDraftIds(new Set(extractDrafts.map((d) => d.id)));
    }
  }, [extractDrafts, selectedDraftIds.size]);

  // Accept selected proposed drafts atomically
  const handleAcceptSelectedDrafts = useCallback(async () => {
    const toAccept = extractDrafts.filter((d) => selectedDraftIds.has(d.id));
    if (toAccept.length === 0) return;

    setIsProcessing(true);
    setFeedback(null);
    try {
      const input = buildAcceptanceInput(
        session.id,
        toAccept.map((d) => ({ id: d.id, revision: d.revision }))
      );
      const response = await acceptSessionDrafts(input);

      if (response.acceptedCount > 0) {
        setFeedback({
          type: "success",
          message: `Accepted ${response.acceptedCount} extract${
            response.acceptedCount === 1 ? "" : "s"
          } into library`,
        });
        await loadAll();
      } else {
        setFeedback({
          type: "error",
          message: "Failed to accept drafts. Revisions may be stale.",
        });
      }
    } catch (err) {
      console.error("[SessionExtracts] Failed to accept drafts:", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to accept extracts",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [extractDrafts, selectedDraftIds, session.id, loadAll]);

  // Reject a single draft
  const handleRejectDraft = useCallback(
    async (id: string) => {
      setIsProcessing(true);
      try {
        await rejectSessionLearningDrafts(session.id, [id]);
        setDrafts((prev) =>
          prev.map((d) =>
            d.id === id ? { ...d, status: "rejected", revision: d.revision + 1 } : d
          )
        );
        setSelectedDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setFeedback({ type: "success", message: "Extract draft rejected" });
      } catch (err) {
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to reject draft",
        });
      } finally {
        setIsProcessing(false);
      }
    },
    [session.id]
  );

  return (
    <div
      data-testid="session-extracts"
      className={cn("max-w-4xl mx-auto space-y-4 pb-8", className)}
    >
      {/* Header & Filter Tabs */}
      <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Quotes className="w-5 h-5 text-primary" />
            Session Extracts
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Exact quotations saved or proposed from this recording session.
          </p>
        </div>

        <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg text-xs font-medium">
          <button
            type="button"
            onClick={() => setActiveFilter("saved")}
            className={cn(
              "px-3 py-1 rounded-md transition-colors",
              activeFilter === "saved"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Saved ({extracts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveFilter("proposed")}
            className={cn(
              "px-3 py-1 rounded-md transition-colors inline-flex items-center gap-1",
              activeFilter === "proposed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkle className="w-3 h-3 text-primary" />
            Proposed ({extractDrafts.length})
          </button>
        </div>
      </div>

      {/* Feedback Alert */}
      {feedback && (
        <div
          className={cn(
            "p-3 rounded-xl border text-xs flex items-center justify-between gap-2",
            feedback.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          )}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="p-8 text-center text-xs text-muted-foreground">
          Loading extracts...
        </div>
      ) : activeFilter === "proposed" ? (
        extractDrafts.length === 0 ? (
          <div className="p-8 text-center bg-card border border-dashed border-border rounded-xl">
            <Sparkle className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-foreground mb-1">
              No Proposed Extracts
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              When AI analysis runs, suggested key quotes and passages will appear here for review.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Batch Action Bar */}
            <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-card shadow-sm flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllDrafts}
                  className="text-xs text-primary font-medium hover:underline"
                >
                  {selectedDraftIds.size === extractDrafts.length ? "Deselect All" : "Select All"}
                </button>
                <span className="text-xs text-muted-foreground">
                  · {selectedDraftIds.size} of {extractDrafts.length} selected
                </span>
              </div>

              <button
                type="button"
                onClick={handleAcceptSelectedDrafts}
                disabled={isProcessing || selectedDraftIds.size === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {isProcessing ? (
                  <CircleNotch className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Accept Selected ({selectedDraftIds.size})
              </button>
            </div>

            {/* Proposed Extracts List */}
            <div className="space-y-3">
              {extractDrafts.map((draft) => {
                const timeSec = draft.evidence?.time?.startMs !== undefined
                  ? draft.evidence.time.startMs / 1000
                  : undefined;
                const hasTime = typeof timeSec === "number";

                return (
                  <div
                    key={draft.id}
                    data-testid={`proposed-extract-${draft.id}`}
                    className={cn(
                      "p-4 bg-card border rounded-xl shadow-sm space-y-3 transition-colors",
                      draft.selected
                        ? "border-primary/50 ring-1 ring-primary/20"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <button
                        type="button"
                        onClick={() => handleToggleSelectDraft(draft.id)}
                        className={cn(
                          "w-5 h-5 rounded border mt-0.5 flex items-center justify-center shrink-0 transition-colors",
                          draft.selected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "border-border bg-background hover:border-primary/50"
                        )}
                      >
                        {draft.selected && <Check className="w-3.5 h-3.5" />}
                      </button>

                      <div className="flex-1 min-w-0 space-y-2">
                        <blockquote className="border-l-3 border-primary/70 pl-3 italic text-sm text-foreground leading-relaxed">
                          &ldquo;{draft.verbatimText}&rdquo;
                        </blockquote>

                        {draft.summaryNote && (
                          <div className="text-xs p-2 rounded-lg bg-muted/40 border border-border/50 text-muted-foreground">
                            <span className="font-medium text-foreground">Note: </span>
                            {draft.summaryNote}
                          </div>
                        )}

                        <div className="flex items-center justify-between flex-wrap gap-2 pt-1 text-xs">
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            {hasTime && (
                              <span className="inline-flex items-center gap-1 text-primary">
                                <Clock className="w-3 h-3" />
                                {Math.floor(timeSec / 60)}:
                                {String(Math.floor(timeSec % 60)).padStart(2, "0")}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            {hasTime && onSeek && (
                              <button
                                type="button"
                                onClick={() => onSeek(timeSec)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium transition-colors"
                              >
                                <Play className="w-3 h-3" />
                                Play
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleRejectDraft(draft.id)}
                              className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Reject draft"
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : extracts.length === 0 ? (
        <div className="p-8 text-center bg-card border border-dashed border-border rounded-xl">
          <Quotes className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground mb-1">
            No Extracts Saved Yet
          </h3>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4">
            Select text in the transcript and click &ldquo;Save Extract&rdquo; to capture exact quotations and link them to your library.
          </p>
          {onOpenTranscriptAt && (
            <button
              type="button"
              onClick={() => onOpenTranscriptAt()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Go to Transcript
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {extracts.map((extract) => {
            const timeSec = (extract.selection_context as any)?.timeSeconds;
            const hasTime = typeof timeSec === "number";

            return (
              <div
                key={extract.id}
                data-testid={`extract-item-${extract.id}`}
                className="p-4 bg-card border border-border rounded-xl shadow-sm space-y-3"
              >
                <blockquote className="border-l-3 border-primary/70 pl-3 italic text-sm text-foreground leading-relaxed">
                  &ldquo;{extract.content}&rdquo;
                </blockquote>

                {extract.notes && (
                  <div className="text-xs p-2.5 rounded-lg bg-muted/40 border border-border/50 text-muted-foreground">
                    <span className="font-medium text-foreground">Note: </span>
                    {extract.notes}
                  </div>
                )}

                <div className="flex items-center justify-between flex-wrap gap-2 pt-1 border-t border-border/40 text-xs">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>
                      Saved {new Date(extract.date_created).toLocaleDateString()}
                    </span>
                    {hasTime && (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <Clock className="w-3 h-3" />
                        {Math.floor(timeSec / 60)}:
                        {String(Math.floor(timeSec % 60)).padStart(2, "0")}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {hasTime && onSeek && (
                      <button
                        type="button"
                        onClick={() => onSeek(timeSec)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        Play
                      </button>
                    )}
                    {onOpenTranscriptAt && (
                      <button
                        type="button"
                        onClick={() => onOpenTranscriptAt(hasTime ? timeSec : undefined)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-border hover:bg-muted font-medium transition-colors text-foreground"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        In Transcript
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onCreateCard(extract.id, extract.content)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 font-medium transition-opacity"
                    >
                      <Cards className="w-3 h-3" />
                      Create Flashcard
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
