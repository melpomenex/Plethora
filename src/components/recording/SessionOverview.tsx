import React, { useEffect, useState, useCallback, useMemo } from "react";
import {
  CheckCircle,
  WarningCircle,
  Clock,
  ArrowClockwise,
  Gear,
  BookOpen,
  Quotes,
  Cards,
  DownloadSimple,
  Play,
  ShieldCheck,
  Cpu,
  Stop,
  ListBullets,
  Lightbulb,
  TreeStructure,
  CheckSquare,
  Trash,
} from "@phosphor-icons/react";
import type { RecordingSession, SessionMediaAsset } from "../../types/recordingSession";
import type { DocumentPrivacyFlags } from "../../lib/documentPrivacy";
import type { SessionOverviewAnalysisResult } from "../../lib/ai/schemas/sessionAnalysis";
import { getExtracts, type Extract } from "../../api/extracts";
import {
  exportPartialRecording,
  deleteSessionMedia,
  deleteRecordingSession,
} from "../../api/recordingSessions";
import { useTranscriptionQueueStore } from "../../stores/transcriptionQueueStore";
import { SessionMarkers } from "./SessionMarkers";
import { SessionRelatedMaterials } from "./SessionRelatedMaterials";
import { SessionConceptRelations } from "./SessionConceptRelations";
import { isTauri } from "../../lib/tauri";
import { cn } from "../../utils/cn";

export interface SessionOverviewProps {
  session: RecordingSession;
  mediaAsset: SessionMediaAsset | null;
  privacy: DocumentPrivacyFlags;
  currentTimeSec?: number;
  onOpenTranscript: (seekTimeSec?: number) => void;
  onOpenExtracts: () => void;
  onOpenFlashcards: () => void;
  onSeek?: (timeSec: number) => void;
  onCreateManualCard: (linkedExtractId?: string, excerpt?: string) => void;
  onSessionUpdated?: (updated: RecordingSession) => void;
  onSessionDeleted?: () => void;
  className?: string;
}

