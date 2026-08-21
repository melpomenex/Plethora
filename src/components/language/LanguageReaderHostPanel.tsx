import { useMemo, useState } from "react";
import { BookOpenText, GraduationCap, Lightbulb, SpeakerHigh, Translate as TranslateIcon, X } from "@phosphor-icons/react";
import { DictionaryPeek, type DictionaryPeekTarget } from "../viewer/selectionInteraction/DictionaryPeek";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import type { SourceAnchor } from "../../types/languageLexicon";
import { dispatchLanguageHostAction } from "../../lib/languageHost";
import { languageAnnotationStyleText } from "../../lib/languageHighlighting";
import { dispatchTopLanguagePracticeRecommendation } from "../../lib/languagePractice";

export interface LanguageReaderHostPanelProps {
  documentId: string;
  selectedText: string;
  sourceAnchor: SourceAnchor;
  languageModeEnabled: boolean;
  onLanguageModeChange: (enabled: boolean) => void;
  onPractice?: (text: string, anchor: SourceAnchor) => void;
}

/**
 * Small opt-in bridge between existing readers and the language services.
 * Readers retain ownership of their DOM/selection; this surface only exposes
 * source-grounded actions and can be removed without changing ordinary reading.
 */
export function LanguageReaderHostPanel({
  documentId,
  selectedText,
  sourceAnchor,
  languageModeEnabled,
  onLanguageModeChange,
  onPractice,
}: LanguageReaderHostPanelProps) {
  const { snapshot } = useLanguageLearningHost();
  const [peekOpen, setPeekOpen] = useState(false);
  const trimmedSelection = selectedText.trim();
  const canAct = snapshot.status === "ready" && trimmedSelection.length > 0;
  const profile = snapshot.profile;
  const dispatchAction = (action: "translate" | "sentence-mode" | "tutor" | "practice" | "replay" | "reading-assist", text = trimmedSelection) => {
    if (!canAct) return;
    dispatchLanguageHostAction({
      action,
      hostId: snapshot.hostId,
      source: snapshot.source,
      sourceAnchor,
      selectedText: text,
      profileId: profile?.id,
      languageTag: profile?.targetLanguage,
      origin: "reader",
    });
    if (action === "practice") onPractice?.(trimmedSelection, sourceAnchor);
  };
  const peekTarget = useMemo<DictionaryPeekTarget | null>(() => {
    if (!peekOpen || !canAct) return null;
    return {
      text: trimmedSelection,
      profileId: profile?.id,
      languageTag: profile?.targetLanguage,
      sourceAnchor,
      geometry: null,
    };
  }, [canAct, peekOpen, profile?.id, profile?.targetLanguage, sourceAnchor, trimmedSelection]);

  return (
    <>
      <style data-language-host-style>{languageAnnotationStyleText()}</style>
      <div
        className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex max-w-[min(96vw,680px)] -translate-x-1/2 items-center gap-2 rounded-lg border border-border bg-card/95 px-2.5 py-2 text-xs shadow-lg backdrop-blur"
        data-language-reader-host="true"
      >
        <BookOpenText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="max-w-[180px] truncate text-muted-foreground" title={profile?.name ?? "Language Mode"}>
          {snapshot.status === "ready" ? `${profile?.name ?? "Language Mode"} · ${profile?.targetLanguage}` : "Language Mode"}
        </span>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted"
          aria-pressed={languageModeEnabled}
          onClick={() => onLanguageModeChange(!languageModeEnabled)}
        >
          {languageModeEnabled ? "On" : "Enable"}
        </button>
        {snapshot.status === "resolving" ? (
          <span className="text-muted-foreground" role="status">Loading…</span>
        ) : snapshot.status !== "ready" ? (
          <span className="text-muted-foreground" role="status">
            {snapshot.status === "disabled" ? "Off" : snapshot.status === "unavailable" ? "No profile for this source" : "Unavailable"}
          </span>
        ) : (
          <>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-1 font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAct}
              onClick={() => setPeekOpen(true)}
              aria-label={canAct ? `Open Language Peek for ${trimmedSelection}` : "Select a word to open Language Peek"}
            >
              Peek
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAct}
              onClick={() => dispatchAction("practice")}
              aria-label={canAct ? `Practice ${trimmedSelection}` : "Select text to practice"}
            >
              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              Practice
            </button>
            <button
              type="button"
              className="hidden rounded-md border border-border px-2 py-1 font-medium hover:bg-muted md:inline-flex"
              disabled={!canAct}
              onClick={() => dispatchTopLanguagePracticeRecommendation({
                candidates: [{ id: `${snapshot.source.contentId}:${trimmedSelection}`, profileId: profile?.id ?? "", sourceType: snapshot.source.contentType, sourceId: snapshot.source.contentId, sourceFingerprint: snapshot.source.contentFingerprint ?? "", title: trimmedSelection, topics: [], coverageStatus: "pending", qualityScore: 0.5, freshnessScore: 1, lifecycle: "candidate" }],
                interests: [],
                detail: { hostId: snapshot.hostId, source: snapshot.source, sourceAnchor, profileId: profile?.id ?? "", languageTag: profile?.targetLanguage ?? "", origin: "reader" },
              })}
            >
              Recommend
            </button>
            <button
              type="button"
              className="hidden rounded-md border border-border px-2 py-1 font-medium hover:bg-muted md:inline-flex"
              disabled={!canAct}
              onClick={() => dispatchAction("sentence-mode")}
              aria-label="Open Sentence Mode"
            >
              Sentence
            </button>
            <button
              type="button"
              className="hidden rounded-md border border-border px-2 py-1 font-medium hover:bg-muted md:inline-flex"
              disabled={!canAct}
              onClick={() => dispatchAction("tutor")}
              aria-label="Ask language tutor"
            >
              Tutor
            </button>
            <button
              type="button"
              className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-muted sm:inline-flex disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAct || !snapshot.capabilities.translation.available}
              onClick={() => dispatchAction("translate")}
              aria-label="Translate selected text"
            >
              <TranslateIcon className="h-3.5 w-3.5" aria-hidden="true" />
              Translate
            </button>
            <button
              type="button"
              className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-muted sm:inline-flex disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAct || !snapshot.capabilities.originalAudio.available}
              onClick={() => dispatchAction("replay")}
              aria-label="Replay selected sentence"
            >
              <SpeakerHigh className="h-3.5 w-3.5" aria-hidden="true" />
              Replay
            </button>
            <button
              type="button"
              className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-muted sm:inline-flex disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAct || !snapshot.capabilities.tutor.available}
              onClick={() => dispatchAction("tutor")}
              aria-label="Explain selected text"
            >
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              Explain
            </button>
            <button
              type="button"
              className="hidden items-center gap-1 rounded-md border border-border px-2 py-1 font-medium hover:bg-muted sm:inline-flex disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canAct || !snapshot.capabilities.readingAssist.available}
              onClick={() => dispatchAction("reading-assist")}
              aria-label="Open reading assist"
            >
              Assist
            </button>
          </>
        )}
      </div>
      {peekTarget && (
        <DictionaryPeek
          target={peekTarget}
          documentId={documentId}
          onDismiss={() => setPeekOpen(false)}
          onReplayOriginalAudio={() => {
            dispatchLanguageHostAction({
              action: "replay",
              hostId: snapshot.hostId,
              source: snapshot.source,
              sourceAnchor,
              selectedText: trimmedSelection,
              profileId: profile?.id,
              languageTag: profile?.targetLanguage,
              origin: "reader",
            });
          }}
          aiAvailable={snapshot.capabilities.tutor.available}
          onExplain={(text) => dispatchAction("tutor", text)}
          onPractice={(text) => {
            dispatchLanguageHostAction({
              action: "practice",
              hostId: snapshot.hostId,
              source: snapshot.source,
              sourceAnchor,
              selectedText: text,
              profileId: profile?.id,
              languageTag: profile?.targetLanguage,
              origin: "reader",
            });
          }}
        />
      )}
      {peekOpen && !peekTarget && (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs shadow"
          onClick={() => setPeekOpen(false)}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Close
        </button>
      )}
    </>
  );
}
