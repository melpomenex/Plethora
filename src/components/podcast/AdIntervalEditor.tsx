import React, { useState } from "react";
import {
  Clock,
  Play,
  Plus,
  Tag,
  Trash,
  Check,
  WarningCircle,
} from "@phosphor-icons/react";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { cn } from "../../utils/cn";
import type { PodcastAdInterval } from "../../types/podcastAd";
import { saveManualAdInterval, deleteAdInterval } from "../../api/podcastAd";

export interface AdIntervalEditorProps {
  open: boolean;
  onClose: () => void;
  episodeId: string;
  mediaRevision?: string;
  durationSec: number;
  currentTimeSec: number;
  adIntervals: PodcastAdInterval[];
  onIntervalsChanged: (updated: PodcastAdInterval[]) => void;
  onSeek?: (seconds: number) => void;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function parseTimeToMs(str: string): number | null {
  const parts = str.trim().split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseFloat(parts[1]);
    if (!isNaN(m) && !isNaN(s) && m >= 0 && s >= 0) {
      return Math.round((m * 60 + s) * 1000);
    }
  } else if (parts.length === 3) {
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const s = parseFloat(parts[2]);
    if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
      return Math.round((h * 3600 + m * 60 + s) * 1000);
    }
  } else if (parts.length === 1) {
    const s = parseFloat(parts[0]);
    if (!isNaN(s) && s >= 0) {
      return Math.round(s * 1000);
    }
  }
  return null;
}

export function AdIntervalEditor({
  open,
  onClose,
  episodeId,
  mediaRevision = "v1",
  durationSec,
  currentTimeSec,
  adIntervals,
  onIntervalsChanged,
  onSeek,
}: AdIntervalEditorProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [startInput, setStartInput] = useState(formatTime(currentTimeSec));
  const [endInput, setEndInput] = useState(formatTime(Math.min(durationSec, currentTimeSec + 30)));
  const [category, setCategory] = useState("external_ad");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSaveManual = async () => {
    setError(null);
    const startMs = parseTimeToMs(startInput);
    const endMs = parseTimeToMs(endInput);

    if (startMs === null || endMs === null) {
      setError("Please enter valid timestamps in MM:SS format.");
      return;
    }

    if (endMs <= startMs) {
      setError("End timestamp must be greater than start timestamp.");
      return;
    }

    setSaving(true);
    try {
      const newInterval: PodcastAdInterval = {
        id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        episodeId,
        mediaRevision,
        startMs,
        endMs,
        category,
        confidence: 1.0,
        origin: "manual_user",
      };
      await saveManualAdInterval(episodeId, newInterval);
      onIntervalsChanged([...adIntervals.filter((i) => i.id !== newInterval.id), newInterval]);
      setIsAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save ad interval");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (intervalId: string) => {
    try {
      await deleteAdInterval(intervalId);
      onIntervalsChanged(adIntervals.filter((inv) => inv.id !== intervalId));
    } catch (err) {
      console.error("Failed to delete ad interval:", err);
    }
  };

  return (
    <ResponsiveDialogSheet
      open={open}
      onClose={onClose}
      title="Advertisement Intervals"
      description="View, adjust, or manually add ad skip intervals for this episode."
      closeLabel="Close"
      presentation="auto"
      className="max-w-lg"
    >
      <div className="space-y-4 py-2">
        {/* Interval List */}
        <div className="space-y-2 max-h-[45vh] overflow-y-auto -mx-1 px-1">
          {adIntervals.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg p-6">
              No advertisement intervals detected for this episode.
            </div>
          ) : (
            adIntervals.map((interval) => {
              const durSec = (interval.endMs - interval.startMs) / 1000;
              return (
                <div
                  key={interval.id}
                  data-testid={`ad-interval-row-${interval.id}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-card hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Tag className="w-4 h-4 text-amber-500 flex-shrink-0" weight="fill" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium">
                          {formatTime(interval.startMs / 1000)} – {formatTime(interval.endMs / 1000)}
                        </span>
                        <span className="text-[11px] text-muted-foreground">({durSec.toFixed(1)}s)</span>
                      </div>
                      <div className="text-xs text-muted-foreground capitalize mt-0.5">
                        {interval.category.replace(/_/g, " ")} · {Math.round(interval.confidence * 100)}% conf
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {onSeek && (
                      <button
                        type="button"
                        onClick={() => {
                          onSeek(interval.startMs / 1000);
                          onClose();
                        }}
                        className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="Jump to ad start"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(interval.id)}
                      data-testid={`delete-ad-btn-${interval.id}`}
                      className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                      title="Remove ad interval"
                    >
                      <Trash className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Add manual interval form */}
        {isAdding ? (
          <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              <span>Add Manual Ad Interval</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  Start (MM:SS)
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={startInput}
                    onChange={(e) => setStartInput(e.target.value)}
                    placeholder="0:00"
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-input bg-background font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setStartInput(formatTime(currentTimeSec))}
                    title="Set to current playback time"
                    className="p-1.5 rounded-md border border-input hover:bg-muted text-xs text-muted-foreground"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-muted-foreground block mb-1">
                  End (MM:SS)
                </label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={endInput}
                    onChange={(e) => setEndInput(e.target.value)}
                    placeholder="1:30"
                    className="w-full px-2.5 py-1.5 text-xs rounded-md border border-input bg-background font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setEndInput(formatTime(currentTimeSec))}
                    title="Set to current playback time"
                    className="p-1.5 rounded-md border border-input hover:bg-muted text-xs text-muted-foreground"
                  >
                    <Clock className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground block mb-1">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-md border border-input bg-background"
              >
                <option value="external_ad">Sponsor / External Ad</option>
                <option value="podcast_cross_promo">Podcast Cross-Promotion</option>
                <option value="host_self_promo">Host Self-Promotion / Patreon</option>
                <option value="bumper">Bumper / Station ID</option>
              </select>
            </div>

            {error && (
              <div className="text-xs text-destructive flex items-center gap-1.5">
                <WarningCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSaveManual}
                data-testid="save-manual-ad-btn"
                className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1 shadow-xs"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Segment</span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setStartInput(formatTime(currentTimeSec));
              setEndInput(formatTime(Math.min(durationSec, currentTimeSec + 30)));
              setIsAdding(true);
            }}
            data-testid="add-manual-ad-trigger"
            className="w-full py-2 px-3 rounded-lg border border-dashed border-border hover:border-primary/50 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center justify-center gap-2 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Mark New Ad Interval</span>
          </button>
        )}
      </div>
    </ResponsiveDialogSheet>
  );
}
