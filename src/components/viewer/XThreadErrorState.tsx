/**
 * XThreadErrorState — native, actionable error states for the X thread
 * reader: thread unavailable (private/deleted), ThreadReaderApp unavailable,
 * rate limited, network error, invalid URL, or auth/credentials. Includes
 * Retry / Open on X / copy-URL actions. Never a blank page or white iframe
 * fallback, and never a raw internal exception as the primary message.
 */
import { memo, useCallback } from "react";
import { ArrowClockwise, Copy, WarningCircle, ArrowSquareOut } from "@phosphor-icons/react";
import { openExternal } from "../../lib/tauri";
import { copySelectionTextToClipboard } from "./SelectionPopup";
import { useToast } from "../common/Toast";
import { resolveThreadError, type XThreadError } from "../../lib/xthreadError";

export type { XThreadError };

const XThreadErrorStateImpl = function XThreadErrorState({
  error,
  statusUrl,
  onRetry,
}: {
  error: unknown;
  /** The canonical status URL to offer as "Open on X". */
  statusUrl?: string;
  onRetry?: () => void;
}) {
  const { type, copy, message } = resolveThreadError(error);
  const toast = useToast();

  const copyUrl = useCallback(async () => {
    if (!statusUrl) return;
    await copySelectionTextToClipboard(statusUrl);
    toast.success("Copied", "Status URL copied to clipboard");
  }, [statusUrl, toast]);

  // Invalid links carry no usable status URL — opening or copying them is
  // meaningless (the backend rejected the id before any provider was called).
  const openable = Boolean(statusUrl) && type !== "invalidUrl";
  // Raw backend text is secondary detail only — never the primary message.
  const showDetail = message && message !== copy.detail;

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
        <h2 className="text-base font-semibold text-foreground">{copy.title}</h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">{copy.detail}</p>
        {showDetail && (
          <p
            data-testid="x-thread-error-detail"
            className="mx-auto max-w-sm break-words text-xs leading-relaxed text-muted-foreground/70"
          >
            {message}
          </p>
        )}
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
        {openable && (
          <button
            onClick={() => openExternal(statusUrl!)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <ArrowSquareOut size={15} />
            Open on X
          </button>
        )}
        {openable && (
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
};

export const XThreadErrorState = memo(XThreadErrorStateImpl);
