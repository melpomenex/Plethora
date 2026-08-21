import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, Camera, FilmStrip, Play, Translate } from "@phosphor-icons/react";
import { DictionaryPeek, type DictionaryPeekTarget } from "../viewer/selectionInteraction/DictionaryPeek";
import { useOptionalLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { dispatchLanguageHostAction, type LanguageHostActionDetail, type LanguageHostSnapshot } from "../../lib/languageHost";
import { createLanguageMiningPayload } from "../../lib/languageMining";
import { TranscriptLanguageHighlightAdapter } from "../../lib/languageHighlighting/adapters";
import { languageVocabularyStateClass } from "../../lib/languageHighlighting";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";
import type { SourceAnchor } from "../../types/languageLexicon";
import type { TranscriptSegment } from "../media/TranscriptSync";
import { createVideoLanguageSession, currentVideoSentence, selectVideoSentence } from "../../lib/languageVideo";
import { createTranslationService } from "../../lib/languageTranslation";
import { replayOriginalFirst } from "../../lib/languageAudioAlignment";
import { useTTS } from "../../hooks/useTTS";

interface LanguageVideoHostProps {
  videoId: string;
  documentId?: string;
  sourceFingerprint: string;
  segments: readonly TranscriptSegment[];
  currentTime: number;
  onSeek: (time: number, endTime?: number) => void;
}

function transcriptAnchor(videoId: string, segment: TranscriptSegment, sourceFingerprint: string): SourceAnchor {
  return {
    sourceType: "transcript",
    mediaId: videoId,
    sourceId: `${videoId}:${segment.id}`,
    contentFingerprint: sourceFingerprint,
    locator: { segmentId: segment.id, startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000) },
  };
}

/**
 * Video-specific language controls. It is deliberately a sibling of the
 * player/transcript controls: the YouTube player remains the only clock,
 * seek owner, and progress persistence path.
 */
export function LanguageVideoHost(props: LanguageVideoHostProps) {
  const host = useOptionalLanguageLearningHost();
  if (!host) return null;
  return <LanguageVideoHostConnected {...props} snapshot={host.snapshot} />;
}

