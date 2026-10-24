import React, { useEffect, useState, useCallback } from "react";
import {
  ArrowLeft,
  BookOpen,
  Cards,
  ChatCircleText,
  Clock,
  Compass,
  FileText,
  Microphone,
  Quotes,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import type { RecordingSession, SessionMediaAsset } from "../../types/recordingSession";
import {
  findSessionByDocumentId,
  getRecordingAsset,
  getRecordingSession,
} from "../../api/recordingSessions";
import { getDocumentPrivacy, type DocumentPrivacyFlags } from "../../lib/documentPrivacy";
import { useTranscriptionQueueStore } from "../../stores/transcriptionQueueStore";
import { FlashcardStudioModal } from "../review/FlashcardStudioModal";
import { SessionPlayer } from "./SessionPlayer";
import { SessionTranscript } from "./SessionTranscript";
import { SessionOverview } from "./SessionOverview";
import { SessionExtracts } from "./SessionExtracts";
import { SessionFlashcards } from "./SessionFlashcards";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils/cn";

export type LearningStudioTab = "overview" | "transcript" | "extracts" | "flashcards" | "ask";

export interface LearningStudioProps {
  documentId?: string;
  documentTitle?: string;
  session?: RecordingSession;
  initialTab?: LearningStudioTab;
  initialSeekTimeSec?: number;
  initialTranscriptSegmentId?: string;
  onBack?: () => void;
  className?: string;
}

export const LearningStudio: React.FC<LearningStudioProps> = ({
  documentId,
  documentTitle,
  session: propSession,
  initialTab = "overview",
  initialSeekTimeSec = 0,
  initialTranscriptSegmentId,
  onBack,
  className,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<LearningStudioTab>(initialTab);
  const [session, setSession] = useState<RecordingSession | null>(propSession ?? null);
  const [mediaAsset, setMediaAsset] = useState<SessionMediaAsset | null>(null);
  const [privacy, setPrivacy] = useState<DocumentPrivacyFlags>({
    isLocalOnly: true,
    isAiExcluded: false,
    privacyVersion: 1,
  });
  const [isLoading, setIsLoading] = useState(!propSession);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Flashcard Studio Modal integration
  const [isStudioOpen, setIsStudioOpen] = useState(false);
  const [studioSeed, setStudioSeed] = useState<{
    key: string;
    documentId?: string | null;
    excerpt?: string;
    linkedExtractId?: string;
    resetDraftCards?: boolean;
    autoEditDraft?: boolean;
  } | null>(null);

  // Playback coordination
  const [currentTimeSec, setCurrentTimeSec] = useState<number>(initialSeekTimeSec);
  const [seekTargetSec, setSeekTargetSec] = useState<number | null>(null);
  const [seekRequestId, setSeekRequestId] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // 1. Resolve session by document ID if not provided as prop
  useEffect(() => {
    let active = true;

    async function loadSession() {
      if (propSession) {
        setSession(propSession);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setLoadError(null);
      try {
        const found = await findSessionByDocumentId(documentId);
        if (active) {
          if (found) {
            setSession(found);
          } else {
            setLoadError("No recording session found for this document.");
          }
        }
      } catch (err) {
        if (active) {
          console.warn("[LearningStudio] Failed to load session for document:", err);
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    void loadSession();

    return () => {
      active = false;
    };
  }, [documentId, propSession]);

  // 2. Load media asset if session has mediaAssetId
  useEffect(() => {
    let active = true;
    if (!session?.mediaAssetId) {
      setMediaAsset(null);
      return;
    }

    async function loadAsset() {
      try {
        if (!session) return;
        const asset = await getRecordingAsset(session.id, session.mediaAssetId!);
        if (active) {
          setMediaAsset(asset);
        }
      } catch (err) {
        if (active) {
          console.warn("[LearningStudio] Failed to load media asset:", err);
        }
      }
    }

    void loadAsset();

    return () => {
      active = false;
    };
  }, [session?.id, session?.mediaAssetId]);

  // 3. Load document privacy flags
  useEffect(() => {
    let active = true;

    async function checkPrivacy() {
      try {
        const p = await getDocumentPrivacy(documentId);
        if (active) {
          setPrivacy(p);
        }
      } catch (err) {
        console.warn("[LearningStudio] Failed to check document privacy:", err);
      }
    }

    void checkPrivacy();

    return () => {
      active = false;
    };
  }, [documentId]);

  // 4. Background queue completion notification: refresh session when transcription completes
  const sessionQueueEntry = useTranscriptionQueueStore(
    (state) =>
      state.entries.find(
        (e) =>
          (session?.id && e.sessionId === session.id) ||
          (session?.documentId && e.documentId === session.documentId)
      ) ?? (session?.documentId ? state.getEntryForDocument(session.documentId) : undefined)
  );

  useEffect(() => {
    if (session?.id && sessionQueueEntry?.status === "completed") {
      void getRecordingSession(session.id)
        .then((latest) => {
          setSession(latest);
        })
        .catch((err) => {
          console.warn("[LearningStudio] Failed to refresh completed session:", err);
        });
    }
  }, [session?.id, sessionQueueEntry?.status]);

  // Seek handler called from transcript or marker clicks
  const handleSeek = useCallback((timeSec: number) => {
    setSeekTargetSec(timeSec);
    setSeekRequestId((prev) => prev + 1);
  }, []);

  // Studio opening handler
  const handleOpenStudio = useCallback(
    (linkedExtractId?: string, excerpt?: string) => {
      setStudioSeed({
        key: `studio-${session?.id ?? "session"}-${Date.now()}`,
        documentId: session?.documentId ?? documentId ?? null,
        excerpt,
        linkedExtractId,
        resetDraftCards: false,
        autoEditDraft: true,
      });
      setIsStudioOpen(true);
    },
    [session?.id, session?.documentId, documentId]
  );

  // Loading state
  if (isLoading) {
    return (
      <div
        data-testid="learning-studio-loading"
        className="flex items-center justify-center h-full p-8 text-muted-foreground"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm font-medium">Opening Learning Studio...</p>
        </div>
      </div>
    );
  }

  // Error / missing state
  if (loadError || !session) {
    return (
      <div
        data-testid="learning-studio-error"
        className="flex flex-col items-center justify-center h-full p-8 text-center"
      >
        <WarningCircle className="w-12 h-12 text-destructive mb-3" />
        <h2 className="text-lg font-semibold text-foreground mb-1">Session Unavailable</h2>
        <p className="text-sm text-muted-foreground max-w-md mb-4">
          {loadError || "The recording session could not be located."}
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 text-sm font-medium transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Library
          </button>
        )}
      </div>
    );
  }

  const hasTranscript = session.transcriptId !== null || session.transcriptRevision > 0;

  return (
    <div
      data-testid="learning-studio"
      className={cn("flex flex-col h-full w-full bg-background overflow-hidden", className)}
    >
      {/* 1. Header Bar */}
      <header className="flex flex-col border-b border-border bg-card/60 backdrop-blur shrink-0 px-4 py-3 gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
                title="Back to library"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base font-semibold text-foreground truncate">
                  {documentTitle || (session.id ? `Recording ${session.id.slice(0, 8)}` : "Session")}
                </h1>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wider">
                  {session.contentType || "lecture"}
                </span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {session.origin}
                </span>
                {privacy.isLocalOnly && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                    title="This document is local-only. Media and text never leave this device."
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Local only
                  </span>
                )}
                {privacy.isAiExcluded && (
                  <span
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    title="AI processing is excluded for this document."
                  >
                    AI excluded
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Embedded Player */}
        <SessionPlayer
          session={session}
          mediaAsset={mediaAsset}
          initialSeekTimeSec={initialSeekTimeSec}
          seekTimeSec={seekTargetSec}
          seekRequestId={seekRequestId}
          onTimeUpdate={setCurrentTimeSec}
          onPlayStateChange={setIsPlaying}
          className="mt-1"
        />

        {/* Tab Navigation */}
        <nav
          role="tablist"
          aria-label="Learning Studio areas"
          className="flex items-center gap-1 overflow-x-auto pt-1 -mb-1 text-sm font-medium"
        >
          <button
            role="tab"
            aria-selected={activeTab === "overview"}
            onClick={() => setActiveTab("overview")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap",
              activeTab === "overview"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Compass className="w-4 h-4" />
            Overview
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "transcript"}
            onClick={() => setActiveTab("transcript")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap",
              activeTab === "transcript"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <FileText className="w-4 h-4" />
            Transcript
            {hasTranscript && (
              <span className="w-2 h-2 rounded-full bg-primary/60 inline-block" />
            )}
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "extracts"}
            onClick={() => setActiveTab("extracts")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap",
              activeTab === "extracts"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Quotes className="w-4 h-4" />
            Extracts
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "flashcards"}
            onClick={() => setActiveTab("flashcards")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap",
              activeTab === "flashcards"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Cards className="w-4 h-4" />
            Flashcards
          </button>

          <button
            role="tab"
            aria-selected={activeTab === "ask"}
            onClick={() => setActiveTab("ask")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 border-b-2 transition-colors whitespace-nowrap",
              activeTab === "ask"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <ChatCircleText className="w-4 h-4" />
            Ask Plethora
          </button>
        </nav>
      </header>

      {/* 2. Content Body Area */}
      <main className="flex-1 overflow-auto p-4 md:p-6">
        {activeTab === "overview" && (
          <div data-testid="tab-overview">
            <SessionOverview
              session={session}
              mediaAsset={mediaAsset}
              privacy={privacy}
              currentTimeSec={currentTimeSec}
              onOpenTranscript={(seekSec) => {
                if (typeof seekSec === "number") handleSeek(seekSec);
                setActiveTab("transcript");
              }}
              onOpenExtracts={() => setActiveTab("extracts")}
              onOpenFlashcards={() => setActiveTab("flashcards")}
              onSeek={handleSeek}
              onCreateManualCard={(linkedExtractId, excerpt) =>
                handleOpenStudio(linkedExtractId, excerpt)
              }
              onSessionUpdated={setSession}
            />
          </div>
        )}

        {activeTab === "transcript" && (
          <div
            data-testid="tab-transcript"
            className="max-w-4xl mx-auto h-[calc(100vh-14rem)] flex flex-col"
          >
            {hasTranscript ? (
              <SessionTranscript
                session={session}
                currentTimeSec={currentTimeSec}
                onSeek={handleSeek}
                onCreateCard={(quote) => handleOpenStudio(undefined, quote)}
                className="flex-1 min-h-0"
              />
            ) : (
              <div className="p-8 text-center bg-card border border-dashed border-border rounded-xl max-w-md mx-auto my-8">
                <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="text-sm font-semibold text-foreground mb-1">No Transcript Yet</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  Audio has been saved safely. Transcribe this session to read segments, search, and
                  extract quotes.
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === "extracts" && (
          <div data-testid="tab-extracts">
            <SessionExtracts
              session={session}
              documentId={session.documentId}
              onSeek={handleSeek}
              onOpenTranscriptAt={(timeSec) => {
                if (typeof timeSec === "number") handleSeek(timeSec);
                setActiveTab("transcript");
              }}
              onCreateCard={(linkedExtractId, excerpt) =>
                handleOpenStudio(linkedExtractId, excerpt)
              }
            />
          </div>
        )}

        {activeTab === "flashcards" && (
          <div data-testid="tab-flashcards">
            <SessionFlashcards
              session={session}
              onSeek={handleSeek}
              onCreateManualCard={(linkedExtractId, excerpt) =>
                handleOpenStudio(linkedExtractId, excerpt)
              }
            />
          </div>
        )}

        {activeTab === "ask" && (
          <div data-testid="tab-ask" className="max-w-4xl mx-auto">
            <div className="p-8 text-center bg-card border border-border rounded-xl max-w-md mx-auto my-8">
              <ChatCircleText className="w-10 h-10 text-primary mx-auto mb-3" />
              <h3 className="text-sm font-semibold text-foreground mb-1">Ask Plethora</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Ground your questions in this recording session and explore concepts with citations.
              </p>
              <div className="text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border/50">
                Session scope: Document #{(session.documentId || documentId || "").slice(0, 8)}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 3. Flashcard Studio Modal for Manual Card Authoring */}
      {isStudioOpen && (
        <FlashcardStudioModal
          isOpen={isStudioOpen}
          onClose={() => setIsStudioOpen(false)}
          seed={studioSeed}
        />
      )}
    </div>
  );
};
