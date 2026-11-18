/**
 * XThreadMediaGrid — native media rendering for X thread posts: 1/2/3-4 image
 * layouts with aspect-ratio boxes, lazy loading, alt text, zoom via the
 * existing ImageViewer, reliable video playback (cached via Rust + streamed
 * over loopback media_server in Tauri so WebKitGTK never chokes on remote
 * video.twimg.com), and inline video transcription with seekable timestamps.
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { TwitterMedia } from "../../types/document";
import { ModalType, useModal } from "../common/Modal";
import { isTauri, openExternal } from "../../lib/tauri";
import { cacheTwitterVideo } from "../../api/documents";
import { getVideoTranscript, type VideoTranscript } from "../../api/video-extracts";
import { useTranscriptionService } from "../transcription/useTranscriptionService";
import { TranscriptionKeyDialog } from "../transcription/TranscriptionKeyDialog";
import { TranscribeAudioDialog } from "../transcription/TranscribeAudioDialog";
import { useSettingsStore } from "../../stores/settingsStore";
import { cn } from "../../utils";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CaretDown,
  CaretUp,
  Check,
  CircleNotch,
  Copy,
  FileAudio,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";

/** True when `url` is an http(s) video stream URL (not an image/thumbnail fallback). */
export function isPlayableVideoUrl(url?: string | null): boolean {
  if (!url) return false;
  if (!url.startsWith("https://") && !url.startsWith("http://")) return false;
  const withoutQuery = url.split("?")[0].toLowerCase();
  if (withoutQuery.startsWith("https://pbs.twimg.com/")) return false;
  if (/\.(jpg|jpeg|png|webp|gif)$/.test(withoutQuery)) return false;
  return true;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function MediaImage({
  media,
  postId,
  index,
  className,
}: {
  media: TwitterMedia;
  postId: string;
  index: number;
  className?: string;
}) {
  const { custom } = useModal();
  const src = media.mediaUrl || media.thumbnailUrl || "";
  if (!src) return null;
  const alt =
    media.altText?.trim() ||
    `Image ${index + 1} in post ${postId}`;

  const inspect = useCallback(() => {
    custom(
      <div className="flex max-h-[80vh] items-center justify-center overflow-auto p-2">
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>,
      { type: ModalType.Custom, title: "Image", size: "xl" }
    );
  }, [custom, src, alt]);

  return (
    <button
      type="button"
      onClick={inspect}
      className={cn(
        "group relative block h-full w-full overflow-hidden rounded-xl bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className
      )}
      aria-label={alt}
    >
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02] motion-reduce:transition-none"
        style={media.aspectRatio ? { aspectRatio: String(media.aspectRatio) } : undefined}
      />
    </button>
  );
}

