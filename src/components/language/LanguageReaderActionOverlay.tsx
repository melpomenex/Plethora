import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SentenceModePanel } from "../common/SentenceModePanel";
import { DictionaryPeek, type DictionaryPeekTarget } from "../viewer/selectionInteraction/DictionaryPeek";
import { useLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { LANGUAGE_HOST_ACTION_EVENT, dispatchLanguageHostAction, type LanguageHostActionDetail } from "../../lib/languageHost";
import {
  createSentenceIndexAdapter,
  createSentenceModeSession,
  moveSentence,
  sentenceId,
  type SentenceModeSession,
  type SentenceSegment,
} from "../../lib/languageSentenceMode";
import {
  createTranslationService,
  isTranslationError,
  type TranslationPrivacyMode,
  type TranslationSettings,
} from "../../lib/languageTranslation";
import {
  replayOriginalFirst,
  sharedAudioAlignmentRegistry,
  type SentenceAudioAlignment,
} from "../../lib/languageAudioAlignment";
import { listLanguageAudioAlignments } from "../../api/languageEcosystem";
import { useTTS } from "../../hooks/useTTS";
import { useSettingsStore } from "../../stores/settingsStore";

const MULTILINGUAL_SENTENCE_PUNCTUATION = /[。！？．؟।]/;
const MULTILINGUAL_SENTENCE_PATTERN = /[^.!?\n。！？．…؟।]+(?:[.!?。！？．…؟।]+|$)/g;

function splitMultilingualSentencePieces(text: string, languageTag?: string): Array<{ text: string; start: number; end: number }> {
  const SegmenterCtor = typeof Intl !== "undefined"
    ? (Intl as unknown as { Segmenter?: new (locale?: string, options?: { granularity: "sentence" }) => { segment: (input: string) => Iterable<{ segment: string; index: number }> } }).Segmenter
    : undefined;
  if (SegmenterCtor) {
    try {
      const segmenter = new SegmenterCtor(languageTag || undefined, { granularity: "sentence" });
      const pieces: Array<{ text: string; start: number; end: number }> = [];
      for (const part of segmenter.segment(text)) {
        const trimmed = part.segment.trim();
        if (!trimmed) continue;
        const leadingOffset = part.segment.indexOf(trimmed);
        const start = part.index + leadingOffset;
        pieces.push({ text: trimmed, start, end: start + trimmed.length });
      }
      if (pieces.length > 0) return pieces;
    } catch {
      // Fall back to deterministic regex splitting if locale tag is invalid.
    }
  }
  const fallback: Array<{ text: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  MULTILINGUAL_SENTENCE_PATTERN.lastIndex = 0;
  while ((match = MULTILINGUAL_SENTENCE_PATTERN.exec(text))) {
    const trimmed = match[0].trim();
    if (!trimmed) continue;
    const start = match.index + match[0].indexOf(trimmed);
    fallback.push({ text: trimmed, start, end: start + trimmed.length });
  }
  return fallback;
}

function refineMultilingualSegments(
  segments: readonly SentenceSegment[],
  sourceId: string,
  contentFingerprint: string,
  languageTag?: string,
): readonly SentenceSegment[] {
  const needsRefinement =
    segments.some((segment) => MULTILINGUAL_SENTENCE_PUNCTUATION.test(segment.text)) ||
    segments.length === 1;
  if (!needsRefinement) return segments;

  const refined: SentenceSegment[] = [];
  for (const segment of segments) {
    const pieces = splitMultilingualSentencePieces(segment.text, languageTag);
    if (pieces.length <= 1) {
      refined.push({ ...segment, index: refined.length });
      continue;
    }
    const baseOffset = segment.startOffset ?? 0;
    for (const piece of pieces) {
      const startOffset = baseOffset + piece.start;
      const endOffset = baseOffset + piece.end;
      refined.push({
        identity: {
          sentenceId: sentenceId(sourceId, startOffset, endOffset, piece.text),
          sourceId,
          contentFingerprint,
          sourceAnchor: {
            sourceType: "text",
            sourceId,
            contentFingerprint,
            locator: { startOffset, endOffset },
          },
        },
        index: refined.length,
        text: piece.text,
        startOffset,
        endOffset,
        freshness: segment.freshness,
      });
    }
  }
  return refined;
}

function normalizeSourceAnchorType(sourceType: string): "epub" | "pdf" | "text" | "html" | "markdown" | "transcript" | "media" {
  switch (sourceType) {
    case "epub":
    case "pdf":
    case "text":
    case "html":
    case "markdown":
    case "transcript":
    case "media":
      return sourceType;
    default:
      return "text";
  }
}

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
  const speakRef = useRef(tts.speak);
  speakRef.current = tts.speak;
  const [request, setRequest] = useState<LanguageHostActionDetail | null>(null);
  const [session, setSession] = useState<SentenceModeSession | null>(null);
  const [segments, setSegments] = useState<readonly SentenceSegment[]>([]);
  const [translationState, setTranslationState] = useState<"ready" | "pending" | "stale" | "offline">("ready");
  const [translation, setTranslation] = useState("");
  const [cloudConsentPending, setCloudConsentPending] = useState(false);
  const [cloudConsentGranted, setCloudConsentGranted] = useState(false);
  const [inspectTarget, setInspectTarget] = useState<DictionaryPeekTarget | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationService = useMemo(() => createTranslationService(), []);

  useEffect(() => {
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<LanguageHostActionDetail>).detail;
      if (!detail || detail.hostId !== snapshot.hostId) return;
      if (detail.action === "replay") {
        const text = detail.selectedText ?? detail.source.text ?? "";
        const sentenceKey = detail.sourceAnchor.sourceId ?? "sentence";
        const sourceFp = detail.source.contentFingerprint ?? detail.sourceAnchor.contentFingerprint ?? "-";
        void (async () => {
          let resolution = sharedAudioAlignmentRegistry.resolve({
            sourceId: detail.source.contentId,
            sentenceId: sentenceKey,
            sourceFingerprint: sourceFp,
          });
          if (resolution.kind !== "original") {
            const dbAlignments = await listLanguageAudioAlignments(
              detail.source.contentId,
              snapshot.profile?.id,
            ).catch(() => []);
            if (dbAlignments.length > 0) {
              for (const rec of dbAlignments) {
                sharedAudioAlignmentRegistry.add({
                  id: rec.id,
                  profileId: rec.profileId,
                  sourceType: rec.sourceType as SentenceAudioAlignment["sourceType"],
                  sourceId: rec.sourceId,
                  sentenceId: rec.sentenceId,
                  sourceAnchor: detail.sourceAnchor,
                  sourceFingerprint: rec.sourceFingerprint ?? sourceFp,
                  range: {
                    mediaId: rec.mediaId ?? rec.sourceId,
                    startMs: rec.startMs,
                    endMs: rec.endMs,
                    mediaFingerprint: rec.mediaFingerprint ?? undefined,
                  },
                  confidence: rec.confidence ?? 0.85,
                  method: (rec.method as SentenceAudioAlignment["method"]) ?? "manual",
                  status: (rec.status as SentenceAudioAlignment["status"]) ?? "ready",
                  updatedAt: Date.now(),
                });
              }
              resolution = sharedAudioAlignmentRegistry.resolve({
                sourceId: detail.source.contentId,
                sentenceId: sentenceKey,
                sourceFingerprint: sourceFp,
              });
            }
          }
          if (resolution.kind !== "original") {
            const range = audioRangeFromAnchor(detail.sourceAnchor);
            if (range) {
              resolution = {
                kind: "original",
                tier: "exact",
                alignment: {
                  id: `${detail.source.contentId}:${sentenceKey}`,
                  profileId: snapshot.profile?.id,
                  sourceType: "audio",
                  sourceId: detail.source.contentId,
                  sentenceId: sentenceKey,
                  sourceAnchor: detail.sourceAnchor,
                  sourceFingerprint: sourceFp,
                  range,
                  confidence: 1,
                  method: "manual",
                  status: "ready",
                  updatedAt: Date.now(),
                },
              };
            }
          }
          await replayOriginalFirst({
            text,
            resolution,
            playOriginal: (resolved) => {
              window.dispatchEvent(
                new CustomEvent("plethora-language-original-audio-range", {
                  detail: { documentId: detail.source.contentId, ...resolved.range },
                }),
              );
            },
            speakTts: (value) => speakRef.current(value),
          });
        })().catch(() => undefined);
        return;
      }
      if (detail.action === "sentence-mode" || detail.action === "translate") setRequest(detail);
    };
    window.addEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
    return () => window.removeEventListener(LANGUAGE_HOST_ACTION_EVENT, onAction);
  }, [snapshot.hostId, snapshot.profile?.id]);

  const adapter = useMemo(() => {
    if (!request) return null;
    return createSentenceIndexAdapter("text", request.source.contentId, request.source.text ?? request.selectedText ?? "", request.source.contentFingerprint);
  }, [request]);

  const resolvePrivacyOverride = useCallback((allowCloudOverride?: boolean): TranslationPrivacyMode | undefined => {
    if (allowCloudOverride || cloudConsentGranted) return "allow-cloud";
    const storeTranslation = (useSettingsStore.getState().settings.languageLearning as
      | { translation?: Partial<TranslationSettings> }
      | undefined)?.translation;
    if (storeTranslation?.privacy) return storeTranslation.privacy;
    const pref = snapshot.profile?.preferences?.translationProvider?.toLowerCase();
    if (pref === "cloud" || pref === "allow-cloud" || pref === "ai" || pref === "plethora-ai-translate") {
      return "allow-cloud";
    }
    return undefined;
  }, [cloudConsentGranted, snapshot.profile?.preferences?.translationProvider]);

  const runTranslation = useCallback((
    sentence: SentenceSegment,
    activeRequest: LanguageHostActionDetail,
    opts?: { allowCloud?: boolean },
  ) => {
    if (!snapshot.profile) return;
    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;
    setCloudConsentPending(false);
    setTranslationState("pending");
    const privacyOverride = resolvePrivacyOverride(opts?.allowCloud);
    void translationService.translate({
      text: sentence.text,
      sourceLanguage: snapshot.profile.targetLanguage,
      targetLanguage: snapshot.profile.baseLanguage,
      profileId: snapshot.profile.id,
      sourceFingerprint: activeRequest.source.contentFingerprint,
      sourceAnchor: {
        sourceType: normalizeSourceAnchorType(activeRequest.sourceAnchor.sourceType),
        documentId: activeRequest.sourceAnchor.documentId,
        sourceId: activeRequest.sourceAnchor.sourceId,
        contentFingerprint: activeRequest.sourceAnchor.contentFingerprint,
      },
      providerPolicy: privacyOverride ? { privacy: privacyOverride } : undefined,
    }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setTranslation(result.translatedText);
        setTranslationState("ready");
        setCloudConsentPending(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setTranslation("");
        if (isTranslationError(error) && error.code === "privacy-blocked") {
          setTranslationState("ready");
          setCloudConsentPending(true);
          return;
        }
        setTranslationState("offline");
      });
  }, [resolvePrivacyOverride, snapshot.profile, translationService]);

  useEffect(() => {
    translationAbortRef.current?.abort();
    setTranslation("");
    setTranslationState("ready");
    setCloudConsentPending(false);
    setInspectTarget(null);
    if (!request || !adapter) {
      setSession(null);
      setSegments([]);
      setCloudConsentGranted(false);
      return;
    }
    let disposed = false;
    void adapter.getWindow(0, 50).then((rawWindow) => {
      if (disposed || rawWindow.length === 0) return;
      const windowSegments = refineMultilingualSegments(
        rawWindow,
        request.source.contentId,
        adapter.contentFingerprint,
        request.languageTag ?? snapshot.profile?.targetLanguage,
      );
      const selected = request.selectedText?.trim() ?? "";
      const entry = (selected
        ? windowSegments.find((segment) => segment.text.includes(selected))
        : undefined) ?? windowSegments[0];
      const next = createSentenceModeSession({
        sessionId: `${snapshot.hostId}:sentence-mode:${Date.now()}`,
        source: "text",
        sourceId: request.source.contentId,
        contentFingerprint: adapter.contentFingerprint,
        entry,
        returnAnchor: { documentId: request.source.contentId, sourceId: request.source.contentId, sourceAnchor: request.sourceAnchor },
        profileId: snapshot.profile?.id,
        total: windowSegments.length,
      });
      setSegments(windowSegments);
      setSession(next);
      if (request.action === "translate") {
        runTranslation(entry, request);
      }
    });
    return () => {
      disposed = true;
      translationAbortRef.current?.abort();
    };
  }, [adapter, request, runTranslation, snapshot.hostId, snapshot.profile?.id, snapshot.profile?.targetLanguage]);

  if (!session || !request) return null;
  const current = segments.find((segment) => segment.identity.sentenceId === session.currentSentenceId) ?? null;
  const navigate = (offset: number) => {
    const next = segments[session.progress.current + offset];
    if (!next) return;
    translationAbortRef.current?.abort();
    setTranslation("");
    setTranslationState("ready");
    setCloudConsentPending(false);
    setInspectTarget(null);
    setSession((previous) => previous ? moveSentence(previous, next) : previous);
  };
  const revealTranslation = () => {
    if (!current) return;
    runTranslation(current, request);
  };

  return (
    <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-background/70 p-4 backdrop-blur-sm" data-language-sentence-overlay="true">
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
        onInspectVocabulary={(text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          setInspectTarget({
            text: trimmed,
            passage: current?.text,
            profileId: snapshot.profile?.id,
            languageTag: snapshot.profile?.targetLanguage,
            sourceAnchor: current?.identity.sourceAnchor ?? request.sourceAnchor,
            geometry: null,
          });
        }}
        onGrammar={(text) => dispatchLanguageHostAction({ action: "tutor", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onPractice={(text) => dispatchLanguageHostAction({ action: "practice", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        onExit={() => {
          translationAbortRef.current?.abort();
          setInspectTarget(null);
          setRequest(null);
        }}
      />
      {cloudConsentPending && current && (
        <div
          role="region"
          aria-label="Cloud translation consent"
          className="mx-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg"
        >
          <p className="min-w-0 flex-1 text-muted-foreground">
            No local translation provider is available. Send this sentence to your configured cloud AI provider?
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              className="min-h-9 rounded border border-border px-3 text-xs font-medium hover:bg-muted"
              onClick={() => {
                setCloudConsentPending(false);
                setTranslationState("offline");
              }}
            >
              Keep local only
            </button>
            <button
              type="button"
              className="min-h-9 rounded bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"
              onClick={() => {
                setCloudConsentGranted(true);
                runTranslation(current, request, { allowCloud: true });
              }}
            >
              Allow cloud translation
            </button>
          </div>
        </div>
      )}
      {inspectTarget && (
        <DictionaryPeek
          target={inspectTarget}
          documentId={request.source.contentId}
          onDismiss={() => setInspectTarget(null)}
          onReplayOriginalAudio={() => {
            dispatchLanguageHostAction({
              action: "replay",
              hostId: snapshot.hostId,
              source: request.source,
              sourceAnchor: inspectTarget.sourceAnchor ?? request.sourceAnchor,
              selectedText: inspectTarget.text,
              profileId: snapshot.profile?.id,
              languageTag: snapshot.profile?.targetLanguage,
              origin: "reader",
            });
          }}
          aiAvailable={snapshot.capabilities.tutor?.available ?? false}
          onExplain={(text) => dispatchLanguageHostAction({ action: "tutor", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
          onPractice={(text) => dispatchLanguageHostAction({ action: "practice", hostId: snapshot.hostId, source: request.source, sourceAnchor: request.sourceAnchor, selectedText: text, profileId: snapshot.profile?.id, languageTag: snapshot.profile?.targetLanguage, origin: "reader" })}
        />
      )}
    </div>
  );
}
