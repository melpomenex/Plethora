import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowsClockwise,
  BookOpenText,
  Camera,
  CaretDown,
  CaretUp,
  ChatsCircle,
  FilmStrip,
  Pause,
  Play,
  SlidersHorizontal,
  Translate,
  X,
} from "@phosphor-icons/react";
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
import { createVideoLanguageSession, currentVideoSentence, selectVideoSentence, supportsVideoLayout, type VideoLanguageLayout, type VideoSubtitleMode } from "../../lib/languageVideo";
import { createTranslationService } from "../../lib/languageTranslation";
import { replayOriginalFirst, sharedAudioAlignmentRegistry } from "../../lib/languageAudioAlignment";
import { useTTS } from "../../hooks/useTTS";
import {
  createDefaultLanguageProcessingRegistry,
  isLexicalToken,
  normalizeForLookup,
  tokenKind,
  wordSegments,
} from "../../lib/languageProcessing";

export interface LanguageVideoHostProps {
  videoId: string;
  documentId?: string;
  sourceFingerprint: string;
  segments: readonly TranscriptSegment[];
  currentTime: number;
  onSeek: (time: number, endTime?: number) => void;
  onPause?: () => void;
  onPlaybackRateChange?: (rate: number) => void;
  playbackRate?: number;
  onCaptureFrame?: () => Promise<string | null>;
  frameCaptureAvailable?: boolean;
}

interface SubtitleToken {
  start: number;
  end: number;
  surface: string;
  normalized: string;
  lemma?: string;
  partOfSpeech?: string;
  confidence?: number;
  isLexical: boolean;
}

interface LexiconStateIndex {
  exact: ReadonlyMap<string, LanguageKnowledgeState>;
  lemma: ReadonlyMap<string, LanguageKnowledgeState>;
}

interface CapturedFrameState {
  dataUrl: string;
  timestampMs: number;
}

const SPEED_OPTIONS = [0.75, 0.85, 1, 1.25] as const;
const LEXICON_PAGE_LIMIT = 500;
const EMPTY_LEXICON: LexiconStateIndex = { exact: new Map(), lemma: new Map() };

function normalizeLexiconKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function isValidKnowledgeState(value: unknown): value is LanguageKnowledgeState {
  return (
    value === "new" ||
    value === "encountered" ||
    value === "learning" ||
    value === "familiar" ||
    value === "known" ||
    value === "ignored"
  );
}

function buildSyncSubtitleTokens(text: string, languageTag: string): SubtitleToken[] {
  return wordSegments(text, languageTag).map((seg) => {
    const kind = tokenKind(seg.segment, seg.isWordLike);
    return {
      start: seg.start,
      end: seg.end,
      surface: seg.segment,
      normalized: normalizeForLookup(seg.segment, languageTag),
      isLexical: isLexicalToken(kind, seg.segment),
    };
  });
}

