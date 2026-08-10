/**
 * Audiobook Viewer
 * 
 * Full-featured audiobook player with:
 - Playback controls (play, pause, skip, speed)
 - Chapter navigation
 - Bookmark management
 - Sleep timer
 - Transcript sync and text selection
 - Extract creation from audio + text
 - Progress tracking
 */

import { useState, useRef, useEffect, useCallback } from "react";
import {
  ArrowCounterClockwise,
  ArrowsInSimple,
  ArrowsOutSimple,
  Bookmark,
  BookmarkSimple,
  CaretLeft,
  CaretRight,
  CircleNotch,
  Clock,
  Headphones,
  Info,
  List,
  Microphone,
  Moon,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Sparkle,
  SpeakerHigh,
  SpeakerSlash,
  TextT,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import { Document } from "../../types/document";
import { useI18n } from "../../lib/i18n";
import {
  SponsorBlockCut,
  SponsorBlockSegment,
  getSponsorBlockCuts,
  fetchSponsorBlockSegments,
  extractVideoID,
  getCategoryDisplayName,
} from "../../api/sponsorblock";
import type {
  AudiobookMetadata,
  AudiobookChapter,
  AudiobookTranscript,
} from "../../api/audiobooks";
import * as audiobookApi from "../../api/audiobooks";
import { useToast } from "../common/Toast";
import { CreateExtractDialog } from "../extracts/CreateExtractDialog";
import { useTranscriptionStore } from "../../stores/useTranscriptionStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { startTranscription } from "../../api/transcription";
import { invokeCommand, isTauri, listen } from "../../lib/tauri";
import { useMobileShell } from "../../hooks/useMobileShell";
import { readDocumentFile, updateDocument as updateDocumentApi, updateDocumentProgressAuto, updateDocumentContent, getDocument } from "../../api/documents";
import { getDocumentPosition, saveDocumentPosition, timePosition } from "../../api/position";
import { getEpisodePosition, updateEpisodePosition, markEpisodePlayed, downloadEpisodeAudio, getDownloadedEpisodePath, getPodcastTranscript, transcribePodcastEpisode, transcribePodcastEpisodeWithGroq } from "../../api/podcast";
import { isNativeMobile } from "../../lib/tauri";
import { logAudiobookDiagnostic } from "../../lib/audiobookDiagnostics";
import { resolveLocalMediaSource } from "./localMediaSource";
import { KaraokeText } from "../media/KaraokeText";
import { findActiveWordIndex, type WordTiming } from "../../utils/wordTimings";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { usePaletteActionListener } from "../../commandPalette/paletteActionEvents";
import { useIsActiveTab } from "../common/Tabs";

export type AudiobookPlaybackErrorKind = "source" | "codec";

export interface AudiobookPlaybackErrorState {
  kind: AudiobookPlaybackErrorKind;
  message: string;
}

export function classifyAudiobookPlaybackError(code?: number): AudiobookPlaybackErrorKind {
  return code === 3 || code === 4 ? "codec" : "source";
}

export function AudiobookPlaybackErrorNotice({
  error,
  retryLabel,
  onRetry,
}: {
  error: AudiobookPlaybackErrorState | null;
  retryLabel: string;
  onRetry: () => void;
}) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
    >
      <span className="text-muted-foreground">{error.message}</span>
      <button
        type="button"
        className="shrink-0 rounded-md border border-border px-3 py-1.5 font-medium hover:bg-muted"
        onClick={onRetry}
      >
        {retryLabel}
      </button>
    </div>
  );
}

interface AudiobookViewerProps {
  document: Document;
  fileContent?: string;
  initialSeekTime?: number;
  initialTranscriptSegmentId?: string;
  autoPlayOnOpen?: boolean;
  audioRef?: React.RefObject<HTMLAudioElement | null>;
  onTimeUpdate?: (currentTime: number) => void;
  /** Direct URL to stream remote audio (for podcast episodes) */
  remoteAudioUrl?: string;
  /** Podcast episode ID for position persistence */
  episodeId?: string;
  /** Override title for podcast episodes */
  episodeTitle?: string;
  /** Parent podcast name for display */
  podcastTitle?: string;
  /** Callback when episode finishes playing */
  onEpisodeEnded?: () => void;
  /** Back/exit handler (mobile top-bar back chevron). */
  onBack?: () => void;
  /** Hide the large repeated title block when a parent podcast shell already labels the episode. */
  hideTitleHeader?: boolean;
}

interface AudiobookBookmark {
  id: string;
  time: number;
  title: string;
  note?: string;
  createdAt: string;
}

// Map elapsed time in a pre-cut audio file back to the original uncut timeline (for transcripts/chapters)
function mapCutTimeToOriginalTime(t: number, cuts: SponsorBlockCut[]): number {
  let mappedTime = t;
  const sortedCuts = [...cuts].sort((a, b) => a.cutStart - b.cutStart);
  for (const cut of sortedCuts) {
    if (t > cut.cutStart) {
      mappedTime += (cut.originalEnd - cut.originalStart);
    }
  }
  return mappedTime;
}

// Map a time in the original uncut timeline to the corresponding time in the pre-cut file (for seeking)
function mapOriginalTimeToCutTime(t: number, cuts: SponsorBlockCut[]): number {
  let reduction = 0;
  const sortedCuts = [...cuts].sort((a, b) => a.originalStart - b.originalStart);
  for (const cut of sortedCuts) {
    if (t >= cut.originalEnd) {
      reduction += (cut.originalEnd - cut.originalStart);
    } else if (t > cut.originalStart) {
      reduction += (t - cut.originalStart);
      break;
    }
  }
  return t - reduction;
}

interface SleepTimer {
  minutes?: number;
  endTime?: number;
  mode: "time" | "chapter";
}

interface MultiPartInfo {
  totalParts: number;
  partFiles: string[];
  partDurations: number[];
}

// Re-exported for callers that historically imported it from here; the
// implementation now lives in utils/wordTimings so the YouTube transcript panel
// can share the exact same active-word math.
export { findActiveWordIndex };

/**
 * Render a transcript segment's text. When per-word timings are available (Groq
 * word-level transcription) AND this segment is the active one, highlight the
 * single word currently being spoken (karaoke-style), syncing to `currentTime`.
 * Otherwise render the plain segment text.
 */
function PodcastSegmentText({
  text,
  wordTimings,
  currentTime,
  isActive,
}: {
  text: string;
  wordTimings?: WordTiming[];
  currentTime: number;
  isActive: boolean;
}) {
  return (
    <p className="text-sm leading-relaxed">
      <KaraokeText
        text={text}
        wordTimings={wordTimings}
        currentTime={currentTime}
        isActive={isActive}
      />
    </p>
  );
}

