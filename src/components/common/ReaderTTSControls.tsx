import { useEffect, useMemo, useState, useCallback, useRef, forwardRef, useImperativeHandle } from "react";
import {
  CircleNotch,
  Highlighter,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SpeakerHigh,
  Square,
} from "@phosphor-icons/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { getVoicesForProvider } from "../../utils/ttsSettings";
import { generateSpeech, resolveTTSMaxChunkSize } from "../../api/tts";
import { useSystemVoices, resolveSystemVoice } from "../../hooks/useSystemVoices";
import {
  onPlaybackState as onNativePlaybackState,
  onSentencePosition as onNativeSentencePosition,
  onUtteranceComplete as onNativeUtteranceComplete,
  onWordPosition as onNativeWordPosition,
  onTtsError as onNativeTtsError,
  pluginPause as nativePause,
  pluginResume as nativeResume,
  pluginSpeak as nativeSpeak,
  pluginStop as nativeStop,
  isAndroidTtsAvailable,
} from "../../api/tts/android/bridge";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import {
  ReaderSpeechIndex,
  buildSpeechIndexFromText,
  CHUNK_MAX,
  CHUNK_TARGET,
  resolveStartAnchor,
  type ResolveStartContext,
  type SpeechPosition,
  type SpeechSectionInput,
  type SourceAnchor,
  type TTSChunk,
  type TTSStartAnchor,
} from "../../utils/readerSpeechIndex";
import {
  nextActiveWordIndex,
  resolveChunkTimings,
  type WordTiming,
} from "../../utils/wordTimings";
import { charIndexToWordIndex } from "../../api/tts/timing";
import {
  getProfileId,
  getTTSListeningPosition,
  resolveListeningPosition,
  saveTTSListeningPosition,
  writeListeningPositionSync,
  fingerprintDocument,
  fingerprintSpeechIndex,
  type TTSListeningPosition,
} from "../../utils/ttsListeningPosition";
import { digestText128 } from "../../utils/ttsCache";
import { useSpokenWordFollow } from "../../hooks/useSpokenWordFollow";
import { useRemoteMediaBridge } from "../../hooks/useRemoteMediaBridge";
import type { RemoteMediaContext } from "../../utils/remoteMediaDispatcher";
import { createLongFormSessionId } from "../../utils/longFormPlaybackSession";
import { usePresentation, useIsEink } from "../../contexts/PresentationContext";
import { WordHighlightLayer } from "./WordHighlightLayer";

interface TTSStartPosition {
  pageNumber: number | null;
  scrollPercent: number | null;
}

/** Imperative start/stop API for hosts (selection "Read from here", TOC retarget). */
export interface ReaderTTSHandle {
  /** Stop any current playback and begin at an exact anchor. */
  startFrom(anchor: TTSStartAnchor): void;
  /** Stop playback and clear transient state. */
  stop(): void;
  /**
   * Queue an anchor as the next start (TOC navigation while stopped or
   * paused): never starts playback; consumed by the next Play/resume.
   */
  queueAnchor(anchor: TTSStartAnchor): void;
  /** Current coarse playback state. */
  playbackState(): "stopped" | "playing" | "paused";
}

interface ReaderTTSControlsProps {
  text: string;
  /**
   * Section-structured speech text for anchored chunking (EPUB spine sections,
   * DOM-derived markdown/HTML sections, PDF canonical pages). When absent the
   * plain `text` prop is indexed with anchor-less words (QueueScrollPage).
   */
  sections?: SpeechSectionInput[] | null;
  className?: string;
  /** Called when all chunks have finished playing */
  onComplete?: () => void;
  /** Whether to auto-play the next chunk after one finishes */
  autoAdvance?: boolean;
  /** Called when a chunk starts playing, useful for highlighting */
  onChunkStart?: (chunkIndex: number, text: string) => void;
  /** Document position to start reading from */
  startPosition?: TTSStartPosition;
  /** Document type for position mapping */
  docType?: "pdf" | "epub" | "scroll";
  /** Called when the active chunk changes (useful for auto-scroll / position sync) */
  onChunkChange?: (chunkIndex: number, scrollPercent: number) => void;
  /** Whether word highlighting is enabled */
  highlightEnabled?: boolean;
  /** Called when highlight toggle is clicked */
  onHighlightToggle?: () => void;
  /** Whether auto-scroll is paused (user scrolled manually) */
  autoScrollPaused?: boolean;
  /** Called when user clicks re-center */
  onReCenter?: () => void;
  /**
   * Resolve the live visible-viewport start anchor (D6). Called only at
   * Play/retarget time — never per frame. Returns a SourceAnchor the speech
   * index can locate, or null when the viewport cannot be resolved.
   */
  resolveViewportAnchor?: () => SourceAnchor | null;
  /** The reader's authoritative current-position anchor (priority level 3). */
  resolvePositionAnchor?: () => SourceAnchor | null;
  /** Section-key → container (EPUB iframe bodies) for anchored highlighting. */
  sectionContainers?: Map<string, HTMLElement> | null;
  /** Resolve an EPUB CFI to a speech source anchor (selections, TOC targets). */
  cfiToEpubAnchor?: (cfi: string) => SourceAnchor | null;
  /** Ref for the element to highlight text in */
  highlightContainerRef?: React.RefObject<HTMLElement | null>;
  /** Iframe window for EPUB and HTML document readers */
  iframeWindow?: Window | null;
  /**
   * Document identity for TTS listening-position persistence (#2): saves are
   * keyed per document+profile and restored as the level-4 "saved position".
   * When absent, no listening position is persisted.
   */
  documentId?: string | null;
}

const BUFFER_TARGET_SEC = 60; // target seconds of audio buffered ahead
const MAX_CONCURRENT_GEN = 3; // max parallel generation invocations
const EVICT_BEHIND_COUNT = 3; // keep N already-played chunks in memory

/**
 * Whether speech position `a` precedes `b` in document order. Chunks are
 * contiguous and ordered, so (chunkIndex, wordIndex) compares correctly.
 */
function isPositionEarlier(a: SpeechPosition, b: SpeechPosition): boolean {
  return a.chunkIndex < b.chunkIndex || (a.chunkIndex === b.chunkIndex && a.wordIndex < b.wordIndex);
}

interface BufferedAudio {
  audioUrl: string;
  durationSec?: number;
  text?: string;
  wordTimings?: WordTiming[];
  system?: boolean;
  cacheSource?: string;
}