function LanguageVideoHostConnected({ videoId, documentId, sourceFingerprint, segments, currentTime, onSeek, snapshot }: LanguageVideoHostProps & { snapshot: LanguageHostSnapshot }) {
  const tts = useTTS({ lang: snapshot.profile?.targetLanguage ?? "en-US" });
  const [peekOpen, setPeekOpen] = useState(false);
  const [states, setStates] = useState<ReadonlyMap<string, LanguageKnowledgeState>>(new Map());
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const [subtitleMode, setSubtitleMode] = useState<"target" | "base" | "dual">("target");
  const [translation, setTranslation] = useState("");
  const [translationState, setTranslationState] = useState<"idle" | "pending" | "ready" | "offline">("idle");
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationService = useMemo(() => createTranslationService(), []);

  const session = useMemo(() => createVideoLanguageSession({
    sessionId: `${snapshot.hostId}:video-language`,
    videoId,
    profileId: snapshot.profile?.id,
    sourceFingerprint,
    sentences: segments.map((segment) => ({
      id: segment.id,
      text: segment.text,
      startMs: segment.start * 1000,
      endMs: segment.end * 1000,
      sourceAnchor: transcriptAnchor(videoId, segment, sourceFingerprint),
      tokens: [],
    })),
    subtitleMode,
    layout: "desktop",
    normalMode: snapshot.status !== "ready",
    autoPause: true,
    loopCurrent: false,
  }), [segments, snapshot.hostId, snapshot.profile?.id, snapshot.status, sourceFingerprint, subtitleMode, videoId]);

  const active = useMemo(() => {
    const candidate = session.sentences.find((sentence) => currentTime * 1000 >= sentence.startMs && currentTime * 1000 < sentence.endMs)
      ?? session.sentences.at(-1)
      ?? null;
    return candidate ? currentVideoSentence(selectVideoSentence(session, candidate.id)) : null;
  }, [currentTime, session]);

  const adapter = useMemo(() => new TranscriptLanguageHighlightAdapter(videoId, session.sentences.map((sentence) => ({
    id: sentence.id,
    text: sentence.text,
    startMs: sentence.startMs,
    endMs: sentence.endMs,
  }))), [session.sentences, videoId]);

  useEffect(() => {
    let disposed = false;
    if (snapshot.status !== "ready" || !snapshot.profile || adapter.getTokenAnchors().length === 0) {
      setStates(new Map());
      setAnalysisStatus("idle");
      return () => { disposed = true; };
    }
    setAnalysisStatus("loading");
    void listLanguageLexicalEntries(snapshot.profile.id, { languageTag: snapshot.profile.targetLanguage, offset: 0, limit: 500 })
      .then((page) => {
        if (disposed) return;
        const next = new Map<string, LanguageKnowledgeState>();
        for (const entry of page.items) {
          if (entry.knowledgeState === "new" || entry.knowledgeState === "encountered" || entry.knowledgeState === "learning" || entry.knowledgeState === "familiar" || entry.knowledgeState === "known" || entry.knowledgeState === "ignored") {
            next.set(entry.normalizedForm, entry.knowledgeState);
          }
        }
        setStates(next);
        setAnalysisStatus("ready");
      })
      .catch(() => { if (!disposed) { setStates(new Map()); setAnalysisStatus("failed"); } });
    return () => { disposed = true; adapter.dispose(); };
  }, [adapter, analysisRetry, snapshot.profile, snapshot.status]);

  useEffect(() => {
    translationAbortRef.current?.abort();
    if (subtitleMode === "target" || !active || !snapshot.profile) {
      setTranslation("");
      setTranslationState("idle");
      return;
    }
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setTranslationState("pending");
    void translationService.translate({
      text: active.text,
      sourceLanguage: snapshot.profile.targetLanguage,
      targetLanguage: snapshot.profile.baseLanguage,
      profileId: snapshot.profile.id,
      sourceFingerprint,
    }, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setTranslation(result.translatedText); setTranslationState("ready"); } })
      .catch(() => { if (!controller.signal.aborted) { setTranslation(""); setTranslationState("offline"); } });
    return () => controller.abort();
  }, [active, snapshot.profile, sourceFingerprint, subtitleMode, translationService]);

  if (!active || snapshot.status !== "ready" || !snapshot.profile) return null;

  const sourceAnchor = active.sourceAnchor ?? transcriptAnchor(videoId, {
    id: active.id,
    text: active.text,
    start: active.startMs / 1000,
    end: active.endMs / 1000,
  }, sourceFingerprint);
  const source = {
    ...snapshot.source,
    contentFingerprint: sourceFingerprint,
    text: active.text,
    source: sourceAnchor,
  };
  const words = active.text.split(/(\s+)/);
  const peekTarget: DictionaryPeekTarget | null = peekOpen ? {
    text: active.text,
    profileId: snapshot.profile.id,
    languageTag: snapshot.profile.targetLanguage,
    sourceAnchor,
    geometry: null,
  } : null;
  const send = (action: LanguageHostActionDetail["action"], selectedText = active.text) => {
    dispatchLanguageHostAction({
      action,
      hostId: snapshot.hostId,
      source,
      sourceAnchor,
      selectedText,
      profileId: snapshot.profile?.id,
      languageTag: snapshot.profile?.targetLanguage,
      origin: "video",
    });
  };

  const handleMine = () => {
    const payload = createLanguageMiningPayload({
      profileId: snapshot.profile?.id,
      sourceType: "video",
      sourceId: videoId,
      documentId,
      text: active.text,
      sentenceText: active.text,
      selectedText: active.text,
      sourceAnchor,
      sourceFingerprint,
      mediaId: videoId,
      mediaStartMs: active.startMs,
      mediaEndMs: active.endMs,
      originalAudioAvailability: "available",
      translationAvailability: "missing",
      analysisAvailability: "available",
      origin: "mining",
    });
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plethora-language-mining-draft", { detail: payload }));
    send("mine");
  };
  const replayCurrent = () => {
    void replayOriginalFirst({
      text: active.text,
      resolution: {
        kind: "original",
        tier: "exact",
        alignment: {
          id: `${videoId}:${active.id}`,
          profileId: snapshot.profile.id,
          sourceType: "transcript",
          sourceId: videoId,
          sentenceId: active.id,
          sourceAnchor,
          sourceFingerprint,
          range: { mediaId: videoId, startMs: active.startMs, endMs: active.endMs, mediaFingerprint: sourceFingerprint },
          confidence: 1,
          method: "caption",
          status: "ready",
          updatedAt: Date.now(),
        },
      },
      playOriginal: () => onSeek(active.startMs / 1000, active.endMs / 1000),
      speakTts: (text) => tts.speak(text),
    });
  };

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-30 w-[min(92vw,520px)] rounded-xl border border-border bg-card/95 p-3 text-xs shadow-lg backdrop-blur" data-language-video-host="true">
      <div className="flex items-center gap-2">
        <FilmStrip className="h-4 w-4 text-primary" aria-hidden="true" />
        <span className="font-medium">Language video</span>
        <span className="text-muted-foreground">{snapshot.profile.targetLanguage}</span>
        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-primary">{active.id}</span>
      </div>
      <div className="mt-2 rounded-lg bg-muted/50 p-2 leading-relaxed" aria-live="polite">
        {words.map((word, index) => {
          const state = states.get(word.normalize("NFKC").toLocaleLowerCase());
          return word.trim() && state ? <span key={`${word}-${index}`} className={`mr-1 ${languageVocabularyStateClass(state)}`} title={state}>{word}</span> : <span key={`${word}-${index}`}>{word}</span>;
        })}
      </div>
      {analysisStatus === "failed" && <div className="mt-1 flex items-center gap-2 text-[11px] text-destructive" role="status"><span>Lexical analysis unavailable.</span><button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-muted" onClick={() => setAnalysisRetry((value) => value + 1)}>Retry</button></div>}
      {subtitleMode !== "target" && <p className="mt-1 text-[11px] text-muted-foreground" role="status">{translationState === "pending" ? "Translation loading…" : translationState === "ready" ? translation : "Base translation unavailable offline."}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 hover:bg-muted" onClick={replayCurrent}>
          <Play className="h-3.5 w-3.5" aria-hidden="true" /> Replay
        </button>
        <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-muted" onClick={() => setPeekOpen(true)}>
          <BookOpenText className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Peek
        </button>
        <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-muted" onClick={() => send("sentence-mode")}>
          Sentence
        </button>
        <button type="button" className="rounded-md border border-border px-2 py-1 hover:bg-muted" onClick={handleMine}>
          Mine
        </button>
        <label className="ml-auto inline-flex items-center gap-1 text-muted-foreground">
          <Translate className="h-3.5 w-3.5" aria-hidden="true" />
          <select aria-label="Language video subtitle mode" className="rounded border border-border bg-card px-1 py-0.5 text-foreground" value={subtitleMode} onChange={(event) => setSubtitleMode(event.target.value as typeof subtitleMode)}>
            <option value="target">Target</option>
            <option value="dual">Target + base</option>
            <option value="base">Base</option>
          </select>
        </label>
        <button type="button" className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-muted-foreground hover:bg-muted" disabled aria-label="Frame capture unavailable">
          <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Frame unavailable
        </button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">Sentence timing follows the player clock; word timing is approximate when captions do not provide it.</p>
      {peekTarget && <DictionaryPeek target={peekTarget} documentId={documentId ?? videoId} onDismiss={() => setPeekOpen(false)} onReplayOriginalAudio={replayCurrent} aiAvailable={snapshot.capabilities.tutor.available} onExplain={(text) => send("tutor", text)} onPractice={() => send("practice")} />}
    </div>
  );
}