export const SessionOverview: React.FC<SessionOverviewProps> = ({
  session,
  mediaAsset,
  privacy,
  currentTimeSec = 0,
  onOpenTranscript,
  onOpenExtracts,
  onOpenFlashcards,
  onSeek,
  onCreateManualCard,
  onSessionUpdated,
  onSessionDeleted,
  className,
}) => {
  const [extracts, setExtracts] = useState<Extract[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);

  // Queue store for live transcription job status
  const queueEntry = useTranscriptionQueueStore(
    (state) =>
      state.entries.find((e) => e.sessionId === session.id || e.documentId === session.documentId) ??
      (session.documentId ? state.getEntryForDocument(session.documentId) : undefined)
  );
  const cancelJob = useTranscriptionQueueStore((state) => state.cancel);
  const retryJob = useTranscriptionQueueStore((state) => state.retry);

  // Load saved extracts for this document
  useEffect(() => {
    let active = true;
    if (!session.documentId) return;

    async function loadExtracts() {
      try {
        const list = await getExtracts(session.documentId!);
        if (active) {
          setExtracts(list);
        }
      } catch (err) {
        console.warn("[SessionOverview] Failed to load extracts:", err);
      }
    }

    void loadExtracts();
    return () => {
      active = false;
    };
  }, [session.documentId]);

  const hasTranscript = session.transcriptId !== null || session.transcriptRevision > 0;
  const isTranscriptOnly = !session.mediaAssetId && !mediaAsset;

  // Open settings handler
  const handleOpenSettings = useCallback(() => {
    window.dispatchEvent(new CustomEvent("tour-open-tab-settings"));
  }, []);

  // Export audio handler
  const handleExportAudio = useCallback(async () => {
    if (!session.id) return;
    setIsExporting(true);
    setExportMessage(null);
    try {
      if (isTauri()) {
        const defaultName = `session-${session.id.slice(0, 8)}.wav`;
        // In Tauri we export partial recording
        const parts = await exportPartialRecording(session.id, defaultName);
        setExportMessage(`Exported ${parts} parts to ${defaultName}`);
      } else {
        setExportMessage("Export is supported on desktop and mobile.");
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [session.id]);

  // Deletion states
  const [isDeletingMedia, setIsDeletingMedia] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [deleteConfirmType, setDeleteConfirmType] = useState<"media" | "session" | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDeleteMedia = useCallback(async () => {
    setIsDeletingMedia(true);
    setDeleteError(null);
    try {
      const result = await deleteSessionMedia(session.id, session.version);
      setDeleteConfirmType(null);
      onSessionUpdated?.({
        ...session,
        version: result.version,
        mediaAssetId: null,
      });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete audio");
    } finally {
      setIsDeletingMedia(false);
    }
  }, [session, onSessionUpdated]);

  const handleDeleteSession = useCallback(async () => {
    setIsDeletingSession(true);
    setDeleteError(null);
    try {
      await deleteRecordingSession(session.id, session.version, true);
      setDeleteConfirmType(null);
      onSessionDeleted?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Failed to delete session");
    } finally {
      setIsDeletingSession(false);
    }
  }, [session.id, session.version, onSessionDeleted]);

  // Stage 3 transcribing state
  const isTranscribing = queueEntry?.status === "processing";
  const isTranscribePending = queueEntry?.status === "pending";
  const isTranscribeFailed = queueEntry?.status === "failed";
  const isTranscribeCancelled = queueEntry?.status === "cancelled";

  // Parse synthesized overview JSON (Screen 4)
  const overviewData = useMemo<SessionOverviewAnalysisResult | null>(() => {
    if (!session.overviewJson) return null;
    try {
      return JSON.parse(session.overviewJson) as SessionOverviewAnalysisResult;
    } catch (e) {
      console.warn("[SessionOverview] Failed to parse overviewJson:", e);
      return null;
    }
  }, [session.overviewJson]);

  // Check if transcript was modified after overview synthesis
  const isOverviewStale = Boolean(
    overviewData &&
      session.overviewRevision !== null &&
      session.transcriptRevision !== null &&
      session.overviewRevision < session.transcriptRevision
  );

  return (
    <div
      data-testid="session-overview"
      className={cn("max-w-4xl mx-auto space-y-6 pb-8", className)}
    >
      {/* 1. Quick Stats Grid */}
      <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-base font-semibold text-foreground">Session Overview</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Created {new Date(session.createdAt).toLocaleDateString()}
              {session.contentType ? ` · ${session.contentType}` : ""}
              {session.origin ? ` · ${session.origin}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {mediaAsset && (
              <button
                type="button"
                onClick={handleExportAudio}
                disabled={isExporting}
                aria-label="Export audio"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors disabled:opacity-50"
              >
                <DownloadSimple className="w-3.5 h-3.5" />
                {isExporting ? "Exporting..." : "Export Audio"}
              </button>
            )}
            {mediaAsset && (
              <button
                type="button"
                onClick={() => setDeleteConfirmType("media")}
                aria-label="Delete audio"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/30 hover:bg-destructive/10 text-xs font-medium text-destructive transition-colors"
              >
                <Trash className="w-3.5 h-3.5" />
                Delete Audio
              </button>
            )}
            {hasTranscript && (
              <button
                type="button"
                onClick={() => onOpenTranscript()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:opacity-90 transition-opacity"
              >
                <BookOpen className="w-3.5 h-3.5" />
                Open Transcript
              </button>
            )}
          </div>
        </div>

        {exportMessage && (
          <div className="text-xs p-2.5 rounded-lg bg-muted border border-border/70 text-foreground">
            {exportMessage}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 pt-1">
          <div className="p-3 bg-muted/30 border border-border/50 rounded-lg">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Media Asset
            </div>
            <div className="text-sm font-semibold text-foreground mt-1 truncate">
              {isTranscriptOnly
                ? "Transcript only"
                : mediaAsset?.state === "ready"
                ? "Ready for playback"
                : session.captureState}
            </div>
          </div>

          <div className="p-3 bg-muted/30 border border-border/50 rounded-lg">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Transcript
            </div>
            <div className="text-sm font-semibold text-foreground mt-1 truncate">
              {hasTranscript ? `Ready (rev ${session.transcriptRevision})` : "Not transcribed"}
            </div>
          </div>

          <div className="p-3 bg-muted/30 border border-border/50 rounded-lg">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Saved Extracts
            </div>
            <div className="text-sm font-semibold text-foreground mt-1">
              {extracts.length} {extracts.length === 1 ? "extract" : "extracts"}
            </div>
          </div>

          <div className="p-3 bg-muted/30 border border-border/50 rounded-lg">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Privacy
            </div>
            <div className="text-sm font-semibold text-foreground mt-1 flex items-center gap-1 truncate">
              {privacy.isLocalOnly && (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  Local only
                </span>
              )}
              {privacy.isAiExcluded && (
                <span className="text-amber-600 dark:text-amber-400">
                  · AI excluded
                </span>
              )}
              {!privacy.isLocalOnly && !privacy.isAiExcluded && "Standard"}
            </div>
          </div>
        </div>
      </div>

      {/* Overview Synthesis (Screen 4: Completed Session Overview) */}
      {overviewData && (
        <div data-testid="session-overview-synthesis" className="space-y-4">
          {/* Stale Warning Banner if transcript was updated after overview */}
          {isOverviewStale && (
            <div
              role="alert"
              className="p-3 bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 rounded-xl text-xs flex items-center gap-2"
            >
              <WarningCircle className="w-4 h-4 shrink-0" />
              <span>Transcript changed; refresh summary.</span>
            </div>
          )}

          {/* AI Executive Summary */}
          {overviewData.overviewSummary && (
            <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">AI Executive Summary</h3>
                </div>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  AI Summary
                </span>
              </div>
              <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
                {overviewData.overviewSummary}
              </p>
            </div>
          )}

          {/* Section Outline & Key Takeaways */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {overviewData.outline && overviewData.outline.length > 0 && (
              <div className="p-4 bg-card border border-border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <ListBullets className="w-4 h-4 text-primary" />
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Section Outline
                  </h4>
                </div>
                <ul className="space-y-1.5 text-xs text-foreground/90 list-disc list-inside">
                  {overviewData.outline.map((item, idx) => (
                    <li key={idx} className="leading-snug">
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {overviewData.keyTakeaways && overviewData.keyTakeaways.length > 0 && (
              <div className="p-4 bg-card border border-border rounded-xl shadow-sm space-y-2">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle className="w-4 h-4 text-emerald-500" />
                  <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                    Key Takeaways
                  </h4>
                </div>
                <ul className="space-y-1.5 text-xs text-foreground/90 list-disc list-inside">
                  {overviewData.keyTakeaways.map((takeaway, idx) => (
                    <li key={idx} className="leading-snug">
                      <span>{takeaway}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Key Concepts with optional cross-session relations */}
          {overviewData.concepts && overviewData.concepts.length > 0 && (
            <SessionConceptRelations
              sessionDocumentId={session.documentId}
              concepts={overviewData.concepts}
            />
          )}

          {/* Meeting Outcomes: Decisions & Action Items */}
          {((overviewData.decisions && overviewData.decisions.length > 0) ||
            (overviewData.actionItems && overviewData.actionItems.length > 0)) && (
            <div className="p-4 bg-card border border-border rounded-xl shadow-sm space-y-3">
              <div className="flex items-center gap-2">
                <CheckSquare className="w-4 h-4 text-blue-500" />
                <h4 className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Meeting Outcomes
                </h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                {overviewData.decisions && overviewData.decisions.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Decisions:</div>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      {overviewData.decisions.map((dec, idx) => (
                        <li key={idx}>{dec}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {overviewData.actionItems && overviewData.actionItems.length > 0 && (
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">Action Items:</div>
                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                      {overviewData.actionItems.map((actItem, idx) => (
                        <li key={idx}>{actItem}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Processing Stages (Screen 3) */}
      <div
        data-testid="processing-stages"
        className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Processing Stages</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Independent stages track your session from recording to study materials.
            </p>
          </div>
          {isTranscribing && (
            <span className="inline-flex items-center gap-1 text-xs text-primary font-medium">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              Processing active
            </span>
          )}
        </div>

        <ol className="space-y-3 text-xs">
          {/* Stage 1: Saved / Imported */}
          <li className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/40">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">
                1. {session.origin !== "recorded" ? "File imported" : "Recording saved"}
              </div>
              <div className="text-muted-foreground mt-0.5">
                {isTranscriptOnly
                  ? "Transcript source safely stored"
                  : mediaAsset
                  ? `Audio asset verified (${mediaAsset.mime || "audio"}${mediaAsset.byteLength ? `, ${Math.round(mediaAsset.byteLength / 1024)} KB` : ""})`
                  : "Audio prefix safely written to disk"}
              </div>
            </div>
          </li>

          {/* Stage 2: Preparing Media */}
          <li className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/40">
            <CheckCircle
              className={cn(
                "w-4 h-4 shrink-0 mt-0.5",
                mediaAsset?.state === "ready" || isTranscriptOnly
                  ? "text-emerald-500"
                  : "text-muted-foreground"
              )}
            />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">2. Preparing media</div>
              <div className="text-muted-foreground mt-0.5">
                {isTranscriptOnly
                  ? "Bypassed (text source)"
                  : mediaAsset?.state === "ready"
                  ? "Audio probed and ready for playback"
                  : "Probing media format and duration"}
              </div>
            </div>
          </li>

          {/* Stage 3: Transcribing */}
          <li className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/40">
            {hasTranscript ? (
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            ) : isTranscribing || isTranscribePending ? (
              <div className="w-4 h-4 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0 mt-0.5" />
            ) : isTranscribeFailed ? (
              <WarningCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            ) : (
              <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-medium text-foreground">3. Transcribing</div>
                {queueEntry?.provider && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {queueEntry.provider}
                  </span>
                )}
              </div>
              <div className="text-muted-foreground mt-0.5">
                {hasTranscript
                  ? `Transcript ready (rev ${session.transcriptRevision})`
                  : isTranscribing
                  ? `Transcribing audio (${queueEntry?.progress ?? 0}% complete)... You can safely leave this screen.`
                  : isTranscribePending
                  ? "Queued for transcription..."
                  : isTranscribeFailed
                  ? `Transcription failed: ${queueEntry?.errorMessage || "Unknown error"}`
                  : isTranscribeCancelled
                  ? "Transcription cancelled"
                  : isTranscriptOnly
                  ? "Imported directly from text source"
                  : "No transcript generated yet"}
              </div>

              {/* Action remedies for transcription */}
              {isTranscribeFailed && (
                <div className="flex items-center gap-2 mt-2">
                  {queueEntry?.id && (
                    <button
                      type="button"
                      onClick={() => retryJob(queueEntry.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary text-secondary-foreground text-xs hover:bg-secondary/80 font-medium"
                    >
                      <ArrowClockwise className="w-3.5 h-3.5" />
                      Retry Transcription
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleOpenSettings}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-border text-xs hover:bg-muted font-medium"
                  >
                    <Gear className="w-3.5 h-3.5" />
                    Open Settings
                  </button>
                </div>
              )}

              {isTranscribing && queueEntry?.id && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => cancelJob(queueEntry.id)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 font-medium"
                  >
                    <Stop className="w-3.5 h-3.5" />
                    Cancel Transcription
                  </button>
                </div>
              )}

              {!hasTranscript && !queueEntry && !isTranscriptOnly && (
                <div className="flex items-center gap-2 mt-2">
                  <button
                    type="button"
                    onClick={handleOpenSettings}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-secondary text-secondary-foreground text-xs hover:bg-secondary/80 font-medium"
                  >
                    <Gear className="w-3.5 h-3.5" />
                    Configure Provider in Settings
                  </button>
                </div>
              )}
            </div>
          </li>

          {/* Stage 4: Structuring Concepts */}
          <li className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/40">
            <Cpu className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">4. Structuring concepts</div>
              <div className="text-muted-foreground mt-0.5">
                {hasTranscript
                  ? "Ready for section & concept structuring"
                  : "Awaiting transcript"}
              </div>
            </div>
          </li>

          {/* Stage 5: Study Suggestions */}
          <li className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/40">
            <Cards className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">5. Generating study suggestions</div>
              <div className="text-muted-foreground mt-0.5">
                {session.contentType === "meeting"
                  ? "Off for meetings · Enable suggestions"
                  : privacy.isAiExcluded
                  ? "Excluded by privacy policy (AI excluded)"
                  : "Manual authoring always available; AI suggestions generate on demand"}
              </div>
            </div>
          </li>

          {/* Stage 6: Ready for Review */}
          <li className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/20 border border-border/40">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground">6. Ready for study & review</div>
              <div className="text-muted-foreground mt-0.5">
                {extracts.length > 0
                  ? `${extracts.length} saved extracts available for study`
                  : "Ready for reading, highlighting extracts, and creating flashcards"}
              </div>
            </div>
          </li>
        </ol>
      </div>

      {/* 3. Available Actions */}
      <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Available Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <button
            type="button"
            onClick={() => onOpenTranscript()}
            className="flex items-start gap-3 p-3 rounded-lg border border-border/70 hover:bg-muted/40 transition-colors text-left"
          >
            <BookOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-foreground">Read & Extract</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Read transcript segments, search terms, and save exact quotations.
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => onCreateManualCard()}
            className="flex items-start gap-3 p-3 rounded-lg border border-border/70 hover:bg-muted/40 transition-colors text-left"
          >
            <Cards className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-foreground">Create Flashcard</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Author new flashcards grounded in this recording.
              </div>
            </div>
          </button>
        </div>
      </div>

      {/* 4. Saved Extracts Summary */}
      {extracts.length > 0 && (
        <div className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Quotes className="w-4 h-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">
                Saved Extracts ({extracts.length})
              </h3>
            </div>
            <button
              type="button"
              onClick={onOpenExtracts}
              className="text-xs font-medium text-primary hover:underline"
            >
              View all
            </button>
          </div>

          <div className="space-y-2">
            {extracts.slice(0, 3).map((ext) => (
              <div
                key={ext.id}
                className="p-3 rounded-lg bg-muted/20 border border-border/50 text-xs space-y-2"
              >
                <blockquote className="border-l-2 border-primary/60 pl-2 italic text-foreground">
                  “{ext.content}”
                </blockquote>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[10px] text-muted-foreground">
                    Saved {new Date(ext.date_created).toLocaleDateString()}
                  </span>
                  <div className="flex items-center gap-2">
                    {onSeek && (ext.selection_context as any)?.timeSeconds !== undefined && (
                      <button
                        type="button"
                        onClick={() => {
                          const time = (ext.selection_context as any)?.timeSeconds;
                          if (typeof time === "number") onSeek(time);
                        }}
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <Play className="w-3 h-3" />
                        Play
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onCreateManualCard(ext.id, ext.content)}
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <Cards className="w-3 h-3" />
                      Make Card
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Pinned Moments & Markers */}
      <SessionMarkers
        session={session}
        currentTimeMs={currentTimeSec * 1000}
        onSeek={onSeek}
      />

      {/* 6. Related Materials & Slides */}
      <SessionRelatedMaterials session={session} />

      {/* 7. Retention & Storage */}
      <div
        className="p-5 bg-card border border-border rounded-xl shadow-sm space-y-4"
        data-testid="retention-storage-section"
      >
        <div>
          <h3 className="text-sm font-semibold text-foreground">Retention & Storage</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Manage local audio and session data. Accepted library flashcards and extracts are preserved regardless of deletion.
          </p>
        </div>

        {deleteError && (
          <div
            className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-xs text-destructive flex items-center gap-2"
            role="alert"
          >
            <WarningCircle className="w-4 h-4 shrink-0" />
            <span>{deleteError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {mediaAsset && (
            <button
              type="button"
              onClick={() => setDeleteConfirmType("media")}
              disabled={isDeletingMedia}
              aria-label="Delete audio only"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors disabled:opacity-50"
            >
              <Trash className="w-3.5 h-3.5 text-muted-foreground" />
              Delete Audio Only (Keep Transcript)
            </button>
          )}

          <button
            type="button"
            onClick={() => setDeleteConfirmType("session")}
            disabled={isDeletingSession}
            aria-label="Delete session"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-destructive/40 bg-destructive/5 hover:bg-destructive/15 text-xs font-medium text-destructive transition-colors disabled:opacity-50"
          >
            <Trash className="w-3.5 h-3.5" />
            Delete Session
          </button>
        </div>
      </div>

      {deleteConfirmType && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full shadow-lg space-y-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold text-foreground">
                {deleteConfirmType === "media"
                  ? "Delete Audio Recording?"
                  : "Delete Recording Session?"}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {deleteConfirmType === "media"
                  ? "This will permanently remove the audio file from disk to free up space. Your transcript, summary, extracts, and cards will be preserved."
                  : "This will permanently remove this recording session and its audio. Any cards and extracts saved to your library will NOT be deleted."}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteConfirmType(null);
                  setDeleteError(null);
                }}
                disabled={isDeletingMedia || isDeletingSession}
                className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={deleteConfirmType === "media" ? handleDeleteMedia : handleDeleteSession}
                disabled={isDeletingMedia || isDeletingSession}
                className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground hover:opacity-90 text-xs font-medium transition-opacity"
              >
                {deleteConfirmType === "media"
                  ? isDeletingMedia
                    ? "Deleting..."
                    : "Confirm Delete Audio"
                  : isDeletingSession
                  ? "Deleting..."
                  : "Confirm Delete Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