function MediaVideo({
  media,
  postId,
  index,
  className,
  documentId,
  documentTitle,
}: {
  media: TwitterMedia;
  postId: string;
  index: number;
  className?: string;
  documentId?: string;
  documentTitle?: string;
}) {
  const rawSrc = media.mediaUrl;
  const poster = media.thumbnailUrl || undefined;
  const isGif = media.kind === "animated_gif";
  const alt = media.altText?.trim() || `Video ${index + 1} in post ${postId}`;
  const hasPlayableUrl = isPlayableVideoUrl(rawSrc);
  const tauriEnv = isTauri();

  const videoRef = useRef<HTMLVideoElement>(null);
  const [streamSrc, setStreamSrc] = useState<string | null>(() =>
    hasPlayableUrl && !tauriEnv ? rawSrc : null
  );
  const [localPath, setLocalPath] = useState<string | undefined>(undefined);
  const [caching, setCaching] = useState<boolean>(hasPlayableUrl && tauriEnv);
  const [playbackError, setPlaybackError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  // Transcript UI state
  const [transcript, setTranscript] = useState<VideoTranscript | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [showKeyDialog, setShowKeyDialog] = useState(false);
  const [showSetupDialog, setShowSetupDialog] = useState(false);
  const pendingTranscribeRef = useRef(false);

  // Cache + mint loopback stream URL in Tauri so WebKitGTK plays video.twimg.com reliably.
  useEffect(() => {
    if (!hasPlayableUrl) {
      setStreamSrc(null);
      setCaching(false);
      return;
    }
    if (!tauriEnv) {
      setStreamSrc(rawSrc);
      setCaching(false);
      setPlaybackError(false);
      return;
    }

    let cancelled = false;
    setCaching(true);
    setPlaybackError(false);

    cacheTwitterVideo(rawSrc, postId)
      .then((cached) => {
        if (cancelled) return;
        setLocalPath(cached.localPath);
        setStreamSrc(cached.streamUrl);
        setCaching(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Fall back to direct URL if caching fails; onError handles it if that also fails.
        setStreamSrc(rawSrc);
        setCaching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hasPlayableUrl, tauriEnv, rawSrc, postId, retryCount]);

  // Load existing transcript if already transcribed for this document.
  const refreshTranscript = useCallback(async () => {
    if (!documentId || isGif) return;
    try {
      const existing = await getVideoTranscript(documentId);
      if (existing && (existing.transcript.trim() || existing.segments.length > 0)) {
        setTranscript(existing);
      }
    } catch {
      // Non-fatal: transcript table may not be available in web/test mode.
    }
  }, [documentId, isGif]);

  useEffect(() => {
    void refreshTranscript();
  }, [refreshTranscript]);

  const {
    status: transcriptionStatus,
    error: transcriptionError,
    progress: transcriptionProgress,
    startTranscription,
    retryTranscription,
    isProcessing: isTranscribing,
  } = useTranscriptionService({
    documentId: documentId ?? "",
    documentTitle: documentTitle ?? `X Video (${postId})`,
    filePath: localPath,
    mediaUrl: !localPath && hasPlayableUrl ? rawSrc : undefined,
    onComplete: () => {
      void refreshTranscript().then(() => setTranscriptOpen(true));
    },
  });

  // If user clicked Transcribe while the video was still caching, start once localPath arrives.
  useEffect(() => {
    if (pendingTranscribeRef.current && localPath) {
      pendingTranscribeRef.current = false;
      void startTranscription().then((res) => {
        if (res.needsApiKey) setShowKeyDialog(true);
        else if (res.needsModel) setShowSetupDialog(true);
      });
    }
  }, [localPath, startTranscription]);

  const handleTranscribeClick = useCallback(async () => {
    if (!documentId) return;
    if (transcript) {
      setTranscriptOpen((prev) => !prev);
      return;
    }
    if (transcriptionStatus === "needs-api-key") {
      setShowKeyDialog(true);
      return;
    }
    if (transcriptionStatus === "needs-model") {
      setShowSetupDialog(true);
      return;
    }
    if (tauriEnv && !localPath && caching) {
      pendingTranscribeRef.current = true;
      return;
    }
    const res =
      transcriptionStatus === "failed"
        ? await retryTranscription()
        : await startTranscription();
    if (res.needsApiKey) setShowKeyDialog(true);
    else if (res.needsModel) setShowSetupDialog(true);
  }, [
    documentId,
    transcript,
    transcriptionStatus,
    tauriEnv,
    localPath,
    caching,
    retryTranscription,
    startTranscription,
  ]);

  const handleSeek = useCallback((timeSecs: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = timeSecs;
    void video.play().catch(() => undefined);
  }, []);

  const handleCopyTranscript = useCallback(() => {
    if (!transcript) return;
    const text =
      transcript.transcript.trim() ||
      transcript.segments.map((s) => s.text).join(" ").trim();
    if (!text) return;
    void navigator.clipboard?.writeText(text).then(() => {
      setCopiedTranscript(true);
      window.setTimeout(() => setCopiedTranscript(false), 1800);
    }).catch(() => undefined);
  }, [transcript]);

  const handleRetryVideo = useCallback(() => {
    setPlaybackError(false);
    setRetryCount((c) => c + 1);
  }, []);

  const aspectStyle = media.aspectRatio
    ? { aspectRatio: String(media.aspectRatio) }
    : { aspectRatio: "16 / 9" };

  const showTranscribeBar = Boolean(documentId && !isGif && hasPlayableUrl);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className="relative overflow-hidden rounded-xl bg-muted/40"
        style={aspectStyle}
      >
        {!hasPlayableUrl ? (
          <a
            href={poster ?? undefined}
            onClick={(e) => {
              e.preventDefault();
              void openExternal(`https://x.com/i/status/${postId}`);
            }}
            className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            aria-label="Open video on X"
          >
            {poster ? (
              <img
                src={poster}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover opacity-80"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted/30" />
            )}
            <span className="relative z-10 flex items-center gap-2 rounded-full bg-black/65 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm transition-transform group-hover:scale-105">
              <Play size={16} weight="fill" />
              Open video on X
            </span>
          </a>
        ) : playbackError ? (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-muted/50">
            {poster && (
              <img
                src={poster}
                alt=""
                className="absolute inset-0 h-full w-full object-cover opacity-35"
              />
            )}
            <div className="relative z-10 flex flex-col items-center gap-2.5 px-4 text-center">
              <span className="text-xs font-medium text-foreground/90">
                Video couldn&apos;t be played inline
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRetryVideo}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
                >
                  <ArrowClockwise size={13} />
                  Retry
                </button>
                <button
                  type="button"
                  onClick={() => void openExternal(`https://x.com/i/status/${postId}`)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/85"
                >
                  <ArrowSquareOut size={13} />
                  Open on X
                </button>
              </div>
            </div>
          </div>
        ) : caching || !streamSrc ? (
          <div className="relative flex h-full w-full items-center justify-center bg-muted/50">
            {poster && (
              <img
                src={poster}
                alt={alt}
                className="absolute inset-0 h-full w-full object-cover opacity-75"
              />
            )}
            <span className="relative z-10 inline-flex items-center gap-2 rounded-full bg-black/65 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
              <CircleNotch size={14} className="animate-spin" />
              Loading video…
            </span>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={streamSrc}
            poster={poster}
            controls
            preload="metadata"
            playsInline
            autoPlay={isGif}
            loop={isGif}
            muted={isGif}
            onError={() => setPlaybackError(true)}
            className="h-full w-full object-contain bg-black"
            aria-label={alt}
          />
        )}
      </div>

      {showTranscribeBar && (
        <div className="flex flex-col gap-2" data-testid="x-video-transcription-bar">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleTranscribeClick()}
                disabled={isTranscribing}
                aria-expanded={transcript ? transcriptOpen : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  transcript
                    ? "border-border bg-card/70 text-foreground hover:bg-muted"
                    : transcriptionStatus === "failed"
                      ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
                      : "border-border bg-card/60 text-foreground hover:bg-muted",
                  isTranscribing && "cursor-wait opacity-75"
                )}
              >
                {isTranscribing ? (
                  <>
                    <CircleNotch size={14} className="animate-spin text-primary" />
                    <span>
                      {transcriptionProgress.message || "Transcribing…"}
                    </span>
                  </>
                ) : transcript ? (
                  <>
                    <FileAudio size={14} className="text-primary" />
                    <span>{transcriptOpen ? "Hide transcript" : "Show transcript"}</span>
                    {transcriptOpen ? <CaretUp size={12} /> : <CaretDown size={12} />}
                  </>
                ) : transcriptionStatus === "failed" ? (
                  <>
                    <WarningCircle size={14} />
                    <span>Retry transcription</span>
                  </>
                ) : (
                  <>
                    <FileAudio size={14} className="text-primary" />
                    <span>Transcribe video</span>
                  </>
                )}
              </button>

              {transcriptionStatus === "failed" && transcriptionError?.message && (
                <span className="text-xs text-destructive line-clamp-1">
                  {transcriptionError.message}
                </span>
              )}
            </div>

            {transcript && (
              <button
                type="button"
                onClick={handleCopyTranscript}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Copy transcript"
              >
                {copiedTranscript ? (
                  <>
                    <Check size={13} className="text-primary" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy size={13} />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>

          {transcript && transcriptOpen && (
            <div
              data-testid="x-video-transcript-panel"
              className="max-h-60 overflow-y-auto rounded-xl border border-border bg-card/50 p-3 text-sm leading-relaxed text-foreground select-text"
            >
              {transcript.segments.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {transcript.segments.map((seg, segIdx) => (
                    <div key={`${seg.time}-${segIdx}`} className="flex items-start gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleSeek(seg.time)}
                        className="mt-0.5 shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-primary transition-colors hover:bg-primary/15"
                        title={`Jump to ${formatTimestamp(seg.time)}`}
                      >
                        {formatTimestamp(seg.time)}
                      </button>
                      <span className="text-[13px] leading-relaxed text-foreground/90">
                        {seg.text}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                  {transcript.transcript}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {showKeyDialog && (
        <TranscriptionKeyDialog
          isOpen={showKeyDialog}
          onClose={() => setShowKeyDialog(false)}
          onSaved={() => {
            setShowKeyDialog(false);
            void startTranscription();
          }}
        />
      )}

      {showSetupDialog && documentId && (
        <TranscribeAudioDialog
          open={showSetupDialog}
          title={documentTitle ?? `X Video (${postId})`}
          onCancel={() => setShowSetupDialog(false)}
          onConfirm={(opts) => {
            setShowSetupDialog(false);
            useSettingsStore.getState().updateSettingsCategory("audioTranscription", {
              mode: opts.mode,
              provider: opts.sttProvider === "local" ? "local" : "groq",
              language: opts.language,
            });
            void startTranscription();
          }}
        />
      )}
    </div>
  );
}

/** Media URLs are constrained to X's media origins (mirror of the Rust
 *  allow-list); anything else is dropped at render time. */
export function isAllowlistedMediaUrl(url?: string | null): boolean {
  if (!url) return false;
  return url.startsWith("https://pbs.twimg.com/") || url.startsWith("https://video.twimg.com/");
}

export const XThreadMediaGrid = memo(function XThreadMediaGrid({
  media,
  postId,
  documentId,
  documentTitle,
}: {
  media: TwitterMedia[];
  postId: string;
  documentId?: string;
  documentTitle?: string;
}) {
  const photos = media.filter((m) => m.kind === "photo" && isAllowlistedMediaUrl(m.mediaUrl || m.thumbnailUrl));
  const videos = media.filter(
    (m) => (m.kind === "video" || m.kind === "animated_gif") && isAllowlistedMediaUrl(m.mediaUrl || m.thumbnailUrl)
  );
  const items = [...photos, ...videos];
  if (items.length === 0) return null;

  const count = items.length;
  const gridClass =
    count === 1
      ? "grid-cols-1"
      : count === 2
        ? "grid-cols-2"
        : "grid-cols-2";
  // Single image: contain (never stretched/cropped); grid cells: cover.
  const cellHeight =
    count === 1 && photos.length === 1
      ? "max-h-[420px]"
      : count >= 3
        ? "aspect-[4/3]"
        : "aspect-[16/10]";

  return (
    <div
      data-testid="x-thread-media-grid"
      className={cn("mt-3 grid gap-1.5", gridClass)}
    >
      {items.map((m, i) => {
        const cell = (
          <div
            key={`${m.mediaUrl}-${i}`}
            className={cn(
              "min-w-0",
              count === 1 ? "" : cellHeight,
              count === 3 && i === 2 ? "col-span-2 aspect-[16/7]" : ""
            )}
          >
            {m.kind === "photo" ? (
              <MediaImage media={m} postId={postId} index={i} className={count === 1 ? "h-auto" : "h-full"} />
            ) : (
              <MediaVideo
                media={m}
                postId={postId}
                index={i}
                className="h-full"
                documentId={documentId}
                documentTitle={documentTitle}
              />
            )}
          </div>
        );
        return cell;
      })}
    </div>
  );
});