export function AudiobookViewer({
  document,
  fileContent,
  initialSeekTime,
  initialTranscriptSegmentId,
  autoPlayOnOpen = false,
  audioRef: externalAudioRef,
  onTimeUpdate,
  remoteAudioUrl,
  episodeId,
  episodeTitle,
  podcastTitle,
  onEpisodeEnded,
  onBack,
  hideTitleHeader = false,
}: AudiobookViewerProps) {
  const internalAudioRef = useRef<HTMLAudioElement>(null);
  const audioRef = externalAudioRef ?? internalAudioRef;
  const transcriptRef = useRef<HTMLDivElement>(null);
  const { success: showSuccess, info: showInfo, error: showError } = useToast();
  const { t } = useI18n();

  // SponsorBlock integration states
  const [sponsorBlockCuts, setSponsorBlockCuts] = useState<SponsorBlockCut[]>([]);
  const [sponsorBlockSegments, setSponsorBlockSegments] = useState<SponsorBlockSegment[]>([]);
  const [skipNotification, setSkipNotification] = useState<{
    category: string;
    savedSeconds?: number;
    originalStart?: number;
    originalEnd?: number;
    undoable: boolean;
  } | null>(null);

  const notifiedCutsRef = useRef<Set<string>>(new Set());
  const skippedSegmentsRef = useRef<Set<string>>(new Set());
  const temporarilyDisabledSegmentsRef = useRef<Set<string>>(new Set());
  const skipNotificationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleUndoSkip = (originalStart: number, originalEnd: number, category: string) => {
    const segment = sponsorBlockSegments.find(s => s.segment[0] === originalStart);
    if (segment) {
      temporarilyDisabledSegmentsRef.current.add(segment.UUID);
    }
    
    if (audioRef.current) {
      audioRef.current.currentTime = originalStart;
      setCurrentTime(originalStart);
      currentTimeRef.current = originalStart;
      audioRef.current.play().catch(() => {});
    }
    
    setSkipNotification(null);
    showSuccess("Playing skipped segment: " + getCategoryDisplayName(category as any));
  };
  const { profiles, fetchProfiles, currentStatus, activeJob, activeSegments, loadTranscript, transcriptionProgress } = useTranscriptionStore();
  
  // Core playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [buffered, setBuffered] = useState(0);
  
  // Multi-part handling
  const [multiPartInfo, setMultiPartInfo] = useState<MultiPartInfo | null>(null);
  const [currentPartIndex, setCurrentPartIndex] = useState(0);
  const [partSources, setPartSources] = useState<string[]>([]);
  
  // Audiobook data
  const [metadata, setMetadata] = useState<Partial<AudiobookMetadata>>({});
  const [chapters, setChapters] = useState<AudiobookChapter[]>([]);
  const [transcript, setTranscript] = useState<AudiobookTranscript | null>(null);
  const [bookmarks, setBookmarks] = useState<AudiobookBookmark[]>([]);
  
  // UI state
  const [showChapters, setShowChapters] = useState(false);
  // Adaptive (bottom-sheet on mobile / dialog on desktop) chapters picker.
  // Backs the chapter chip above the progress bar and the chapters button in
  // the control cluster, so chapter navigation works everywhere AudiobookViewer
  // is mounted (Audiobooks tab, Queue, PodcastManager, EPUB sync) — including
  // mobile, where the desktop-only left sidebar is unreachable.
  const [showChaptersSheet, setShowChaptersSheet] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [showSleepTimer, setShowSleepTimer] = useState(false);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [selectedText, setSelectedText] = useState("");
  const [isExtractDialogOpen, setIsExtractDialogOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sleepTimer, setSleepTimer] = useState<SleepTimer | null>(null);
  const [fallbackSrc, setFallbackSrc] = useState<string | null>(null);
  const [hasTriedFallback, setHasTriedFallback] = useState(false);
  // Bumped by retryPlayback to re-run source preparation after a failure, so
  // the retry control actually re-resolves the media source instead of leaving
  // an idle player with no src.
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [localCoverUrl, setLocalCoverUrl] = useState<string | undefined>(document.coverImageUrl);
  const [preparedPlaybackPath, setPreparedPlaybackPath] = useState<string | null>(null);
  const [preparedPlaybackSrc, setPreparedPlaybackSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<AudiobookPlaybackErrorState | null>(null);
  const [podcastLocalSrc, setPodcastLocalSrc] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState<string>("");
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Podcast transcript state (podcasts are stored separately from document/audiobook transcripts)
  const isPodcast = !!episodeId;
  const audioTranscriptionSettings = useSettingsStore((state) => state.settings.audioTranscription);
  const displayProvider = isNativeMobile()
    ? (audioTranscriptionSettings.provider === "local" ? "groq" : audioTranscriptionSettings.provider)
    : audioTranscriptionSettings.provider;
  const isMobile = useMobileShell();
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const [podcastTranscriptText, setPodcastTranscriptText] = useState<string | null>(null);
  const [podcastTranscriptSegments, setPodcastTranscriptSegments] = useState<Array<{ start: number; end: number; text: string; wordTimings?: Array<{ word: string; start_ms: number; end_ms: number }> }>>([]);
  const [podcastTranscriptionProgress, setPodcastTranscriptionProgress] = useState<{ status: string; progress: number } | null>(null);
  const [podcastTranscriptStatus, setPodcastTranscriptStatus] = useState<string | null>(null);
  const [hasLoadedStatus, setHasLoadedStatus] = useState(false);

  // Bookmark annotations state
  const [showBookmarkNoteModal, setShowBookmarkNoteModal] = useState(false);
  const [newBookmarkTime, setNewBookmarkTime] = useState<number | null>(null);
  const [bookmarkTitleInput, setBookmarkTitleInput] = useState("");
  const [bookmarkNoteInput, setBookmarkNoteInput] = useState("");

  // Smart audio enhancements (Web Audio API)
  const [audioContext, setAudioContext] = useState<AudioContext | null>(null);
  const [analyserNode, setAnalyserNode] = useState<AnalyserNode | null>(null);
  const [gainNode, setGainNode] = useState<GainNode | null>(null);
  const [silenceSkipEnabled, setSilenceSkipEnabled] = useState(false);
  const [volumeBoostEnabled, setVolumeBoostEnabled] = useState(false);

  // Listening statistics & tracking
  const [listeningStats, setListeningStats] = useState({ today: 0, week: 0 });
  const lastTimeRef = useRef(0);

  // Audiobook (non-podcast) Groq transcription state. Used on mobile and when
  // the provider is Groq — the auto-transcription queue worker has no Groq path,
  // so we drive the dedicated transcribe_audio_file_groq command from here.
  const [audiobookTranscriptionProgress, setAudiobookTranscriptionProgress] = useState<{ status: string; progress: number; message?: string } | null>(null);

  const shouldPlayAfterDownloadRef = useRef(false);
  const pendingAutoplayAfterDownloadRef = useRef(false);

  const documentIdRef = useRef(document.id);
  const currentTimeRef = useRef(0);
  const currentGlobalTimeRef = useRef(0);
  const durationRef = useRef(0);
  const totalDurationSecondsRef = useRef<number | undefined>(undefined);
  const lastSavedGlobalTimeRef = useRef(0);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const pendingAutoplayAfterFallbackRef = useRef(false);
  const fallbackAttemptedRef = useRef(false);
  const appliedInitialSeekRef = useRef<string | null>(null);
  // Tracks whether the mount-time position/volume/rate restore has already run
  // for the current playback session. Without this, the restore effect re-fires
  // every time `document.currentPage` updates (the 5s auto-save mutates it),
  // which re-seeks the audio element backward and creates a "play 6s, jump back
  // 2s, repeat" feedback loop. Keyed by the session identity, not by progress.
  const restoredSessionRef = useRef<string | null>(null);
  // Always-latest reference to loadSavedPosition so the once-per-session restore
  // effect can invoke it without depending on the callback's identity (which
  // also changes on every `document.currentPage` update).
  const loadSavedPositionRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    fallbackAttemptedRef.current = false;
    setHasTriedFallback(false);
    setPlaybackError(null);
    setFallbackSrc(null);
  }, [document.id]);

  // Auto-fetch cover if document has none
  useEffect(() => {
    if (document.coverImageUrl) {
      setLocalCoverUrl(document.coverImageUrl);
      return;
    }

    // Skip local file cover extraction for remote podcast episodes
    const isRemote = document.filePath?.startsWith("http://") || document.filePath?.startsWith("https://") || document.filePath?.startsWith("data:");
    if (isRemote || (!document.filePath && remoteAudioUrl)) {
      return;
    }

    let cancelled = false;

    const fetchCover = async () => {
      try {
        if (document.filePath) {
          const embeddedCover = await audiobookApi.extractAudioCoverArt(document.filePath);
          if (cancelled) return;

          if (embeddedCover) {
            setLocalCoverUrl(embeddedCover);
            try {
              await updateDocumentApi(document.id, {
                ...document,
                coverImageUrl: embeddedCover,
              } as any);
            } catch (_e) { /* non-critical */ }
            return;
          }
        }

        const author = metadata.author || document.metadata?.author;
        const covers = await audiobookApi.searchAudiobookCover(document.title, author);
        if (cancelled) return;

        if (covers.length > 0) {
          setLocalCoverUrl(covers[0]);
          try {
            await updateDocumentApi(document.id, {
              ...document,
              coverImageUrl: covers[0],
            } as any);
          } catch (_e) { /* non-critical */ }
        }
      } catch (error) {
        console.error("[AudiobookViewer] Failed to auto-fetch cover:", error);
      }
    };

    fetchCover();

    return () => { cancelled = true; };
  }, [document.id, document.coverImageUrl, document.filePath, remoteAudioUrl]);

  useEffect(() => {
    let cancelled = false;
    const loadSponsorBlockData = async () => {
      const id = episodeId || document.id;
      if (id) {
        try {
          const cuts = await getSponsorBlockCuts(id);
          if (cancelled) return;
          if (cuts && cuts.length > 0) {
            setSponsorBlockCuts(cuts);
            return; // Downloaded pre-cut audio, skip live segment fetches
          }
        } catch (error) {
          console.warn("[SponsorBlock] Failed to check for pre-cut metadata:", error);
        }
      }

      const targetUrl = remoteAudioUrl || document.filePath;
      if (targetUrl) {
        const videoIdResult = extractVideoID(targetUrl);
        if (videoIdResult && videoIdResult.platform === "youtube") {
          try {
            const fetched = await fetchSponsorBlockSegments(videoIdResult.videoID);
            if (!cancelled) {
              setSponsorBlockSegments(fetched);
            }
          } catch (error) {
            console.warn("[SponsorBlock] Failed to fetch live segments:", error);
          }
        }
      }
    };

    loadSponsorBlockData();
    return () => { cancelled = true; };
  }, [document.id, document.filePath, remoteAudioUrl, episodeId]);

  useEffect(() => {
  }, [fileContent]);
  useEffect(() => {
  }, [remoteAudioUrl]);

  useEffect(() => {
    documentIdRef.current = document.id;
    const loadAudiobookData = async () => {
      const data = localStorage.getItem(`audiobook-${document.id}`);
      if (data) {
        try {
          const parsed = JSON.parse(data);
          setMetadata(parsed.metadata || {});
          setChapters(parsed.chapters || []);
          setTranscript(parsed.transcript || null);

          if (parsed.multiPart) {
            setMultiPartInfo(parsed.multiPart);
            setPartSources(parsed.multiPart.partFiles);
          }

          // Ensure transcript text is available to the AI assistant via documents.content
          if (parsed.transcript?.fullText && isTauri()) {
            try {
              const doc = await getDocument(document.id);
              if (!doc?.content) {
                await updateDocumentContent(document.id, parsed.transcript.fullText);
              }
            } catch { /* non-critical */ }
          }
        } catch {
        /* Audio playback error handling */ }
      }
      
      const bookmarksData = localStorage.getItem(`audiobook-${document.id}-bookmarks`);
      if (bookmarksData) {
        try {
          setBookmarks(JSON.parse(bookmarksData));
        } catch {
        /* Audio format detection */ }
      }
    };
    
    loadAudiobookData();
  }, [document.id]);

  useEffect(() => {
    const ext = document.filePath?.split(".").pop()?.toLowerCase();
    if (!isTauri() || !document.filePath) {
      setPreparedPlaybackPath(null);
      setPreparedPlaybackSrc(null);
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        if (isNativeMobile()) {
          // DocumentViewer already resolves the canonical app-managed path to
          // the loopback media server. Reuse that URL instead of resolving a
          // second source and briefly mounting an empty <audio> element.
          const resolved = fileContent
            ? {
              src: fileContent,
              strategy: "local-media-server",
            }
            : await resolveLocalMediaSource(document.filePath, "audio");
          if (!cancelled) {
            setPreparedPlaybackPath(document.filePath);
            setPreparedPlaybackSrc(resolved.src);
            logAudiobookDiagnostic("source_resolution", {
              documentId: document.id,
              filePath: document.filePath,
              strategy: resolved.strategy,
              status: "success",
            });
          }
          return;
        }

        // All Tauri platforms (desktop and mobile) resolve through the local
        // streaming media server (get_media_stream_url) — Range-capable HTTP,
        // no asset protocol. On Android the asset protocol buffers the entire
        // file into a Java WebResourceResponse body, which OOMs for large
        // audiobooks/podcasts (see src-tauri/src/media_server.rs); on desktop
        // the asset protocol is disabled entirely (no app.security.assetProtocol
        // block), so convertFileSrc URLs are never served.
        const resolvePlaybackUrl = async (path: string): Promise<string> =>
          invokeCommand<string>("get_media_stream_url", { filePath: path });

        // m4b transcoding via prepareAudiobookPlayback (ffmpeg) is desktop-only:
        // Android has no ffmpeg sidecar, so the transcode throws and leaves the
        // player without a source. Android's <audio> element decodes m4b
        // (AAC-LC in MP4) natively, and the local media server already serves
        // the file with HTTP Range support, so on mobile we stream the original
        // m4b directly — same path mp3/etc. already take below.
        if (ext === "m4b" && !isNativeMobile()) {
          const preparedPath = await audiobookApi.prepareAudiobookPlayback(document.filePath);
          const preparedUrl = await resolvePlaybackUrl(preparedPath);
          if (!cancelled) {
            setPreparedPlaybackPath(preparedPath);
            setPreparedPlaybackSrc(preparedUrl);
            logAudiobookDiagnostic("source_resolution", {
              documentId: document.id,
              filePath: preparedPath,
              strategy: "local-media-server",
              status: "success",
            });
          }
        } else {
          // Other audio formats (mp3, m4b on mobile, etc.) can play directly
          const url = await resolvePlaybackUrl(document.filePath);
          if (!cancelled) {
            setPreparedPlaybackPath(document.filePath);
            setPreparedPlaybackSrc(url);
            logAudiobookDiagnostic("source_resolution", {
              documentId: document.id,
              filePath: document.filePath,
              strategy: "local-media-server",
              status: "success",
            });
          }
        }
      } catch (error) {
        console.error("[AudiobookViewer] Failed to prepare playback:", error);
        logAudiobookDiagnostic("source_resolution", {
          documentId: document.id,
          filePath: document.filePath,
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        }, "error");
        if (!cancelled) {
          setPreparedPlaybackPath(null);
          setPreparedPlaybackSrc(null);
          // Surface the failure instead of leaving the player idle with a
          // cleared source: the error notice + retry render from here.
          setPlaybackError({
            kind: "source",
            message: `${t("viewer.unableToLoadAudio")}: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [document.filePath, retryAttempt]);

  useEffect(() => {
    if (!isTauri() || !episodeId) {
      setPodcastLocalSrc(null);
      setIsDownloading(false);
      return;
    }

    let cancelled = false;
    let unlistenProgress: (() => void) | null = null;

    void (async () => {
      try {
        const localPath = await getDownloadedEpisodePath(episodeId);
        if (localPath) {
          if (!cancelled) {
            // Stream via the local media server (Range requests) on every
            // platform — the Tauri asset protocol (convertFileSrc) buffers the
            // whole file into the Java heap on Android and OOMs on large
            // podcasts, and is disabled (unserved) on desktop.
            const localUrl = await invokeCommand<string>("get_media_stream_url", { filePath: localPath });
            setPodcastLocalSrc(localUrl);
            setIsDownloading(false);
          }
          return;
        }

        if (remoteAudioUrl) {
          if (cancelled) return;
          setIsDownloading(true);
          setDownloadProgress(0);
          setDownloadStatus("downloading");
          setDownloadError(null);

          const unlisten = await listen<{ episodeId: string; progress: number; status?: string }>(
            "podcast://download-progress",
            (e) => {
              if (e.payload.episodeId === episodeId && !cancelled) {
                setDownloadProgress(e.payload.progress);
                if (e.payload.status) {
                  setDownloadStatus(e.payload.status);
                }
              }
            }
          );
          unlistenProgress = unlisten;

          const downloadedPath = await downloadEpisodeAudio(episodeId, remoteAudioUrl, undefined);

          if (!cancelled) {
            const localUrl = await invokeCommand<string>("get_media_stream_url", { filePath: downloadedPath });
            setPodcastLocalSrc(localUrl);
            setIsDownloading(false);

            // Auto play if requested
            if (shouldPlayAfterDownloadRef.current || autoPlayOnOpen) {
              pendingAutoplayAfterDownloadRef.current = true;
            }
          }
        } else if (!cancelled) {
          setPodcastLocalSrc(null);
        }
      } catch (error) {
        console.warn("[AudiobookViewer] Auto-download failed:", error);
        if (!cancelled) {
          setIsDownloading(false);
          setDownloadError(error instanceof Error ? error.message : "Download failed");
        }
      }
    })();

    return () => {
      cancelled = true;
      if (unlistenProgress) {
        unlistenProgress();
      }
    };
  }, [episodeId, remoteAudioUrl, autoPlayOnOpen]);

  useEffect(() => {
    if (!isTauri() || !document.filePath || multiPartInfo) {
      return;
    }

    const hasRealChapters = chapters.length > 1
      || (chapters.length === 1 && chapters[0]?.title && chapters[0].title !== "Chapter 1");
    const hasMetadataTitle = Boolean(metadata.title);
    if (hasRealChapters && hasMetadataTitle) {
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const parsed = await audiobookApi.parseAudiobookMetadata(document.filePath);
        if (cancelled) return;

        setMetadata((prev) => ({
          ...parsed,
          ...prev,
          title: prev.title || parsed.title,
          author: prev.author || parsed.author,
          duration: prev.duration || parsed.duration,
        }));

        if (!hasRealChapters && parsed.chapters?.length) {
          setChapters(parsed.chapters);
        }

        const existingRaw = localStorage.getItem(`audiobook-${document.id}`);
        if (existingRaw) {
          try {
            const existing = JSON.parse(existingRaw);
            localStorage.setItem(`audiobook-${document.id}`, JSON.stringify({
              ...existing,
              metadata: {
                ...parsed,
                ...existing.metadata,
                title: existing.metadata?.title || parsed.title,
                author: existing.metadata?.author || parsed.author,
                duration: existing.metadata?.duration || parsed.duration,
              },
              chapters: hasRealChapters ? existing.chapters : parsed.chapters,
            }));
          } catch {
            // Ignore localStorage repair failures.
          }
        }
      } catch (error) {
        console.warn("[AudiobookViewer] Failed to refresh audiobook metadata:", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chapters, document.filePath, document.id, metadata.title, multiPartInfo]);

  const getTotalDurationSeconds = useCallback((): number | undefined => {
    if (multiPartInfo?.partDurations?.length) {
      const sum = multiPartInfo.partDurations.reduce(
        (acc, d) => acc + (Number.isFinite(d) ? d : 0),
        0
      );
      return Number.isFinite(sum) && sum > 0 ? Math.floor(sum) : undefined;
    }
    return Number.isFinite(durationRef.current) && durationRef.current > 0
      ? Math.floor(durationRef.current)
      : undefined;
  }, [multiPartInfo?.partDurations]);

  // Keep a ref for cleanup/unmount saves (avoid stale closures).
  useEffect(() => {
    totalDurationSecondsRef.current = getTotalDurationSeconds();
  }, [getTotalDurationSeconds, duration, multiPartInfo?.partDurations]);

  const toGlobalSeconds = useCallback(
    (partIndex: number, timeInPart: number): number => {
      if (!multiPartInfo?.partDurations?.length) return timeInPart;
      const base = multiPartInfo.partDurations
        .slice(0, Math.max(0, partIndex))
        .reduce((acc, d) => acc + (Number.isFinite(d) ? d : 0), 0);
      return base + timeInPart;
    },
    [multiPartInfo?.partDurations]
  );

  const fromGlobalSeconds = useCallback(
    (globalSeconds: number): { partIndex: number; timeInPart: number } => {
      if (!multiPartInfo?.partDurations?.length) {
        return { partIndex: 0, timeInPart: globalSeconds };
      }

      const totalParts = multiPartInfo.partDurations.length;
      let remaining = Math.max(0, globalSeconds);
      for (let i = 0; i < totalParts; i++) {
        const d = Number.isFinite(multiPartInfo.partDurations[i]) ? multiPartInfo.partDurations[i] : 0;
        if (remaining < d || i === totalParts - 1) {
          return { partIndex: i, timeInPart: Math.min(remaining, Math.max(0, d - 0.25)) };
        }
        remaining -= d;
      }

      return { partIndex: 0, timeInPart: globalSeconds };
    },
    [multiPartInfo?.partDurations]
  );

  const persistPosition = useCallback(
    async (timeInPart: number) => {
      const docId = documentIdRef.current;
      const globalSeconds = toGlobalSeconds(currentPartIndex, timeInPart);
      const rounded = Math.floor(globalSeconds);

      if (!Number.isFinite(rounded) || rounded < 0) return;
      if (Math.abs(rounded - lastSavedGlobalTimeRef.current) < 1) return;
      lastSavedGlobalTimeRef.current = rounded;

      const promises: Promise<any>[] = [];

      // 1. Save to document system (IR system)
      if (docId) {
        promises.push(updateDocumentProgressAuto(docId, rounded));
        promises.push(saveDocumentPosition(docId, timePosition(rounded, getTotalDurationSeconds())));
      }

      // 2. Save to podcast system (Podcast manager)
      if (episodeId) {
        promises.push(updateEpisodePosition(episodeId, timeInPart));
      }

      try {
        await Promise.all(promises);
      } catch (error) {
        console.warn("[AudiobookViewer] Failed to persist position:", error);
      }
    },
    [currentPartIndex, episodeId, getTotalDurationSeconds, toGlobalSeconds]
  );

  const loadSavedPosition = useCallback(async () => {
    let savedSeconds: number | null = null;

    try {
      const pos = await getDocumentPosition(document.id);
      if (pos?.type === "time" && typeof pos.seconds === "number") {
        savedSeconds = pos.seconds;
      }
    } catch (error) {
      console.warn("[AudiobookViewer] Failed to load saved position from position API:", error);
    }

    if (savedSeconds == null && typeof document.currentPage === "number") {
      savedSeconds = document.currentPage;
    }

    if (savedSeconds == null || !Number.isFinite(savedSeconds) || savedSeconds <= 0) {
      return;
    }

    const { partIndex, timeInPart } = fromGlobalSeconds(savedSeconds);
    if (multiPartInfo && partIndex !== currentPartIndex) {
      setCurrentPartIndex(partIndex);
    }
    
    // Immediate seek if possible, otherwise queue it
    if (audioRef.current && audioRef.current.readyState >= 1) {
      audioRef.current.currentTime = timeInPart;
      setCurrentTime(timeInPart);
      currentTimeRef.current = timeInPart;
    } else {
      pendingSeekTimeRef.current = timeInPart;
    }
  }, [currentPartIndex, document.currentPage, document.id, fromGlobalSeconds, multiPartInfo]);

  // Keep a ref to the latest loadSavedPosition so the once-per-session restore
  // effect (below) can call it without re-running every time this callback is
  // recreated. The callback is recreated whenever document.currentPage changes
  // (its dep), and re-running the restore on every progress write is what drove
  // the save -> restore -> seek-back playback loop.
  loadSavedPositionRef.current = loadSavedPosition;

  // Reset seek retry count and last saved global time on episode/document change
  useEffect(() => {
    seekRetryCountRef.current = 0;
    lastSavedGlobalTimeRef.current = 0;
  }, [document.id, episodeId]);

  // Mount-time restore: seek to the saved playback position (or the podcast
  // episode position) and apply the persisted volume/playback rate. This must
  // run ONCE per playback session — it is intentionally NOT reactive to
  // `document.currentPage` or `loadSavedPosition`'s identity.
  //
  // Why: the 5s auto-save interval calls persistPosition -> updateDocumentProgressAuto,
  // which mutates document.currentPage in the store. If this effect depended on
  // document.currentPage (it previously did), every save would re-trigger the
  // restore, re-seeking the audio element BACKWARD to the just-saved position
  // ~1s later (the async DB round-trip latency). That produced a visible
  // "play ~6s, jump back ~2s, repeat forever" loop during playback.
  useEffect(() => {
    const sessionKey = `${document.id}:${episodeId ?? ""}:${remoteAudioUrl ?? ""}`;
    if (restoredSessionRef.current === sessionKey) return;
    restoredSessionRef.current = sessionKey;

    if (typeof initialSeekTime !== "number" || !Number.isFinite(initialSeekTime)) {
      void loadSavedPositionRef.current();
    }

    // For podcast episodes, restore saved position
    if (episodeId) {
      void (async () => {
        try {
          const pos = await getEpisodePosition(episodeId);
          if (pos > 0) {
            if (audioRef.current && audioRef.current.readyState >= 1) {
              audioRef.current.currentTime = pos;
              setCurrentTime(pos);
              currentTimeRef.current = pos;
              currentGlobalTimeRef.current = toGlobalSeconds(currentPartIndex, pos);
            } else {
              pendingSeekTimeRef.current = pos;
              setIsWaitingForSeek(true);
            }
          }
        } catch (err) {
          console.warn("[AudiobookViewer] Failed to load episode position:", err);
        }
      })();
    }

    const savedVolume = localStorage.getItem("audiobook-volume");
    if (savedVolume) {
      setVolume(parseFloat(savedVolume));
      if (audioRef.current) {
        audioRef.current.volume = parseFloat(savedVolume);
      }
    }

    const savedRate = localStorage.getItem("audiobook-rate");
    if (savedRate) {
      setPlaybackRate(parseFloat(savedRate));
      if (audioRef.current) {
        audioRef.current.playbackRate = parseFloat(savedRate);
      }
    }
    // Deliberately minimal: only re-run when the actual playback session
    // identity changes (different document / episode / source). Progress writes
    // and callback identity changes must NOT re-trigger the restore.
  }, [
    document.id,
    episodeId,
    remoteAudioUrl,
    initialSeekTime,
    currentPartIndex,
    toGlobalSeconds,
  ]);
  
  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      const time = audioRef.current.currentTime;
      setCurrentTime(time);
      currentTimeRef.current = time;
      currentGlobalTimeRef.current = toGlobalSeconds(currentPartIndex, time);
      onTimeUpdate?.(toGlobalSeconds(currentPartIndex, time));

      // Accumulate listening stats
      const diff = time - lastTimeRef.current;
      if (isPlaying && diff > 0 && diff < 5) {
        accumulateListeningTime(diff);
      }
      lastTimeRef.current = time;

      // SponsorBlock cut metadata (pre-cut) check
      if (sponsorBlockCuts && sponsorBlockCuts.length > 0) {
        for (const cut of sponsorBlockCuts) {
          if (time >= cut.cutStart && time <= cut.cutStart + 1.5) {
            if (!notifiedCutsRef.current.has(cut.uuid)) {
              notifiedCutsRef.current.add(cut.uuid);
              
              setSkipNotification({
                category: cut.category,
                savedSeconds: Math.round(cut.originalEnd - cut.originalStart),
                undoable: false,
              });
              
              if (skipNotificationTimeoutRef.current) clearTimeout(skipNotificationTimeoutRef.current);
              skipNotificationTimeoutRef.current = setTimeout(() => {
                setSkipNotification(null);
              }, 4000);
            }
          }
        }
      }

      // SponsorBlock live segment check (streaming / uncut)
      if (sponsorBlockSegments && sponsorBlockSegments.length > 0) {
        for (const segment of sponsorBlockSegments) {
          const [start, end] = segment.segment;
          if (time >= start && time < end) {
            if (!skippedSegmentsRef.current.has(segment.UUID) && !temporarilyDisabledSegmentsRef.current.has(segment.UUID)) {
              skippedSegmentsRef.current.add(segment.UUID);
              
              audioRef.current.currentTime = end;
              setCurrentTime(end);
              currentTimeRef.current = end;
              
              setSkipNotification({
                category: segment.category,
                savedSeconds: Math.round(end - start),
                originalStart: start,
                originalEnd: end,
                undoable: true,
              });
              
              if (skipNotificationTimeoutRef.current) clearTimeout(skipNotificationTimeoutRef.current);
              skipNotificationTimeoutRef.current = setTimeout(() => {
                setSkipNotification(null);
              }, 4000);
              break;
            }
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      // Use the podcast transcript segments for podcasts (they live in a separate
      // system from the audiobook document-transcript store); otherwise the
      // audiobook sources. This is what drives active-segment highlighting +
      // auto-scroll as the audio plays. Built from raw state here (not the
      // podcastDisplaySegments derivation, which is declared later in the component)
      // — the segment lookup below already normalizes startTime/endTime.
      const allSegments: any[] = isPodcast
        ? (podcastTranscriptSegments.length > 0
            ? podcastTranscriptSegments.map((s, i) => ({
                id: `pod-seg-${i}`,
                startTime: s.start || 0,
                endTime: s.end || 0,
                text: s.text,
                wordTimings: s.wordTimings,
              }))
            : (podcastTranscriptText || "").split(/(?<=[.!?])\s+/).map((s, i) => s.trim()).filter(Boolean).map((text, i) => ({ id: `pod-seg-${i}`, startTime: 0, endTime: 0, text })))
        : (transcript?.segments || activeSegments);
      if (allSegments.length > 0) {
        const checkTime = sponsorBlockCuts.length > 0
          ? mapCutTimeToOriginalTime(time, sponsorBlockCuts)
          : time;
        const segment = allSegments.find(
          s => {
            const start = s.startTime ?? s.start_ms / 1000;
            const end = s.endTime ?? s.end_ms / 1000;
            return checkTime >= start && checkTime < end;
          }
        );
        const id = segment ? (segment.id || `seg-${allSegments.indexOf(segment)}`) : null;
        if (id && id !== activeSegmentId) {
          setActiveSegmentId(id);
          // Scroll segment into view using container-relative scrolling
          // to avoid scrolling the entire page and affecting other elements
          const element = window.document.getElementById(`segment-${id}`);
          const container = transcriptRef.current;
          if (element && container && showTranscript) {
            // Calculate the element's position relative to the container
            const containerRect = container.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            
            // Calculate relative position (accounting for container's scroll position)
            const relativeTop = elementRect.top - containerRect.top + container.scrollTop;
            const elementHeight = elementRect.height;
            const containerHeight = containerRect.height;
            
            // Calculate target scroll position to center the element
            const targetScrollTop = relativeTop - (containerHeight / 2) + (elementHeight / 2);
            
            // Only scroll if the element is outside the visible area (with some padding)
            const padding = 50;
            const isAbove = elementRect.top < containerRect.top + padding;
            const isBelow = elementRect.bottom > containerRect.bottom - padding;
            
            if (isAbove || isBelow) {
              container.scrollTo({
                top: targetScrollTop,
                behavior: "smooth",
              });
            }
          }
        }
      }
      
      if (audioRef.current.buffered.length > 0) {
        setBuffered(audioRef.current.buffered.end(audioRef.current.buffered.length - 1));
      }
    }
  }, [activeSegmentId, activeSegments, currentPartIndex, showTranscript, toGlobalSeconds, transcript, sponsorBlockCuts, sponsorBlockSegments, isPodcast, podcastTranscriptSegments, podcastTranscriptText]);
  
  const [isWaitingForSeek, setIsWaitingForSeek] = useState(false);
  const seekRetryCountRef = useRef(0);

  const seek = useCallback((time: number) => {
    if (!audioRef.current) return;

    const clamped = Math.max(0, Math.min(durationRef.current || duration || time, time));

    try {
      audioRef.current.currentTime = clamped;

      // Optimistically update UI — the actual position will be confirmed
      // by the 'seeked' event / handleTimeUpdate
      setCurrentTime(clamped);
      currentTimeRef.current = clamped;
      currentGlobalTimeRef.current = toGlobalSeconds(currentPartIndex, clamped);
      seekRetryCountRef.current = 0;
      setIsWaitingForSeek(false);

      // Reset SponsorBlock notification tracking for positions past the new seek time
      if (sponsorBlockCuts.length > 0) {
        sponsorBlockCuts.forEach(cut => {
          if (clamped < cut.cutStart) {
            notifiedCutsRef.current.delete(cut.uuid);
          }
        });
      }
      if (sponsorBlockSegments.length > 0) {
        sponsorBlockSegments.forEach(seg => {
          if (clamped < seg.segment[0]) {
            skippedSegmentsRef.current.delete(seg.UUID);
            temporarilyDisabledSegmentsRef.current.delete(seg.UUID);
          }
        });
      }
    } catch (err) {
      console.error("[AudiobookViewer] Seek error:", err);
      pendingSeekTimeRef.current = clamped;
      setIsWaitingForSeek(true);
    }
  }, [currentPartIndex, duration, toGlobalSeconds, sponsorBlockCuts, sponsorBlockSegments]);

  const attemptPendingSeek = useCallback(() => {
    if (pendingSeekTimeRef.current != null && audioRef.current) {
      const target = pendingSeekTimeRef.current;
      
      let isSeekable = false;
      for (let i = 0; i < audioRef.current.seekable.length; i++) {
        if (target >= audioRef.current.seekable.start(i) && target <= audioRef.current.seekable.end(i)) {
          isSeekable = true;
          break;
        }
      }

      if (isSeekable || audioRef.current.readyState >= 1) {
        pendingSeekTimeRef.current = null;
        seek(target);
      } else if (audioRef.current.readyState > 0) {
        seekRetryCountRef.current++;
        if (seekRetryCountRef.current > 50) { // Limit retries
          console.warn("[AudiobookViewer] Seek retry limit reached. User might need to play first.");
          pendingSeekTimeRef.current = null;
          setIsWaitingForSeek(false);
        }
      }
    }
  }, [seek]);

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      durationRef.current = audioRef.current.duration;
      setPlaybackError(null);
      logAudiobookDiagnostic("playback", {
        documentId: document.id,
        filePath: document.filePath,
        status: "metadata",
        elapsedMs: Math.round(audioRef.current.duration * 1000),
      });
      attemptPendingSeek();

      if (
        (autoPlayOnOpen && appliedInitialSeekRef.current === `${document.id}:${initialSeekTime}`) ||
        pendingAutoplayAfterDownloadRef.current
      ) {
        pendingAutoplayAfterDownloadRef.current = false;
        audioRef.current.play().catch(() => {
          setIsPlaying(false);
        });
      }
    }
  };

  const handleCanPlay = () => {
    setPlaybackError(null);
    logAudiobookDiagnostic("playback", {
      documentId: document.id,
      filePath: document.filePath,
      status: "canplay",
    });
  };

  const handleStalled = () => {
    logAudiobookDiagnostic("playback", {
      documentId: document.id,
      filePath: document.filePath,
      status: "stalled",
    }, "warn");
  };
  
  const handleProgress = () => {
    if (isWaitingForSeek) {
      attemptPendingSeek();
    }
  };
  
  const handleEnded = () => {
    if (multiPartInfo && currentPartIndex < multiPartInfo.partFiles.length - 1) {
      const nextPartIndex = currentPartIndex + 1;
      setCurrentPartIndex(nextPartIndex);
      currentTimeRef.current = 0;
      currentGlobalTimeRef.current = toGlobalSeconds(nextPartIndex, 0);
      // Load next part - audio element will auto-play if it was playing
      if (audioRef.current) {
        audioRef.current.src = partSources[nextPartIndex] || "";
        audioRef.current.load();
        audioRef.current.play().catch(() => {
          setIsPlaying(false);
        });
      }
      showInfo(t("viewer.nextPart"), t("viewer.playingPart", { current: nextPartIndex + 1, total: multiPartInfo.partFiles.length }));
      return;
    }

    // Podcast episode: mark as played when it ends naturally
    if (episodeId) {
      void markEpisodePlayed(episodeId, true);
      onEpisodeEnded?.();
    }
    
    setIsPlaying(false);
    showInfo(t("viewer.audiobookFinished"), t("viewer.reachedTheEnd"));
  };
  
  // Go to specific part (for multi-part books)
  const goToPart = (partIndex: number) => {
    if (!multiPartInfo || partIndex < 0 || partIndex >= multiPartInfo.partFiles.length) return;
    
    setCurrentPartIndex(partIndex);
    currentTimeRef.current = 0;
    currentGlobalTimeRef.current = toGlobalSeconds(partIndex, 0);
    if (audioRef.current) {
      audioRef.current.src = partSources[partIndex] || "";
      audioRef.current.load();
      audioRef.current.play().catch(() => {
        setIsPlaying(false);
      });
    }
  };
  
  const handlePause = () => {
    setIsPlaying(false);
    if (audioRef.current) {
      void persistPosition(audioRef.current.currentTime);
    }
  };

  const getAudioMimeType = (path?: string) => {
    const ext = path?.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "wav":
        return "audio/wav";
      case "m4a":
      case "m4b":
        return "audio/mp4";
      case "aac":
        return "audio/aac";
      case "ogg":
        return "audio/ogg";
      case "flac":
        return "audio/flac";
      case "opus":
        return "audio/opus";
      case "mp3":
      default:
        return "audio/mpeg";
    }
  };

  const loadFallbackAudioSource = useCallback(async (): Promise<boolean> => {
    if (hasTriedFallback) {
      showError(
        t("viewer.playbackFailed"),
        t("viewer.audioFormatNotSupported")
      );
      return false;
    }

    setHasTriedFallback(true);

    // On native mobile, reading the whole audio file into a JS byte array via
    // readDocumentFile() causes OutOfMemoryError for large files (a ~180MB
    // podcast allocates a fixed ~189MB Uint8Array and blows the 512MB Java
    // heap). Instead, hand the <audio> element a URL served by the local
    // streaming media server (src-tauri/src/media_server.rs), which honours
    // HTTP Range requests so the WebView only fetches the bytes it needs.
    // This mirrors the strategy already used by localMediaSource.ts on mobile.

    // For podcast episodes with a remote URL, prefer the local download.
    if (isTauri() && remoteAudioUrl && episodeId) {
      try {
        showInfo(t("viewer.loadingAudio"), t("viewer.directPlaybackFailed"));
        let localPath = await getDownloadedEpisodePath(episodeId);
        if (!localPath) {
          localPath = await downloadEpisodeAudio(episodeId, remoteAudioUrl, undefined);
        }

        if (localPath) {
          // Mobile: stream via the local media server (Range requests, bounded memory).
          if (isNativeMobile()) {
            try {
              const streamUrl = await invokeCommand<string>("get_media_stream_url", { filePath: localPath });
              if (streamUrl) {
                setFallbackSrc((prev) => {
                  if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
                  return streamUrl;
                });
                return true;
              }
            } catch (streamErr) {
              console.warn("[AudiobookViewer] Mobile stream fallback failed, trying remote stream:", streamErr);
            }
          } else {
            // Desktop: blob URL is safe (no mobile heap ceiling) and supports macOS.
            try {
              const bytes = await readDocumentFile(localPath);
              if (bytes.byteLength > 0) {
                const mimeType = getAudioMimeType(localPath);
                const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
                setFallbackSrc((prev) => {
                  if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
                  return blobUrl;
                });
                return true;
              }
            } catch (blobErr) {
              console.warn("[AudiobookViewer] Local blob fallback failed, falling back to streaming:", blobErr);
            }
          }
        }

        // Streaming fallback
        setFallbackSrc(remoteAudioUrl);
        return true;
      } catch (err) {
        console.error("[AudiobookViewer] Podcast fallback failed:", err);
        // Last resort: try streaming remote URL directly
        setFallbackSrc(remoteAudioUrl);
        return true;
      }
    }

    const playbackFilePath = preparedPlaybackPath || document.filePath;
    const isRemotePath = playbackFilePath?.startsWith("http://") || playbackFilePath?.startsWith("https://") || playbackFilePath?.startsWith("data:");

    if (!isTauri() || !playbackFilePath || isRemotePath) {
      showError(t("viewer.playbackFailed"), t("viewer.unableToLoadAudio"));
      return false;
    }

    try {
      showInfo(t("viewer.loadingAudio"), t("viewer.directPlaybackFailed"));

      // Mobile: stream via the local media server to avoid loading the whole
      // file into the Java heap. readDocumentFile() on a large audiobook/
      // podcast reliably OOMs Android (see media_server.rs module docs).
      if (isNativeMobile()) {
        const streamUrl = await invokeCommand<string>("get_media_stream_url", { filePath: playbackFilePath });
        if (streamUrl) {
          setFallbackSrc((prev) => {
            if (prev?.startsWith("blob:")) URL.revokeObjectURL(prev);
            return streamUrl;
          });
          return true;
        }
        throw new Error("media server unavailable");
      }

      const bytes = await readDocumentFile(playbackFilePath);
      if (bytes.byteLength === 0) {
        throw new Error("Empty file data");
      }
      const mimeType = getAudioMimeType(playbackFilePath);
      const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      setFallbackSrc((prev) => {
        if (prev?.startsWith("blob:")) {
          URL.revokeObjectURL(prev);
        }
        return blobUrl;
      });
      return true;
    } catch (err) {
      showError(
        t("viewer.playbackFailed"),
        err instanceof Error ? err.message : t("viewer.unableToLoadAudio")
      );
      return false;
    }
  }, [document.filePath, episodeId, hasTriedFallback, preparedPlaybackPath, remoteAudioUrl, showError, showInfo, t]);

  // Playback controls
  const togglePlay = async () => {
    if (isDownloading) {
      shouldPlayAfterDownloadRef.current = !shouldPlayAfterDownloadRef.current;
      setIsPlaying(shouldPlayAfterDownloadRef.current);
      return;
    }
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        const audioDuration = durationRef.current || duration || audioRef.current.duration || 0;
        const isNearEnd = audioDuration > 0 && audioRef.current.currentTime >= audioDuration - 1;
        if (audioRef.current.ended || isNearEnd) {
          audioRef.current.currentTime = 0;
          setCurrentTime(0);
          currentTimeRef.current = 0;
        }
        try {
          await audioRef.current.play();
        } catch (err) {
          console.error('[AudiobookViewer] Play error:', err);
          const isNotSupportedError = 
            (err instanceof DOMException && err.name === "NotSupportedError") ||
            (err instanceof Error && err.name === "NotSupportedError") ||
            (typeof err === "object" && err !== null && "name" in err && err.name === "NotSupportedError") ||
            String(err).includes("NotSupportedError");

          if (isNotSupportedError) {
            if (fallbackAttemptedRef.current) {
              setPlaybackError({ kind: "codec", message: t("viewer.audioFormatNotSupported") });
              return;
            }
            fallbackAttemptedRef.current = true;
            pendingAutoplayAfterFallbackRef.current = true;
            const loadedFallback = await loadFallbackAudioSource();
            if (!loadedFallback) {
              pendingAutoplayAfterFallbackRef.current = false;
              setPlaybackError({ kind: "codec", message: t("viewer.audioFormatNotSupported") });
            }
            return;
          }
          showError(
            t("viewer.playbackFailed"),
            err instanceof Error ? err.message : t("viewer.unableToLoadAudio")
          );
        }
      }
    } else {
      console.warn('[AudiobookViewer] No audio ref');
    }
  };

  const handleAudioError = async () => {
    const error = audioRef.current?.error;
    const src = audioRef.current?.currentSrc || audioRef.current?.src;
    const kind = classifyAudiobookPlaybackError(error?.code);
    const message = kind === "codec"
      ? t("viewer.audioFormatNotSupported")
      : t("viewer.unableToLoadAudio");
    console.error("[AudiobookViewer] Audio error:", { code: error?.code, message: error?.message, src, kind });
    logAudiobookDiagnostic("playback", {
      documentId: document.id,
      filePath: document.filePath,
      status: "error",
      mediaErrorCode: error?.code ?? "unknown",
      message: error?.message || message,
    }, "error");

    // A failed fallback can emit the same error again. Keep this finite so a
    // broken local stream cannot leave the viewer retrying forever while the
    // user sees an apparently permanent loading state.
    if (fallbackAttemptedRef.current) {
      setIsPlaying(false);
      setPlaybackError({ kind, message });
      pendingAutoplayAfterFallbackRef.current = false;
      return;
    }

    fallbackAttemptedRef.current = true;
    pendingAutoplayAfterFallbackRef.current = true;
    const loadedFallback = await loadFallbackAudioSource();
    if (!loadedFallback) {
      pendingAutoplayAfterFallbackRef.current = false;
      setPlaybackError({ kind, message });
    }
  };

  const retryPlayback = useCallback(() => {
    fallbackAttemptedRef.current = false;
    setHasTriedFallback(false);
    setPlaybackError(null);
    setFallbackSrc(null);
    // Re-run source preparation (get_media_stream_url) so the retry either
    // recovers a now-available source or re-surfaces the error.
    setRetryAttempt((attempt) => attempt + 1);
    window.setTimeout(() => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.load();
      void audio.play().catch((error) => {
        console.warn("[AudiobookViewer] Retry playback failed:", error);
      });
    }, 0);
  }, [audioRef]);

  useEffect(() => {
    if (typeof initialSeekTime !== "number" || !Number.isFinite(initialSeekTime)) return;

    const key = `${document.id}:${initialSeekTime}`;
    if (appliedInitialSeekRef.current === key) return;
    appliedInitialSeekRef.current = key;

    const { partIndex, timeInPart } = fromGlobalSeconds(Math.max(0, initialSeekTime));
    setShowTranscript(true);
    if (initialTranscriptSegmentId) {
      setActiveSegmentId(initialTranscriptSegmentId);
    }

    if (multiPartInfo && partIndex !== currentPartIndex) {
      setCurrentPartIndex(partIndex);
    }

    pendingSeekTimeRef.current = timeInPart;
    attemptPendingSeek();
  }, [
    attemptPendingSeek,
    currentPartIndex,
    document.id,
    fromGlobalSeconds,
    initialSeekTime,
    initialTranscriptSegmentId,
    multiPartInfo,
  ]);
  useEffect(() => {
    if (!showTranscript || !initialTranscriptSegmentId) return;

    window.setTimeout(() => {
      const element = globalThis.document.getElementById(`segment-${initialTranscriptSegmentId}`);
      element?.scrollIntoView?.({ block: "center" });
    }, 0);
  }, [activeSegments.length, initialTranscriptSegmentId, showTranscript, transcript?.segments?.length]);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        void persistPosition(currentTimeRef.current);
      }
    };
  }, [persistPosition]);

  // Auto-save every 5s while playing
  useEffect(() => {
    if (!isPlaying) return;

    const id = window.setInterval(() => {
      if (audioRef.current) {
        void persistPosition(audioRef.current.currentTime);
      }
    }, 5000);

    return () => window.clearInterval(id);
  }, [isPlaying, persistPosition]);

  useEffect(() => {
    if (!fallbackSrc || !pendingAutoplayAfterFallbackRef.current || !audioRef.current) {
      return;
    }

    pendingAutoplayAfterFallbackRef.current = false;
    const audio = audioRef.current;
    audio.load();
    void audio.play()
      .then(() => {
        showSuccess(t("viewer.audioLoaded"), t("viewer.retryPlay"));
      })
      .catch((err) => {
        console.error("[AudiobookViewer] Fallback play error:", err);
        showError(
          t("viewer.playbackFailed"),
          err instanceof Error ? err.message : t("viewer.audioFormatNotSupported")
        );
      });
  }, [fallbackSrc, showError, showSuccess, t]);

  useEffect(() => {
    return () => {
      if (fallbackSrc?.startsWith("blob:")) {
        URL.revokeObjectURL(fallbackSrc);
      }
    };
  }, [fallbackSrc]);

  useEffect(() => {
    return () => {
      const docId = documentIdRef.current;
      const globalRounded = Math.floor(
        Number.isFinite(currentGlobalTimeRef.current) && currentGlobalTimeRef.current > 0
          ? currentGlobalTimeRef.current
          : currentTimeRef.current
      );
      if (docId && Number.isFinite(globalRounded) && globalRounded > 0) {
        void updateDocumentProgressAuto(docId, globalRounded);
        void saveDocumentPosition(docId, timePosition(globalRounded, totalDurationSecondsRef.current));
      }
    };
  }, []); // Empty deps: refs carry the latest values
  
  const skip = (seconds: number) => {
    seek(currentTime + seconds);
  };
  
  const goToChapter = (chapter: AudiobookChapter) => {
    seek(chapter.startTime);
    setShowChapters(false);
    setShowChaptersSheet(false);
  };
  
  // Volume controls
  const handleVolumeChange = (newVolume: number) => {
    setVolume(newVolume);
    setIsMuted(newVolume === 0);
    if (audioRef.current) {
      audioRef.current.volume = newVolume;
      audioRef.current.muted = newVolume === 0;
    }
    localStorage.setItem("audiobook-volume", newVolume.toString());
  };
  
  const toggleMute = () => {
    if (audioRef.current) {
      const newMuted = !isMuted;
      audioRef.current.muted = newMuted;
      setIsMuted(newMuted);
      if (!newMuted && volume === 0) {
        setVolume(0.5);
        audioRef.current.volume = 0.5;
      }
    }
  };
  
  // Playback rate (0.5x intervals up to 3x, per the mobile spec).
  const playbackRates = [0.5, 1, 1.5, 2, 2.5, 3];
  const cyclePlaybackRate = () => {
    const currentIndex = playbackRates.indexOf(playbackRate);
    const nextRate = playbackRates[(currentIndex + 1) % playbackRates.length];
    setPlaybackRate(nextRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
    localStorage.setItem("audiobook-rate", nextRate.toString());
  };

  // Listening statistics accumulator
  const accumulateListeningTime = (seconds: number) => {
    if (seconds <= 0) return;
    const key = "audiobook-listening-stats-summary";
    const raw = localStorage.getItem(key);
    let today = 0;
    let week = 0;
    let lastDate = new Date().toDateString();
    
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        today = parsed.today || 0;
        week = parsed.week || 0;
        lastDate = parsed.lastDate || new Date().toDateString();
      } catch {
        // ignore
      }
    }
    
    const currentDate = new Date().toDateString();
    if (lastDate !== currentDate) {
      today = 0; // reset daily stats
    }
    
    today += seconds;
    week += seconds;
    
    const updated = { today, week, lastDate: currentDate };
    localStorage.setItem(key, JSON.stringify(updated));
    setListeningStats(updated);
  };

  // Smart audio nodes initialization (Volume Boost & Silence Skip)
  const initAudioNodes = () => {
    if (!audioRef.current || audioContext) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const srcNode = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const gain = ctx.createGain();
      
      srcNode.connect(analyser);
      analyser.connect(gain);
      gain.connect(ctx.destination);
      
      setAudioContext(ctx);
      setAnalyserNode(analyser);
      setGainNode(gain);
      
      // Sync initial volume boost setting
      gain.gain.value = volumeBoostEnabled ? 2.2 : 1.0;
    } catch (err) {
      console.warn("Failed to initialize AudioContext:", err);
    }
  };

  useEffect(() => {
    if (gainNode) {
      gainNode.gain.value = volumeBoostEnabled ? 2.2 : 1.0;
    }
  }, [volumeBoostEnabled, gainNode]);

  // Smart Silence Skipping interval analyzer
  useEffect(() => {
    if (!silenceSkipEnabled || !analyserNode || !audioRef.current || !isPlaying) return;
    
    const bufferLength = analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    let lastNonSilentTime = Date.now();
    
    const interval = setInterval(() => {
      if (!audioRef.current) return;
      analyserNode.getByteFrequencyData(dataArray);
      
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const average = sum / bufferLength;
      
      if (average > 8) {
        lastNonSilentTime = Date.now();
      } else {
        const silentDuration = Date.now() - lastNonSilentTime;
        if (silentDuration > 500) {
          // Skip past silence (jump forward 0.5s)
          audioRef.current.currentTime = Math.min(
            audioRef.current.duration || 0,
            audioRef.current.currentTime + 0.5
          );
          lastNonSilentTime = Date.now();
        }
      }
    }, 100);
    
    return () => clearInterval(interval);
  }, [silenceSkipEnabled, analyserNode, isPlaying]);

  // Web Media Session API synchronization
  useEffect(() => {
    if ("mediaSession" in navigator && document) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: metadata.title || document.title,
        artist: metadata.author || document.metadata?.author || "Unknown Author",
        album: "Audiobook",
        artwork: localCoverUrl ? [
          { src: localCoverUrl, sizes: "256x256", type: "image/png" }
        ] : []
      });
    }
  }, [document, metadata, localCoverUrl]);

  useEffect(() => {
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.setActionHandler("play", () => {
          if (audioRef.current) {
            audioRef.current.play().catch(() => {});
            setIsPlaying(true);
          }
        });
        
        navigator.mediaSession.setActionHandler("pause", () => {
          if (audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
          }
        });

        navigator.mediaSession.setActionHandler("seekbackward", (details) => {
          const offset = details.seekOffset || 15;
          skip(-offset);
        });

        navigator.mediaSession.setActionHandler("seekforward", (details) => {
          const offset = details.seekOffset || 15;
          skip(offset);
        });

        navigator.mediaSession.setActionHandler("previoustrack", () => {
          if (audioRef.current) {
            audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
          }
        });

        navigator.mediaSession.setActionHandler("nexttrack", () => {
          skip(30);
        });
      } catch (err) {
        console.warn("Media Session action handlers failed to register:", err);
      }
    }
    
    return () => {
      if ("mediaSession" in navigator) {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("seekbackward", null);
        navigator.mediaSession.setActionHandler("seekforward", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
      }
    };
  }, [isPlaying]);

  useEffect(() => {
    if ("mediaSession" in navigator && audioRef.current) {
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
    }
  }, [isPlaying]);

  useEffect(() => {
    if ("mediaSession" in navigator && audioRef.current && Number.isFinite(duration) && duration > 0) {
      try {
        navigator.mediaSession.setPositionState({
          duration: duration,
          playbackRate: playbackRate,
          position: currentTime
        });
      } catch (e) {
        // ignore
      }
    }
  }, [currentTime, duration, playbackRate]);
  
  // Bookmarks
  const addBookmark = () => {
    const chapter = getCurrentChapter();
    setNewBookmarkTime(currentTime);
    setBookmarkTitleInput(chapter?.title || `Bookmark @ ${audiobookApi.formatDuration(currentTime)}`);
    setBookmarkNoteInput("");
    setShowBookmarkNoteModal(true);
  };

  const saveBookmarkWithNote = () => {
    if (newBookmarkTime === null) return;
    
    const newBookmark: AudiobookBookmark = {
      id: `bookmark-${Date.now()}`,
      time: newBookmarkTime,
      title: bookmarkTitleInput || `Bookmark @ ${audiobookApi.formatDuration(newBookmarkTime)}`,
      note: bookmarkNoteInput.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    
    const updated = [...bookmarks, newBookmark];
    setBookmarks(updated);
    localStorage.setItem(`audiobook-${document.id}-bookmarks`, JSON.stringify(updated));
    setShowBookmarkNoteModal(false);
    showSuccess("Bookmark added", `Saved at ${audiobookApi.formatDuration(newBookmarkTime)}`);
  };
  
  const deleteBookmark = (id: string) => {
    const updated = bookmarks.filter(b => b.id !== id);
    setBookmarks(updated);
    localStorage.setItem(`audiobook-${document.id}-bookmarks`, JSON.stringify(updated));
  };
  
  const goToBookmark = (bookmark: AudiobookBookmark) => {
    seek(bookmark.time);
    setShowBookmarks(false);
  };
  
  // Sleep timer
  const startSleepTimer = (minutes: number) => {
    const endTime = Date.now() + minutes * 60 * 1000;
    setSleepTimer({ minutes, endTime, mode: "time" });
    setShowSleepTimer(false);
    showSuccess("Sleep timer set", `Playback will pause in ${minutes} minutes`);
  };

  const startChapterSleepTimer = () => {
    setSleepTimer({ mode: "chapter" });
    setShowSleepTimer(false);
    showSuccess("Sleep timer set", "Playback will pause at the end of the current chapter");
  };
  
  const cancelSleepTimer = () => {
    setSleepTimer(null);
  };

  const handleToggleSilenceSkip = () => {
    initAudioNodes();
    setSilenceSkipEnabled(!silenceSkipEnabled);
  };

  const handleToggleVolumeBoost = () => {
    initAudioNodes();
    setVolumeBoostEnabled(!volumeBoostEnabled);
  };

  // ---- Contextual command-palette actions --------------------------------
  // This viewer is reused as the Podcast tab's inline player (isPodcast). In
  // that case it reports view "podcast" so playback actions route here while
  // PodcastManager handles podcast-specific (episode) actions. Only the active
  // tab's viewer listens.
  const isActiveTab = useIsActiveTab();
  usePaletteActionListener(
    isPodcast ? "podcast" : "audiobook",
    {
      "audiobook.playPause": () => togglePlay(),
      "audiobook.skipBack": () => skip(-10),
      "audiobook.skipForward": () => skip(10),
      "audiobook.cycleSpeed": () => cyclePlaybackRate(),
      "audiobook.toggleMute": () => toggleMute(),
      "audiobook.toggleChapters": () => setShowChapters((prev) => !prev),
      "audiobook.addBookmark": () => addBookmark(),
      "audiobook.toggleTranscript": () => setShowTranscript((prev) => !prev),
      "audiobook.toggleSleepTimer": () => setShowSleepTimer((prev) => !prev),
      "audiobook.toggleFullscreen": () => setIsFullscreen((prev) => !prev),
      // Playback actions reused when serving as the Podcast inline player:
      "podcast.playPause": () => togglePlay(),
      "podcast.skipBack": () => skip(-10),
      "podcast.skipForward": () => skip(10),
      "podcast.toggleTranscript": () => setShowTranscript((prev) => !prev),
    },
    { isActive: isActiveTab },
  );
  
  useEffect(() => {
    if (!sleepTimer) return;
    
    const interval = setInterval(() => {
      if (!audioRef.current) return;
      
      if (sleepTimer.mode === "time" && sleepTimer.endTime) {
        const timeLeftMs = sleepTimer.endTime - Date.now();
        if (timeLeftMs <= 0) {
          if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
            audioRef.current.volume = volume;
          }
          setSleepTimer(null);
          showInfo("Sleep timer", "Playback paused");
        } else if (timeLeftMs <= 5000) {
          // Gradual volume fade-out over last 5 seconds
          const factor = timeLeftMs / 5000;
          audioRef.current.volume = volume * factor;
        }
      } else if (sleepTimer.mode === "chapter") {
        const activeChapter = getCurrentChapter();
        if (activeChapter) {
          const chapEnd = activeChapter.endTime || (activeChapter.startTime + (activeChapter.duration || 0));
          if (chapEnd > 0) {
            const timeUntilEnd = chapEnd - audioRef.current.currentTime;
            if (timeUntilEnd <= 0) {
              if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
                audioRef.current.volume = volume;
              }
              setSleepTimer(null);
              showInfo("Sleep timer", "Chapter finished, playback paused");
            } else if (timeUntilEnd <= 5) {
              // Gradual volume fade-out over last 5 seconds
              const factor = timeUntilEnd / 5;
              audioRef.current.volume = volume * factor;
            }
          }
        }
      }
    }, 250);
    
    return () => {
      clearInterval(interval);
      if (audioRef.current) {
        audioRef.current.volume = volume;
      }
    };
  }, [sleepTimer, isPlaying, volume, showInfo]);
  
  const getCurrentChapter = (): AudiobookChapter | null => {
    if (!chapters.length) return null;

    if (multiPartInfo && chapters.length === multiPartInfo.partFiles.length) {
      const idx = Math.min(currentPartIndex, chapters.length - 1);
      return chapters[idx];
    }

    for (let i = chapters.length - 1; i >= 0; i--) {
      if (currentTime >= chapters[i].startTime) {
        return chapters[i];
      }
    }
    return chapters[0];
  };
  
  const handleTranscribe = async () => {
    // Podcasts use their own transcription pipeline (keyed by episodeId), and
    // the audio is fetched by the backend — so document.filePath is often empty.
    if (isPodcast) {
      if (!episodeId) return;
      const allSettings = useSettingsStore.getState().settings;
      const audioSettings = allSettings.audioTranscription;
      const language = audioSettings.language || "en";
      try {
        setPodcastTranscriptionProgress({ status: "starting", progress: 0 });
        // On mobile the local Whisper/sherpa-onnx sidecar + FFmpeg pipeline
        // doesn't work — route to Groq cloud transcription (which also yields
        // word-level timestamps for karaoke highlighting). Falls back to the
        // local command on desktop (when the provider isn't groq).
        const useGroq = audioSettings.provider === "groq" || isNativeMobile();
        if (useGroq) {
          const audioUrl = remoteAudioUrl || document.filePath;
          if (!audioUrl) {
            showError("Transcription Failed", "No audio URL available for this episode.");
            return;
          }
          await transcribePodcastEpisodeWithGroq(episodeId, audioUrl, language);
        } else {
          const modelId = audioSettings.preferredModelId || "distil-small.en";
          const autoSegment = allSettings.documents.autoProcessOnImport;
          await transcribePodcastEpisode(episodeId, modelId, language, autoSegment);
        }
      } catch (err) {
        setPodcastTranscriptionProgress(null);
        showError("Transcription Failed", String(err));
      }
      return;
    }

    if (!document.filePath) {
      showError("Transcription Error", "No file path available for this document");
      return;
    }

    const settings = useSettingsStore.getState().settings.audioTranscription;
    const provider = isNativeMobile()
      ? (settings.provider === "local" ? "groq" : settings.provider)
      : settings.provider;

    try {
      let currentProfiles = profiles;
      if (currentProfiles.length === 0) {
        await fetchProfiles();
        currentProfiles = useTranscriptionStore.getState().profiles;
      }

      const installed = currentProfiles.filter((p) => p.installed);

      // Define quality ranks for local models (highest quality first)
      const MODEL_QUALITY_RANK = [
        "parakeet-tdt-ctc-110m",  // Parakeet TDT-CTC 110M - ~126MB (SOTA English, very fast)
        "sense-voice-small",      // SenseVoice Small - ~234MB (SOTA zh/en/ja/ko/yue)
        "small",                  // Whisper Small (Multilingual Balanced) - ~488MB
        "distil-small.en",        // Whisper Distil Small (English Fast) - ~336MB
        "base",                   // Whisper Base (Multilingual Fast) - ~148MB
      ];

      // Determine model to use
      let bestModelId = settings.preferredModelId;
      const isPreferredInstalled = installed.some((p) => p.id === bestModelId);

      if (!bestModelId || !isPreferredInstalled) {
        if (installed.length > 0) {
          // Sort installed by rank
          const sortedInstalled = [...installed].sort((a, b) => {
            let rankA = MODEL_QUALITY_RANK.indexOf(a.id);
            let rankB = MODEL_QUALITY_RANK.indexOf(b.id);
            if (rankA === -1) rankA = 999;
            if (rankB === -1) rankB = 999;
            return rankA - rankB;
          });
          bestModelId = sortedInstalled[0].id;
        } else {
          bestModelId = "distil-small.en"; // Fallback default
        }
      }

      const isGroq = provider === "groq";
      const language = settings.language === "auto" ? undefined : (settings.language || "en");

      // Route transcription based on model & provider.
      // Groq (always on mobile, or when the user picks Groq on desktop) goes
      // through the dedicated transcribe_audio_file_groq command — the
      // auto-transcription queue worker only knows local Whisper/Parakeet models
      // and has no Groq path, so queueing "groq" there fails to find a model.
      if (isGroq) {
        if (!document.filePath) {
          showError("Transcription Error", "No file path available for this document");
          return;
        }
        setAudiobookTranscriptionProgress({ status: "starting", progress: 0 });
        showInfo("Transcribing via Groq…", "Your audiobook is being transcribed. You can keep listening while it runs.");
        try {
          await audiobookApi.transcribeAudiobookWithGroq(document.id, document.filePath, language);
          // The command persists segments to the transcript tables; reload them
          // so the panel + karaoke highlight + auto-scroll (book sync) pick up.
          await loadTranscript(document.id, document.id);
          setAudiobookTranscriptionProgress(null);
          showSuccess("Transcription Complete", "Audiobook transcript is ready.");
        } catch (err) {
          setAudiobookTranscriptionProgress(null);
          showError("Transcription Failed", String(err));
        }
      } else {
        const finalModelId = bestModelId;
        const currentChapter = getCurrentChapter();
        const chapterId = currentChapter?.id?.toString() || "default";
        await startTranscription(
          document.id,
          chapterId,
          document.filePath,
          finalModelId,
          settings.language || "en"
        );
        showSuccess("Transcription Started", "Transcribing in background...");
      }
    } catch (err) {
      showError("Transcription Failed", String(err));
    }
  };

  const isCurrentTranscribing = isPodcast
    ? !!podcastTranscriptionProgress
    : (activeJob?.bookId === document.id || !!audiobookTranscriptionProgress);

  const isTranscribing = isCurrentTranscribing || podcastTranscriptStatus === "transcribing" || podcastTranscriptStatus === "downloading";

  // Text selection for extracts
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      setSelectedText(selection.toString());
    }
  };
  
  const createExtractFromSelection = () => {
    if (selectedText) {
      setIsExtractDialogOpen(true);
    }
  };
  
  // Current chapter
  const currentChapter = getCurrentChapter();

  // Podcast transcripts are stored as a single text blob; split into
  // sentence-based segments so they render like audiobook segments. Podcast
  // Build the display segments for the podcast transcript panel. Real segments
  // from getPodcastTranscript carry start/end in SECONDS (normalized in the API)
  // and may carry per-word timings (Groq word-level) for karaoke highlighting.
  // When no real segments exist, fall back to sentence-splitting the blob with
  // unsynced start/end (timestamps hidden). startTime/endTime are in seconds to
  // match the active-segment lookup in handleTimeUpdate.
  const podcastDisplaySegments = isPodcast
    ? (podcastTranscriptSegments.length > 0
        ? podcastTranscriptSegments
        : (podcastTranscriptText || "")
            .split(/(?<=[.!?])\s+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((text, i) => ({ start: 0, end: 0, text, wordTimings: undefined as never })))
        .map((seg, i) => ({
          id: `pod-seg-${i}`,
          text: seg.text,
          startTime: seg.start || 0,
          endTime: seg.end || 0,
          wordTimings: seg.wordTimings,
        }))
    : [];
  const hasPodcastTranscript = isPodcast && (podcastDisplaySegments.length > 0);

  // Load podcast transcript when the panel is opened (podcasts are stored in
  // podcast_episodes.transcript_text, a separate system from the document
  // transcript tables that loadTranscript() reads from).
  useEffect(() => {
    if (!showTranscript || !isPodcast || !episodeId) {
      setHasLoadedStatus(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await getPodcastTranscript(episodeId);
        if (cancelled) return;
        setPodcastTranscriptText(res.text || null);
        setPodcastTranscriptSegments(res.segments || []);
        setPodcastTranscriptStatus(res.status || null);

        // If it's currently downloading/transcribing in backend, initialize local progress bar
        if (res.status === "transcribing" || res.status === "downloading") {
          setPodcastTranscriptionProgress({
            status: res.status,
            progress: res.status === "downloading" ? 10 : 30,
          });
        }

        setHasLoadedStatus(true);
      } catch (_e) {
        if (!cancelled) {
          setPodcastTranscriptText(null);
          setPodcastTranscriptSegments([]);
          setPodcastTranscriptStatus(null);
          setHasLoadedStatus(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [showTranscript, isPodcast, episodeId]);

  // Listen for podcast transcription progress/complete/error events so the
  // panel's progress bar and transcript reflect the background job.
  useEffect(() => {
    if (!isTauri() || !isPodcast || !episodeId) return;
    let unlisteners: Array<() => void> = [];
    let cancelled = false;

    const setupListeners = async () => {
      try {
        const u1 = await listen<{ episodeId: string; status: string; progress: number }>(
          "podcast://transcription-progress",
          (e) => {
            if (e.payload.episodeId !== episodeId) return;
            setPodcastTranscriptionProgress({ status: e.payload.status, progress: e.payload.progress });
            setPodcastTranscriptStatus(e.payload.status);
          },
        );
        const u2 = await listen<{ episodeId: string; segmentCount: number; duration: number }>(
          "podcast://transcription-complete",
          async (e) => {
            if (e.payload.episodeId !== episodeId) return;
            setPodcastTranscriptionProgress(null);
            setPodcastTranscriptStatus("done");
            try {
              const res = await getPodcastTranscript(episodeId);
              setPodcastTranscriptText(res.text || null);
              setPodcastTranscriptSegments(res.segments || []);
              showSuccess("Transcription Complete", "Podcast transcript is ready.");
            } catch (_e) { /* non-critical */ }
          },
        );
        const u3 = await listen<{ episodeId: string; error: string }>(
          "podcast://transcription-error",
          (e) => {
            if (e.payload.episodeId !== episodeId) return;
            setPodcastTranscriptionProgress(null);
            setPodcastTranscriptStatus("error");
            showError("Transcription Failed", e.payload.error);
          },
        );

        if (cancelled) {
          u1();
          u2();
          u3();
        } else {
          unlisteners = [u1, u2, u3];
        }
      } catch (err) {
        console.error("Failed to setup podcast transcription listeners:", err);
      }
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [isPodcast, episodeId, showSuccess, showError]);

  // Auto-start transcription for podcasts when the transcript view is opened and none exists
  useEffect(() => {
    if (!showTranscript || !isPodcast || !episodeId || !hasLoadedStatus) return;

    const isTranscribing = !!podcastTranscriptionProgress || podcastTranscriptStatus === "transcribing" || podcastTranscriptStatus === "downloading";
    const hasTranscript = !!podcastTranscriptText || podcastTranscriptSegments.length > 0;

    if (!isTranscribing && !hasTranscript) {
      // Auto-start Groq transcription for podcasts on mobile/desktop
      void handleTranscribe();
    }
  }, [showTranscript, isPodcast, episodeId, hasLoadedStatus, podcastTranscriptStatus, podcastTranscriptText, podcastTranscriptSegments.length, podcastTranscriptionProgress]);

  // Listen for audiobook (non-podcast) Groq transcription progress/complete/error
  // events so the transcript panel's progress bar reflects the background job run
  // by transcribe_audio_file_groq. (Podcasts use the podcast:// events above.)
  useEffect(() => {
    if (isPodcast) return;
    if (!isTauri()) return;
    let unlisteners: Array<() => void> = [];
    let cancelled = false;

    const setupListeners = async () => {
      try {
        const u1 = await listen<{ documentId: string; status: string; progress: number; message?: string }>(
          "audiobook://transcription-progress",
          (e) => {
            if (e.payload.documentId !== document.id) return;
            setAudiobookTranscriptionProgress({
              status: e.payload.status,
              progress: e.payload.progress,
              message: e.payload.message,
            });
          },
        );
        const u2 = await listen<{ documentId: string; segmentCount: number }>(
          "audiobook://transcription-complete",
          async (e) => {
            if (e.payload.documentId !== document.id) return;
            setAudiobookTranscriptionProgress(null);
            // Reload transcript segments from the DB so the panel + karaoke +
            // auto-scroll (book sync) pick them up.
            try {
              await loadTranscript(document.id, document.id);
              showSuccess("Transcription Complete", "Audiobook transcript is ready.");
            } catch { /* non-critical */ }
          },
        );
        if (cancelled) {
          u1();
          u2();
        } else {
          unlisteners = [u1, u2];
        }
      } catch (err) {
        console.error("Failed to setup audiobook transcription listeners:", err);
      }
    };

    setupListeners();

    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [isPodcast, document.id, loadTranscript, showSuccess]);

  useEffect(() => {
    if (!showTranscript) return;
    if (isPodcast) return; // podcasts use the effect above, not the document transcript store
    if (transcript?.segments?.length) return;
    if (activeSegments.length > 0) return;

    // Try loading transcript with several possible chapter IDs:
    // 1. document.id (how auto-transcription stores it)
    // 2. chapter-based ID (how in-viewer transcription stores it)
    // 3. "default" (fallback)
    const chapterId = currentChapter?.id?.toString() || "default";
    const tryLoad = async () => {
      for (const cid of [document.id, chapterId, "default"]) {
        try {
          await loadTranscript(document.id, cid);
          const segments = useTranscriptionStore.getState().activeSegments;
          if (segments.length > 0) return;
        } catch (_e) { /* non-critical */ }
      }
    };
    tryLoad();
  }, [
    showTranscript,
    isPodcast,
    transcript?.segments?.length,
    activeSegments.length,
    loadTranscript,
    document.id,
    currentChapter?.id,
  ]);

  // Sync transcript to documents.content so the AI assistant can access it
  useEffect(() => {
    if (!isTauri() || activeSegments.length === 0 || transcript?.segments?.length) return;
    const fullText = activeSegments.map(s => s.text).join(" ");
    if (!fullText) return;
    (async () => {
      try {
        const doc = await getDocument(document.id);
        if (!doc?.content) {
          await updateDocumentContent(document.id, fullText);
        }
      } catch { /* non-critical */ }
    })();
  }, [activeSegments.length, document.id, isTauri, transcript?.segments?.length]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      
      switch (e.key) {
        case " ":
          e.preventDefault();
          togglePlay();
          break;
        case "ArrowLeft":
          e.preventDefault();
          skip(e.shiftKey ? -30 : -10);
          break;
        case "ArrowRight":
          e.preventDefault();
          skip(e.shiftKey ? 30 : 10);
          break;
        case "ArrowUp":
          e.preventDefault();
          handleVolumeChange(Math.min(1, volume + 0.1));
          break;
        case "ArrowDown":
          e.preventDefault();
          handleVolumeChange(Math.max(0, volume - 0.1));
          break;
        case "m":
          e.preventDefault();
          toggleMute();
          break;
        case "s":
          e.preventDefault();
          cyclePlaybackRate();
          break;
        case "b":
          e.preventDefault();
          addBookmark();
          break;
        case "t":
          e.preventDefault();
          setShowTranscript(prev => !prev);
          break;
        case "c":
          e.preventDefault();
          // On mobile the desktop left sidebar is unreachable, so toggle the
          // adaptive chapters sheet instead. On desktop, toggle the sidebar.
          if (isMobile) {
            setShowChaptersSheet(prev => !prev);
          } else {
            setShowChapters(prev => !prev);
          }
          break;
        case "f":
          e.preventDefault();
          setIsFullscreen(prev => !prev);
          break;
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPlaying, volume, playbackRate]);
  
  // Progress bar click handler
  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDownloading) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    seek(percent * duration);
  };
  
  return (
    <div className={cn(
      "flex flex-col bg-background h-full relative",
      isFullscreen && "fixed inset-0 z-50"
    )}>
      {/* Mobile top bar: back chevron + title + details. Rendered only on mobile
          (PodcastManager supplies its own external bar on desktop-style mounts). */}
      {isMobile && !hideTitleHeader && (
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card/80 backdrop-blur-md flex-shrink-0 safe-top">
          <button
            onClick={() => onBack?.()}
            className="flex-shrink-0 w-9 h-9 -ml-1 flex items-center justify-center rounded-full hover:bg-muted transition-colors active:scale-95"
            aria-label="Back"
          >
            <CaretLeft className="w-6 h-6" />
          </button>
          <div className="flex-1 min-w-0 text-center">
            <p className="text-sm font-semibold text-foreground truncate">
              {episodeTitle || document.title}
            </p>
            {podcastTitle && (
              <p className="text-xs text-muted-foreground truncate">{podcastTitle}</p>
            )}
          </div>
          <button
            onClick={() => setShowMobileDetails((v) => !v)}
            className={cn(
              "flex-shrink-0 w-9 h-9 -mr-1 flex items-center justify-center rounded-full transition-colors active:scale-95",
              showMobileDetails ? "bg-primary/10 text-primary" : "hover:bg-muted"
            )}
            aria-label="Details"
          >
            <Info className="w-5 h-5" />
          </button>
        </div>
      )}

      {/* Mobile details panel (toggled by the info button). */}
      {isMobile && !hideTitleHeader && showMobileDetails && (
        <div className="px-4 py-3 border-b border-border bg-card/60 flex-shrink-0 space-y-1.5 text-sm">
          <p className="font-medium text-foreground">{episodeTitle || document.title}</p>
          {podcastTitle && <p className="text-muted-foreground">{podcastTitle}</p>}
          <p className="text-muted-foreground">
            {audiobookApi.formatDuration(duration)} · {playbackRate}x speed
          </p>
        </div>
      )}

      {/* Premium SponsorBlock Skip Notification Overlay */}
      {skipNotification && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top duration-300">
          <div className="px-4 py-3 bg-card/85 backdrop-blur-md border border-border/60 rounded-2xl shadow-xl flex items-center gap-3.5 max-w-sm sm:max-w-md ring-1 ring-black/5">
            <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary shadow-sm flex-shrink-0 animate-pulse">
              <Sparkle className="h-5.5 w-5.5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-foreground tracking-wide uppercase opacity-90">
                SponsorBlock
              </p>
              <p className="text-sm font-medium text-muted-foreground truncate leading-normal">
                {skipNotification.undoable
                  ? `Auto-skipped: ${getCategoryDisplayName(skipNotification.category as any)} (${skipNotification.savedSeconds}s)`
                  : `Sponsored segment cut from downloaded file (${skipNotification.savedSeconds}s saved!)`
                }
              </p>
            </div>
            {skipNotification.undoable && (
              <button
                onClick={() => handleUndoSkip(skipNotification.originalStart!, skipNotification.originalEnd!, skipNotification.category)}
                className="px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/95 text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow-sm transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              >
                <ArrowCounterClockwise className="h-3.5 w-3.5" />
                Undo
              </button>
            )}
            <button
              onClick={() => setSkipNotification(null)}
              className="p-1.5 hover:bg-muted text-muted-foreground hover:text-foreground rounded-lg transition-colors flex-shrink-0"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {/* Audio element - use fallbackSrc (to override failing custom protocol sources), podcastLocalSrc (downloaded podcast), remoteAudioUrl (podcast stream), fileContent (blob URL), otherwise fall back to partSources */}
      <audio
        ref={audioRef}
        src={fallbackSrc || podcastLocalSrc || (!isTauri() || downloadError ? remoteAudioUrl : undefined) || preparedPlaybackSrc || fileContent || (multiPartInfo ? partSources[currentPartIndex] || null : null) || undefined}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={handleCanPlay}
        onProgress={handleProgress}
        onStalled={handleStalled}
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={handlePause}
        onError={handleAudioError}
      />

      <AudiobookPlaybackErrorNotice
        error={playbackError}
        retryLabel={t("viewer.retryPlay")}
        onRetry={retryPlayback}
      />
      
      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar - Chapters/Bookmarks (desktop only) */}
        {!isMobile && (showChapters || showBookmarks) && (
          <div className="w-80 border-r border-border bg-card flex flex-col">
            <div className="flex items-center justify-between border-b border-border p-3">
              <h3 className="font-semibold">
                {showChapters ? t("viewer.chapters") : t("viewer.bookmarks")}
              </h3>
              <button
                onClick={() => {
                  setShowChapters(false);
                  setShowBookmarks(false);
                }}
                className="p-1 hover:bg-muted rounded"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            
            {/* Part selector for multi-part books */}
            {showChapters && multiPartInfo && (
              <div className="border-b border-border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground mb-1.5">{t("viewer.selectPart")}</p>
                <select
                  value={currentPartIndex}
                  onChange={(e) => goToPart(Number(e.target.value))}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all text-foreground cursor-pointer"
                >
                  {multiPartInfo.partFiles.map((part, idx) => {
                    const fileName = part.split(/[/\\]/).pop() || `Part ${idx + 1}`;
                    return (
                      <option key={idx} value={idx}>
                        Part {idx + 1}: {fileName}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
            
            <div className="flex-1 overflow-y-auto">
              {showChapters && chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  onClick={() => goToChapter(chapter)}
                  className={cn(
                    "w-full px-4 py-3 text-left hover:bg-muted transition-colors border-b border-border/50",
                    currentChapter?.id === chapter.id && "bg-primary/10 text-primary"
                  )}
                >
                  <p className="text-sm font-medium">{chapter.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {audiobookApi.formatDuration(chapter.startTime)}
                  </p>
                </button>
              ))}
              
              {showBookmarks && (
                <>
                  {bookmarks.length === 0 ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                      {t("viewer.noBookmarksYet")}
                    </div>
                  ) : (
                    bookmarks.map(bookmark => (
                      <div
                        key={bookmark.id}
                        className="flex items-start gap-2 px-4 py-3 border-b border-border/50 hover:bg-muted group"
                      >
                        <button
                          onClick={() => goToBookmark(bookmark)}
                          className="flex-1 text-left"
                        >
                          <p className="text-sm font-medium">{bookmark.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {audiobookApi.formatDuration(bookmark.time)}
                          </p>
                          {bookmark.note && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {bookmark.note}
                            </p>
                          )}
                        </button>
                        <button
                          onClick={() => deleteBookmark(bookmark.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 hover:text-destructive rounded"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        )}
        
        {/* Center - Main player */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Cover and info */}
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="flex flex-col items-center max-w-md w-full">
              {/* Cover */}
              <div
                className="relative mb-6 aspect-square w-full max-w-[300px] rounded-xl overflow-hidden shadow-2xl cursor-pointer group"
                onClick={togglePlay}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePlay(); } }}
                aria-label={isPlaying ? t("viewer.pause") : t("viewer.play")}
              >
                {localCoverUrl ? (
                  <img
                    src={localCoverUrl}
                    alt={document.title}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-muted flex items-center justify-center">
                    <Headphones className="h-24 w-24 text-muted-foreground" />
                  </div>
                )}

                {/* Play/pause overlay on hover */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/40 transition-all duration-200">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                    {isPlaying ? (
                      <Pause className="h-16 w-16 text-white drop-shadow-lg" />
                    ) : (
                      <Play className="h-16 w-16 text-white drop-shadow-lg" />
                    )}
                  </div>
                </div>

                {/* Playing indicator */}
                {isPlaying && (
                  <div className="absolute bottom-4 right-4 flex gap-1">
                    {[1, 2, 3].map(i => (
                      <div
                        key={i}
                        className="w-1 h-4 bg-primary rounded-full animate-pulse"
                        style={{ animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                  </div>
                )}

                {isDownloading && (
                  <div className="absolute inset-0 bg-background/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center z-20 cursor-default" onClick={(e) => e.stopPropagation()}>
                    <CircleNotch className="h-10 w-10 text-primary animate-spin mb-4" />
                    <h3 className="font-semibold text-foreground mb-1 text-sm">
                      {downloadStatus === "cutting" ? "Stripping Sponsor Segments..." : "Downloading Episode..."}
                    </h3>
                    <p className="text-xs text-muted-foreground mb-4 max-w-[220px]">
                      {downloadStatus === "cutting"
                        ? "Using SponsorBlock and ffmpeg to cut sponsored segments"
                        : `Downloaded ${downloadProgress}%`}
                    </p>
                    <div className="w-full bg-muted rounded-full h-1.5 max-w-[180px] overflow-hidden mb-3">
                      <div 
                        className="bg-primary h-full transition-all duration-300 rounded-full"
                        style={{ width: `${downloadProgress}%` }}
                      />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        shouldPlayAfterDownloadRef.current = !shouldPlayAfterDownloadRef.current;
                        setIsPlaying(shouldPlayAfterDownloadRef.current);
                      }}
                      className="px-3 py-1 bg-primary/25 text-primary hover:bg-primary/35 text-xs font-semibold rounded-lg transition-all"
                    >
                      {isPlaying ? "Cancel Auto-Play" : "Play When Ready"}
                    </button>
                  </div>
                )}
              </div>
              
              {/* Info */}
              {!hideTitleHeader && (
                <>
                  <h1 className="text-xl font-bold text-center mb-1">{episodeTitle || document.title}</h1>
                  <p className="text-muted-foreground text-center mb-2">
                    {podcastTitle || metadata.author || document.metadata?.author}
                  </p>
                </>
              )}
              
              {/* Multi-part indicator */}
              {multiPartInfo && (
                <div className="flex items-center justify-center gap-2 mb-2">
                  <span className="text-xs text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    {t("viewer.partOf", { current: currentPartIndex + 1, total: multiPartInfo.partFiles.length })}
                  </span>
                </div>
              )}
              
              {currentChapter && (
                <p className="text-sm text-primary text-center">
                  {currentChapter.title}
                </p>
              )}
            </div>
          </div>
          
          {/* Controls */}
          <div className={cn(
            "border-t border-border bg-card p-4",
            isMobile && "pb-[calc(5rem+env(safe-area-inset-bottom))]"
          )}>
            {/* Mobile chapter chip — tappable "now playing" chapter that opens
                the chapters sheet. Mirrors the Spotify/Apple Podcasts pattern:
                surfaces the current chapter at a glance and keeps the control
                row uncluttered. Only shown when there is more than one real
                chapter (the parser synthesizes a dummy "Chapter 1" otherwise). */}
            {isMobile && chapters.length > 1 && (
              <button
                type="button"
                onClick={() => setShowChaptersSheet(true)}
                className="mx-auto mb-3 flex max-w-full items-center gap-2 rounded-full bg-muted/60 px-3.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
                aria-label={t("viewer.chapters")}
              >
                <List className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">
                  {currentChapter?.title || t("viewer.chapters")}
                </span>
                <CaretRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            )}

            {/* Progress bar */}
            <div className="mb-4">
              <div 
                className={cn(
                  "h-2 bg-muted rounded-full relative group",
                  isDownloading ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                )}
                onClick={handleProgressClick}
              >
                {/* Buffered */}
                <div 
                  className="absolute h-full bg-muted-foreground/30 rounded-full"
                  style={{ width: `${duration > 0 ? (buffered / duration) * 100 : 0}%` }}
                />
                {/* Played */}
                <div 
                  className="absolute h-full bg-primary rounded-full"
                  style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
                {/* Handle */}
                <div 
                  className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-primary rounded-full shadow transition-transform scale-75 group-hover:scale-110 duration-200"
                  style={{ left: `calc(${duration > 0 ? (currentTime / duration) * 100 : 0}% - 8px)` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground mt-1">
                <div className="flex items-center gap-1">
                  <span>{audiobookApi.formatDuration(currentTime)}</span>
                  {isWaitingForSeek && (
                    <span className="text-[10px] bg-primary/20 text-primary px-1 rounded animate-pulse">
                      {t("viewer.loadingPosition") || "Loading position..."}
                    </span>
                  )}
                </div>
                <span>{audiobookApi.formatDuration(duration)}</span>
              </div>

            </div>
            
            {/* Control buttons */}
            <div className="flex items-center justify-between">
              {/* Left - Secondary controls (desktop only; mobile uses the top bar
                  for back/details and keeps the center playback cluster). */}
              {!isMobile && (
              <div className="flex items-center gap-2">
                {/* Chapters */}
                <button
                  onClick={() => {
                    setShowChapters(!showChapters);
                    setShowBookmarks(false);
                  }}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    showChapters ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                  title={t("viewer.chapters")}
                >
                  <List className="h-5 w-5" />
                </button>
                
                {/* Bookmarks */}
                <button
                  onClick={() => {
                    setShowBookmarks(!showBookmarks);
                    setShowChapters(false);
                  }}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    showBookmarks ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                  title={t("viewer.bookmarks")}
                >
                  <Bookmark className="h-5 w-5" />
                </button>
                
                {/* Add bookmark */}
                <button
                  onClick={addBookmark}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                  title={t("viewer.addBookmark")}
                >
                  <BookmarkSimple className="h-5 w-5" />
                </button>
              </div>
              )}

              {/* Center - Main playback */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => skip(-30)}
                  disabled={isDownloading}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    isDownloading ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={t("viewer.skipBack30s")}
                >
                  <SkipBack className="h-5 w-5" />
                </button>
                
                <button
                  onClick={togglePlay}
                  className="p-4 bg-primary text-primary-foreground rounded-full hover:opacity-90 transition-opacity"
                  title={t("viewer.playPause")}
                >
                  {isDownloading ? (
                    <CircleNotch className="h-6 w-6 animate-spin text-primary-foreground" />
                  ) : isPlaying ? (
                    <Pause className="h-6 w-6" />
                  ) : (
                    <Play className="h-6 w-6" />
                  )}
                </button>
                
                <button
                  onClick={() => skip(30)}
                  disabled={isDownloading}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    isDownloading ? "text-muted-foreground/40 cursor-not-allowed" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                  title={t("viewer.skipForward30s")}
                >
                  <SkipForward className="h-5 w-5" />
                </button>
              </div>
              
              {/* Right - Additional controls */}
              <div className="flex items-center gap-3">
                {/* Sleep timer indicator */}
                {sleepTimer && (
                  <button
                    onClick={cancelSleepTimer}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs text-amber-500 bg-amber-500/10 rounded-lg hover:bg-amber-500/20"
                    title={t("viewer.cancelSleepTimer")}
                  >
                    <Moon className="h-3 w-3 animate-pulse" />
                    {sleepTimer.mode === "time" && sleepTimer.endTime ? (
                      audiobookApi.formatDuration(Math.max(0, (sleepTimer.endTime - Date.now()) / 1000))
                    ) : (
                      "Chapter"
                    )}
                  </button>
                )}
                
                {/* Sleep timer */}
                <button
                  onClick={() => setShowSleepTimer(!showSleepTimer)}
                  className={cn(
                    "p-2 rounded-lg transition-colors relative",
                    showSleepTimer ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                  title={t("viewer.sleepTimer")}
                >
                  <Clock className="h-5 w-5" />
                </button>

                {/* Silence Skipping */}
                <button
                  onClick={handleToggleSilenceSkip}
                  className={cn(
                    "p-2 rounded-lg transition-colors relative",
                    silenceSkipEnabled ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                  )}
                  title="Silence Skipping"
                >
                  <Sparkle className="h-5 w-5" />
                </button>

                {/* Volume Boost */}
                <button
                  onClick={handleToggleVolumeBoost}
                  className={cn(
                    "p-2 rounded-lg transition-colors relative",
                    volumeBoostEnabled ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
                  )}
                  title="Volume Boost"
                >
                  <SpeakerHigh className="h-5 w-5" />
                </button>
                
                {/* Speed Slider */}
                <div className="flex items-center gap-2 px-2.5 py-1 bg-muted/40 rounded-lg border border-border/50">
                  <span className="text-[10px] text-muted-foreground font-semibold select-none">Speed:</span>
                  <input
                    type="range"
                    min="0.5"
                    max="3.0"
                    step="0.05"
                    value={playbackRate}
                    onChange={(e) => {
                      const rate = parseFloat(e.target.value);
                      setPlaybackRate(rate);
                      if (audioRef.current) {
                        audioRef.current.playbackRate = rate;
                      }
                      localStorage.setItem("audiobook-rate", rate.toString());
                    }}
                    className="w-16 h-1 bg-muted rounded-full appearance-none cursor-pointer accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary"
                  />
                  <span className="text-[11px] font-bold text-foreground w-10 text-right select-none">
                    {playbackRate.toFixed(2)}x
                  </span>
                </div>
                
                {/* Volume (desktop only — mobile uses hardware volume) */}
                {!isMobile && (
                <div className="flex items-center gap-1">
                  <button
                    onClick={toggleMute}
                    className="p-2 hover:bg-muted rounded-lg transition-colors"
                    title={t("viewer.mute")}
                  >
                    {isMuted || volume === 0 ? (
                      <SpeakerSlash className="h-5 w-5" />
                    ) : (
                      <SpeakerHigh className="h-5 w-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 bg-muted rounded-full appearance-none cursor-pointer"
                  />
                </div>
                )}

                {/* Chapters — opens the adaptive chapters sheet. Visible on both
                    mobile and desktop so chapter navigation is reachable in every
                    mount context (notably the Queue, where the title header — and
                    thus the desktop-only left-cluster button — is hidden). The
                    existing desktop left-cluster button is preserved for muscle
                    memory; both toggle the same sheet. */}
                {chapters.length > 0 && (
                <button
                  onClick={() => setShowChaptersSheet(true)}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    showChaptersSheet ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                  title={t("viewer.chapters")}
                  aria-label={t("viewer.chapters")}
                >
                  <List className="h-5 w-5" />
                </button>
                )}

                {/* Transcript toggle */}
                <button
                  onClick={() => setShowTranscript(!showTranscript)}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    showTranscript ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  )}
                  title={t("viewer.transcript")}
                >
                  <TextT className="h-5 w-5" />
                </button>
                
                {/* Fullscreen (desktop only) */}
                {!isMobile && (
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-2 hover:bg-muted rounded-lg transition-colors"
                  title={t("viewer.fullscreen")}
                >
                  {isFullscreen ? (
                    <ArrowsInSimple className="h-5 w-5" />
                  ) : (
                    <ArrowsOutSimple className="h-5 w-5" />
                  )}
                </button>
                )}
              </div>
            </div>
          </div>
        </div>
        
        {/* Right sidebar - Transcript */}
        {showTranscript && (
          <div className={cn(
            "bg-card flex flex-col",
            // Desktop: a fixed-width sidebar beside the player. Mobile: a
            // full-screen overlay sheet (the w-96 sidebar is unusable on a phone)
            // so the streaming transcript + karaoke word highlight have room.
            isMobile
              ? "fixed inset-0 z-[60] w-full h-full"
              : "w-96 border-l border-border"
          )}>
            <div className="flex items-center gap-2 border-b border-border p-3 safe-top">
              {isMobile && (
                <button
                  onClick={() => setShowTranscript(false)}
                  className="p-2 -ml-2 hover:bg-muted rounded-lg active:scale-95 transition-transform"
                  aria-label="Go back to player"
                >
                  <CaretLeft className="h-5 w-5" />
                </button>
              )}
              <h3 className="font-semibold flex-1">{t("viewer.transcript")}</h3>
              {!isMobile && (
                <button
                  onClick={() => setShowTranscript(false)}
                  className="p-2 -mr-2 hover:bg-muted rounded-full active:scale-95 transition-transform"
                  aria-label="Close transcript"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </div>

            <div
              ref={transcriptRef}
              className="flex-1 overflow-y-auto overscroll-contain p-4"
              onMouseUp={handleTextSelection}
            >
              {(transcript || activeSegments.length > 0 || hasPodcastTranscript) ? (
                <>
                  {/* Extract button for selected text */}
                  {selectedText && (
                    <div className="sticky top-0 mb-4 p-2 bg-primary/10 rounded-lg flex items-center justify-between">
                      <span className="text-sm text-primary truncate flex-1 mr-2">
                        {selectedText.substring(0, 50)}...
                      </span>
                      <button
                        onClick={createExtractFromSelection}
                        className="px-3 py-1 bg-primary text-primary-foreground text-sm rounded-lg hover:opacity-90"
                      >
                        {t("viewer.extractButton")}
                      </button>
                    </div>
                  )}

                  {/* Transcript segments */}
                  <div className="space-y-2">
                    {(hasPodcastTranscript ? podcastDisplaySegments : (transcript?.segments || activeSegments)).map((segment, idx) => {
                      const id = (segment as any).id || `seg-${idx}`;
                      const startTime = (segment as any).startTime ?? (segment as any).start_ms / 1000;
                      const displayTime = sponsorBlockCuts.length > 0
                        ? mapOriginalTimeToCutTime(startTime, sponsorBlockCuts)
                        : startTime;
                      
                      return (
                        <div
                          key={id}
                          id={`segment-${id}`}
                          className={cn(
                            "p-3 rounded-lg cursor-pointer transition-all duration-150",
                            activeSegmentId === id
                              ? "bg-primary/15 border-l-4 border-primary ring-1 ring-primary/30 scale-[1.01]"
                              : "hover:bg-muted/50 border-l-4 border-transparent"
                          )}
                          onClick={() => {
                            const targetTime = sponsorBlockCuts.length > 0
                              ? mapOriginalTimeToCutTime(startTime, sponsorBlockCuts)
                              : startTime;
                            // Optimistically mark this segment active for instant visual
                            // feedback — otherwise the highlight only updates on the next
                            // audio timeupdate (which lags while the new position buffers),
                            // so the tap feels like it did nothing.
                            setActiveSegmentId(id);
                            seek(targetTime);
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">
                              {audiobookApi.formatDuration(displayTime)}
                            </span>
                            {(segment as any).speaker && (
                              <span className="text-xs text-primary">{(segment as any).speaker}</span>
                            )}
                          </div>
                          <PodcastSegmentText
                            text={segment.text}
                            wordTimings={(segment as any).wordTimings}
                            currentTime={currentTime}
                            isActive={activeSegmentId === id}
                          />
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : isTranscribing ? (
                <div className="flex flex-col items-center justify-center h-full py-16 px-6 text-center animate-[fadeIn_0.3s_ease-out]">
                  <div className="relative mb-6">
                    {/* Glowing outer ring */}
                    <div className="absolute inset-0 rounded-full bg-primary/20 blur-md animate-pulse" />
                    <div className="relative w-16 h-16 rounded-full bg-gradient-to-br from-primary to-orange-500 flex items-center justify-center text-white border border-primary/30 shadow-lg">
                      <Microphone className="w-8 h-8 animate-pulse" />
                    </div>
                  </div>
                  <h3 className="font-semibold text-foreground text-lg mb-2">
                    {podcastTranscriptionProgress?.status === "downloading" || podcastTranscriptStatus === "downloading"
                      ? "Downloading Audio..."
                      : "Transcribing Audio..."}
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-sm mb-6">
                    {isPodcast
                      ? (podcastTranscriptionProgress?.status === "downloading" || podcastTranscriptStatus === "downloading"
                          ? "Downloading audio file for transcription..."
                          : "Transcribing podcast episode using Groq Cloud Whisper...")
                      : (audiobookTranscriptionProgress?.message || "Transcribing audiobook using Groq Cloud Whisper...")}
                  </p>

                  {/* Progress bar */}
                  <div className="w-full max-w-xs bg-muted/60 border border-border/40 rounded-full h-2.5 overflow-hidden shadow-inner">
                    <div
                      className="h-full bg-gradient-to-r from-primary to-orange-500 rounded-full transition-all duration-500 ease-out"
                      style={{ width: `${isPodcast ? (podcastTranscriptionProgress?.progress ?? 10) : (audiobookTranscriptionProgress?.progress ?? transcriptionProgress ?? 10)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-primary mt-2">
                    {isPodcast ? (podcastTranscriptionProgress?.progress ?? 10) : (audiobookTranscriptionProgress?.progress ?? transcriptionProgress ?? 10)}% Completed
                  </span>
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8 animate-[fadeIn_0.3s_ease-out]">
                  <TextT className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p className="font-medium">{t("viewer.noTranscriptAvailable")}</p>

                  <div className="mt-6 space-y-4">
                    <button
                      onClick={handleTranscribe}
                      className="w-full flex flex-col items-center justify-center gap-1 px-4 py-3 bg-primary text-primary-foreground rounded-xl font-bold hover:opacity-90 transition-all active:scale-98"
                    >
                      <div className="flex items-center gap-2">
                        <Microphone className="w-5 h-5" />
                        {isNativeMobile()
                          ? `Transcribe with ${displayProvider === "groq" ? "Groq" : displayProvider}`
                          : t("viewer.startLocalTranscription")
                        }
                      </div>
                    </button>
                    <p className="text-xs" dangerouslySetInnerHTML={{ __html: t("viewer.usesWhisper") }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
      {/* Sleep timer popup */}
      {showSleepTimer && (
        <div className="absolute bottom-20 right-4 bg-card border border-border rounded-xl shadow-2xl p-4 z-50 max-w-[280px]">
          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
            <Moon className="w-4 h-4 text-amber-500 animate-pulse" />
            Sleep Timer
          </h4>
          <div className="grid grid-cols-3 gap-2 mb-3">
            {[5, 15, 30, 45, 60, 90].map(minutes => (
              <button
                key={minutes}
                onClick={() => startSleepTimer(minutes)}
                className="px-2 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-lg transition-colors font-medium"
              >
                {minutes}m
              </button>
            ))}
          </div>
          <button
            onClick={startChapterSleepTimer}
            className="w-full py-2 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded-lg transition-colors font-semibold"
          >
            End of Chapter
          </button>
          <button
            onClick={() => setShowSleepTimer(false)}
            className="mt-3 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground font-medium"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Bookmark note modal */}
      {showBookmarkNoteModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-4">
          <div className="bg-card border border-border rounded-xl max-w-md w-full p-6 shadow-2xl relative">
            <button
              onClick={() => setShowBookmarkNoteModal(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
            
            <h3 className="text-lg font-bold mb-4">Add Bookmark Note</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={bookmarkTitleInput}
                  onChange={(e) => setBookmarkTitleInput(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              
              <div>
                <label className="block text-xs font-semibold text-muted-foreground mb-1">
                  Note
                </label>
                <textarea
                  value={bookmarkNoteInput}
                  onChange={(e) => setBookmarkNoteInput(e.target.value)}
                  placeholder="Enter textual annotation/notes for this timestamp..."
                  rows={3}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                />
              </div>
            </div>
            
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowBookmarkNoteModal(false)}
                className="px-4 py-2 border border-border hover:bg-muted text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveBookmarkWithNote}
                className="px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
              >
                Save Bookmark
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Extract dialog */}
      <CreateExtractDialog
        isOpen={isExtractDialogOpen}
        onClose={() => {
          setIsExtractDialogOpen(false);
          setSelectedText("");
        }}
        documentId={document.id}
        selectedText={selectedText}
        pageNumber={Math.floor(currentTime)} // Use time as "page" for audio
      />

      {/* Chapters sheet — adaptive (bottom sheet on mobile / dialog on desktop).
          Backs the chapter chip above the progress bar and the chapters button in
          the control cluster. Reuses the same chapters data, goToChapter seek
          logic, multi-part selector, and active-chapter highlight as the desktop
          left sidebar. Rendered via portal so it overlays correctly even inside
          the Queue's paged container. */}
      <ResponsiveDialogSheet
        open={showChaptersSheet}
        onClose={() => setShowChaptersSheet(false)}
        title={t("viewer.chapters")}
        description={
          currentChapter
            ? `${currentChapter.title} · ${audiobookApi.formatDuration(currentChapter.startTime)}`
            : undefined
        }
        closeLabel={t("viewer.chapters")}
        presentation="auto"
        className="max-w-lg"
      >
        {/* Part selector for multi-part books (mirrors the desktop sidebar) */}
        {multiPartInfo && (
          <div className="mb-3 rounded-xl border border-border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground mb-1.5">{t("viewer.selectPart")}</p>
            <select
              value={currentPartIndex}
              onChange={(e) => goToPart(Number(e.target.value))}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-all text-foreground cursor-pointer"
            >
              {multiPartInfo.partFiles.map((part, idx) => {
                const fileName = part.split(/[/\\]/).pop() || `Part ${idx + 1}`;
                return (
                  <option key={idx} value={idx}>
                    Part {idx + 1}: {fileName}
                  </option>
                );
              })}
            </select>
          </div>
        )}

        <div className="-mx-1 max-h-[60vh] overflow-y-auto">
          {chapters.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("viewer.chapters")}
            </div>
          ) : (
            chapters.map((chapter) => {
              const isActive = currentChapter?.id === chapter.id;
              return (
                <button
                  key={chapter.id}
                  type="button"
                  onClick={() => goToChapter(chapter)}
                  className={cn(
                    "w-full min-h-[48px] rounded-xl px-3 py-2.5 text-left transition-colors flex items-center gap-3",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-foreground hover:bg-muted active:bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {chapter.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {chapter.title}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      isActive ? "text-primary/80" : "text-muted-foreground"
                    )}
                  >
                    {audiobookApi.formatDuration(chapter.startTime)}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </ResponsiveDialogSheet>
    </div>
  );
}