export const ReaderTTSControls = forwardRef<ReaderTTSHandle, ReaderTTSControlsProps>(
function ReaderTTSControls({
  text,
  sections,
  className,
  onComplete,
  autoAdvance = true,
  onChunkStart,
  startPosition,
  docType = "scroll",
  onChunkChange,
  highlightEnabled = false,
  onHighlightToggle,
  autoScrollPaused = false,
  onReCenter,
  resolveViewportAnchor,
  resolvePositionAnchor,
  sectionContainers,
  cfiToEpubAnchor,
  highlightContainerRef,
  iframeWindow,
  documentId,
}: ReaderTTSControlsProps,
ref: React.ForwardedRef<ReaderTTSHandle>
) {
  const { t } = useI18n();
  const tts = useSettingsStore((state) => state.settings.tts);
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const ttsEnabled = tts?.enabled;
  const isSystemProvider = tts?.provider === "system";
  // Native Android provider: playback is owned by the native plugin
  // (sherpa-onnx → AudioTrack). It does its own chunking/prefetching, so like
  // the system provider there is no <audio> URL to buffer — we hand the whole
  // passage to the plugin in one speak call.
  const isAndroidProvider = tts?.provider === "android";
  const { voices: systemSynthVoices, profiles: systemVoiceProfiles } = useSystemVoices();
  const providerVoices = useMemo(() => {
    if (!tts) return [];
    // System provider: device voices aren't persisted — merge in live list.
    if (tts.provider === "system") {
      return systemVoiceProfiles.length > 0 ? systemVoiceProfiles : getVoicesForProvider(tts);
    }
    return getVoicesForProvider(tts);
  }, [tts, systemVoiceProfiles]);
  // Currently-active SpeechSynthesisUtterance (system provider only).
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [selectedVoiceId, setSelectedVoiceId] = useState(tts?.defaultVoiceId ?? "");
  const [isAutoPlaying, setIsAutoPlaying] = useState(false);
  const [ttsChunkLimit, setTtsChunkLimit] = useState(CHUNK_MAX);

  useEffect(() => {
    let cancelled = false;
    void resolveTTSMaxChunkSize(settings).then((limit) => {
      if (!cancelled) setTtsChunkLimit(limit);
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  // Audio buffer: Map of chunk index -> audio URL
  const audioBufferRef = useRef<Map<number, BufferedAudio>>(new Map());
  const [bufferStatus, setBufferStatus] = useState<
    Map<number, "pending" | "loading" | "ready" | "error">
  >(new Map());

  // Audio element for playback
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Native provider event unsubs (android) — cleaned up on stop/unmount.
  const nativeUnsubRef = useRef<Array<() => void>>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const playbackStateRef = useRef<"stopped" | "playing" | "paused">("stopped");

  // Track previous playing state
  const _wasPlayingRef = useRef(false);
  const intentionalStopRef = useRef(false);
  const advancingRef = useRef(false);

  // Word highlighting
  const [wordOffset, setWordOffset] = useState(0);
  const wordOffsetRef = useRef(0);
  wordOffsetRef.current = wordOffset;
  const rafRef = useRef<number | null>(null);
  // Whether the active word's timing is synthesized (approximate) — drives the
  // softer highlight variant.
  const [activeTimingApproximate, setActiveTimingApproximate] = useState(false);

  // ── Canonical playback position (#1) ──────────────────────────────────────
  // The single source of truth for where narration is: `{chunkIndex,
  // wordIndex, intraChunkMs}` with `intraChunkMs` derived from the live audio
  // clock. Everything derived — active-word highlight (`wordOffset` state),
  // follow-scroll `wordKey`, resume anchor, persisted listening position — is
  // computed from this position, never from an independent zeroable variable.
  interface CanonicalPosition {
    chunkIndex: number;
    wordIndex: number;
    intraChunkMs: number | null;
  }
  const canonicalRef = useRef<CanonicalPosition>({ chunkIndex: 0, wordIndex: 0, intraChunkMs: null });
  // Snapshot of the last committed spoken word (anchor + chunk text span),
  // taken while the pre-rebuild playlist is still authoritative — used to
  // reconcile the session position across an incidental re-extraction.
  const lastSpokenAnchorRef = useRef<SourceAnchor | null>(null);
  const lastSpokenSpanRef = useRef<{ text: string; normStart: number; normEnd: number }>({
    text: "",
    normStart: 0,
    normEnd: 0,
  });
  // React-state mirrors of the canonical position (committed on word/chunk
  // change, never per frame).
  const commitChunk = useCallback((index: number) => {
    canonicalRef.current.chunkIndex = index;
    setChunkIndex(index);
    const chunk = playlistRef.current[index];
    const word = chunk?.words[0];
    lastSpokenAnchorRef.current = word?.anchor ?? null;
    lastSpokenSpanRef.current = word
      ? { text: chunk.text, normStart: word.normStart, normEnd: word.normEnd }
      : lastSpokenSpanRef.current;
  }, []);
  const commitWord = useCallback((index: number, intraMs: number | null) => {
    canonicalRef.current.wordIndex = index;
    canonicalRef.current.intraChunkMs = intraMs;
    setWordOffset(index);
    const chunk = playlistRef.current[canonicalRef.current.chunkIndex];
    const word = chunk?.words[index];
    lastSpokenAnchorRef.current = word?.anchor ?? null;
    lastSpokenSpanRef.current = word
      ? { text: chunk.text, normStart: word.normStart, normEnd: word.normEnd }
      : lastSpokenSpanRef.current;
  }, []);
  /** Live canonical position; intraChunkMs refreshed from the audio clock. */
  const getCanonicalPosition = useCallback((): CanonicalPosition => {
    const { chunkIndex, wordIndex } = canonicalRef.current;
    let intraChunkMs = canonicalRef.current.intraChunkMs;
    const audio = audioRef.current;
    if (audio && !audio.paused && !audio.ended && Number.isFinite(audio.currentTime)) {
      intraChunkMs = Math.round(audio.currentTime * 1000);
    }
    return { chunkIndex, wordIndex, intraChunkMs };
  }, []);

  // ── Listening-position persistence (#2) ───────────────────────────────────
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  // Resolved "saved position" (level 4) for the start-priority chain.
  const savedPositionRef = useRef<SpeechPosition | null>(null);
  // When a genuine text change cancels stale audio while paused, resume must
  // restart from the reconciled position instead of "resuming" a cancelled
  // utterance. Set by the fingerprint reset effect; consumed by resume.
  const pausedRestartPositionRef = useRef<SpeechPosition | null>(null);
  // Document id of the previous render (used to flush the old document's
  // position before switching documents / advancing the Queue).
  const prevDocumentIdRef = useRef<string | null | undefined>(undefined);
  // True once the user has engaged playback for this session — a listening
  // position is only ever written after real narration (never for a document
  // the user merely opened and read).
  const engagedRef = useRef(false);

  // Spoken-word follow (TranscriptSync semantics): comfort offset, debounced
  // movement, arrival-based user-scroll detection, Re-center resume. Reduced
  // motion / e-ink positions instantly.
  const { reducedMotion } = usePresentation();
  const isEink = useIsEink();
  const followSpokenWord = tts?.followSpokenWord ?? true;
  const followContainers = useMemo(() => {
    const list: Array<HTMLElement | null> = [
      highlightContainerRef?.current ?? null,
      iframeWindow?.document?.body ?? null,
    ];
    if (sectionContainers) {
      for (const el of sectionContainers.values()) list.push(el);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightContainerRef?.current, iframeWindow, sectionContainers]);
  const { pausedByUser: followPausedByUser, reCenter: followReCenter } = useSpokenWordFollow({
    enabled: followSpokenWord,
    // Active through a pause (the hook's contract is "playing or paused
    // mid-utterance"): `pausedByUser` must survive a pause so resume can tell
    // a deliberate user scroll from an auto-follow viewport top.
    active: isPlaying || isPaused,
    compact: typeof window !== "undefined" ? window.innerWidth < 640 : false,
    reducedMotion: reducedMotion || isEink,
    wordKey: `${chunkIndex}:${wordOffset}`,
    containers: followContainers,
  });

  /**
   * Playback clock for generated audio: rAF samples `audio.currentTime` (the
   * authoritative media clock) and resolves the active word against the chunk's
   * timings — measured provider timings when they align with the chunk text,
   * else timings synthesized from the actual audio duration. React state
   * commits only when the active word index changes (`nextActiveWordIndex`), so
   * the reader doesn't re-render at animation-frame rates. The loop suspends
   * itself when paused, ended, or the document is hidden.
   */
  const startWordTracking = useCallback(
    (audio: HTMLAudioElement, chunkText: string, measured?: WordTiming[]) => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      let timings = resolveChunkTimings(chunkText, measured, undefined);
      if (timings) {
        setActiveTimingApproximate(timings[0]?.source !== "measured");
      }
      let lastWordIndex = -1;

      const track = () => {
        rafRef.current = null;
        if (!audio || audio.paused || audio.ended || document.hidden) return;

        if (!timings) {
          timings = resolveChunkTimings(chunkText, undefined, audio.duration);
          if (timings) {
            setActiveTimingApproximate(timings[0]?.source !== "measured");
          }
        }
        if (timings) {
          const next = nextActiveWordIndex(timings, audio.currentTime, lastWordIndex);
          if (next !== null) {
            lastWordIndex = next;
            commitWord(next, Math.round(audio.currentTime * 1000));
          }
        }

        rafRef.current = requestAnimationFrame(track);
      };

      rafRef.current = requestAnimationFrame(track);
    },
    [commitWord]
  );

  const stopWordTracking = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    // Pause/stop cancels the word clock but NEVER resets the canonical word
    // index: the highlight stays on the last spoken word and resume continues
    // from the paused word (pause/resume correctness #5).
  }, []);

  // Buffer underrun indicator
  const [isBuffering, setIsBuffering] = useState(false);

  // Playback tracking refs to avoid race conditions and audio leaks
  const mountedRef = useRef(true);
  const playbackIdRef = useRef(0);

  // Anchored speech index — the source of truth for chunking, word spans, and
  // source anchors. When the host supplies section-structured text the index
  // preserves displayed-text → TTS-text → word mapping; otherwise the plain
  // text prop is indexed with anchor-less words (QueueScrollPage usage).
  const speechIndex = useMemo(
    () =>
      sections && sections.length > 0
        ? new ReaderSpeechIndex(sections, ttsChunkLimit)
        : buildSpeechIndexFromText(text, ttsChunkLimit),
    [sections, ttsChunkLimit, text]
  );
  const chunks: TTSChunk[] = speechIndex.chunks;
  const speechIndexRef = useRef(speechIndex);
  speechIndexRef.current = speechIndex;

  // Session playlist: the index's chunks with an optional transient sliced
  // leading chunk from a mid-chunk start (D5). The underlying index is never
  // mutated, so the original chunk keeps its cache entry.
  const [sessionLeading, setSessionLeading] = useState<{
    chunkIndex: number;
    chunk: TTSChunk;
  } | null>(null);
  const sessionLeadingRef = useRef(sessionLeading);
  const playlist = useMemo(
    () =>
      sessionLeading
        ? chunks.map((c, i) => (i === sessionLeading.chunkIndex ? sessionLeading.chunk : c))
        : chunks,
    [chunks, sessionLeading]
  );
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;

  const applySessionLeading = useCallback(
    (leading: { chunkIndex: number; chunk: TTSChunk } | null) => {
      const previousLeading = sessionLeadingRef.current;
      sessionLeadingRef.current = leading;
      playlistRef.current = leading
        ? playlistRef.current.map((c, i) => (i === leading.chunkIndex ? leading.chunk : c))
        : chunksRef.current;
      // A sliced leading chunk has different text than the base chunk already
      // buffered at that index — invalidate the stale in-memory buffer (the
      // IndexedDB cache stays valid; keys include the text digest).
      if (leading && previousLeading?.chunkIndex !== leading.chunkIndex) {
        audioBufferRef.current.delete(leading.chunkIndex);
        setBufferStatus((prev) => {
          if (!prev.has(leading.chunkIndex)) return prev;
          const next = new Map(prev);
          next.delete(leading.chunkIndex);
          return next;
        });
      }
      setSessionLeading(leading);
    },
    []
  );
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;

  // Pending explicit start anchor (selection "Read from here", TOC while
  // stopped/paused) — consumed as priority level 1 by the next Play.
  const pendingAnchorRef = useRef<TTSStartAnchor | null>(null);

  const resolveViewportAnchorRef = useRef(resolveViewportAnchor);
  resolveViewportAnchorRef.current = resolveViewportAnchor;
  const resolvePositionAnchorRef = useRef(resolvePositionAnchor);
  resolvePositionAnchorRef.current = resolvePositionAnchor;
  const cfiToEpubAnchorRef = useRef(cfiToEpubAnchor);
  cfiToEpubAnchorRef.current = cfiToEpubAnchor;

  const resolveVia = useCallback((fn?: () => SourceAnchor | null): SpeechPosition | null => {
    if (!fn) return null;
    try {
      const anchor = fn();
      return anchor ? speechIndexRef.current.locate(anchor) : null;
    } catch {
      return null;
    }
  }, []);

  /**
   * The spec's 5-level start priority: explicit anchor → live viewport →
   * authoritative position → saved position → beginning. The saved position
   * additionally beats a viewport that resolves EARLIER than it (TTS advanced
   * past the manually viewed page); a stale saved percentage can never
   * override a resolvable live viewport at/after the saved position.
   */
  const resolveStartPosition = useCallback(
    (explicit?: TTSStartAnchor | null): SpeechPosition => {
      if (explicit) {
        const pos = resolveStartAnchor(explicit, speechIndexRef.current, {
          cfiToEpubAnchor: cfiToEpubAnchorRef.current,
          resolveViewport: () => {
            const via = resolveVia(resolveViewportAnchorRef.current);
            if (!via) return null;
            const chunk = speechIndexRef.current.chunks[via.chunkIndex];
            return chunk?.words[via.wordIndex]?.anchor ?? null;
          },
        });
        if (pos) return pos;
      }
      const viewport = resolveVia(resolveViewportAnchorRef.current);
      // Level 4: saved TTS listening position (reconciled against the current
      // speech index — nearest-anchor fallback). When a saved position exists
      // and the live viewport resolves EARLIER in the document, the saved
      // position wins: the user manually scrolled away after TTS had advanced
      // past the viewed page, so TTS must resume from where narration actually
      // stopped. A viewport at/after the saved position wins (the normal
      // follow-sync case — the reading position has caught up to narration).
      // An explicit queued anchor (level 1) still beats everything above.
      const saved = savedPositionRef.current;
      if (viewport) {
        if (saved && isPositionEarlier(viewport, saved)) return saved;
        return viewport;
      }
      const authoritative = resolveVia(resolvePositionAnchorRef.current);
      if (authoritative) return authoritative;
      if (saved) return saved;
      const initial = getInitialChunkRef.current();
      if (initial > 0) return { chunkIndex: initial, wordIndex: 0 };
      return { chunkIndex: 0, wordIndex: 0 };
    },
    [resolveVia]
  );

  const getInitialChunkRef = useRef<() => number>(() => 0);

  // Determine initial chunk index from startPosition (legacy fallback only —
  // anchored starts resolve exactly through the speech index).
  const initialChunkRef = useRef<number | null>(null);
  const startPositionRef = useRef(startPosition);
  startPositionRef.current = startPosition;

  const getInitialChunk = useCallback(() => {
    const sp = startPositionRef.current;
    if (!sp) return 0;
    const index = speechIndexRef.current;
    if (docType === "pdf" && sp.pageNumber !== null) {
      const forPage = index.chunksForPage(sp.pageNumber);
      if (forPage.length > 0) return forPage[0];
    }
    if (sp.scrollPercent !== null && sp.scrollPercent > 0) {
      return index.chunkIndexForScrollPercent(sp.scrollPercent);
    }
    return 0;
  }, [docType]);
  getInitialChunkRef.current = getInitialChunk;

  // (findVisibleChunkIndex was removed: starts resolve exactly through the
  // speech index — see resolveStartPosition.)

  // Sync refs for values read in callbacks (avoids stale closures)
  const isAutoPlayingRef = useRef(isAutoPlaying);
  isAutoPlayingRef.current = isAutoPlaying;
  const bufferStatusRef = useRef(bufferStatus);
  bufferStatusRef.current = bufferStatus;
  const chunksLenRef = useRef(chunks.length);
  chunksLenRef.current = chunks.length;
  const onChunkChangeRef = useRef(onChunkChange);
  onChunkChangeRef.current = onChunkChange;

  // Waterfall buffer manager — tracks generation concurrency across all providers
  const bufferMgrRef = useRef({
    activeGenCount: 0,
    queuedIndices: new Set<number>(),
    getBufferedSecondsAhead(index: number): number {
      let total = 0;
      for (let i = index; i < chunksLenRef.current; i++) {
        const entry = audioBufferRef.current.get(i);
        if (!entry) break;
        total += entry.durationSec ?? 3;
      }
      return total;
    },
    evictPlayedChunks(index: number) {
      const cutoff = index - EVICT_BEHIND_COUNT;
      for (const key of audioBufferRef.current.keys()) {
        if (key < cutoff) {
          audioBufferRef.current.delete(key);
        }
      }
      setBufferStatus((prev) => {
        const next = new Map(prev);
        let changed = false;
        for (const key of next.keys()) {
          if (key < cutoff) {
            next.delete(key);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    },
    reset() {
      this.activeGenCount = 0;
      this.queuedIndices.clear();
    },
  });

  // Create a text fingerprint to detect when content actually changes. Uses the
  // persistence module's fingerprint (folded head/tail + length) so the reset
  // effect and the persisted record share one definition of "genuine change".
  const textFingerprint = useMemo(() => fingerprintDocument(text), [text]);
  const textFingerprintRef = useRef(textFingerprint);
  textFingerprintRef.current = textFingerprint;
  // Previous text fingerprint, used when flushing an OLD document's listening
  // position from an effect that runs after this render has already updated
  // `textFingerprintRef` to the NEW document's fingerprint. Tracked with the
  // standard "previous value" pattern: a trailing effect (declared AFTER the
  // flush effects) updates it once per commit, so the flush effects always see
  // the fingerprint that was current BEFORE this render.
  const prevTextFingerprintRef = useRef(textFingerprint);

  // Selected voice for generation
  const voiceId = useMemo(() => {
    const hasSelectedVoice = providerVoices.some((voice) => voice.id === selectedVoiceId);
    return hasSelectedVoice ? selectedVoiceId : providerVoices[0]?.id || tts?.defaultVoiceId || "";
  }, [providerVoices, selectedVoiceId, tts?.defaultVoiceId]);

  useEffect(() => {
    if (!tts) return;
    const hasSelectedVoice = providerVoices.some((voice) => voice.id === selectedVoiceId);
    if (!hasSelectedVoice) {
      setSelectedVoiceId(providerVoices[0]?.id || tts.defaultVoiceId);
    }
  }, [tts, providerVoices, selectedVoiceId]);

  // ── Listening-position persistence (#2) ───────────────────────────────────
  // Build a TTSListeningPosition record from the canonical position. The
  // record is written FROM canonical state (never from a viewport-top word or
  // session-start chunk). Returns null when there is no document identity.
  const buildListeningPosition = useCallback(
    (docIdOverride?: string | null, fingerprintOverride?: string): TTSListeningPosition | null => {
      const docId = docIdOverride ?? documentIdRef.current;
      if (!docId) return null;
      if (!engagedRef.current) return null;
      const pos = getCanonicalPosition();
      const index = speechIndexRef.current;
      const chunk = playlistRef.current[pos.chunkIndex];
      if (!chunk) return null;
      const wordIndex = Math.min(pos.wordIndex, Math.max(0, chunk.words.length - 1));
      const word = chunk.words[wordIndex];
      const normStart = word?.normStart ?? 0;
      const normEnd = word?.normEnd ?? normStart;
      return {
        documentId: docId,
        profileId: getProfileId(),
        updatedAt: Date.now(),
        textFingerprint: fingerprintOverride ?? textFingerprintRef.current,
        speechFingerprint: fingerprintSpeechIndex(index),
        provider: tts?.provider ?? "",
        model:
          (tts?.providers as Record<string, { modelId?: string }> | undefined)?.[
            tts?.provider as string
          ]?.modelId ?? "",
        voiceId,
        stableAnchor:
          word?.anchor ?? { kind: "text", surface: "tts", startOffset: word?.sectionOffset ?? 0 },
        chunkIndex: pos.chunkIndex,
        chunkTextHash: digestText128(chunk.text),
        wordIndex,
        normalizedCharOffset: word?.sectionOffset ?? 0,
        intraChunkMs: pos.intraChunkMs,
        surroundingText: chunk.text.slice(Math.max(0, normStart - 60), Math.min(chunk.text.length, normEnd + 60)),
        scrollPercentHint: index.getScrollPercent(pos.chunkIndex),
        cfi: null,
        pageNumber: chunk.pageNumbers?.[0] ?? null,
      };
    },
    [getCanonicalPosition, tts, voiceId]
  );

  // Throttled while playing (module's 4 s throttle); `flush` bypasses it.
  const saveListeningPosition = useCallback(
    (flush: boolean, docIdOverride?: string | null, fingerprintOverride?: string) => {
      const docId = docIdOverride ?? documentIdRef.current;
      if (!docId) return;
      const pos = buildListeningPosition(docId, fingerprintOverride);
      if (!pos) return;
      void saveTTSListeningPosition(pos, { flush });
    },
    [buildListeningPosition]
  );

  // Throttled saves while actively playing.
  useEffect(() => {
    if (!isPlaying || isPaused) return;
    const id = setInterval(() => saveListeningPosition(false), 4000);
    return () => clearInterval(id);
  }, [isPlaying, isPaused, saveListeningPosition]);

  // Reconcile the current canonical position against a rebuilt speech index
  // (incidental re-extraction / document regeneration while playing) — exact
  // anchor when it resolves, otherwise nearest-anchor via the persistence
  // module's fallback chain. Returns null when nothing resolves.
  const resolvePreservedPosition = useCallback((): SpeechPosition | null => {
    const index = speechIndexRef.current;
    const pos = canonicalRef.current;
    const span = lastSpokenSpanRef.current;
    if (!span.text) return null;
    const fake: TTSListeningPosition = {
      documentId: "",
      profileId: "",
      updatedAt: Date.now(),
      textFingerprint: "",
      speechFingerprint: "",
      provider: "",
      model: "",
      voiceId: "",
      stableAnchor:
        lastSpokenAnchorRef.current ??
        { kind: "text", surface: "tts", startOffset: 0 },
      chunkIndex: pos.chunkIndex,
      chunkTextHash: digestText128(span.text),
      wordIndex: pos.wordIndex,
      normalizedCharOffset: 0,
      intraChunkMs: pos.intraChunkMs,
      surroundingText: span.text.slice(
        Math.max(0, span.normStart - 60),
        Math.min(span.text.length, span.normEnd + 60),
      ),
      scrollPercentHint: index.getScrollPercent(pos.chunkIndex),
      cfi: null,
      pageNumber: null,
    };
    return resolveListeningPosition(index, fake);
  }, []);

  // Immediate flush when the user pauses (all engines).
  useEffect(() => {
    if (isPaused) saveListeningPosition(true);
  }, [isPaused, saveListeningPosition]);

  // Flush + unload handling: persist the exact position before the process
  // exits so a later restart can resume (IndexedDB write + sync localStorage
  // fallback).
  useEffect(() => {
    const onUnload = () => {
      const docId = documentIdRef.current;
      if (!docId) return;
      const pos = buildListeningPosition();
      if (!pos) return;
      void saveTTSListeningPosition(pos, { flush: true });
      writeListeningPositionSync(pos);
    };
    window.addEventListener("beforeunload", onUnload);
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("pagehide", onUnload);
      onUnload();
    };
  }, [buildListeningPosition]);

  // Reset when text changes: only on a genuine fingerprint change; preserves
  // the session position on incidental re-extraction.
  useEffect(() => {
    if (advancingRef.current) {
      // Queue advancement: flush the completed document's listening position
      // before switching, then auto-continue in the new document. This effect
      // runs BEFORE the documentId-flush effect (declaration order), so
      // `prevDocumentIdRef` still names the OLD document here — the flush must
      // never write a record for the new, not-yet-listened-to document. The
      // record must also carry the OLD text's fingerprint (`prevTextFingerprintRef`),
      // because this render has already reset `textFingerprintRef` to the new
      // document's fingerprint.
      saveListeningPosition(true, prevDocumentIdRef.current, prevTextFingerprintRef.current);
      // Advance the previous-document marker NOW so the documentId-flush effect
      // (which runs next in this same commit) sees `prev === documentId` and
      // skips its redundant flush. Without this, it would flush the OLD key a
      // second time AFTER the refs below have been reset to the new document,
      // overwriting the old record with new-document content identity.
      prevDocumentIdRef.current = documentIdRef.current;
      playbackIdRef.current++;
      applySessionLeading(null);
      pendingAnchorRef.current = null;
      const initialChunk = getInitialChunk();
      commitChunk(initialChunk);
      canonicalRef.current.wordIndex = 0;
      initialChunkRef.current = initialChunk;
      setIsBuffering(false);
      stopAudio();
      audioBufferRef.current.clear();
      setBufferStatus(new Map());
      bufferMgrRef.current.reset();
      advancingRef.current = false;
      setIsAutoPlaying(true);
      intentionalStopRef.current = false;
      playChunkAtIndexRef.current(initialChunk);
      return;
    }

    // Genuine text change while paused: cancel the stale audio and rebuild
    // buffers for the new text, then reconcile the canonical position — WITHOUT
    // auto-playing and WITHOUT leaving the paused state. Resume restarts from
    // the reconciled position (`pausedRestartPositionRef`) so it can never
    // play stale pre-change content. Incidental re-extraction (same
    // fingerprint) never reaches this branch — it is a no-op.
    if (isPausedRef.current) {
      const preserved = resolvePreservedPosition();
      const pos = preserved ?? { chunkIndex: getInitialChunk(), wordIndex: 0 };
      pausedRestartPositionRef.current = pos;
      playbackIdRef.current++;
      applySessionLeading(null);
      setIsBuffering(false);
      cancelAudio();
      audioBufferRef.current.clear();
      setBufferStatus(new Map());
      bufferMgrRef.current.reset();
      commitChunk(pos.chunkIndex);
      canonicalRef.current.wordIndex = pos.wordIndex;
      setWordOffset(pos.wordIndex);
      initialChunkRef.current = pos.chunkIndex;
      return;
    }

    if (isPlayingRef.current) {
      // Genuine mid-playback text change: reconcile the canonical position
      // against the rebuilt index and continue from the preserved location.
      const preserved = resolvePreservedPosition();
      playbackIdRef.current++;
      applySessionLeading(null);
      pendingAnchorRef.current = null;
      setIsBuffering(false);
      stopAudio();
      audioBufferRef.current.clear();
      setBufferStatus(new Map());
      bufferMgrRef.current.reset();
      setIsAutoPlaying(true);
      intentionalStopRef.current = false;
      void startAtPosition(preserved ?? { chunkIndex: getInitialChunk(), wordIndex: 0 });
      return;
    }

    // Stopped: rebuild buffers for the new text without starting playback.
    playbackIdRef.current++;
    applySessionLeading(null);
    pendingAnchorRef.current = null;
    const initialChunk = getInitialChunk();
    commitChunk(initialChunk);
    canonicalRef.current.wordIndex = 0;
    initialChunkRef.current = initialChunk;
    setIsBuffering(false);
    stopAudio();
    audioBufferRef.current.clear();
    setBufferStatus(new Map());
    bufferMgrRef.current.reset();
    setIsAutoPlaying(false);
    intentionalStopRef.current = true;
  }, [textFingerprint]);

  // Flush the previous document's position before switching documents
  // (navigation away / Queue advancement to a new item). Declared AFTER the
  // fingerprint reset effect: on Queue advancement the fingerprint effect
  // flushes the OLD document first (it still sees the previous document id
  // here), then this effect advances `prevDocumentIdRef` to the new document.
  // The old key must carry the fingerprint that was current BEFORE this render
  // (`prevTextFingerprintRef`), since `textFingerprintRef` already reflects the
  // new document's text.
  useEffect(() => {
    const prev = prevDocumentIdRef.current;
    prevDocumentIdRef.current = documentId;
    if (prev !== undefined && prev !== documentId) {
      saveListeningPosition(true, prev, prevTextFingerprintRef.current);
    }
  }, [documentId, saveListeningPosition]);

  // Track the previous text fingerprint for the flush effects above (standard
  // "previous value" pattern — declared LAST so it runs after them each commit).
  useEffect(() => {
    prevTextFingerprintRef.current = textFingerprint;
  }, [textFingerprint]);

  // Restore the "saved position" (priority level 4) when the document or its
  // text changes: load the persisted record and reconcile it against the
  // current speech index (nearest-anchor fallback).
  useEffect(() => {
    savedPositionRef.current = null;
    const docId = documentId;
    if (!docId) return;
    let cancelled = false;
    void getTTSListeningPosition(docId).then((record) => {
      if (cancelled || !record) return;
      savedPositionRef.current = resolveListeningPosition(speechIndexRef.current, record);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId, textFingerprint]);

  useEffect(() => {
    playbackStateRef.current = isPlaying ? "playing" : isPaused ? "paused" : "stopped";
  }, [isPlaying, isPaused]);

  // Cancel the active engine playback without touching React playback state
  // (used to stop stale audio after a genuine text change while paused, where
  // the paused UI state must be preserved). `stopAudio` wraps this with the
  // stopped-state transitions.
  const cancelAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    // System TTS: cancel any in-flight synthesis.
    if (utteranceRef.current) {
      utteranceRef.current.onend = null;
      utteranceRef.current.onerror = null;
      utteranceRef.current.onboundary = null;
      utteranceRef.current = null;
    }
    if (isSystemProvider && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    // Native Android provider: stop native playback and unsubscribe events.
    if (isAndroidProvider && isAndroidTtsAvailable()) {
      nativeStop().catch(() => {});
    }
    const nativeUnsubs = nativeUnsubRef.current;
    nativeUnsubRef.current = [];
    for (const u of nativeUnsubs) {
      try {
        u();
      } catch {
        /* ignore */
      }
    }
  }, [isSystemProvider, isAndroidProvider]);

  const stopAudio = useCallback(() => {
    cancelAudio();
    setIsPlaying(false);
    setIsPaused(false);
    stopWordTracking();
  }, [cancelAudio, stopWordTracking]);

  // Generate audio for a chunk
  const generateChunkAudio = useCallback(
    async (index: number): Promise<BufferedAudio | null> => {
      const list = playlistRef.current;
      if (index < 0 || index >= list.length) return null;

      const chunk = list[index];
      if (!chunk) return null;
      const chunkText = chunk.text;

      // System TTS synthesizes directly at playback time — nothing to fetch/buffer.
      if (isSystemProvider) {
        const buffered: BufferedAudio = { audioUrl: "", system: true };
        audioBufferRef.current.set(index, buffered);
        setBufferStatus((prev) => new Map(prev).set(index, "ready"));
        return buffered;
      }
      // Native Android provider: playback is owned by the plugin; no audio URL.
      if (isAndroidProvider) {
        const buffered: BufferedAudio = { audioUrl: "android-native://playback", system: true };
        audioBufferRef.current.set(index, buffered);
        setBufferStatus((prev) => new Map(prev).set(index, "ready"));
        return buffered;
      }

      try {
        setBufferStatus((prev) => new Map(prev).set(index, "loading"));
        // Session epoch: a retarget/stop/voice change while this request is in
        // flight invalidates its result — stale audio must never play. The
        // IndexedDB cache write (inside generateSpeech) stays valid.
        const epoch = playbackIdRef.current;

        const result = await generateSpeech(settings, {
          text: chunkText,
          voiceId,
          includeTimings: true,
        });

        if (!mountedRef.current || playbackIdRef.current !== epoch) {
          // Stale: drop the buffer entry and revoke the non-cached object URL.
          if (result.audioUrl.startsWith("blob:")) {
            try {
              URL.revokeObjectURL(result.audioUrl);
            } catch {
              /* ignore */
            }
          }
          bufferMgrRef.current.activeGenCount = Math.max(0, bufferMgrRef.current.activeGenCount - 1);
          bufferMgrRef.current.queuedIndices.delete(index);
          return null;
        }

        const buffered: BufferedAudio = {
          audioUrl: result.audioUrl,
          durationSec: result.durationSec,
          text: chunkText,
          wordTimings: result.wordTimings,
        };

        audioBufferRef.current.set(index, buffered);
        setBufferStatus((prev) => new Map(prev).set(index, "ready"));

        bufferMgrRef.current.activeGenCount = Math.max(0, bufferMgrRef.current.activeGenCount - 1);
        bufferMgrRef.current.queuedIndices.delete(index);

        return buffered;
      } catch (error) {
        console.error(`Failed to generate audio for chunk ${index}:`, error);
        setBufferStatus((prev) => new Map(prev).set(index, "error"));
        bufferMgrRef.current.activeGenCount = Math.max(0, bufferMgrRef.current.activeGenCount - 1);
        bufferMgrRef.current.queuedIndices.delete(index);
        return null;
      }
    },
    [playlist, settings, voiceId]
  );

  // Pre-buffer upcoming chunks — unified waterfall for all providers
  const preBufferChunks = useCallback(
    (fromIndex: number) => {
      bufferMgrRef.current.evictPlayedChunks(fromIndex);

      const mgr = bufferMgrRef.current;
      const list = playlistRef.current;
      const secondsAhead = mgr.getBufferedSecondsAhead(fromIndex);
      if (secondsAhead >= BUFFER_TARGET_SEC) return;

      let bufferedSec = secondsAhead;
      let idx = fromIndex;
      while (idx < list.length && bufferedSec < BUFFER_TARGET_SEC) {
        if (!audioBufferRef.current.has(idx) && !mgr.queuedIndices.has(idx)) {
          const status = bufferStatusRef.current.get(idx);
          if (!status || status === "error") {
            if (mgr.activeGenCount < MAX_CONCURRENT_GEN) {
              mgr.activeGenCount++;
              mgr.queuedIndices.add(idx);
              setBufferStatus((prev) => new Map(prev).set(idx, "pending"));
              generateChunkAudio(idx).catch((err) => {
                console.warn(`Background generation failed for chunk ${idx}:`, err);
              });
            }
          }
        }
        const entry = audioBufferRef.current.get(idx);
        if (entry) bufferedSec += entry.durationSec ?? 3;
        idx++;
      }
    },
    [chunks.length, generateChunkAudio]
  );

  // Ref so audio.onended always calls the latest playChunkAtIndex (avoids stale closure)
  const playChunkAtIndexRef = useRef<(index: number) => Promise<void>>(() => Promise.resolve());

  // Play a chunk by index
  const playChunkAtIndex = useCallback(
    async (index: number) => {
      const list = playlistRef.current;
      if (index < 0 || index >= list.length) return;

      const playId = ++playbackIdRef.current;

      const chunk = list[index];
      const chunkText = chunk.text;
      commitChunk(index);
      canonicalRef.current.wordIndex = 0;
      canonicalRef.current.intraChunkMs = 0;
      setWordOffset(0);
      onChunkStart?.(index, chunkText);
      onChunkChangeRef.current?.(index, speechIndexRef.current.getScrollPercent(index));

      let buffered = audioBufferRef.current.get(index);
      // A transient sliced chunk at this index invalidates any buffered audio
      // generated for different text (distinct cache identity, same index).
      if (buffered && buffered.text !== undefined && buffered.text !== chunkText) {
        audioBufferRef.current.delete(index);
        buffered = undefined;
      }

      if (!buffered) {
        // Buffer underrun — show indicator and generate synchronously
        setIsBuffering(true);
        buffered = await generateChunkAudio(index);
        setIsBuffering(false);
        if (!mountedRef.current || playbackIdRef.current !== playId) {
          return;
        }

        if (!buffered) {
          console.error("Failed to generate audio for chunk", index);
          setIsAutoPlaying(false);
          return;
        }
      }

      if (!mountedRef.current || playbackIdRef.current !== playId) {
        return;
      }

      stopAudio();

      // ── System TTS: synthesize directly via the device speech engine ──────
      // No audio element/URL; word highlighting comes from onboundary events
      // (more accurate than the time-fraction heuristic used for cloud audio).
      if (isSystemProvider && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(chunkText);
        utterance.rate = playbackRate;
        const sysVoice = resolveSystemVoice(voiceId, systemSynthVoices);
        if (sysVoice) {
          utterance.voice = sysVoice;
          utterance.lang = sysVoice.lang;
        }
        utterance.onstart = () => {
          if (!mountedRef.current || playbackIdRef.current !== playId) return;
          setIsPlaying(true);
          setIsPaused(false);
          commitWord(0, null);
        };
        utterance.onboundary = (event) => {
          if (!mountedRef.current || playbackIdRef.current !== playId) return;
          if (typeof event.charIndex === "number") {
            commitWord(charIndexToWordIndex(chunkText, event.charIndex), null);
          }
        };
        utterance.onend = () => {
          if (!mountedRef.current || playbackIdRef.current !== playId) return;
          setIsPlaying(false);
          setIsPaused(false);
          commitWord(0, null);
          if (isAutoPlayingRef.current && autoAdvance && !intentionalStopRef.current) {
            const nextIndex = index + 1;
            if (nextIndex < chunksLenRef.current) {
              playChunkAtIndexRef.current(nextIndex);
            } else {
              advancingRef.current = true;
              setIsAutoPlaying(false);
              onComplete?.();
            }
          }
        };
        utterance.onerror = () => {
          if (!mountedRef.current || playbackIdRef.current !== playId) return;
          setIsPlaying(false);
          setIsPaused(false);
          commitWord(0, null);
        };
        utteranceRef.current = utterance;
        window.speechSynthesis.speak(utterance);
        return;
      }

      // ── Native Android provider: hand the remaining chunks to the plugin ──
      // The plugin owns inference (sherpa-onnx), AudioTrack playback, audio
      // focus, lifecycle, and System-TTS fallback. It does its own prefetching
      // and emits sentence-position/playback-state/utterance-complete events;
      // we use those to drive chunk highlight and auto-advance.
      if (isAndroidProvider && isAndroidTtsAvailable()) {
        const remaining = list.slice(index).map((c) => c.text);
        setIsPlaying(true);
        setIsPaused(false);
        setIsBuffering(false);

        // Subscribe for the duration of this utterance; unsubscribed on
        // completion/error/unmount via the refs the effect cleanup owns.
        // Events are filtered by a monotonic utteranceId (the stale-guard
        // pattern from useNativeAndroidTTS): events for an utterance older
        // than the newest one seen can never move highlight or playback.
        const monotonicUtteranceRef = { current: -1 };
        const acceptUtterance = (utteranceId: number | undefined): boolean => {
          if (typeof utteranceId !== "number") return true;
          if (utteranceId < monotonicUtteranceRef.current) return false;
          monotonicUtteranceRef.current = utteranceId;
          return true;
        };
        const nativeUnsub: Array<() => void> = [];
        nativeUnsub.push(
          await onNativePlaybackState(() => {
            /* state handled below */
          })
        );
        nativeUnsub.push(
          await onNativeSentencePosition((e) => {
            if (!mountedRef.current || playbackIdRef.current !== playId) return;
            if (!acceptUtterance((e as { utteranceId?: number }).utteranceId)) return;
            // The plugin's index is relative to the slice we handed it.
            const absolute = index + e.index;
            if (absolute !== chunkIndex) {
              commitChunk(absolute);
              onChunkStart?.(absolute, playlistRef.current[absolute]?.text ?? e.sentence);
              onChunkChangeRef.current?.(
                absolute,
                speechIndexRef.current.getScrollPercent(absolute)
              );
              // Sherpa engine path (no word events): the sentence anchor is
              // the best safe fallback — the first word of the chunk,
              // explicitly marked approximate.
              commitWord(0, null);
              setActiveTimingApproximate(true);
            }
          })
        );
        // Fallback-engine word events (onRangeStart): exact active-word
        // updates, filtered by the monotonic utterance guard.
        nativeUnsub.push(
          await onNativeWordPosition((e) => {
            if (!mountedRef.current || playbackIdRef.current !== playId) return;
            if (!acceptUtterance((e as { utteranceId?: number }).utteranceId)) return;
            const absolute = index + e.sentenceIndex;
            const text = playlistRef.current[absolute]?.text;
            if (!text) return;
            commitChunk(absolute);
            commitWord(charIndexToWordIndex(text, e.charIndex), null);
            setActiveTimingApproximate(false);
          })
        );
        nativeUnsub.push(
          await onNativeUtteranceComplete(() => {
            if (!mountedRef.current || playbackIdRef.current !== playId) return;
            setIsPlaying(false);
            setIsPaused(false);
            if (isAutoPlayingRef.current && autoAdvance && !intentionalStopRef.current) {
              advancingRef.current = true;
              setIsAutoPlaying(false);
              onComplete?.();
            }
          })
        );
        nativeUnsub.push(
          await onNativeTtsError(() => {
            if (!mountedRef.current || playbackIdRef.current !== playId) return;
            setIsPlaying(false);
            setIsPaused(false);
          })
        );
        nativeUnsubRef.current = nativeUnsub;

        try {
          await nativeSpeak({
            sentences: remaining,
            modelId: tts?.providers?.android?.modelId,
            voiceId,
            speed: playbackRate,
          });
        } catch (err) {
          console.error("Native Android TTS failed to start:", err);
          setIsPlaying(false);
          nativeUnsub.forEach((u) => {
            try {
              u();
            } catch {
              /* ignore */
            }
          });
        }
        return;
      }

      const audio = new Audio(buffered.audioUrl);
      audio.playbackRate = playbackRate;
      audioRef.current = audio;

      audio.onplay = () => {
        setIsPlaying(true);
        setIsPaused(false);
        startWordTracking(audio, chunkText, buffered.wordTimings);
      };

      audio.onpause = () => {
        if (!audio.ended) {
          setIsPaused(true);
          setIsPlaying(false);
        }
        stopWordTracking();
      };

      audio.onended = () => {
        setIsPlaying(false);
        setIsPaused(false);
        stopWordTracking();

        if (isAutoPlayingRef.current && autoAdvance && !intentionalStopRef.current) {
          const nextIndex = index + 1;
          if (nextIndex < chunksLenRef.current) {
            playChunkAtIndexRef.current(nextIndex);
          } else {
            // All done — signal advance so new text triggers auto-continue
            advancingRef.current = true;
            setIsAutoPlaying(false);
            onComplete?.();
          }
        }
      };

      audio.onerror = () => {
        console.error("Audio playback error");
        setIsPlaying(false);
        setIsPaused(false);
        stopWordTracking();
      };

      try {
        await audio.play();
        preBufferChunks(index + 1);
      } catch (error) {
        console.error("Failed to play audio:", error);
        setIsPlaying(false);
        stopWordTracking();
      }
    },
    [
      chunks,
      playbackRate,
      autoAdvance,
      stopAudio,
      generateChunkAudio,
      preBufferChunks,
      onComplete,
      onChunkStart,
      startWordTracking,
      stopWordTracking,
      isSystemProvider,
      systemSynthVoices,
      voiceId,
      commitChunk,
    ]
  );
  playChunkAtIndexRef.current = playChunkAtIndex;

  /**
   * Begin playback at an exact speech position. A mid-chunk word start slices
   * the chunk into a transient leading chunk (its own cache identity); the
   * normal chunk sequence continues afterward. Seeking into a cached full-chunk
   * clip without measured timings is never attempted.
   */
  const startAtPosition = useCallback(
    async (pos: SpeechPosition) => {
      engagedRef.current = true;
      const index = speechIndexRef.current;
      if (pos.wordIndex > 0) {
        const sliced = index.sliceChunkAtWord(pos.chunkIndex, pos.wordIndex);
        applySessionLeading(sliced ? { chunkIndex: pos.chunkIndex, chunk: sliced } : null);
      } else {
        applySessionLeading(null);
      }
      setIsAutoPlaying(true);
      intentionalStopRef.current = false;
      await playChunkAtIndex(pos.chunkIndex);
    },
    [applySessionLeading, playChunkAtIndex]
  );

  /**
   * Imperative start (selection "Read from here", TOC retarget): resolve the
   * anchor through the full priority chain and begin playback there.
   */
  const startFrom = useCallback(
    async (anchor: TTSStartAnchor) => {
      saveListeningPosition(true);
      stopAudio();
      const pos = resolveStartPosition(anchor);
      await startAtPosition(pos);
    },
    [saveListeningPosition, stopAudio, resolveStartPosition, startAtPosition]
  );
  const startFromRef = useRef(startFrom);
  startFromRef.current = startFrom;
  const handleStopRef = useRef<() => void>(() => {});

  useImperativeHandle(
    ref,
    () => ({
      startFrom: (anchor: TTSStartAnchor) => {
        void startFromRef.current(anchor);
      },
      stop: () => handleStopRef.current(),
      queueAnchor: (anchor: TTSStartAnchor) => {
        pendingAnchorRef.current = anchor;
      },
      playbackState: () => playbackStateRef.current,
    }),
    []
  );

  useEffect(() => {
    if (chunks.length > 0 && ttsEnabled) {
      const startIdx = initialChunkRef.current ?? 0;
      preBufferChunks(startIdx);
    }
  }, [chunks.length, ttsEnabled, preBufferChunks]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      playbackIdRef.current++;
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        } catch {
          // Ignore errors from already paused or ended audio elements
        }
        audioRef.current = null;
      }
      // Stop any in-flight system TTS synthesis on unmount.
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Controls
  const handlePlayPause = async () => {
    // ── Pause (all engines) ──
    if (isPlaying && !isPaused) {
      if (isSystemProvider && "speechSynthesis" in window) {
        window.speechSynthesis.pause();
      } else if (isAndroidProvider && isAndroidTtsAvailable()) {
        nativePause().catch(() => {});
      } else {
        playbackIdRef.current++;
        audioRef.current?.pause();
      }
      setIsPaused(true);
      setIsPlaying(false);
      return;
    }

    setIsAutoPlaying(true);
    intentionalStopRef.current = false;

    if (isPaused) {
      // A queued anchor (TOC navigation while paused) rebases the resume
      // position; playback does not start until the user resumes.
      const queued = pendingAnchorRef.current;
      if (queued) {
        pendingAnchorRef.current = null;
        saveListeningPosition(true);
        stopAudio();
        await startAtPosition(resolveStartPosition(queued));
        return;
      }
      // A genuine text change while paused cancelled the stale audio and
      // reconciled the position; resume must restart there (the old utterance
      // can no longer be resumed).
      const restart = pausedRestartPositionRef.current;
      if (restart) {
        pausedRestartPositionRef.current = null;
        saveListeningPosition(true);
        stopAudio();
        await startAtPosition(restart);
        return;
      }
      // Paused-resume semantics (#5): resume at the exact paused word unless
      // the user deliberately scrolled while paused (follow suspended by a
      // real user scroll — `useSpokenWordFollow`'s pausedByUser, or the host's
      // `autoScrollPaused`), in which case re-anchor to the viewport with a
      // sentence look-behind for audible context. The auto-follow viewport
      // top sitting in an earlier chunk is NEVER treated as a move. Runs for
      // every engine before the engine-specific exact resume.
      const userScrolled = followPausedByUser || autoScrollPaused;
      if (userScrolled) {
        const viewport = resolveVia(resolveViewportAnchorRef.current);
        if (viewport) {
          saveListeningPosition(true);
          stopAudio();
          await startAtPosition(speechIndexRef.current.sentenceStartFor(viewport));
          return;
        }
      }
      // Engine-specific exact resume.
      if (isSystemProvider && "speechSynthesis" in window) {
        window.speechSynthesis.resume();
        setIsPaused(false);
        setIsPlaying(true);
        return;
      }
      if (isAndroidProvider && isAndroidTtsAvailable()) {
        nativeResume().catch(() => {});
        setIsPaused(false);
        setIsPlaying(true);
        return;
      }
      if (audioRef.current) {
        audioRef.current.play();
        startWordTracking(
          audioRef.current,
          playlistRef.current[chunkIndex]?.text ?? "",
          audioBufferRef.current.get(chunkIndex)?.wordTimings
        );
      }
      return;
    }

    // Starting fresh (or after a stop): explicit pending anchor (level 1) →
    // live viewport (2) → authoritative position (3) → saved position (4) →
    // start (5).
    const explicit = pendingAnchorRef.current;
    pendingAnchorRef.current = null;
    const pos = resolveStartPosition(explicit);
    if (pos.chunkIndex !== chunkIndex || pos.wordIndex > 0) {
      stopAudio();
    }
    await startAtPosition(pos);
  };

  const handleStop = () => {
    playbackIdRef.current++;
    intentionalStopRef.current = true;
    saveListeningPosition(true);
    setIsAutoPlaying(false);
    applySessionLeading(null);
    pendingAnchorRef.current = null;
    stopAudio();
  };
  handleStopRef.current = handleStop;

  const handlePrev = async () => {
    playbackIdRef.current++;
    intentionalStopRef.current = true;
    saveListeningPosition(true);
    stopAudio();
    setIsAutoPlaying(true);
    intentionalStopRef.current = false;
    await playChunkAtIndex(chunkIndex - 1);
  };

  const handleNext = async () => {
    playbackIdRef.current++;
    intentionalStopRef.current = true;
    saveListeningPosition(true);
    stopAudio();
    setIsAutoPlaying(true);
    intentionalStopRef.current = false;
    await playChunkAtIndex(chunkIndex + 1);
  };

  // Reader speech is a first-class playback host. Its OS-facing controls are
  // registered through the same bridge as Audio Editions; sentence-based
  // engines intentionally omit precise seek capabilities.
  const readerSourceKind = isAndroidProvider
    ? ("native_android_tts" as const)
    : isSystemProvider
      ? ("web_speech" as const)
      : ("generated_audio" as const);
  const readerSourceId = `reader:${documentId ?? "active"}`;
  const readerSessionId = createLongFormSessionId(readerSourceKind, readerSourceId);
  const readerMediaContextRef = useRef<RemoteMediaContext>({
    documentId: documentId ?? "reader",
    documentTitle: "Read aloud",
    playbackSessionId: readerSessionId,
    sourceId: readerSourceId,
    audioElement: null,
    currentTimestampSec: 0,
    anchors: [],
  });
  const preciseReaderAudio = !isSystemProvider && !isAndroidProvider;
  readerMediaContextRef.current = {
    documentId: documentId ?? "reader",
    documentTitle: "Read aloud",
    playbackSessionId: readerSessionId,
    sourceId: readerSourceId,
    audioElement: audioRef.current,
    currentTimestampSec: audioRef.current?.currentTime ?? chunkIndex,
    anchors: [],
    onPlayPause: () => {
      void handlePlayPause();
    },
    onNextChapter: () => {
      void handleNext();
    },
    onPrevChapter: () => {
      void handlePrev();
    },
    onSeekRelative: preciseReaderAudio
      ? (deltaSec) => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, audio.currentTime + deltaSec));
        }
      : undefined,
    onSeekAbsolute: preciseReaderAudio
      ? (positionSec) => {
          const audio = audioRef.current;
          if (audio) audio.currentTime = Math.max(0, Math.min(audio.duration || Infinity, positionSec));
        }
      : undefined,
  };
  useRemoteMediaBridge({
    getContext: () => readerMediaContextRef.current,
    title: "Read aloud",
    artist: "Plethora",
    album: "Reader",
    sourceId: readerSourceId,
    sessionId: readerSessionId,
    sourceKind: readerSourceKind,
    section: { index: chunkIndex, title: `Section ${chunkIndex + 1}`, anchor: String(chunkIndex) },
    isPlaying,
    // Auto-play still loading audio is honest buffering, not a paused media
    // session; the bridge defers OS-visible controls until playback starts.
    playbackState: isPlaying ? "playing" : isPaused ? "paused" : "buffering",
    enabled: isPlaying || isPaused || isAutoPlaying,
    duration: preciseReaderAudio ? audioRef.current?.duration : undefined,
    currentTime: audioRef.current?.currentTime ?? chunkIndex,
    playbackRate,
    capabilities: {
      canPlay: true,
      canPause: true,
      canResume: true,
      canSeekRelative: preciseReaderAudio,
      canSeekAbsolute: preciseReaderAudio,
      precisePosition: preciseReaderAudio,
      canNext: true,
      canPrevious: true,
    },
  });

  const handleVoiceChange = (voiceId: string) => {
    playbackIdRef.current++;
    setSelectedVoiceId(voiceId);
    if (!tts) return;
    updateSettings({
      tts: {
        ...tts,
        defaultVoiceId: voiceId,
      },
    });
    // Clear buffer when voice changes since audio URLs are voice-specific
    audioBufferRef.current.clear();
    setBufferStatus(new Map());
    bufferMgrRef.current.reset();
  };

  const speedOptions = [0.8, 1, 1.2, 1.5, 2];

  if (chunks.length === 0) return null;
  if (!ttsEnabled) {
    // Discoverable affordance stays available; playback bar hidden when disabled is handled by DocumentViewer Listen button.
    // Keep handle available but don't render bar here.
    return null;
  }

  const currentChunk = chunks[Math.min(chunkIndex, chunks.length - 1)]?.text ?? "";
  const currentBufferStatus = bufferStatus.get(chunkIndex);
  const isLoading = currentBufferStatus === "loading" || currentBufferStatus === "pending";

  return (
    <>
      {(isPlaying || isPaused) && highlightEnabled && currentChunk && (highlightContainerRef?.current || iframeWindow) && (
        <WordHighlightLayer
          enabled={highlightEnabled}
          chunk={playlist[chunkIndex] ?? null}
          chunkText={currentChunk}
          wordOffset={wordOffset}
          timingApproximate={activeTimingApproximate}
          containerRef={highlightContainerRef}
          useChunkLevel={false}
          iframeWindow={iframeWindow}
          sectionContainers={sectionContainers}
        />
      )}
      <div
        className={cn(
          "pointer-events-auto rounded-xl border border-border/80 bg-card/95 px-3 py-2 shadow-lg backdrop-blur",
          className
        )}
      >
        <div className="flex items-center gap-2">
          <SpeakerHigh className="h-4 w-4 text-primary" />
          <button
            onClick={() => void handlePrev()}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
            disabled={chunkIndex === 0 || isLoading}
            title={t("readerTts.previousChunk")}
          >
            <SkipBack className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void handlePlayPause()}
            className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
            disabled={isLoading}
            title={
              isPlaying
                ? isPaused
                  ? t("readerTts.resume")
                  : t("readerTts.pause")
                : t("readerTts.play")
            }
          >
            {isBuffering && isAutoPlaying ? (
              <CircleNotch className="h-3.5 w-3.5 animate-spin" />
            ) : isLoading ? (
              <CircleNotch className="h-3.5 w-3.5 animate-spin" />
            ) : isPlaying && !isPaused ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={handleStop}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
            disabled={!isPlaying && !isPaused}
            title={t("readerTts.stop")}
          >
            <Square className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void handleNext()}
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
            disabled={chunkIndex >= chunks.length - 1 || isLoading}
            title={t("readerTts.nextChunk")}
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>

          <div className="flex items-center gap-1">
            {providerVoices.length ? (
              <select
                value={selectedVoiceId}
                onChange={(e) => handleVoiceChange(e.target.value)}
                className="max-w-[9.5rem] rounded-md border border-border bg-background px-1.5 py-1 text-xs"
                title={t("readerTts.voice")}
              >
                {providerVoices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name}
                  </option>
                ))}
              </select>
            ) : null}

            <select
              value={playbackRate}
              onChange={(e) => {
                const rate = Number(e.target.value);
                setPlaybackRate(rate);
                if (audioRef.current) {
                  audioRef.current.playbackRate = rate;
                }
              }}
              className="rounded-md border border-border bg-background px-1.5 py-1 text-xs"
              title={t("readerTts.playbackSpeed")}
            >
              {speedOptions.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}x
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => {
              onHighlightToggle?.();
            }}
            className={cn(
              "rounded-md border px-2 py-1 text-xs hover:bg-muted",
              highlightEnabled
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            )}
            title={highlightEnabled ? "Disable word highlighting" : "Enable word highlighting"}
          >
            <Highlighter className="h-3.5 w-3.5" />
          </button>

          {(followPausedByUser || autoScrollPaused) && (
            <button
              onClick={() => {
                followReCenter();
                onReCenter?.();
              }}
              className="rounded-md border border-amber-500 bg-amber-500/10 px-2 py-1 text-xs text-amber-600 hover:bg-amber-500/20"
              title="Re-center to current TTS position"
            >
              Re-center
            </button>
          )}

          <span className="text-[11px] text-foreground/80">
            {Math.min(chunkIndex + 1, chunks.length)}/{chunks.length}
          </span>
        </div>
        <p
          className="mt-1 max-w-[26rem] truncate text-[11px] text-foreground/80"
          title={currentChunk}
        >
          {isBuffering && isAutoPlaying
            ? t("readerTts.bufferingNextSegment")
            : isLoading
              ? t("readerTts.generatingAudio")
              : currentChunk}
        </p>
      </div>
    </>
  );
}
);
