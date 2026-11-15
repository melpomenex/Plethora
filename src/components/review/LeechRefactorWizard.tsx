import { useMemo, useState } from "react";
import { ArrowUUpLeft, Scissors, Sparkle, Warning, X } from "@phosphor-icons/react";
import {
  GracefulAiFallbackCard,
  classifyAiError,
  type AiFailureKind,
} from "../common/GracefulAiFallbackCard";

/**
 * Deterministically split multi-clause / multi-sentence text into up to 3
 * atomic cloze candidate strings.
 */
export function splitTextIntoClozeCandidates(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const parts = clean
    .split(/(?:\.\s+|;\s+|,\s+and\s+)/i)
    .map((p) => p.trim().replace(/[.;]+$/, ""))
    .filter((p) => p.length >= 3);

  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) {
      unique.push(part);
    }
    if (unique.length >= 3) break;
  }

  return unique.length > 0 ? unique : [clean];
}

export interface LeechRefactorWizardProps {
  cardId: string;
  question: string;
  answer?: string;
  lapses: number;
  leechThreshold?: number;
  parentExtractText?: string | null;
  onSplitClozes: (candidates: string[]) => Promise<void> | void;
  onRewriteWithAi?: () => Promise<string | null> | void;
  onDemoteToExtract: () => Promise<void> | void;
  onDismiss: () => void;
}

export function LeechRefactorWizard({
  question,
  answer,
  lapses,
  parentExtractText,
  onSplitClozes,
  onRewriteWithAi,
  onDemoteToExtract,
  onDismiss,
}: LeechRefactorWizardProps) {
  const [isBusy, setIsBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);

  const candidates = useMemo(
    () => splitTextIntoClozeCandidates(answer?.trim() || question),
    [answer, question]
  );

  const handleSplit = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await onSplitClozes(candidates);
    } finally {
      setIsBusy(false);
    }
  };

  const [aiFailureKind, setAiFailureKind] = useState<AiFailureKind | null>(null);

  const handleRewrite = async (_contextScale = 1.0) => {
    if (isBusy) return;
    if (!onRewriteWithAi) {
      setAiFailureKind("offline");
      setAiStatus("Local AI offline — try Split into Simpler Clozes or Demote.");
      return;
    }
    setIsBusy(true);
    setAiStatus(null);
    setAiFailureKind(null);
    try {
      const rewritten = await onRewriteWithAi();
      if (!rewritten) {
        setAiFailureKind("offline");
        setAiStatus("Local AI offline — try Split into Simpler Clozes or Demote.");
      } else {
        setAiStatus(rewritten);
      }
    } catch (err) {
      setAiFailureKind(classifyAiError(err));
      setAiStatus(
        err instanceof Error ? err.message : "Local AI offline — try Split into Simpler Clozes or Demote."
      );
    } finally {
      setIsBusy(false);
    }
  };

  const handleDemote = async () => {
    if (isBusy) return;
    setIsBusy(true);
    try {
      await onDemoteToExtract();
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      data-leech-refactor-wizard="true"
      className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-foreground shadow-sm"
    >
      <div className="flex items-center justify-between gap-2 pb-3 border-b border-amber-500/20">
        <div className="flex items-center gap-2 font-semibold text-amber-500">
          <Warning className="h-4 w-4 shrink-0" />
          <span>Leech Detected ({lapses} lapses)</span>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss leech wizard"
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-card/70 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Card Prompt
          </div>
          <p className="mt-1 text-xs leading-relaxed text-foreground line-clamp-4">
            {question}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/70 p-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Parent Extract
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground line-clamp-4">
            {parentExtractText?.trim() || "No linked parent extract"}
          </p>
        </div>
      </div>

      {candidates.length > 0 && (
        <div className="mt-3 rounded-xl border border-border/50 bg-background/60 p-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Atomic Cloze Preview: </span>
          {candidates.map((c, idx) => `(${idx + 1}) ${c}`).join(" • ")}
        </div>
      )}

      {aiStatus && (
        <div className="mt-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
          {aiStatus}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleSplit()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Scissors className="h-3.5 w-3.5" />
          Split into Simpler Clozes
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleRewrite()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
        >
          <Sparkle className="h-3.5 w-3.5" />
          Rewrite via Local AI
        </button>
        <button
          type="button"
          disabled={isBusy}
          onClick={() => void handleDemote()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-500 hover:bg-amber-500/25 disabled:opacity-50"
        >
          <ArrowUUpLeft className="h-3.5 w-3.5" />
          Demote to Reading Extract
        </button>
      </div>
      {aiFailureKind && (
        <div className="mt-3">
          <GracefulAiFallbackCard
            errorKind={aiFailureKind}
            preservedQuote={question}
            errorMessage={aiStatus ?? undefined}
            onFallbackManual={() => {
              setAiFailureKind(null);
              void handleDemote();
            }}
            onRetrySmallerContext={(scale) => {
              void handleRewrite(scale);
            }}
          />
        </div>
      )}
    </div>
  );
}
