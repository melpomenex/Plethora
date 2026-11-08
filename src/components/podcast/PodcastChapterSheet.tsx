import React from "react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import type { PodcastChapter } from "../../types/podcastAd";
import { cn } from "../../utils";
import { ArrowSquareOut, Tag } from "@phosphor-icons/react";

export interface PodcastChapterSheetProps {
  open: boolean;
  onClose: () => void;
  chapters: PodcastChapter[];
  currentTimeMs: number;
  onSeek: (startMs: number) => void;
  episodeTitle?: string;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function PodcastChapterSheet({
  open,
  onClose,
  chapters,
  currentTimeMs,
  onSeek,
  episodeTitle,
}: PodcastChapterSheetProps) {
  const chapterList = Array.isArray(chapters) ? chapters : [];
  const activeChapter = chapterList.find((ch, idx) => {
    const nextStart = chapterList[idx + 1]?.startMs;
    if (nextStart !== undefined) {
      return currentTimeMs >= ch.startMs && currentTimeMs < nextStart;
    }
    return currentTimeMs >= ch.startMs && (ch.endMs > ch.startMs ? currentTimeMs <= ch.endMs : true);
  });

  return (
    <ResponsiveDialogSheet
      open={open}
      onClose={onClose}
      title="Chapters"
      description={
        activeChapter
          ? `${activeChapter.title} · ${formatDuration(activeChapter.startMs / 1000)}`
          : episodeTitle
      }
      closeLabel="Close chapters"
      presentation="auto"
      className="max-w-lg"
    >
      <div className="-mx-1 max-h-[65vh] overflow-y-auto space-y-1">
        {chapterList.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No chapters available for this episode
          </div>
        ) : (
          chapterList.map((chapter) => {
            const isActive = activeChapter?.id === chapter.id;
            const durationSecs = Math.max(0, Math.floor((chapter.endMs - chapter.startMs) / 1000));

            return (
              <div
                key={chapter.id}
                onClick={() => {
                  onSeek(chapter.startMs);
                  onClose();
                }}
                className={cn(
                  "w-full min-h-[52px] rounded-xl px-3 py-2 text-left transition-colors flex items-center gap-3 cursor-pointer group",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted active:bg-muted"
                )}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSeek(chapter.startMs);
                    onClose();
                  }
                }}
              >
                {/* Artwork thumbnail or Chapter Index Badge */}
                {chapter.imageUrl ? (
                  <img
                    src={chapter.imageUrl}
                    alt=""
                    className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border/50"
                    loading="lazy"
                  />
                ) : (
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover:bg-muted/80"
                    )}
                  >
                    {chapter.chapterIndex + 1}
                  </span>
                )}

                {/* Chapter Title and badges */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="block truncate text-sm font-medium">
                      {chapter.title}
                    </span>
                    {chapter.isAdvertisement && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                        <Tag className="w-2.5 h-2.5" />
                        Sponsor
                      </span>
                    )}
                  </div>
                  {durationSecs > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {formatDuration(durationSecs)}
                    </span>
                  )}
                </div>

                {/* External link icon if present */}
                {chapter.linkUrl && (
                  <a
                    href={chapter.linkUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    title={chapter.linkUrl}
                  >
                    <ArrowSquareOut className="w-3.5 h-3.5" />
                  </a>
                )}

                {/* Start timestamp */}
                <span
                  className={cn(
                    "shrink-0 text-xs tabular-nums font-mono",
                    isActive ? "text-primary font-semibold" : "text-muted-foreground"
                  )}
                >
                  {formatDuration(chapter.startMs / 1000)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </ResponsiveDialogSheet>
  );
}
