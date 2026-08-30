import { useMemo } from "react";
import { Sparkle } from "@phosphor-icons/react";
import type { ArenaModelCandidate, ArenaGradePreview } from "../../api/review";
import type { ArenaSelectionDraft } from "../../stores/reviewStore";
import { useI18n } from "../../lib/i18n";
import {
  groupHorizonCollisions,
  horizonPosition,
  horizonTicks,
} from "./arenaHorizon";
import { formatArenaDueDate, formatArenaInterval } from "./arenaFormatters";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";

interface MemoryHorizonProps {
  preview: ArenaGradePreview;
  selection: ArenaSelectionDraft;
  chosenDays: number;
  chosenDueAt?: string;
  selectedLabel: string;
  onSelect: (selection: ArenaSelectionDraft) => void;
}

export function MemoryHorizon({
  preview,
  selection,
  chosenDays,
  chosenDueAt,
  selectedLabel,
  onSelect,
}: MemoryHorizonProps) {
  const { t, locale } = useI18n();
  const haptic = useHapticFeedback();
  const formatInterval = (days: number) => formatArenaInterval(days, locale);
  const maxHorizon = useMemo(() => Math.max(
    14,
    preview.recommendation.interval_days * 1.35,
    ...preview.candidates.map((candidate) => candidate.interval_days * 1.35),
  ), [preview]);
  const clusters = useMemo(() => groupHorizonCollisions(
    preview.candidates.map((candidate) => ({
      id: candidate.model_id,
      intervalDays: candidate.interval_days,
    })),
    maxHorizon,
  ), [preview, maxHorizon]);
  const ticks = useMemo(() => horizonTicks(maxHorizon, 5), [maxHorizon]);
  const rangeLeft = horizonPosition(preview.range.min_days, maxHorizon);
  const rangeRight = horizonPosition(preview.range.max_days, maxHorizon);

  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-background/45 px-3 py-4 sm:px-5 sm:py-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{t("algorithmArena.selectedTrajectory")}</p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl">{formatInterval(chosenDays)}</span>
            <span className="text-sm font-medium text-primary">{selectedLabel}</span>
          </div>
        </div>
        <p className="text-right text-xs text-muted-foreground">
          {t("algorithmArena.lands")}<br />
          <span className="font-medium text-foreground">{formatArenaDueDate(chosenDueAt ?? "", locale)}</span>
        </p>
      </div>

      <div className="relative mt-7 h-28" aria-label={t("algorithmArena.memoryHorizon")}>
        <div className="absolute left-0 right-0 top-8 h-px bg-border" />
        <div
          className="absolute top-[29px] h-1.5 rounded-full bg-primary/20"
          style={{ left: `${rangeLeft}%`, width: `${Math.max(1, rangeRight - rangeLeft)}%` }}
        />
        <div className="absolute left-0 top-[27px] h-3 w-3 -translate-x-1/2 rounded-full border-2 border-card bg-foreground" />
        {ticks.slice(0, -1).map((tick) => (
          <div key={tick} className="absolute top-[29px] -translate-x-1/2" style={{ left: `${horizonPosition(tick, maxHorizon)}%` }}>
            <div className="h-2 w-px bg-border" />
            <span className="mt-10 block -translate-x-1/2 whitespace-nowrap text-[8px] text-muted-foreground/80">{formatInterval(tick)}</span>
          </div>
        ))}
        {clusters.map((cluster, index) => {
          const candidates = cluster.points.map((point) =>
            preview.candidates.find((candidate) => candidate.model_id === point.id),
          ).filter((candidate): candidate is ArenaModelCandidate => Boolean(candidate));
          const selected = selection.source === "model"
            && candidates.some((candidate) => candidate.model_id === selection.modelId);
          const label = candidates.length === 1
            ? candidates[0].label
            : t("algorithmArena.clusterModels", { count: candidates.length });
          const selectedIndex = candidates.findIndex((candidate) => candidate.model_id === selection.modelId);
          const chooseNext = () => {
            const nextIndex = candidates.length === 1 ? 0 : (selectedIndex + 1) % candidates.length;
            const candidate = candidates[nextIndex];
            if (candidate) {
              haptic.click();
              onSelect({ source: "model", modelId: candidate.model_id });
            }
          };
          const accessibleLabel = candidates.map((candidate) => t("algorithmArena.candidateAnnouncement", {
            model: candidate.label,
            interval: formatInterval(candidate.interval_days),
            date: formatArenaDueDate(candidate.due_at, locale),
            percent: candidate.weight_percent.toFixed(1),
          })).join("; ");
          return (
            <button
              type="button"
              key={candidates.map((candidate) => candidate.model_id).join("-")}
              onClick={chooseNext}
              aria-label={`${label}: ${accessibleLabel}`}
              className="arena-horizon-marker absolute -translate-x-1/2 rounded-lg px-1 outline-none focus-visible:ring-2 focus-visible:ring-primary"
              style={{ left: `${cluster.position}%`, top: `${index % 2 === 0 ? 0 : 13}px`, "--arena-x": `${cluster.position}%`, animationDelay: `${index * 35}ms` } as React.CSSProperties}
            >
              <div className={`mx-auto h-9 w-px ${selected ? "bg-primary" : "bg-border"}`} />
              <div className={`mx-auto -mt-1 grid h-3 min-w-3 place-items-center rounded-full border-2 border-card px-0.5 ${selected ? "scale-125 bg-primary ring-4 ring-primary/15" : "bg-muted-foreground"}`}>
                {candidates.length > 1 && <span className="text-[7px] font-bold leading-none text-background">{candidates.length}</span>}
              </div>
              <span className={`mt-1 block -translate-x-[35%] whitespace-nowrap text-[9px] font-semibold ${selected ? "text-primary" : "text-muted-foreground"}`}>{label}</span>
            </button>
          );
        })}
        <div
          className="arena-horizon-marker absolute top-[20px] -translate-x-1/2"
          style={{ left: `${horizonPosition(preview.recommendation.interval_days, maxHorizon)}%`, "--arena-x": `${horizonPosition(preview.recommendation.interval_days, maxHorizon)}%` } as React.CSSProperties}
        >
          <div className={`grid h-7 w-7 place-items-center rounded-full border-2 border-card shadow-sm ${selection.source === "arena" ? "bg-primary text-primary-foreground ring-4 ring-primary/20" : "bg-foreground text-background"}`}>
            <Sparkle size={12} weight="fill" />
          </div>
        </div>
        <div
          className="arena-selected-lens pointer-events-none absolute top-[25px] h-4 w-0.5 -translate-x-1/2 rounded-full bg-primary"
          style={{ left: `${horizonPosition(chosenDays, maxHorizon)}%` }}
        />
        <span className="absolute bottom-0 left-0 text-[9px] uppercase tracking-widest text-muted-foreground">{t("algorithmArena.now")}</span>
        <span className="absolute bottom-0 right-0 text-[9px] uppercase tracking-widest text-muted-foreground">{formatInterval(maxHorizon)}</span>
      </div>
    </div>
  );
}
