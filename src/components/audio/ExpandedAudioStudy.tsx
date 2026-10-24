import { lazy, Suspense, useEffect, useState } from "react";
import type { RecordingSession } from "../../types/recordingSession";
import { useAudioPlaybackStore } from "../../stores/audioPlaybackStore";
import { useI18n } from "../../lib/i18n";
import { runAudioAction } from "./audioPlayerActions";

const SessionTranscript = lazy(() =>
  import("../recording/SessionTranscript").then(module => ({ default: module.SessionTranscript })),
);
const SessionExtracts = lazy(() =>
  import("../recording/SessionExtracts").then(module => ({ default: module.SessionExtracts })),
);
const SessionFlashcards = lazy(() =>
  import("../recording/SessionFlashcards").then(module => ({ default: module.SessionFlashcards })),
);

type StudyTab = "transcript" | "extracts" | "flashcards";
const STUDY_TABS: StudyTab[] = ["transcript", "extracts", "flashcards"];

function openStudioDocument(documentId: string | undefined): void {
  if (!documentId) return;
  void Promise.all([
    import("../../utils/openDocumentAtLocation"),
    import("../../stores/tabsStore"),
  ]).then(([{ openDocumentAtLocation }, { useTabsStore }]) =>
    openDocumentAtLocation(documentId, {}, useTabsStore.getState().addTab),
  );
}

/**
 * Lazy, bounded continuation of the recording learning surface inside the
 * expanded player. Transcript pages stay at the existing 200-segment bound and
 * no reader/studio tree is mounted until the section is opened.
 */
export function ExpandedAudioStudy({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [session, setSession] = useState<RecordingSession | null>(null);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<StudyTab>("transcript");
  const currentTimeSec = useAudioPlaybackStore(state => state.snapshot?.positionSec ?? 0);

  useEffect(() => {
    let active = true;
    setSession(null);
    setError(false);
    void import("../../api/recordingSessions")
      .then(api => api.getRecordingSession(sessionId))
      .then(next => {
        if (active) setSession(next);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  const seek = (seconds: number) => {
    if (!Number.isFinite(seconds)) return;
    void runAudioAction(owner => owner.seekTo(Math.max(0, seconds)));
  };

  const labels: Record<StudyTab, string> = {
    transcript: t("audio.transcript"),
    extracts: t("audio.extracts"),
    flashcards: t("audio.flashcards"),
  };

  return (
    <section className="flex flex-col gap-3 border-t border-outline-variant pt-4" aria-label={t("audio.study")}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={t("audio.study")}>
        {STUDY_TABS.map(entry => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={tab === entry}
            className={`md-focus-ring min-h-12 rounded-full px-4 text-sm ${tab === entry ? "bg-secondary-container text-on-secondary-container" : "border border-outline"}`}
            onClick={() => setTab(entry)}
          >
            {labels[entry]}
          </button>
        ))}
      </div>
      {error ? (
        <p role="status" className="text-sm text-error">
          {t("audio.studyLoadError")}
        </p>
      ) : !session ? (
        <p className="text-sm text-on-surface-variant" role="status">
          {t("audio.loading")}
        </p>
      ) : (
        <Suspense fallback={null}>
          <div role="tabpanel" className="min-h-0">
            {tab === "transcript" && (
              <SessionTranscript
                session={session}
                currentTimeSec={currentTimeSec}
                onSeek={seek}
                onCreateCard={() => openStudioDocument(session.documentId)}
                className="max-h-[50vh] overflow-y-auto"
              />
            )}
            {tab === "extracts" && (
              <SessionExtracts
                session={session}
                onSeek={seek}
                onOpenTranscriptAt={() => setTab("transcript")}
                onCreateCard={() => openStudioDocument(session.documentId)}
                className="max-h-[50vh] overflow-y-auto"
              />
            )}
            {tab === "flashcards" && (
              <SessionFlashcards
                session={session}
                onSeek={seek}
                onCreateManualCard={() => openStudioDocument(session.documentId)}
                className="max-h-[50vh] overflow-y-auto"
              />
            )}
          </div>
        </Suspense>
      )}
    </section>
  );
}
