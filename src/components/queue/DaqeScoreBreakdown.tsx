import React from "react";
import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";
import { termStatus, type TermBreakdown, type TermValue } from "../../lib/daqe/snapshot";

interface DaqeScoreBreakdownProps {
  breakdown: TermBreakdown;
  /** The user's configured energy target, for the downshift explanation. */
  configuredEnergyTarget?: number;
}

/**
 * Why an item sits where it does.
 *
 * The one thing this component must never do is show a bare total. Every term
 * carries `available` and `defaulted` flags, and this renders them: a term whose
 * signal was missing says so, and a term backed by a per-item-type default says
 * "estimated" rather than presenting a number that looks measured but is not.
 */
export const DaqeScoreBreakdown = React.memo(function DaqeScoreBreakdown({
  breakdown,
  configuredEnergyTarget,
}: DaqeScoreBreakdownProps) {
  const { t } = useI18n();
  const score = breakdown.srsUrgency.value * breakdown.srsWeight +
    breakdown.goalRelevance.value * breakdown.goalWeight +
    breakdown.energyFit.value * breakdown.energyWeight -
    breakdown.interleavePenalty.value * breakdown.interleaveWeight -
    breakdown.frictionPenalty.value * breakdown.frictionWeight;

  const downshifted =
    breakdown.energyDownshiftReason !== undefined &&
    configuredEnergyTarget !== undefined &&
    breakdown.effectiveEnergyTarget < configuredEnergyTarget;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{t("daqeScore.title")}</span>
        <span className="font-mono">{score.toFixed(3)}</span>
      </div>

      <Term
        label={t("daqeScore.memoryUrgency")}
        term={breakdown.srsUrgency}
        weight={breakdown.srsWeight}
      />
      <Term
        label={t("daqeScore.goalRelevance")}
        term={breakdown.goalRelevance}
        weight={breakdown.goalWeight}
      />
      <Term
        label={t("daqeScore.energyFit")}
        term={breakdown.energyFit}
        weight={breakdown.energyWeight}
      />
      <PenaltyTerm
        label={t("daqeScore.interleavePenalty")}
        term={breakdown.interleavePenalty}
        weight={breakdown.interleaveWeight}
        against={breakdown.interleaveAgainst}
      />
      <PenaltyTerm
        label={t("daqeScore.frictionPenalty")}
        term={breakdown.frictionPenalty}
        weight={breakdown.frictionWeight}
      />

      {downshifted ? (
        <p className="opacity-70">
          {t("daqeScore.effectiveTarget", {
            target: breakdown.effectiveEnergyTarget.toFixed(0),
            configured: configuredEnergyTarget.toFixed(0),
          })}
        </p>
      ) : null}
    </div>
  );
});

function StatusBadge({ term }: { term: TermValue }) {
  const { t } = useI18n();
  const status = termStatus(term);
  const hint =
    status === "untracked"
      ? t("daqeScore.untrackedHint")
      : status === "defaulted"
        ? t("daqeScore.defaultedHint")
        : undefined;

  return (
    <span
      title={hint}
      className={cn(
        "rounded px-1 py-0.5 text-[10px] uppercase tracking-wide",
        status === "measured" && "bg-muted/60",
        status === "defaulted" && "bg-muted/40 opacity-80",
        status === "untracked" && "bg-muted/20 opacity-60"
      )}
    >
      {t(`daqeScore.${status}`)}
    </span>
  );
}

function Term({
  label,
  term,
  weight,
}: {
  label: string;
  term: TermValue;
  weight: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="opacity-80">{label}</span>
      <span className="flex items-center gap-1.5 font-mono">
        <span className="opacity-60">×{weight.toFixed(2)}</span>
        <span>{term.value.toFixed(3)}</span>
        <StatusBadge term={term} />
      </span>
    </div>
  );
}

function PenaltyTerm({
  label,
  term,
  weight,
  against,
}: {
  label: string;
  term: TermValue;
  weight: number;
  against?: string[];
}) {
  const { t } = useI18n();
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <span className="opacity-80">{label}</span>
        <span className="flex items-center gap-1.5 font-mono">
          <span className="opacity-60">−{weight.toFixed(2)}</span>
          <span>{term.value.toFixed(3)}</span>
          <StatusBadge term={term} />
        </span>
      </div>
      {against && against.length > 0 && term.value > 0 ? (
        <p className="mt-0.5 text-[10px] opacity-60">
          {t("daqeScore.interleaveAgainst", { items: against.join(", ") })}
        </p>
      ) : null}
    </div>
  );
}