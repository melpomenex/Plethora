import { Check, X } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";
import type {
  OcclusionAssistCard,
  OcclusionAssistRejection,
  OcclusionAssistStatus,
} from "./useOcclusionAssist";

/**
 * AI occlusion-assist panel for the composer sidebar (tasks 3.6–3.8).
 *
 * Shows the OCR statistics, the proposed cards (per-card accept — never
 * defaulted on, question/answer editable), the model's rejected labels with
 * reasons, and the distinct low-precision labeling for the experimental
 * freeform path. The freeform action only appears when OCR found no labels
 * AND the `aiOcclusionFreeform` flag is on.
 */
export interface OcclusionAssistPanelProps {
  status: OcclusionAssistStatus;
  proposals: {
    cards: OcclusionAssistCard[];
    rejected: OcclusionAssistRejection[];
    appropriate: boolean;
    usedFreeform: boolean;
  } | null;
  ocrMeta: {
    detected: number;
    kept: number;
    droppedTiny: number;
    droppedShortText: number;
    droppedDense: number;
    backend: "android-mlkit" | "rust-ocr";
  } | null;
  isStale: boolean;
  busy: boolean;
  freeformEnabled: boolean;
  onRun: () => void;
  onRunFreeform?: () => void;
  onToggleCard: (cardId: string) => void;
  onAcceptAll: (accepted: boolean) => void;
  onEditCard: (cardId: string, patch: { question?: string; answer?: string }) => void;
}

export function OcclusionAssistPanel({
  status,
  proposals,
  ocrMeta,
  isStale,
  busy,
  freeformEnabled,
  onRun,
  onRunFreeform,
  onToggleCard,
  onAcceptAll,
  onEditCard,
}: OcclusionAssistPanelProps) {
  const { t } = useI18n();

  const statusNode = (() => {
    switch (status.kind) {
      case "ocr-running":
        return (
          <p data-testid="assist-status" className="text-xs text-muted-foreground">
            {t("aiOcclusion.ocrRunning")}
          </p>
        );
      case "ai-running":
        return (
          <p data-testid="assist-status" className="text-xs text-muted-foreground">
            {t("aiOcclusion.aiRunning")}
          </p>
        );
      case "no-labels":
        return (
          <p data-testid="assist-status" className="text-xs text-amber-600 dark:text-amber-400">
            {t("aiOcclusion.noLabels")}
            {freeformEnabled && onRunFreeform ? (
              <>
                {" "}
                <button
                  type="button"
                  data-testid="assist-freeform-run"
                  onClick={onRunFreeform}
                  className="underline underline-offset-2"
                >
                  {t("aiOcclusion.freeformTry")}
                </button>
              </>
            ) : null}
          </p>
        );
      case "inappropriate":
        return (
          <p data-testid="assist-status" className="text-xs text-amber-600 dark:text-amber-400">
            {t("aiOcclusion.notAppropriate")}
          </p>
        );
      case "error":
        return (
          <p data-testid="assist-status" className="text-xs text-destructive">
            {t("aiOcclusion.failed")}
            {status.message ? ` ${status.message}` : ""}
          </p>
        );
      default:
        return null;
    }
  })();

  return (
    <div className="flex flex-col gap-1.5" data-testid="ai-assist-panel">
      <span className="text-xs font-medium text-muted-foreground">
        {t("aiOcclusion.panelTitle")}
      </span>
      <p className="rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
        {t("aiOcclusion.panelHint")}
      </p>
      <button
        type="button"
        data-testid="assist-run"
        disabled={busy}
        onClick={onRun}
        className="rounded-md bg-primary px-2 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? t("aiOcclusion.running") : t("aiOcclusion.runAction")}
      </button>

      {ocrMeta && (
        <p data-testid="assist-ocr-meta" className="text-[11px] text-muted-foreground">
          {t("aiOcclusion.ocrMeta", {
            detected: ocrMeta.detected,
            kept: ocrMeta.kept,
            backend:
              ocrMeta.backend === "android-mlkit"
                ? t("aiOcclusion.backendMlKit")
                : t("aiOcclusion.backendRust"),
          })}
          {ocrMeta.droppedTiny + ocrMeta.droppedShortText + ocrMeta.droppedDense > 0
            ? ` · ${t("aiOcclusion.ocrDropped", {
                count: ocrMeta.droppedTiny + ocrMeta.droppedShortText + ocrMeta.droppedDense,
              })}`
            : ""}
        </p>
      )}

      {isStale && (
        <p data-testid="assist-stale" className="rounded-md bg-amber-500/15 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
          {t("aiOcclusion.staleWarning")}
        </p>
      )}

      {statusNode}

      {proposals && proposals.usedFreeform && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
          {t("aiOcclusion.freeformExperimental")}
        </p>
      )}

      {proposals && proposals.cards.length > 0 && !proposals.usedFreeform && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">
              {t("aiOcclusion.proposedCards", { count: proposals.cards.length })}
            </span>
            <button
              type="button"
              data-testid="assist-accept-all"
              onClick={() => onAcceptAll(true)}
              className="rounded bg-emerald-600/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-600/25 dark:text-emerald-400"
            >
              {t("aiOcclusion.acceptAll")}
            </button>
          </div>
          {proposals.cards.map((card, index) => (
            <div
              key={card.id}
              data-testid={`assist-card-${index}`}
              className={cn(
                "rounded-md border px-2 py-1.5",
                card.accepted
                  ? "border-emerald-500/50 bg-emerald-500/10"
                  : "border-border bg-background"
              )}
            >
              <div className="flex items-start gap-1.5">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={card.accepted}
                  data-testid={`assist-card-accept-${index}`}
                  onClick={() => onToggleCard(card.id)}
                  title={t("aiOcclusion.toggleCard")}
                  className={cn(
                    "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                    card.accepted
                      ? "border-emerald-600 bg-emerald-600 text-white"
                      : "border-border bg-background"
                  )}
                >
                  {card.accepted && <Check className="h-3 w-3" />}
                </button>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <input
                    value={card.question}
                    onChange={(event) => onEditCard(card.id, { question: event.target.value })}
                    aria-label={t("aiOcclusion.cardQuestion")}
                    className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <input
                    value={card.answer}
                    onChange={(event) => onEditCard(card.id, { answer: event.target.value })}
                    aria-label={t("aiOcclusion.cardAnswer")}
                    className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {t("aiOcclusion.cardLabels", {
                      count: card.labelIds.length,
                      text: card.labelIds.length === 1 ? "" : "s",
                    })}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {proposals && proposals.rejected.length > 0 && (
        <details data-testid="assist-rejected" className="rounded-md border border-border px-2 py-1">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
            {t("aiOcclusion.rejectedLabels", { count: proposals.rejected.length })}
          </summary>
          <ul className="mt-1 flex flex-col gap-1">
            {proposals.rejected.map((rejection) => (
              <li key={rejection.labelId} className="flex items-start gap-1 text-[11px]">
                <X className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span>
                  <span className="font-medium">{rejection.text ?? rejection.labelId}</span>
                  {" — "}
                  {rejection.reason}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
