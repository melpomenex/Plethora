/**
 * XThreadMediaGrid — native media rendering for X thread posts: 1/2/3-4 image
 * layouts with aspect-ratio boxes, lazy loading, alt text, zoom via the
 * existing ImageViewer, and inline video playback when enrichment provided an
 * mp4 URL (otherwise a poster + "Open video on X" preview card).
 */
import { memo, useCallback } from "react";
import type { TwitterMedia } from "../../types/document";
import { ModalType, useModal } from "../common/Modal";
import { openExternal } from "../../lib/tauri";
import { cn } from "../../utils";
import { Play } from "@phosphor-icons/react";

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
}: {
  media: TwitterMedia;
  postId: string;
  index: number;
  className?: string;
}) {
  const src = media.mediaUrl;
  const poster = media.thumbnailUrl || undefined;
  const isGif = media.kind === "animated_gif";
  const alt = media.altText?.trim() || `Video ${index + 1} in post ${postId}`;

  if (src && src.startsWith("http")) {
    return (
      <div className={cn("overflow-hidden rounded-xl bg-black/5", className)}>
        <video
          src={src}
          poster={poster}
          controls
          preload="metadata"
          playsInline
          autoPlay={isGif}
          loop={isGif}
          muted={isGif}
          className="h-full w-full object-contain"
          style={media.aspectRatio ? { aspectRatio: String(media.aspectRatio) } : undefined}
          aria-label={alt}
        />
      </div>
    );
  }

  // No usable URL (TRA gives none) → attractive preview card linking to X.
  return (
    <a
      href={poster ?? undefined}
      onClick={(e) => {
        e.preventDefault();
        openExternal(`https://x.com/i/status/${postId}`);
      }}
      className={cn(
        "group relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className
      )}
      aria-label={`Open video on X`}
    >
      {poster ? (
        <img
          src={poster}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover opacity-70"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-muted/60 to-muted/30" />
      )}
      <span className="relative z-10 flex items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium text-white backdrop-blur-sm">
        <Play size={16} weight="fill" />
        Open video on X
      </span>
    </a>
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
}: {
  media: TwitterMedia[];
  postId: string;
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
              <MediaVideo media={m} postId={postId} index={i} className="h-full" />
            )}
          </div>
        );
        return cell;
      })}
    </div>
  );
});
