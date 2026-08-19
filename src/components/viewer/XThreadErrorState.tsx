/**
 * XThreadErrorState — native, actionable error states for the X thread
 * reader: thread unavailable (private/deleted), ThreadReaderApp unavailable,
 * rate limited, network error, or invalid URL. Includes Retry / Open on X /
 * copy-URL actions. Never a blank page or white iframe fallback.
 */
import { memo, useCallback } from "react";
import { ArrowClockwise, Copy, WarningCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { openExternal } from "../../lib/tauri";
import { copySelectionTextToClipboard } from "./SelectionPopup";
import { useToast } from "../common/Toast";
import { parseThreadError, type XThreadError } from "../../lib/xthreadError";

export type { XThreadError };
export { parseThreadError };

const TITLES: Record<string, string> = {
  threadUnavailable: "Unable to load this X thread",
  threadReaderUnavailable: "Thread could not be retrieved",
  rateLimited: "Rate limited",
  networkError: "Network error",
  invalidUrl: "Invalid X link",
};

const DETAILS: Record<string, string> = {
  threadUnavailable:
    "This post or thread may be private, deleted, or otherwise unavailable on X.",
  threadReaderUnavailable:
    "ThreadReaderApp could not unroll this thread. The post may still open directly on X.",
  rateLimited: "Too many requests. Wait a moment and try again.",
  networkError: "Could not reach the thread service. Check your connection and retry.",
  invalidUrl: "This doesn't look like a valid X status link.",
};

export const XThreadErrorState = memo(function XThreadErrorState({
  error,
  statusUrl,
  onRetry,
}: {
  error: unknown;
  /** The canonical status URL to offer as "Open on X". */
  statusUrl?: string;
  onRetry?: () => void;
}) {
  const { type, message } = parseThreadError(error);
  const toast = useToast();

  const copyUrl = useCallback(async () => {
    if (!statusUrl) return;
    await copySelectionTextToClipboard(statusUrl);
    toast.success("Copied", "Status URL copied to clipboard");
  }, [statusUrl, toast]);

  return (
    <div
      role="alert"
      data-testid="x-thread-error"
      className="mx-auto flex w-full max-w-[480px] flex-col items-center gap-4 rounded-2xl border border-border bg-card/50 px-6 py-10 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WarningCircle size={24} weight="duotone" />
      </div>
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold text-foreground">
          {TITLES[type ?? ""] ?? "Unable to load this X thread"}
        </h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
          {DETAILS[type ?? ""] ?? message ?? "Something went wrong while fetching this thread."}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ArrowClockwise size={15} />
            Retry
          </button>
        )}
        {statusUrl && (
          <button
            onClick={() => openExternal(statusUrl)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ArrowSquareOut size={15} />
            Open on X
          </button>
        )}
        {statusUrl && (
          <button
            onClick={copyUrl}
            aria-label="Copy status URL"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Copy size={15} />
            Copy URL
          </button>
        )}
      </div>
    </div>
  );
});
