import { useEffect, useRef, useState } from "react";
import { Timer, X } from "@phosphor-icons/react";
import { TIMEBOX_PRESETS, type TimeboxPresetId } from "../../utils/timeboxPlaylistBuilder";
import { cn } from "../../utils";
import { useViewportClampedPopover } from "./useViewportClampedPopover";

export interface TimeboxCompletionRingProps {
  completedCount: number;
  totalCount: number;
  label?: string;
}

export function TimeboxCompletionRing({
  completedCount,
  totalCount,
  label,
}: TimeboxCompletionRingProps) {
  const safeTotal = Math.max(1, totalCount);
  const pct = Math.max(0, Math.min(100, Math.round((completedCount / safeTotal) * 100)));
  const radius = 11;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - pct / 100);

  return (
    <div
      data-timebox-ring="true"
      aria-label={`Timebox progress ${pct}%`}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/45 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm"
    >
      <svg className="h-6 w-6 -rotate-90" viewBox="0 0 28 28" aria-hidden="true">
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-white/20"
        />
        <circle
          cx="14"
          cy="14"
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="text-emerald-400 transition-all duration-300"
        />
      </svg>
      <span className="tabular-nums">{pct}%</span>
      {label && <span className="hidden sm:inline text-white/75">{label}</span>}
    </div>
  );
}

export interface TimeboxSessionLauncherProps {
  activePreset: TimeboxPresetId | null;
  onSelectPreset: (preset: TimeboxPresetId) => void;
  onClearPreset: () => void;
}

export function TimeboxSessionLauncher({
  activePreset,
  onSelectPreset,
  onClearPreset,
}: TimeboxSessionLauncherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverOffsetLeft = useViewportClampedPopover({
    isOpen,
    anchorRef: containerRef,
    popoverRef,
  });

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
      }
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-label="Timebox playlist presets"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors backdrop-blur-sm",
          activePreset
            ? "border-emerald-400/50 bg-emerald-500/20 text-emerald-200"
            : "border-white/15 bg-black/40 text-white hover:bg-black/60"
        )}
      >
        <Timer className="h-3.5 w-3.5" />
        <span className="hidden md:inline">
          {activePreset
            ? TIMEBOX_PRESETS.find((p) => p.id === activePreset)?.label ?? "Timebox"
            : "Timebox"}
        </span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="menu"
          style={popoverOffsetLeft !== null ? { left: `${popoverOffsetLeft}px` } : undefined}
          className="absolute left-0 top-full z-50 mt-2 w-[min(16rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-2 text-card-foreground shadow-xl"
        >
          <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Time-Boxed Playlists</span>
            {activePreset && (
              <button
                type="button"
                onClick={() => {
                  onClearPreset();
                  setIsOpen(false);
                }}
                className="inline-flex items-center gap-1 text-destructive hover:underline"
              >
                <X className="h-3 w-3" />
                Clear
              </button>
            )}
          </div>
          <div className="mt-1 space-y-1">
            {TIMEBOX_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelectPreset(preset.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted",
                  activePreset === preset.id && "bg-primary/10 text-primary"
                )}
              >
                <span className="text-xs font-semibold">{preset.label}</span>
                <span className="text-[11px] text-muted-foreground">{preset.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
