import { ArrowCounterClockwise, FileText, WarningCircle, WifiSlash, Clock } from "@phosphor-icons/react";

export type AiFailureKind = "offline" | "timeout" | "error";

export interface GracefulAiFallbackProps {
  errorKind: AiFailureKind;
  preservedQuote?: string;
  preservedPrompt?: string;
  errorMessage?: string;
  onFallbackManual: () => void;
  onRetrySmallerContext: (contextScale: number) => void;
}

export function classifyAiError(err: unknown): AiFailureKind {
  const msg =
    err instanceof Error
      ? err.message.toLowerCase()
      : typeof err === "string"
        ? err.toLowerCase()
        : "";
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) {
    return "timeout";
  }
  if (
    msg.includes("offline") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("unreachable") ||
    msg.includes("connect")
  ) {
    return "offline";
  }
  return "offline";
}

export function GracefulAiFallbackCard({
  errorKind,
  preservedQuote,
  preservedPrompt,
  errorMessage,
  onFallbackManual,
  onRetrySmallerContext,
}: GracefulAiFallbackProps) {
  const badgeLabel =
    errorKind === "timeout"
      ? "Request Timeout"
      : errorKind === "offline"
        ? "Local LLM Offline"
        : "AI Generation Error";

  const BadgeIcon =
    errorKind === "timeout"
      ? Clock
      : errorKind === "offline"
        ? WifiSlash
        : WarningCircle;

  return (
    <div
      role="alert"
      data-graceful-ai-fallback="true"
      data-error-kind={errorKind}
      className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-foreground space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-semibold text-amber-500">
          <BadgeIcon className="h-3.5 w-3.5" />
          <span>{badgeLabel}</span>
        </span>
      </div>

      {errorMessage && (
        <p className="text-[11px] text-muted-foreground">{errorMessage}</p>
      )}

      {(preservedQuote || preservedPrompt) && (
        <div
          data-preserved-context="true"
          className="rounded-lg border border-border/70 bg-background/70 p-2 space-y-1 text-[11px]"
        >
          {preservedQuote && (
            <p className="italic text-muted-foreground line-clamp-2">
              &ldquo;{preservedQuote}&rdquo;
            </p>
          )}
          {preservedPrompt && (
            <p className="font-medium text-foreground">
              Prompt: {preservedPrompt}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onFallbackManual}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted"
        >
          <FileText className="h-3.5 w-3.5 text-primary" />
          <span>Fallback to Manual Extract</span>
        </button>
        <button
          type="button"
          onClick={() => onRetrySmallerContext(0.5)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ArrowCounterClockwise className="h-3.5 w-3.5" />
          <span>Retry with Smaller Context</span>
        </button>
      </div>
    </div>
  );
}
