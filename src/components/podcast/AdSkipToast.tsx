import React, { useEffect } from "react";
import { ArrowCounterClockwise, Tag, X } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

export interface AdSkipToastProps {
  open: boolean;
  intervalId: string;
  category?: string;
  brand?: string;
  fromSec: number;
  toSec: number;
  onUndo: (intervalId: string, fromSec: number) => void;
  onDismiss: () => void;
  autoHideDurationMs?: number;
}

export function formatAdDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const remSec = s % 60;
  if (m > 0 && remSec > 0) {
    return `${m}m ${remSec}s`;
  }
  if (m > 0) {
    return `${m}m`;
  }
  return `${remSec}s`;
}

export function AdSkipToast({
  open,
  intervalId,
  category,
  brand,
  fromSec,
  toSec,
  onUndo,
  onDismiss,
  autoHideDurationMs = 5000,
}: AdSkipToastProps) {
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, autoHideDurationMs);
    return () => clearTimeout(timer);
  }, [open, autoHideDurationMs, onDismiss]);

  if (!open) return null;

  const durationSec = Math.max(0, toSec - fromSec);
  const durationStr = formatAdDuration(durationSec);
  const sponsorTitle = brand || (category ? category.replace(/_/g, " ") : "Sponsor");

  return (
    <div
      role="alert"
      data-testid="ad-skip-toast"
      className={cn(
        "fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50",
        "flex items-center gap-3 px-4 py-2.5 rounded-xl",
        "bg-background/95 text-foreground border border-border/80 shadow-lg backdrop-blur-md",
        "animate-in fade-in slide-in-from-bottom-2 duration-200"
      )}
    >
      <Tag className="w-4 h-4 text-amber-500 flex-shrink-0" weight="fill" />
      <span className="text-sm font-medium">
        Skipped ad: <span className="capitalize">{sponsorTitle}</span> ({durationStr})
      </span>
      <div className="flex items-center gap-1.5 ml-1">
        <button
          type="button"
          onClick={() => {
            onUndo(intervalId, fromSec);
            onDismiss();
          }}
          data-testid="ad-skip-undo-btn"
          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
        >
          <ArrowCounterClockwise className="w-3.5 h-3.5" weight="bold" />
          <span>Undo</span>
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss skip notification"
          data-testid="ad-skip-dismiss-btn"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
