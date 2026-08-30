import type { ReactNode } from "react";
import { CheckCircle, MagicWand, SlidersHorizontal } from "@phosphor-icons/react";
import type { ArenaModelCandidate, ArenaGradePreview } from "../../api/review";
import type { ArenaSelectionDraft } from "../../stores/reviewStore";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { useI18n } from "../../lib/i18n";
import { formatArenaDueDate, formatArenaInterval } from "./arenaFormatters";

interface ArenaChoiceRailProps {
  preview: ArenaGradePreview;
  selection: ArenaSelectionDraft;
  chosenDays: number;
  horizon: ReactNode;
  onSelect: (selection: ArenaSelectionDraft) => void;
}

export function ArenaChoiceRail({
  preview,
  selection,
  chosenDays,
  horizon,
  onSelect,
}: ArenaChoiceRailProps) {
  const { t, locale } = useI18n();
  const haptic = useHapticFeedback();
  const formatInterval = (days: number) => formatArenaInterval(days, locale);
  const choose = (next: ArenaSelectionDraft) => {
    const changed = next.source !== selection.source
      || next.modelId !== selection.modelId
      || next.intervalDays !== selection.intervalDays;
    if (changed) haptic.click();
    onSelect(next);
  };
  const candidateName = (candidate: ArenaModelCandidate) => t("algorithmArena.candidateAnnouncement", {
    model: candidate.label,
    interval: formatInterval(candidate.interval_days),
    date: formatArenaDueDate(candidate.due_at, locale),
    percent: candidate.weight_percent.toFixed(1),
  });

  return (
    <div role="radiogroup" aria-label={t("algorithmArena.choiceGroup")}>
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
        {horizon}
        <button
          type="button"
          role="radio"
          aria-checked={selection.source === "arena"}
          tabIndex={selection.source === "arena" ? 0 : -1}
          aria-label={t("algorithmArena.arenaAnnouncement", {
            interval: formatInterval(preview.recommendation.interval_days),
            date: formatArenaDueDate(preview.recommendation.due_at, locale),
          })}
          onClick={() => choose({ source: "arena" })}
          className={`group relative min-h-[132px] overflow-hidden rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${selection.source === "arena" ? "border-primary bg-primary text-primary-foreground shadow-[0_12px_40px_-22px_hsl(var(--primary))]" : "border-border bg-background/50 hover:border-primary/40"}`}
        >
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"><MagicWand size={15} weight="duotone" /> {t("algorithmArena.arenaPick")}</span>
            {selection.source === "arena" && <CheckCircle size={19} weight="fill" />}
          </div>
          <p className="mt-4 font-mono text-2xl font-semibold tabular-nums">{formatInterval(preview.recommendation.interval_days)}</p>
          <p className={`mt-1 text-xs ${selection.source === "arena" ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{t("algorithmArena.weightedForYou")}</p>
        </button>
      </div>

      <div className="mt-4 flex snap-x snap-mandatory gap-2 overflow-x-auto pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6">
        {preview.candidates.map((candidate, index) => {
          const selected = selection.source === "model" && selection.modelId === candidate.model_id;
          return (
            <button
              key={candidate.model_id}
              type="button"
              role="radio"
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              aria-label={candidateName(candidate)}
              onClick={() => choose({ source: "model", modelId: candidate.model_id })}
              className={`min-h-[92px] min-w-[136px] snap-center rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-w-0 ${selected ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border bg-background/40 hover:border-primary/30 hover:bg-muted/40"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={`text-xs font-semibold ${selected ? "text-primary" : "text-foreground"}`}>{candidate.label}</span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{index + 1}</span>
              </div>
              <p className="mt-2 font-mono text-base font-semibold tabular-nums text-foreground">{formatInterval(candidate.interval_days)}</p>
              <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{candidate.weight_percent.toFixed(1)}% {t("algorithmArena.voice")}</span>
                {candidate.personalized && <span className="text-primary">{t("algorithmArena.personalized")}</span>}
              </div>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={selection.source === "custom"}
          tabIndex={selection.source === "custom" ? 0 : -1}
          aria-label={t("algorithmArena.customInterval")}
          onClick={() => choose({ source: "custom", intervalDays: chosenDays || preview.recommendation.interval_days })}
          className={`min-h-[92px] min-w-[136px] snap-center rounded-xl border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:min-w-0 ${selection.source === "custom" ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-border bg-background/40 hover:border-primary/30 hover:bg-muted/40"}`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">{t("algorithmArena.custom")}</span>
            <SlidersHorizontal size={15} />
          </div>
          <p className="mt-2 font-mono text-base font-semibold tabular-nums">{t("algorithmArena.chooseTime")}</p>
          <p className="mt-2 text-[10px] text-muted-foreground">{t("algorithmArena.deliberateOverride")} · M</p>
        </button>
      </div>
    </div>
  );
}
