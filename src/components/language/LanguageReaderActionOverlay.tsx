import { useEffect, useMemo, useRef, useState } from "react";
import { SentenceModePanel } from "../common/SentenceModePanel";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, dispatchLanguageHostAction, type LanguageHostActionDetail } from "../../lib/languageHost";
import { createSentenceIndexAdapter, createSentenceModeSession, moveSentence, type SentenceModeSession, type SentenceSegment } from "../../lib/languageSentenceMode";
import { createTranslationService } from "../../lib/languageTranslation";
import { replayOriginalFirst, type SentenceAudioAlignment } from "../../lib/languageAudioAlignment";
import { useTTS } from "../../hooks/useTTS";

function audioRangeFromAnchor(anchor: LanguageHostActionDetail["sourceAnchor"]): { mediaId: string; startMs: number; endMs: number; mediaFingerprint: string } | null {
  if (!anchor || (anchor.sourceType !== "audio" && anchor.sourceType !== "media" && anchor.sourceType !== "transcript")) return null;
  const locator = anchor.locator;
  if (!locator || typeof locator !== "object") return null;
  const value = locator as Record<string, unknown>;
  const mediaId = typeof value.mediaId === "string" ? value.mediaId : anchor.mediaId;
  const startMs = typeof value.startMs === "number" ? value.startMs : null;
  const endMs = typeof value.endMs === "number" ? value.endMs : null;
  if (!mediaId || startMs === null || endMs === null || endMs <= startMs) return null;
  return { mediaId, startMs, endMs, mediaFingerprint: typeof value.mediaFingerprint === "string" ? value.mediaFingerprint : anchor.contentFingerprint ?? "-" };
}

export function LanguageReaderActionOverlay() {
  const { snapshot } = useLanguageLearningHost();
  const tts = useTTS({ lang: snapshot.profile?.targetLanguage ?? "en-US" });
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [session, setSession] = useState<SentenceModeSession | null>(null);
  const [segments, setSegments] = useState<readonly SentenceSegment[]>([]);
  const [translationState, setTranslationState] = useState<"ready" | "pending" | "stale" | "offline">("ready");
  const [translation, setTranslation] = useState("");
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationService = useMemo(() => createTranslationService(), []);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (!detail || detail.hostId !== snapshot.hostId) return;
      if (detail.action === "replay") {
        const text = detail.selectedText ?? detail.source.text ?? "";
        const range = audioRangeFromAnchor(detail.sourceAnchor);
        const alignment: SentenceAudioAlignment | undefined = range ? {
          id: `${detail.source.contentId}:${detail.sourceAnchor.sourceId ?? "sentence"}`,
          profileId: snapshot.profile?.id,
          sourceType: "audio",
          sourceId: detail.source.contentId,
          sentenceId: detail.sourceAnchor.sourceId ?? "sentence",
          sourceAnchor: detail.sourceAnchor,
          sourceFingerprint: detail.source.contentFingerprint ?? detail.sourceAnchor.contentFingerprint ?? "-",
          range,
          confidence: 1,
          method: "manual",
          status: "ready",
          updatedAt: Date.now(),
        } : undefined;
        void replayOriginalFirst({
          text,
          resolution: alignment ? { kind: "original", tier: "exact", alignment } : { kind: "fallback", reason: "missing" },
          playOriginal: (resolved) => { window.dispatchEvent(new CustomEvent("plethora-language-original-audio-range", { detail: { documentId: detail.source.contentId, ...resolved.range } })); },
          speakTts: (value) => tts.speak(value),
        }).catch(() => undefined);
        return;
      }
      if (detail.action === "sentence-mode" || detail.action === "translate") setRequest(detail);
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId, tts]);

  const adapter = useMemo(() => {
    if (!request) return null;
    return createSentenceIndexAdapter("text", request.source.contentId, request.source.text ?? request.selectedText ?? "", request.source.contentFingerprint);
  }, [request]);

  useEffect(() => {
    if (!request || !adapter) {
      setSession(null);
      setSegments([]);
      setTranslation("");
      translationAbortRef.current?.abort();
      return;
    }
    let disposed = false;
    void adapter.getWindow(0, 50).then((window) => {
      if (disposed || window.length === 0) return;
      const entry = window.find((segment) => segment.text.includes(request.selectedText ?? "")) ?? window[0];
      const next = createSentenceModeSession({
        sessionId: `${snapshot.hostId}:sentence-mode:${Date.now()}`,
        source: "text",
        sourceId: request.source.contentId,
        contentFingerprint: adapter.contentFingerprint,
        entry,
        returnAnchor: { documentId: request.source.contentId, sourceId: request.source.contentId, sourceAnchor: request.sourceAnchor },
        profileId: snapshot.profile?.id,
        total: window.length,
      });
      setSegments(window);
      setSession(next);
      setTranslationState(request.action === "translate" ? "offline" : "ready");
      setTranslation("");
    });
    return () => { disposed = true; };
  }, [adapter, request, snapshot.hostId, snapshot.profile?.id]);

  if (!session || !request) return null;
  const current = segments.find((segment) => segment.identity.sentenceId === session.currentSentenceId) ?? null;
  const navigate = (offset: number) => {
    const next = segments[session.progress.current + offset];
    if (next) setSession((previous) => previous ? moveSentence(previous, next) : previous);
  };
  const revealTranslation = () => {
    if (!current || !snapshot.profile) return;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslationState("pending");
    void translationService.translate({
      text: current.text,
      sourceLanguage: snapshot.profile.targetLanguage,
      targetLanguage: snapshot.profile.baseLanguage,
      profileId: snapshot.profile.id,
      sourceFingerprint: request.source.contentFingerprint,
      sourceAnchor: {
        sourceType: (request.sourceAnchor.sourceType === "epub" || request.sourceAnchor.sourceType === "pdf" || request.sourceAnchor.sourceType === "text" || request.sourceAnchor.sourceType === "html" || request.sourceAnchor.sourceType === "markdown" || request.sourceAnchor.sourceType === "transcript" || request.sourceAnchor.sourceType === "media") ? request.sourceAnchor.sourceType : "text",
        documentId: request.sourceAnchor.documentId,
        sourceId: request.sourceAnchor.sourceId,
        contentFingerprint: request.sourceAnchor.contentFingerprint,
      },
    }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setTranslation(result.translatedText);
        setTranslationState("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTranslation("");
          setTranslationState("offline");
        }
      });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm" data-language-sentence-overlay="true">
      <SentenceModePanel
        session={session}
        sentence={current}
        translation={translation}
        translationState={translationState}
        onPrevious={() => navigate(-1)}
        onNext={() => navigate(1)}
        onPlay={() => dispatchLanguageHostAction({ action: "replay", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: current?.text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onReplay={() => dispatchLanguageHostAction({ action: "replay", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: current?.text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onRevealTranslation={revealTranslation}
        onInspectVocabulary={(text) => dispatchLanguageHostAction({ action: "open-peek", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onGrammar={(text) => dispatchLanguageHostAction({ action: "tutor", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onPractice={(text) => dispatchLanguageHostAction({ action: "practice", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onExit={() => setRequest(null)}
      />
    </div>
  );
}
