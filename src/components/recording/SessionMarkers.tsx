import React, { useEffect, useState, useCallback } from "react";
import {
  Bookmark,
  CheckCircle,
  Clock,
  Lightbulb,
  Plus,
  Question,
  Star,
  WarningCircle,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import type {
  RecordingSession,
  RecordingSessionMarker,
  SessionMarkerKind,
} from "../../types/recordingSession";
import {
  createSessionMarker,
  listSessionMarkers,
  resolveSessionMarkers,
} from "../../api/recordingSessions";
import { formatTime } from "./SessionPlayer";
import { useI18n } from "../../lib/i18n";
import { useToastStore, ToastType } from "../common/Toast";
import { cn } from "../../utils/cn";

export interface SessionMarkersProps {
  session: RecordingSession;
  currentTimeMs?: number;
  onSeek?: (timeSec: number) => void;
  className?: string;
}

export const SessionMarkers: React.FC<SessionMarkersProps> = ({
  session,
  currentTimeMs = 0,
  onSeek,
  className,
}) => {
  const { t } = useI18n();
  const addToast = useToastStore((s) => s.addToast);
  const [markers, setMarkers] = useState<RecordingSessionMarker[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolving, setIsResolving] = useState(false);
  const [lastCreatedMarker, setLastCreatedMarker] = useState<RecordingSessionMarker | null>(null);

  // 1. Load Markers
  const loadMarkers = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await listSessionMarkers(session.id);
      setMarkers(list);
    } catch (err) {
      console.warn("[SessionMarkers] Failed to load markers:", err);
    } finally {
      setIsLoading(false);
    }
  }, [session.id]);

  useEffect(() => {
    void loadMarkers();
  }, [loadMarkers]);

  // 2. Resolve pending markers when transcript is updated or manually triggered
  const handleResolve = useCallback(async () => {
    setIsResolving(true);
    try {
      const updated = await resolveSessionMarkers(session.id);
      setMarkers(updated);
      const newlyResolved = updated.filter(
        (m) => m.state === "resolved" && markers.find((prev) => prev.id === m.id && prev.state === "pending")
      );
      if (newlyResolved.length > 0) {
        addToast({
          type: ToastType.Success,
          title: "Markers Resolved",
          message: `${newlyResolved.length} pending marker(s) matched against transcript.`,
        });
      }
    } catch (err) {
      console.warn("[SessionMarkers] Failed to resolve markers:", err);
      addToast({
        type: ToastType.Error,
        title: "Resolution Failed",
        message: err instanceof Error ? err.message : "Failed to resolve markers with transcript.",
      });
    } finally {
      setIsResolving(false);
    }
  }, [session.id, markers, addToast]);

  // 3. One-tap Add Marker (Confusing, Important, Bookmark)
  const handleAddMarker = async (kind: SessionMarkerKind, note?: string) => {
    try {
      const marker = await createSessionMarker({
        sessionId: session.id,
        kind,
        mediaMs: currentTimeMs,
        windowMs: 30000,
        note,
      });

      setLastCreatedMarker(marker);
      await loadMarkers();

      const label =
        kind === "confusing"
          ? "Confusing Moment"
          : kind === "interesting"
          ? "Important Moment"
          : "Bookmark";

      if (marker.windowMs > 30000) {
        addToast({
          type: ToastType.Info,
          title: `${label} Window Extended`,
          message: `Capture window extended to ${marker.windowMs / 1000}s (max 90s).`,
        });
      } else {
        addToast({
          type: ToastType.Success,
          title: `${label} Marked`,
          message: `Pinned at ${formatTime(marker.mediaMs / 1000)}.`,
        });
      }
    } catch (err) {
      console.error("[SessionMarkers] Failed to add marker:", err);
      addToast({
        type: ToastType.Error,
        title: "Marker Save Failed",
        message: err instanceof Error ? err.message : "Could not save marker to database.",
      });
    }
  };

  return (
    <div
      data-testid="session-markers"
      className={cn("flex flex-col gap-3 p-4 bg-card border border-border rounded-xl shadow-sm", className)}
    >
      {/* Header & Quick Action Row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Bookmark className="w-4 h-4 text-primary" weight="fill" />
          <h3 className="text-sm font-semibold text-foreground">Pinned Moments & Markers</h3>
          {markers.length > 0 && (
            <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {markers.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleResolve}
            disabled={isResolving}
            title="Resolve pending markers against transcript"
            className="p-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted text-muted-foreground hover:text-foreground inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
          >
            <ArrowsClockwise className={cn("w-3.5 h-3.5", isResolving && "animate-spin")} />
            <span className="hidden sm:inline">Resolve</span>
          </button>

          <button
            type="button"
            onClick={() => handleAddMarker("confusing")}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors inline-flex items-center gap-1"
          >
            <Question className="w-3.5 h-3.5" />
            Confusing
          </button>

          <button
            type="button"
            onClick={() => handleAddMarker("interesting")}
            className="px-2.5 py-1 text-xs font-medium rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors inline-flex items-center gap-1"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            Important
          </button>
        </div>
      </div>

      {/* Markers List */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {isLoading && markers.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Loading markers...
          </div>
        ) : markers.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground/70 italic border border-dashed border-border/70 rounded-lg">
            No moments marked yet. Tap "Confusing" or "Important" while listening to pin key moments.
          </div>
        ) : (
          markers.map((marker) => {
            const isConfusing = marker.kind === "confusing";
            const isResolved = marker.state === "resolved";
            const quoteText =
              marker.evidence && marker.evidence.length > 0
                ? (marker.evidence[0] as any).quote || (marker.evidence[0] as any).verbatimText
                : null;

            return (
              <div
                key={marker.id}
                data-testid={`marker-${marker.id}`}
                onClick={() => onSeek?.(marker.mediaMs / 1000)}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border transition-colors cursor-pointer",
                  isConfusing
                    ? "bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10"
                    : "bg-muted/20 border-border/60 hover:bg-muted/40"
                )}
              >
                {/* Kind Icon */}
                <div className="mt-0.5 shrink-0">
                  {isConfusing ? (
                    <Question className="w-4 h-4 text-amber-500" />
                  ) : (
                    <Lightbulb className="w-4 h-4 text-primary" />
                  )}
                </div>

                {/* Body Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-foreground capitalize">
                        {marker.kind === "interesting" ? "Important" : marker.kind}
                      </span>
                      <span className="text-[11px] font-mono text-muted-foreground">
                        {formatTime(marker.mediaMs / 1000)}
                      </span>
                      {marker.windowMs > 0 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          (last {marker.windowMs / 1000}s)
                        </span>
                      )}
                    </div>

                    {/* State badge */}
                    {isResolved ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle className="w-3 h-3" />
                        Resolved
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                        <Clock className="w-3 h-3" />
                        Pending transcription
                      </span>
                    )}
                  </div>

                  {/* Note if present */}
                  {marker.note && (
                    <p className="text-xs text-foreground/80 mt-1 italic font-sans">
                      "{marker.note}"
                    </p>
                  )}

                  {/* Resolved Quote snippet if available */}
                  {quoteText && (
                    <div className="text-xs text-muted-foreground mt-1.5 p-2 bg-background/60 rounded border border-border/40 line-clamp-2">
                      {quoteText}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
