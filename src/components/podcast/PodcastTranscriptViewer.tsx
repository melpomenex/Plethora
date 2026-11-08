import React, { useState, useEffect, useRef, useMemo } from "react";
import { CheckCircle, Eye, EyeSlash, Play, Clock, Tag } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";
import type { PodcastAdInterval } from "../../types/podcastAd";
import type { TranscriptSegment } from "../media/TranscriptSync";

export interface PodcastTranscriptViewerProps {
  episodeId: string;
  segments: TranscriptSegment[];
  adIntervals?: PodcastAdInterval[];
  currentTime: number;
  onSeek?: (timeSec: number) => void;
  initialMode?: "clean" | "verbatim";
  autoScroll?: boolean;
  className?: string;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function PodcastTranscriptViewer({
  episodeId: _episodeId,
  segments = [],
  adIntervals = [],
  currentTime,
  onSeek,
  initialMode = "clean",
  autoScroll: initialAutoScroll = true,
  className,
}: PodcastTranscriptViewerProps) {
  const [mode, setMode] = useState<"clean" | "verbatim">(initialMode);
  const [autoScroll, setAutoScroll] = useState<boolean>(initialAutoScroll);
  const activeSegmentRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Classify each segment as ad or clean
  const classifiedSegments = useMemo(() => {
    return segments.map((seg) => {
      const segStartMs = seg.start * 1000;
      const segEndMs = seg.end * 1000;
      const matchingAd = adIntervals.find(
        (ad) => segStartMs < ad.endMs && segEndMs > ad.startMs
      );
      return {
        ...seg,
        isAd: !!matchingAd,
        adCategory: matchingAd?.category,
      };
    });
  }, [segments, adIntervals]);

  // Group contiguous ad segments in clean mode
  type RenderItem =
    | { type: "segment"; data: (typeof classifiedSegments)[0] }
    | { type: "ad_collapsed"; startSec: number; endSec: number; count: number };

  const renderItems = useMemo<RenderItem[]>(() => {
    if (mode === "verbatim") {
      return classifiedSegments.map((seg) => ({ type: "segment", data: seg }));
    }

    const items: RenderItem[] = [];
    let currentAdGroup: (typeof classifiedSegments)[0][] = [];

    for (const seg of classifiedSegments) {
      if (seg.isAd) {
        currentAdGroup.push(seg);
      } else {
        if (currentAdGroup.length > 0) {
          items.push({
            type: "ad_collapsed",
            startSec: currentAdGroup[0].start,
            endSec: currentAdGroup[currentAdGroup.length - 1].end,
            count: currentAdGroup.length,
          });
          currentAdGroup = [];
        }
        items.push({ type: "segment", data: seg });
      }
    }

    if (currentAdGroup.length > 0) {
      items.push({
        type: "ad_collapsed",
        startSec: currentAdGroup[0].start,
        endSec: currentAdGroup[currentAdGroup.length - 1].end,
        count: currentAdGroup.length,
      });
    }

    return items;
  }, [classifiedSegments, mode]);

  // Find active segment index based on currentTime
  const activeSegmentId = useMemo(() => {
    const found = classifiedSegments.find(
      (seg) => currentTime >= seg.start && currentTime <= seg.end
    );
    return found?.id;
  }, [classifiedSegments, currentTime]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (!autoScroll || !activeSegmentRef.current || !containerRef.current) return;
    activeSegmentRef.current.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }, [activeSegmentId, autoScroll]);

  return (
    <div className={cn("flex flex-col h-full bg-background text-foreground", className)}>
      {/* Header controls: Clean vs Verbatim toggle & Autoscroll */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2.5 bg-muted/20">
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5 text-xs font-medium" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "clean"}
            onClick={() => setMode("clean")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md transition-all",
              mode === "clean"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="mode-clean-btn"
          >
            <CheckCircle className="w-3.5 h-3.5 text-primary" weight="bold" />
            <span>Clean</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "verbatim"}
            onClick={() => setMode("verbatim")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1 rounded-md transition-all",
              mode === "verbatim"
                ? "bg-background text-foreground shadow-xs font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
            data-testid="mode-verbatim-btn"
          >
            <Eye className="w-3.5 h-3.5 text-amber-500" weight="bold" />
            <span>Verbatim</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setAutoScroll((prev) => !prev)}
          className={cn(
            "flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors",
            autoScroll
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:bg-muted"
          )}
          title={autoScroll ? "Auto-scroll enabled" : "Auto-scroll paused"}
        >
          {autoScroll ? <Eye className="w-3.5 h-3.5" /> : <EyeSlash className="w-3.5 h-3.5" />}
          <span>Auto-follow</span>
        </button>
      </div>

      {/* Segment List */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-2"
        data-testid="transcript-content"
      >
        {renderItems.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No transcript available for this episode.
          </div>
        ) : (
          renderItems.map((item, index) => {
            if (item.type === "ad_collapsed") {
              return (
                <div
                  key={`ad-collapsed-${index}`}
                  data-testid="ad-collapsed-pill"
                  className="my-2 py-1.5 px-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Tag className="w-3.5 h-3.5 text-amber-500" weight="fill" />
                    <span>Sponsor segment skipped ({formatTime(item.startSec)} – {formatTime(item.endSec)})</span>
                  </div>
                  {onSeek && (
                    <button
                      type="button"
                      onClick={() => onSeek(item.endSec)}
                      className="text-[11px] font-medium underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100"
                    >
                      Seek past
                    </button>
                  )}
                </div>
              );
            }

            const seg = item.data;
            const isActive = seg.id === activeSegmentId;

            return (
              <div
                key={seg.id || `seg-${index}`}
                ref={isActive ? activeSegmentRef : null}
                onClick={() => onSeek?.(seg.start)}
                data-testid={`transcript-segment-${seg.id}`}
                className={cn(
                  "group relative p-2.5 rounded-lg text-sm leading-relaxed transition-colors cursor-pointer border-l-4",
                  isActive
                    ? "bg-primary/10 border-l-primary text-foreground font-medium"
                    : seg.isAd
                    ? "bg-amber-500/10 border-l-amber-500 text-amber-900 dark:text-amber-200"
                    : "border-l-transparent hover:bg-muted/50 text-foreground"
                )}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSeek?.(seg.start);
                  }
                }}
              >
                <div className="flex items-center gap-2 mb-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1 font-mono">
                    {isActive ? (
                      <Play className="w-3 h-3 text-primary fill-current" />
                    ) : (
                      <Clock className="w-3 h-3" />
                    )}
                    {formatTime(seg.start)}
                  </span>

                  {seg.isAd && (
                    <span
                      data-testid="sponsor-badge"
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-800 dark:text-amber-200"
                    >
                      {seg.adCategory ? seg.adCategory.replace(/_/g, " ") : "Sponsor"}
                    </span>
                  )}
                </div>

                <div className={cn(seg.isAd && "italic")}>
                  {seg.text}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