function resolveTokenKnowledgeState(token: SubtitleToken, lexicon: LexiconStateIndex): LanguageKnowledgeState | undefined {
  const normalizedKey = normalizeLexiconKey(token.normalized);
  const surfaceKey = normalizeLexiconKey(token.surface);
  const lemmaKey = token.lemma ? normalizeLexiconKey(token.lemma) : undefined;
  return (
    lexicon.exact.get(normalizedKey) ??
    lexicon.exact.get(surfaceKey) ??
    (lemmaKey ? lexicon.exact.get(lemmaKey) : undefined) ??
    (lemmaKey ? lexicon.lemma.get(lemmaKey) : undefined) ??
    lexicon.lemma.get(normalizedKey) ??
    lexicon.lemma.get(surfaceKey)
  );
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
 * player/transcript controls: the player remains the clock owner while this
 * host layers tokenization, word Peek, looping, auto-pause, speed, and mining.
 */
export function LanguageVideoHost(props: LanguageVideoHostProps) {
  const host = useOptionalLanguageLearningHost();
  if (!host) return null;
  return <LanguageVideoHostConnected {...props} snapshot={host.snapshot} />;
}

function LanguageVideoHostConnected({
  videoId,
  documentId,
  sourceFingerprint,
  segments,
  currentTime,
  onSeek,
  onPause,
  onPlaybackRateChange,
  playbackRate,
  onCaptureFrame,
  frameCaptureAvailable,
  snapshot,
}: LanguageVideoHostProps & { snapshot: LanguageHostSnapshot }) {
  const targetLanguage = snapshot.profile?.targetLanguage ?? "en-US";
  const tts = useTTS({ lang: targetLanguage });
  const [peekOpen, setPeekOpen] = useState(false);
  const [selectedToken, setSelectedToken] = useState<SubtitleToken | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [loopCurrent, setLoopCurrent] = useState(false);
  const [autoPause, setAutoPause] = useState(false);
  const [speedValue, setSpeedValue] = useState<number>(() => playbackRate ?? 1);
  const [lexicon, setLexicon] = useState<LexiconStateIndex>(EMPTY_LEXICON);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle");
  const [analysisRetry, setAnalysisRetry] = useState(0);
  const [subtitleMode, setSubtitleMode] = useState<VideoSubtitleMode>("target");
  const [translation, setTranslation] = useState("");
  const [translationState, setTranslationState] = useState<"idle" | "pending" | "ready" | "offline">("idle");
  const [translationRetry, setTranslationRetry] = useState(0);
  const [translationRevealed, setTranslationRevealed] = useState(false);
  const [analyzedTokens, setAnalyzedTokens] = useState<SubtitleToken[] | null>(null);
  const [capturedFrame, setCapturedFrame] = useState<CapturedFrameState | null>(null);
  const [capturingFrame, setCapturingFrame] = useState(false);
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationService = useMemo(() => createTranslationService(), []);
  const processingRegistry = useMemo(() => createDefaultLanguageProcessingRegistry(), []);

  useEffect(() => {
    if (typeof playbackRate === "number" && Number.isFinite(playbackRate) && playbackRate > 0) {
      setSpeedValue(playbackRate);
    }
  }, [playbackRate]);

  const layout: VideoLanguageLayout =
    typeof document !== "undefined" && document.documentElement?.dataset?.theme === "eink"
      ? "e-ink"
      : "desktop";
  const reducedMotion =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false;
  const videoLayoutSupported = supportsVideoLayout(layout, reducedMotion);

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
    layout,
    normalMode: snapshot.status !== "ready" || !videoLayoutSupported,
    autoPause,
    loopCurrent,
  }), [autoPause, layout, loopCurrent, segments, snapshot.hostId, snapshot.profile?.id, snapshot.status, sourceFingerprint, subtitleMode, videoId, videoLayoutSupported]);

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
      setLexicon(EMPTY_LEXICON);
      setAnalysisStatus("idle");
      return () => { disposed = true; };
    }
    const profileId = snapshot.profile.id;
    const languageTag = snapshot.profile.targetLanguage;
    setAnalysisStatus("loading");

    void (async () => {
      try {
        const exact = new Map<string, LanguageKnowledgeState>();
        const lemma = new Map<string, LanguageKnowledgeState>();
        let offset = 0;
        let hasMore = true;

        while (hasMore && !disposed) {
          const page = await listLanguageLexicalEntries(profileId, {
            languageTag,
            offset,
            limit: LEXICON_PAGE_LIMIT,
          });
          if (disposed) return;

          for (const entry of page.items) {
            if (!isValidKnowledgeState(entry.knowledgeState)) continue;
            exact.set(normalizeLexiconKey(entry.normalizedForm), entry.knowledgeState);
            if (entry.lemma) {
              const lemmaKey = normalizeLexiconKey(entry.lemma);
              if (!lemma.has(lemmaKey)) lemma.set(lemmaKey, entry.knowledgeState);
            }
            if (entry.canonicalForm) {
              const canonKey = normalizeLexiconKey(entry.canonicalForm);
              if (!lemma.has(canonKey)) lemma.set(canonKey, entry.knowledgeState);
            }
          }

          if (!page.hasMore || page.items.length === 0) {
            hasMore = false;
          } else {
            offset += page.items.length;
          }
        }

        if (disposed) return;
        setLexicon({ exact, lemma });
        setAnalysisStatus("ready");
      } catch {
        if (!disposed) {
          setLexicon(EMPTY_LEXICON);
          setAnalysisStatus("failed");
        }
      }
    })();

    return () => {
      disposed = true;
      adapter.dispose();
    };
  }, [adapter, analysisRetry, snapshot.profile, snapshot.status]);

  // Reset per-sentence transient selections when the active sentence changes.
  useEffect(() => {
    setSelectedToken(null);
    setCapturedFrame(null);
    setTranslationRevealed(false);
  }, [active?.id]);

  // Tokenize and lemmatize the active sentence via the language processing registry.
  const activeText = active?.text ?? "";
  const activeId = active?.id ?? "";
  const syncTokens = useMemo(
    () => (activeText ? buildSyncSubtitleTokens(activeText, targetLanguage) : []),
    [activeText, targetLanguage],
  );

  useEffect(() => {
    setAnalyzedTokens(null);
    if (!activeText || snapshot.status !== "ready" || !snapshot.profile) return;

    const controller = new AbortController();
    const { adapter: langAdapter } = processingRegistry.select({ languageTag: targetLanguage });
    void langAdapter
      .analyze(
        {
          text: activeText,
          languageTag: targetLanguage,
          contentFingerprint: sourceFingerprint,
        },
        controller.signal,
      )
      .then((chunk) => {
        if (controller.signal.aborted) return;
        setAnalyzedTokens(
          chunk.tokens.map((tok) => ({
            start: tok.start,
            end: tok.end,
            surface: tok.surface,
            normalized: tok.normalized,
            lemma: tok.lemma,
            partOfSpeech: tok.pos,
            confidence: tok.confidence.score ?? undefined,
            isLexical: tok.isLexical,
          })),
        );
      })
      .catch(() => {
        // Keep synchronous wordSegments fallback when async analysis fails or cancels.
      });

    return () => controller.abort();
  }, [activeId, activeText, processingRegistry, snapshot.profile, snapshot.status, sourceFingerprint, targetLanguage]);

  useEffect(() => {
    translationAbortRef.current?.abort();
    if (subtitleMode === "target" || (subtitleMode === "hidden" && !translationRevealed) || !active || !snapshot.profile) {
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
  }, [active, snapshot.profile, sourceFingerprint, subtitleMode, translationRevealed, translationRetry, translationService]);

  // Loop & auto-pause boundary tracking across player clock updates.
  const prevTimeRef = useRef(currentTime);
  const prevSentenceRef = useRef<{ id: string; startMs: number; endMs: number } | null>(
    active ? { id: active.id, startMs: active.startMs, endMs: active.endMs } : null,
  );
  const autoPausedSentenceRef = useRef<string | null>(null);
  const loopTriggeredSentenceRef = useRef<string | null>(null);

  useEffect(() => {
    const prevTime = prevTimeRef.current;
    const prevSentence = prevSentenceRef.current;
    prevTimeRef.current = currentTime;
    prevSentenceRef.current = active ? { id: active.id, startMs: active.startMs, endMs: active.endMs } : null;

    if (!active || snapshot.status !== "ready" || !snapshot.profile) return;

    const crossedPrevEnd =
      prevSentence !== null &&
      prevTime < prevSentence.endMs / 1000 &&
      currentTime >= prevSentence.endMs / 1000;

    const targetSentence = crossedPrevEnd ? prevSentence : active;
    const targetEndSec = targetSentence.endMs / 1000;
    const targetStartSec = targetSentence.startMs / 1000;

    if (currentTime < targetEndSec - 0.05) {
      if (loopTriggeredSentenceRef.current === targetSentence.id) {
        loopTriggeredSentenceRef.current = null;
      }
      if (autoPausedSentenceRef.current === targetSentence.id) {
        autoPausedSentenceRef.current = null;
      }
    }

    if (loopCurrent && currentTime >= targetEndSec) {
      if (loopTriggeredSentenceRef.current !== targetSentence.id) {
        loopTriggeredSentenceRef.current = targetSentence.id;
        onSeek(targetStartSec, targetEndSec);
      }
      return;
    }

    if (autoPause && crossedPrevEnd) {
      if (autoPausedSentenceRef.current !== targetSentence.id) {
        autoPausedSentenceRef.current = targetSentence.id;
        onPause?.();
      }
    }
  }, [active, autoPause, currentTime, loopCurrent, onPause, onSeek, snapshot.profile, snapshot.status]);

  if (!active || snapshot.status !== "ready" || !snapshot.profile) return null;

  const displayTokens = analyzedTokens ?? syncTokens;
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

  const peekWord = selectedToken?.surface ?? active.text;
  const peekTarget: DictionaryPeekTarget | null = peekOpen ? {
    text: peekWord,
    passage: active.text,
    profileId: snapshot.profile.id,
    languageTag: snapshot.profile.targetLanguage,
    analysis: selectedToken
      ? {
          lemma: selectedToken.lemma,
          partOfSpeech: selectedToken.partOfSpeech,
          confidence: selectedToken.confidence,
        }
      : undefined,
    sentence: {
      sentenceId: active.id,
      text: active.text,
      translation: translation || undefined,
      sourceAnchor,
    },
    sourceAnchor,
    geometry: null,
  } : null;

  const send = (action: LanguageHostActionDetail["action"], selectedText = peekWord) => {
    dispatchLanguageHostAction({
      action,
      hostId: snapshot.hostId,
      source,
      sourceAnchor,
      selectedText,
      profileId: snapshot.profile?.id,
      languageTag: snapshot.profile?.targetLanguage,
      ...(action === "practice"
        ? { practiceSource: { mediaId: videoId, startMs: active.startMs, endMs: active.endMs } }
        : {}),
      origin: "video",
    });
  };

  const handleWordClick = (token: SubtitleToken) => {
    setSelectedToken(token);
    setPeekOpen(true);
  };

  const handleCaptureFrameClick = async () => {
    if (!frameCaptureAvailable || !onCaptureFrame || capturingFrame) return;
    setCapturingFrame(true);
    try {
      const dataUrl = await onCaptureFrame();
      if (dataUrl) {
        setCapturedFrame({
          dataUrl,
          timestampMs: Math.max(0, Math.round(currentTime * 1000)),
        });
      }
    } finally {
      setCapturingFrame(false);
    }
  };

  const handleMine = () => {
    const selectedText = selectedToken?.surface ?? active.text;
    const payload = createLanguageMiningPayload({
      profileId: snapshot.profile?.id,
      sourceType: "video",
      sourceId: videoId,
      documentId,
      text: selectedText,
      sentenceText: active.text,
      selectedText,
      surroundingContext: active.text,
      sourceAnchor,
      sourceFingerprint,
      mediaId: videoId,
      mediaStartMs: active.startMs,
      mediaEndMs: active.endMs,
      frameTimestampMs: capturedFrame?.timestampMs,
      frameAvailable: Boolean(capturedFrame),
      originalAudioAvailability: "available",
      translationAvailability: translation ? "available" : "missing",
      analysisAvailability: "available",
      origin: "mining",
    });
    const draftDetail = {
      ...payload,
      ...(translation ? { translatedSentence: translation } : {}),
      ...(capturedFrame ? { frameDataUrl: capturedFrame.dataUrl } : {}),
      mediaRange: { mediaId: videoId, startMs: active.startMs, endMs: active.endMs },
    };
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("plethora-language-mining-draft", { detail: draftDetail }));
    }
    send("mine", selectedText);
  };

  const replayCurrent = () => {
    autoPausedSentenceRef.current = null;
    loopTriggeredSentenceRef.current = null;
    const resolved = sharedAudioAlignmentRegistry.resolve({
      sourceId: videoId,
      sentenceId: active.id,
      sourceFingerprint,
    });
    const resolution = resolved.kind === "original"
      ? resolved
      : {
          kind: "original" as const,
          tier: "exact" as const,
          alignment: {
            id: `${videoId}:${active.id}`,
            profileId: snapshot.profile.id,
            sourceType: "transcript" as const,
            sourceId: videoId,
            sentenceId: active.id,
            sourceAnchor,
            sourceFingerprint,
            range: { mediaId: videoId, startMs: active.startMs, endMs: active.endMs, mediaFingerprint: sourceFingerprint },
            confidence: 1,
            method: "caption" as const,
            status: "ready" as const,
            updatedAt: Date.now(),
          },
        };
    void replayOriginalFirst({
      text: active.text,
      resolution,
      playOriginal: (alignment) => onSeek(alignment.range.startMs / 1000, alignment.range.endMs / 1000),
      speakTts: (text) => tts.speak(text),
    });
  };

  const handleSpeedChange = (nextRate: number) => {
    setSpeedValue(nextRate);
    onPlaybackRateChange?.(nextRate);
  };

  const renderSubtitleSegments = () => {
    if (displayTokens.length === 0) return active.text;
    const nodes: Array<{ key: string; text: string; token?: SubtitleToken }> = [];
    let cursor = 0;

    for (const token of displayTokens) {
      if (token.start > cursor) {
        nodes.push({ key: `gap-${cursor}-${token.start}`, text: active.text.slice(cursor, token.start) });
      }
      nodes.push({ key: `tok-${token.start}-${token.end}`, text: token.surface, token });
      cursor = Math.max(cursor, token.end);
    }
    if (cursor < active.text.length) {
      nodes.push({ key: `tail-${cursor}`, text: active.text.slice(cursor) });
    }

    return nodes.map((part) => {
      const token = part.token;
      if (!token) {
        return <Fragment key={part.key}>{part.text}</Fragment>;
      }
      if (!token.isLexical) {
        return <span key={part.key}>{part.text}</span>;
      }
      const state = resolveTokenKnowledgeState(token, lexicon);
      const isSelected = selectedToken?.start === token.start && selectedToken?.end === token.end;
      const stateClass = state ? languageVocabularyStateClass(state) : "";
      const titleParts = [token.surface];
      if (token.lemma && token.lemma !== token.surface) titleParts.push(`lemma: ${token.lemma}`);
      if (state) titleParts.push(state);
      return (
        <button
          key={part.key}
          type="button"
          onClick={() => handleWordClick(token)}
          className={`inline cursor-pointer rounded px-0.5 text-left transition-colors hover:bg-primary/15 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary ${stateClass} ${isSelected ? "bg-primary/20 ring-1 ring-primary/50" : ""}`}
          title={titleParts.join(" · ")}
        >
          {part.text}
        </button>
      );
    });
  };

  if (minimized) {
    return (
      <div className="pointer-events-auto absolute left-2 top-2 z-30 sm:left-3 sm:top-3" data-language-video-host="true">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs shadow-md backdrop-blur hover:bg-muted sm:min-h-0 sm:px-2.5 sm:py-1"
          title="Expand language video panel"
          aria-label="Expand language video panel"
        >
          <FilmStrip className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="font-medium">Language video</span>
          <CaretDown className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="pointer-events-auto absolute left-2 top-2 z-30 w-[min(calc(100vw-1rem),520px)] rounded-xl border border-border bg-card/95 p-2.5 text-xs shadow-lg backdrop-blur sm:left-3 sm:top-3 sm:p-3"
      data-language-video-host="true"
    >
      <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
        <FilmStrip className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="font-medium">Language video</span>
        <span className="text-muted-foreground">{snapshot.profile.targetLanguage}</span>
        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-primary">{active.id}</span>
        <button
          type="button"
          onClick={() => setControlsCollapsed((value) => !value)}
          className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground sm:hidden"
          title={controlsCollapsed ? "Show video controls" : "Hide video controls"}
          aria-label={controlsCollapsed ? "Show video controls" : "Hide video controls"}
          aria-expanded={!controlsCollapsed}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setMinimized(true)}
          className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground sm:min-h-0 sm:min-w-0 sm:p-0.5"
          title="Minimize language video panel"
          aria-label="Minimize language video panel"
        >
          <CaretUp className="h-3.5 w-3.5" />
        </button>
      </div>

      {subtitleMode !== "base" && (
        <div className="mt-2 rounded-lg bg-muted/50 p-2 leading-relaxed" aria-live="polite">
          {renderSubtitleSegments()}
        </div>
      )}

      {analysisStatus === "failed" && (
        <div className="mt-1 flex items-center gap-2 text-[11px] text-destructive" role="status">
          <span>Lexical analysis unavailable.</span>
          <button type="button" className="rounded border border-border px-1.5 py-0.5 hover:bg-muted" onClick={() => setAnalysisRetry((value) => value + 1)}>
            Retry
          </button>
        </div>
      )}

      {!videoLayoutSupported && (
        <div className="mt-1 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground" role="status">
          Video playback synchronization is unavailable in e-ink mode; transcript and dictionary tools remain active.
        </div>
      )}

      {subtitleMode !== "target" && (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground" role="status">
          {subtitleMode === "hidden" && !translationRevealed ? (
            <button
              type="button"
              className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted"
              onClick={() => setTranslationRevealed(true)}
            >
              Reveal translation
            </button>
          ) : translationState === "pending" ? (
            <span>Translation loading…</span>
          ) : translationState === "ready" ? (
            <span>{translation}</span>
          ) : (
            <>
              <span>Base translation unavailable offline.</span>
              <button
                type="button"
                className="rounded border border-border px-1.5 py-0.5 text-foreground hover:bg-muted"
                onClick={() => setTranslationRetry((value) => value + 1)}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}

      {capturedFrame && (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1">
          <img
            src={capturedFrame.dataUrl}
            alt="Captured video frame preview"
            className="h-8 w-14 rounded object-cover"
          />
          <span className="text-[11px] text-muted-foreground">Frame attached</span>
          <button
            type="button"
            onClick={() => setCapturedFrame(null)}
            className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear captured frame"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div className={`mt-2 flex-wrap items-center gap-1.5 ${controlsCollapsed ? "hidden sm:flex" : "flex"}`}>
        <button
          type="button"
          className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-muted sm:min-h-0 sm:px-2"
          onClick={replayCurrent}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" /> Replay
        </button>
        <button
          type="button"
          className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-muted sm:min-h-0 sm:px-2"
          onClick={() => setPeekOpen(true)}
        >
          <BookOpenText className="h-3.5 w-3.5" aria-hidden="true" /> Peek
        </button>
        <button
          type="button"
          className="inline-flex min-h-[36px] items-center rounded-md border border-border px-2.5 py-1 hover:bg-muted sm:min-h-0 sm:px-2"
          onClick={() => send("sentence-mode")}
        >
          Sentence
        </button>
        <button
          type="button"
          className="inline-flex min-h-[36px] items-center rounded-md border border-border px-2.5 py-1 hover:bg-muted sm:min-h-0 sm:px-2"
          onClick={handleMine}
        >
          Mine
        </button>
        {snapshot.capabilities.tutor?.available && (
          <button
            type="button"
            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-muted sm:min-h-0 sm:px-2"
            onClick={() => send("tutor", active.text)}
          >
            <ChatsCircle className="h-3.5 w-3.5" aria-hidden="true" /> Tutor
          </button>
        )}
        <button
          type="button"
          aria-pressed={loopCurrent}
          onClick={() => {
            loopTriggeredSentenceRef.current = null;
            setLoopCurrent((value) => !value);
          }}
          className={`inline-flex min-h-[36px] items-center gap-1 rounded-md border px-2.5 py-1 sm:min-h-0 sm:px-2 ${
            loopCurrent
              ? "border-primary bg-primary/15 text-primary"
              : "border-border hover:bg-muted"
          }`}
          title="Loop current sentence"
          aria-label="Loop current sentence"
        >
          <ArrowsClockwise className="h-3.5 w-3.5" aria-hidden="true" /> Loop
        </button>
        <button
          type="button"
          aria-pressed={autoPause}
          onClick={() => {
            autoPausedSentenceRef.current = null;
            setAutoPause((value) => !value);
          }}
          className={`inline-flex min-h-[36px] items-center gap-1 rounded-md border px-2.5 py-1 sm:min-h-0 sm:px-2 ${
            autoPause
              ? "border-primary bg-primary/15 text-primary"
              : "border-border hover:bg-muted"
          }`}
          title="Auto-pause at sentence end"
          aria-label="Auto-pause at sentence end"
        >
          <Pause className="h-3.5 w-3.5" aria-hidden="true" /> Auto-pause
        </button>
        <label className="inline-flex min-h-[36px] items-center gap-1 text-muted-foreground sm:min-h-0">
          <span className="sr-only">Playback speed</span>
          <select
            aria-label="Playback speed"
            className="min-h-[36px] rounded border border-border bg-card px-1.5 py-0.5 text-foreground sm:min-h-0 sm:px-1"
            value={String(speedValue)}
            onChange={(event) => handleSpeedChange(Number(event.target.value))}
          >
            {SPEED_OPTIONS.map((rate) => (
              <option key={rate} value={String(rate)}>
                {rate.toFixed(rate === 1 ? 1 : 2)}x
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto inline-flex min-h-[36px] items-center gap-1 text-muted-foreground sm:min-h-0">
          <Translate className="h-3.5 w-3.5" aria-hidden="true" />
          <select
            aria-label="Language video subtitle mode"
            className="min-h-[36px] rounded border border-border bg-card px-1.5 py-0.5 text-foreground sm:min-h-0 sm:px-1"
            value={subtitleMode}
            onChange={(event) => setSubtitleMode(event.target.value as typeof subtitleMode)}
          >
            <option value="target">Target</option>
            <option value="dual">Target + base</option>
            <option value="base">Base</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        {frameCaptureAvailable && onCaptureFrame ? (
          <button
            type="button"
            disabled={capturingFrame}
            onClick={() => void handleCaptureFrameClick()}
            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-2.5 py-1 hover:bg-muted disabled:opacity-50 sm:min-h-0 sm:px-2"
            aria-label="Capture video frame"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            {capturingFrame ? "Capturing…" : capturedFrame ? "Frame ready" : "Frame"}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex min-h-[36px] items-center gap-1 rounded-md border border-border px-2.5 py-1 text-muted-foreground sm:min-h-0 sm:px-2"
            disabled
            aria-label="Frame capture unavailable (third-party stream)"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" /> Frame unavailable
          </button>
        )}
      </div>

      <p className="mt-1 text-[11px] text-muted-foreground">
        Sentence timing follows the player clock; word timing is approximate when captions do not provide it.
      </p>

      {peekTarget && (
        <DictionaryPeek
          target={peekTarget}
          documentId={documentId ?? videoId}
          onDismiss={() => setPeekOpen(false)}
          onReplayOriginalAudio={replayCurrent}
          aiAvailable={snapshot.capabilities.tutor.available}
          onExplain={(text) => send("tutor", text)}
          onPractice={() => send("practice", peekWord)}
        />
      )}
    </div>
  );
}
