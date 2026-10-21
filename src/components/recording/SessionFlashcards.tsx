import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cards,
  Check,
  CheckCircle,
  CircleNotch,
  Funnel,
  Plus,
  Quotes,
  Sparkle,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type {
  AcceptSessionDraftSpec,
  PersistedSessionLearningDraft,
  RecordingSession,
} from "../../types/recordingSession";
import {
  acceptSessionDrafts,
  listSessionLearningDrafts,
  rejectSessionLearningDrafts,
  updateSessionLearningDraft,
} from "../../api/recordingSessions";
import {
  buildAcceptanceInput,
  persistedDraftToStudioCard,
  studioCardToPersistedUpdate,
} from "../review/studio/sessionDraftAdapter";
import { DraftCardList } from "../review/studio/DraftCardList";
import type { DraftCard } from "../review/studio/types";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";

export interface SessionFlashcardsProps {
  session: RecordingSession;
  onSeek?: (timeSec: number) => void;
  onCreateManualCard?: (linkedExtractId?: string, excerpt?: string) => void;
  className?: string;
}

type FilterStatus = "all" | "proposed" | "accepted" | "rejected";

export const SessionFlashcards: React.FC<SessionFlashcardsProps> = ({
  session,
  onSeek,
  onCreateManualCard,
  className,
}) => {
  const { t } = useI18n();
  const [drafts, setDrafts] = useState<PersistedSessionLearningDraft[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("proposed");
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [flippedCardId, setFlippedCardId] = useState<string | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  // Load durable drafts from SQLite
  const loadDrafts = useCallback(async () => {
    if (!session.id) return;
    setIsLoading(true);
    try {
      const page = await listSessionLearningDrafts(session.id, {
        kind: "card",
        limit: 100,
      });
      setDrafts(page.items);
      setTotalCount(page.total);

      // Pre-select proposed items by default
      const proposed = new Set(
        page.items.filter((d) => d.status === "proposed").map((d) => d.id)
      );
      setSelectedIds(proposed);
    } catch (err) {
      console.warn("[SessionFlashcards] Failed to load drafts:", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to load drafts",
      });
    } finally {
      setIsLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  // Filtered list of persisted drafts
  const filteredDrafts = useMemo(() => {
    if (filterStatus === "all") return drafts;
    return drafts.filter((d) => d.status === filterStatus);
  }, [drafts, filterStatus]);

  // Map to DraftCards for presentation
  const studioCards: DraftCard[] = useMemo(() => {
    return filteredDrafts.map((d) => {
      const card = persistedDraftToStudioCard(d);
      card.selected = selectedIds.has(d.id);
      return card;
    });
  }, [filteredDrafts, selectedIds]);

  // Toggle selection
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Select all / none
  const handleSelectAll = useCallback(() => {
    const selectable = filteredDrafts.filter((d) => d.status === "proposed");
    if (selectedIds.size === selectable.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectable.map((d) => d.id)));
    }
  }, [filteredDrafts, selectedIds.size]);

  // Save inline edit to SQLite with optimistic CAS
  const handleSaveEditCard = useCallback(
    async (id: string, updates: Partial<DraftCard>) => {
      const existingDraft = drafts.find((d) => d.id === id);
      if (!existingDraft) return;

      const currentCard = persistedDraftToStudioCard(existingDraft);
      const mergedCard: DraftCard = {
        ...currentCard,
        ...updates,
        durableDraftId: existingDraft.id,
        durableRevision: existingDraft.revision,
      };

      try {
        const updateSpec = studioCardToPersistedUpdate(mergedCard);
        const updatedDraft = await updateSessionLearningDraft(updateSpec);

        setDrafts((prev) =>
          prev.map((d) => (d.id === id ? updatedDraft : d))
        );
        setEditingCardId(null);
        setFeedback({ type: "success", message: "Draft card updated" });
      } catch (err) {
        console.warn("[SessionFlashcards] CAS update failed:", err);
        setFeedback({
          type: "error",
          message: err instanceof Error ? err.message : "Failed to update draft card (revision conflict)",
        });
      }
    },
    [drafts]
  );

  // Accept selected proposed drafts atomically
  const handleAcceptSelected = useCallback(async () => {
    const draftsToAccept = drafts.filter(
      (d) => selectedIds.has(d.id) && d.status === "proposed"
    );
    if (draftsToAccept.length === 0) return;

    setIsProcessing(true);
    setFeedback(null);
    try {
      const input = buildAcceptanceInput(session.id, draftsToAccept);
      const response = await acceptSessionDrafts(input);

      if (response.acceptedCount > 0) {
        setFeedback({
          type: "success",
          message: `Accepted ${response.acceptedCount} card${
            response.acceptedCount === 1 ? "" : "s"
          } into your review library`,
        });
        await loadDrafts();
      } else {
        setFeedback({
          type: "error",
          message: "No drafts were accepted. Please check for stale revisions or conflicts.",
        });
      }
    } catch (err) {
      console.error("[SessionFlashcards] Acceptance failed:", err);
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to accept drafts",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [drafts, selectedIds, session.id, loadDrafts]);

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
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setFeedback({ type: "success", message: "Draft rejected" });
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

  const proposedCount = drafts.filter((d) => d.status === "proposed").length;
  const acceptedCount = drafts.filter((d) => d.status === "accepted").length;
  const rejectedCount = drafts.filter((d) => d.status === "rejected").length;
  const selectedCount = selectedIds.size;

  return (
    <div
      data-testid="session-flashcards"
      className={cn("max-w-4xl mx-auto space-y-4 pb-12", className)}
    >
      {/* 1. Header Toolbar */}
      <div className="flex items-center justify-between border-b border-border pb-3 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Cards className="w-5 h-5 text-primary" />
            Session Flashcards
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-suggested drafts and verified flashcards grounded in this session.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {onCreateManualCard && (
            <button
              type="button"
              onClick={() => onCreateManualCard()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-card text-xs font-medium text-foreground hover:bg-muted/70 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-primary" />
              Manual Card
            </button>
          )}

          {/* Status Filters */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-lg text-xs font-medium">
            <button
              type="button"
              onClick={() => setFilterStatus("proposed")}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors inline-flex items-center gap-1",
                filterStatus === "proposed"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Sparkle className="w-3 h-3 text-primary" />
              Proposed ({proposedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus("accepted")}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors",
                filterStatus === "accepted"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Accepted ({acceptedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus("rejected")}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors",
                filterStatus === "rejected"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Rejected ({rejectedCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterStatus("all")}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors",
                filterStatus === "all"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              All ({drafts.length})
            </button>
          </div>
        </div>
      </div>

      {/* 2. Feedback Alert */}
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

      {/* 3. Action Bar for Proposed Drafts */}
      {filterStatus === "proposed" && proposedCount > 0 && (
        <div className="flex items-center justify-between p-3 rounded-xl border border-border bg-card shadow-sm flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-primary font-medium hover:underline"
            >
              {selectedCount === proposedCount ? "Deselect All" : "Select All"}
            </button>
            <span className="text-xs text-muted-foreground">
              · {selectedCount} of {proposedCount} selected
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleAcceptSelected}
              disabled={isProcessing || selectedCount === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isProcessing ? (
                <CircleNotch className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-3.5 h-3.5" />
              )}
              Accept Selected ({selectedCount})
            </button>
          </div>
        </div>
      )}

      {/* 4. Cards List Presentation */}
      <DraftCardList
        cards={studioCards}
        flippedCardId={flippedCardId}
        onFlipCard={(id) => setFlippedCardId((curr) => (curr === id ? null : id))}
        editingCardId={editingCardId}
        onStartEditCard={(id) => setEditingCardId(id)}
        onSaveEditCard={handleSaveEditCard}
        onToggleSelectCard={filterStatus === "proposed" ? handleToggleSelect : undefined}
        onDeleteCard={filterStatus === "proposed" ? handleRejectDraft : undefined}
        emptyStateTitle={
          filterStatus === "proposed"
            ? "No Proposed Cards"
            : filterStatus === "accepted"
            ? "No Accepted Cards Yet"
            : filterStatus === "rejected"
            ? "No Rejected Cards"
            : "No Cards Found"
        }
        emptyStateHint={
          filterStatus === "proposed"
            ? "Run analysis on this session or create a manual card."
            : "Cards accepted from this session will appear here."
        }
        evidenceBadgeRenderer={(card) => {
          if (!card.sessionEvidence) return null;
          const ev = card.sessionEvidence;
          return (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground bg-muted/40 px-2 py-1 rounded border border-border/40 mt-1.5">
              <Quotes className="w-3 h-3 text-primary shrink-0" />
              <span className="truncate max-w-[280px]" title={ev.quote}>
                "{ev.quote}"
              </span>
              {ev.time && onSeek && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(ev.time!.startMs / 1000);
                  }}
                  className="ml-auto text-[10px] text-primary hover:underline shrink-0"
                >
                  Seek
                </button>
              )}
            </div>
          );
        }}
      />
    </div>
  );
};
