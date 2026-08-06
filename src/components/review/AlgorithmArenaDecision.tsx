import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ArrowCounterClockwise, ArrowRight, ClockCountdown, Sparkle } from "@phosphor-icons/react";
import type { SM20ArenaGradePreview } from "../../api/review";
import { getSm20ArenaStats } from "../../api/review";
import { useReviewStore, type ArenaSelectionDraft } from "../../stores/reviewStore";
import { useI18n } from "../../lib/i18n";
import { horizonDaysAt, horizonPosition } from "./arenaHorizon";
import { clampCustomInterval } from "./arenaHorizon";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { useSettingsStore } from "../../stores/settingsStore";
import { ArenaChoiceRail } from "./ArenaChoiceRail";
import { MemoryHorizon } from "./MemoryHorizon";
import { arenaDueAtFromDays, formatArenaDueDate, formatArenaInterval } from "./arenaFormatters";

export { formatArenaInterval } from "./arenaFormatters";

const DAY_UNITS = {
  minutes: 1 / 1_440,
  hours: 1 / 24,
  days: 1,
  weeks: 7,
  months: 30.4375,
  years: 365.25,
} as const;

type DayUnit = keyof typeof DAY_UNITS;

function selectionInterval(selection: ArenaSelectionDraft, preview: SM20ArenaGradePreview): number {
  if (selection.source === "custom") {
    return selection.intervalDays ?? preview.recommendation.interval_days;
  }
  if (selection.source === "model") {
    return (
      preview.candidates.find((candidate) => candidate.model_id === selection.modelId)
        ?.interval_days ?? preview.recommendation.interval_days
    );
  }
  return preview.recommendation.interval_days;
}

interface AlgorithmArenaDecisionProps {
  compact?: boolean;
  onCommitted?: () => void;
}

export function AlgorithmArenaDecision({
  compact = false,
  onCommitted,
}: AlgorithmArenaDecisionProps) {
  const { t, locale } = useI18n();
  const formatInterval = (days: number) => formatArenaInterval(days, locale);
  const haptic = useHapticFeedback();
  const audioReviewSettings = useSettingsStore((state) => state.settings.audioReviewMode);
  const updateSettings = useSettingsStore((state) => state.updateSettings);
  const lastCustomTick = useRef("");
  const customTrackRef = useRef<HTMLDivElement | null>(null);
  const customValuePreviewRef = useRef<HTMLOutputElement | null>(null);
  const customDatePreviewRef = useRef<HTMLSpanElement | null>(null);
  const {
    previewIntervals,
    reviewPhase,
    pendingArenaReview,
    arenaPreviewError,
    error,
    selectArenaChoice,
    confirmArenaSelection,
    cancelArenaDecision,
    retryArenaPreview,
    scheduleArenaAutomatically,
  } = useReviewStore(
    // Explicit property selector: a bare useReviewStore() re-renders this
    // component on every unrelated store write (timers, previews, arena state).
    useShallow((state) => ({
      previewIntervals: state.previewIntervals,
      reviewPhase: state.reviewPhase,
      pendingArenaReview: state.pendingArenaReview,
      arenaPreviewError: state.arenaPreviewError,
      error: state.error,
      selectArenaChoice: state.selectArenaChoice,
      confirmArenaSelection: state.confirmArenaSelection,
      cancelArenaDecision: state.cancelArenaDecision,
      retryArenaPreview: state.retryArenaPreview,
      scheduleArenaAutomatically: state.scheduleArenaAutomatically,
    }))
  );
  const [customUnit, setCustomUnit] = useState<DayUnit>("days");
  const [coachStep, setCoachStep] = useState(0);
  const [rMetric, setRMetric] = useState<number | null>(null);

  const runCommit = useCallback(
    async (commit: () => Promise<void>) => {
      const commitId = useReviewStore.getState().pendingArenaReview?.commitId;
      if (!commitId) return;
      await commit();
      const committedState = useReviewStore.getState();
      if (!committedState.pendingArenaReview && !committedState.error) {
        onCommitted?.();
      }
    },
    [onCommitted]
  );
  const returnToRating = useCallback(() => {
    cancelArenaDecision();
    const restoreFocus = () => {
      document.querySelector<HTMLElement>("[data-review-rating]")?.focus();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(restoreFocus);
    } else {
      window.setTimeout(restoreFocus, 0);
    }
  }, [cancelArenaDecision]);

  const arena = previewIntervals?.arena;
  const gradePreview =
    pendingArenaReview && arena ? arena.grades[pendingArenaReview.grade] : undefined;
  const selection = pendingArenaReview?.selection ?? { source: "arena" as const };

  const chosenDays = gradePreview ? selectionInterval(selection, gradePreview) : 0;
  const chosenDueAt =
    selection.source === "custom"
      ? arenaDueAtFromDays(chosenDays)
      : selection.source === "model"
        ? gradePreview?.candidates.find((candidate) => candidate.model_id === selection.modelId)
            ?.due_at
        : gradePreview?.recommendation.due_at;

  useEffect(() => {
    setCoachStep(audioReviewSettings.algorithmArenaCoachCompleted ? 0 : 1);
  }, [audioReviewSettings.algorithmArenaCoachCompleted]);

  useEffect(() => {
    if (!pendingArenaReview) return;
    let active = true;
    void getSm20ArenaStats()
      .then((stats) => {
        if (active) setRMetric(stats.r_metric);
      })
      .catch(() => {
        if (active) setRMetric(null);
      });
    return () => {
      active = false;
    };
  }, [pendingArenaReview?.itemId]);

  const completeCoach = () => {
    setCoachStep(0);
    updateSettings({
      audioReviewMode: {
        ...audioReviewSettings,
        algorithmArenaCoachCompleted: true,
      },
    });
  };

  useEffect(() => {
    if (!pendingArenaReview || !gradePreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) return;
      if (target instanceof HTMLElement && target.getAttribute("role") === "slider") return;
      if (event.key === "Escape") {
        event.preventDefault();
        returnToRating();
        return;
      }
      if (reviewPhase !== "arena-ready" && reviewPhase !== "arena-error") return;
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectArenaChoice({ source: "arena" });
        return;
      }
      if (event.key.toLowerCase() === "m") {
        event.preventDefault();
        selectArenaChoice({
          source: "custom",
          intervalDays: selectionInterval(selection, gradePreview),
        });
        return;
      }
      if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        const candidate = gradePreview.candidates[Number(event.key) - 1];
        if (candidate) selectArenaChoice({ source: "model", modelId: candidate.model_id });
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const ordered = [
          { source: "arena" as const, interval: gradePreview.recommendation.interval_days },
          ...gradePreview.candidates.map((candidate) => ({
            source: "model" as const,
            modelId: candidate.model_id,
            interval: candidate.interval_days,
          })),
        ].sort((left, right) => left.interval - right.interval);
        const currentIndex = ordered.findIndex(
          (choice) =>
            choice.source === selection.source &&
            (choice.source !== "model" || choice.modelId === selection.modelId)
        );
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = ordered[Math.max(0, Math.min(ordered.length - 1, currentIndex + delta))];
        if (next?.source === "arena") selectArenaChoice({ source: "arena" });
        if (next?.source === "model") {
          selectArenaChoice({ source: "model", modelId: next.modelId });
        }
        return;
      }
      if ((event.key === "Enter" || event.key === " ") && reviewPhase === "arena-ready") {
        event.preventDefault();
        void runCommit(confirmArenaSelection);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    pendingArenaReview,
    gradePreview,
    reviewPhase,
    selection,
    selectArenaChoice,
    confirmArenaSelection,
    returnToRating,
    runCommit,
  ]);

  if (!pendingArenaReview) return null;

  if (reviewPhase === "arena-loading" || !gradePreview) {
    return (
      <section
        className="arena-stage relative overflow-hidden rounded-2xl border border-border bg-card p-4 sm:p-6"
        aria-busy="true"
      >
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
            <div className="h-6 w-56 max-w-[60vw] animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="mt-8 h-24 animate-pulse rounded-xl bg-muted/70" />
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-xl bg-muted/50" />
          ))}
        </div>
        {reviewPhase === "arena-error" && (
          <div className="mt-5 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium text-foreground">{t("algorithmArena.previewFailed")}</p>
            <p className="mt-1 text-muted-foreground">
              {arenaPreviewError ?? t("algorithmArena.gradeSafe")}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void retryArenaPreview()}
                className="min-h-11 rounded-xl bg-primary px-4 font-medium text-primary-foreground"
              >
                {t("algorithmArena.tryAgain")}
              </button>
              <button
                type="button"
                onClick={() => void runCommit(scheduleArenaAutomatically)}
                className="min-h-11 rounded-xl border border-primary/30 bg-primary/5 px-4 font-medium text-foreground"
              >
                {t("algorithmArena.scheduleAutomatically")}
              </button>
              <button
                type="button"
                onClick={returnToRating}
                className="min-h-11 rounded-xl border border-border px-4 font-medium"
              >
                {t("algorithmArena.backToRating")}
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  const customBounds = gradePreview.custom_bounds;
  const customValue = chosenDays / DAY_UNITS[customUnit];
  const customValid =
    Number.isFinite(chosenDays) &&
    chosenDays >= customBounds.min_days &&
    chosenDays <= customBounds.max_days;
  const customPosition = horizonPosition(chosenDays, customBounds.max_days);
  const previewCustomPointer = (clientX: number, commit: boolean) => {
    const track = customTrackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const position = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const days = clampCustomInterval(
      horizonDaysAt(position, customBounds.max_days),
      customBounds.min_days,
      customBounds.max_days
    );
    track.style.setProperty("--arena-custom-x", `${position}%`);
    const tick = formatInterval(days);
    if (customValuePreviewRef.current) customValuePreviewRef.current.textContent = tick;
    if (customDatePreviewRef.current) {
      customDatePreviewRef.current.textContent = formatArenaDueDate(
        arenaDueAtFromDays(days),
        locale
      );
    }
    if (tick !== lastCustomTick.current) {
      lastCustomTick.current = tick;
      haptic.click();
    }
    if (commit) selectArenaChoice({ source: "custom", intervalDays: days });
  };
  const nudgeCustom = (direction: -1 | 1) => {
    const currentPosition = horizonPosition(chosenDays, customBounds.max_days);
    const days = clampCustomInterval(
      horizonDaysAt(currentPosition + direction, customBounds.max_days),
      customBounds.min_days,
      customBounds.max_days
    );
    haptic.click();
    selectArenaChoice({ source: "custom", intervalDays: days });
  };
  const selectedLabel =
    selection.source === "arena"
      ? t("algorithmArena.arenaPick")
      : selection.source === "custom"
        ? t("algorithmArena.customHorizon")
        : (gradePreview.candidates.find((candidate) => candidate.model_id === selection.modelId)
            ?.label ?? "Model");

  return (
    <section
      className={`arena-stage relative isolate flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border bg-card ${reviewPhase === "arena-committing" ? "arena-confirming" : ""} ${compact ? "p-3 sm:p-4" : "p-4 sm:p-6 lg:p-7"}`}
      aria-label={t("algorithmArena.chooseLabel")}
    >
      <style>{`
        /* Arena motion tokens keep entry, selection, and confirmation rhythm coherent. */
        .arena-stage { --arena-motion-select: 200ms; --arena-motion-enter: 380ms; --arena-motion-confirm: 220ms; }
        .arena-stage::before { content: ""; position: absolute; inset: 0; pointer-events: none; z-index: -1; background: radial-gradient(80% 90% at 88% 0%, color-mix(in srgb, hsl(var(--primary)) 12%, transparent), transparent 68%); }
        .arena-horizon-marker { animation: arena-arrive var(--arena-motion-enter) cubic-bezier(.2,.8,.2,1) both; transform-origin: left center; }
        .arena-selected-lens { transition: left var(--arena-motion-select) cubic-bezier(.2,.8,.2,1); }
        .arena-stage.arena-confirming .arena-horizon-marker { animation: none; transform: scale(.94); opacity: .55; transition: transform var(--arena-motion-confirm) ease, opacity var(--arena-motion-confirm) ease; }
        .arena-stage.arena-confirming [role="radio"]:not([aria-checked="true"]) { transform: scale(.985); opacity: .42; transition: transform var(--arena-motion-confirm) ease, opacity var(--arena-motion-confirm) ease; }
        @keyframes arena-arrive { from { transform: translateX(calc(var(--arena-x) * -1)); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @media (prefers-reduced-motion: reduce) { .arena-horizon-marker, .arena-selected-lens, .arena-stage [role="radio"] { animation: none !important; transition: none !important; } }
        @media (prefers-reduced-transparency: reduce) { .arena-stage { backdrop-filter: none !important; } }
      `}</style>

      <div
        data-testid="arena-scroll-region"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3"
      >
        <header className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
              <ClockCountdown size={23} weight="duotone" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t("algorithmArena.memoryHorizon")}
                </p>
                <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {t("algorithmArena.grade", { grade: pendingArenaReview.grade })} ·{" "}
                  {t(`algorithmArena.grade.${pendingArenaReview.grade}`)}
                </span>
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t("algorithmArena.question")}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={returnToRating}
            className="min-h-11 shrink-0 rounded-xl px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t("algorithmArena.back")}{" "}
            <span className="hidden sm:inline">{t("algorithmArena.toRating")}</span>
          </button>
        </header>

        <ArenaChoiceRail
          preview={gradePreview}
          selection={selection}
          chosenDays={chosenDays}
          onSelect={selectArenaChoice}
          horizon={
            <MemoryHorizon
              preview={gradePreview}
              selection={selection}
              chosenDays={chosenDays}
              chosenDueAt={chosenDueAt}
              selectedLabel={selectedLabel}
              onSelect={selectArenaChoice}
            />
          }
        />

        {selection.source === "custom" && (
          <div className="mt-3 rounded-xl border border-primary/25 bg-primary/[0.04] p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-[180px_140px_1fr] sm:items-end">
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("algorithmArena.amount")}
                </span>
                <input
                  type="number"
                  min={customBounds.min_days / DAY_UNITS[customUnit]}
                  max={customBounds.max_days / DAY_UNITS[customUnit]}
                  step="any"
                  value={Number.isFinite(customValue) ? Number(customValue.toPrecision(6)) : ""}
                  onChange={(event) =>
                    selectArenaChoice({
                      source: "custom",
                      intervalDays: Number(event.target.value) * DAY_UNITS[customUnit],
                    })
                  }
                  className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 font-mono text-base tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("algorithmArena.unit")}
                </span>
                <select
                  value={customUnit}
                  onChange={(event) => setCustomUnit(event.target.value as DayUnit)}
                  className="mt-1 min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                >
                  {Object.keys(DAY_UNITS).map((unit) => (
                    <option key={unit} value={unit}>
                      {t(`algorithmArena.unit.${unit}`)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="block">
                <span className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>{t("algorithmArena.timeLens")}</span>
                  <span>
                    {formatInterval(customBounds.min_days)} –{" "}
                    {formatInterval(customBounds.max_days)}
                  </span>
                </span>
                <div
                  ref={customTrackRef}
                  role="slider"
                  tabIndex={0}
                  aria-label={t("algorithmArena.customSlider")}
                  aria-valuemin={customBounds.min_days}
                  aria-valuemax={customBounds.max_days}
                  aria-valuenow={chosenDays}
                  aria-valuetext={`${formatInterval(chosenDays)}, ${formatArenaDueDate(arenaDueAtFromDays(chosenDays), locale)}`}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    previewCustomPointer(event.clientX, false);
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
                      previewCustomPointer(event.clientX, false);
                    }
                  }}
                  onPointerUp={(event) => {
                    previewCustomPointer(event.clientX, true);
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                  }}
                  onPointerCancel={(event) => {
                    event.currentTarget.style.setProperty("--arena-custom-x", `${customPosition}%`);
                    event.currentTarget.releasePointerCapture?.(event.pointerId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
                      event.preventDefault();
                      nudgeCustom(-1);
                    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
                      event.preventDefault();
                      nudgeCustom(1);
                    } else if (event.key === "Home" || event.key === "End") {
                      event.preventDefault();
                      haptic.click();
                      selectArenaChoice({
                        source: "custom",
                        intervalDays:
                          event.key === "Home" ? customBounds.min_days : customBounds.max_days,
                      });
                    }
                  }}
                  className="relative mt-3 min-h-11 w-full cursor-ew-resize touch-none rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  style={{ "--arena-custom-x": `${customPosition}%` } as React.CSSProperties}
                >
                  <span className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
                  <span
                    className="pointer-events-none absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary/40"
                    style={{ width: "var(--arena-custom-x)" }}
                  />
                  <span
                    className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-primary shadow-sm"
                    style={{ left: "var(--arena-custom-x)" }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <output ref={customValuePreviewRef} className="font-mono tabular-nums">
                    {formatInterval(chosenDays)}
                  </output>
                  <span ref={customDatePreviewRef}>
                    {formatArenaDueDate(arenaDueAtFromDays(chosenDays), locale)}
                  </span>
                </div>
              </div>
            </div>
            {!customValid && (
              <p className="mt-2 text-xs font-medium text-destructive">
                {t("algorithmArena.allowedRange", {
                  min: formatInterval(customBounds.min_days),
                  max: formatInterval(customBounds.max_days),
                })}
              </p>
            )}
          </div>
        )}

        <details className="mt-3 rounded-xl border border-border/70 bg-background/35 p-3 text-sm">
          <summary className="cursor-pointer select-none font-medium text-foreground marker:text-primary">
            {t("algorithmArena.whyThisInterval")}
          </summary>
          <div className="mt-3 grid gap-3 text-xs text-muted-foreground sm:grid-cols-[1fr_1.4fr]">
            <p className="leading-relaxed">
              {selection.source === "arena"
                ? t("algorithmArena.whyArena", {
                    min: formatInterval(gradePreview.range.min_days),
                    max: formatInterval(gradePreview.range.max_days),
                  })
                : selection.source === "model"
                  ? t("algorithmArena.whyModel", { model: selectedLabel })
                  : t("algorithmArena.whyCustom")}
              {rMetric != null && (
                <span className="mt-2 block font-medium text-primary">
                  {t("algorithmArena.rMetric", {
                    value: `${rMetric >= 0 ? "+" : ""}${rMetric.toFixed(1)}`,
                  })}
                </span>
              )}
            </p>
            <div className="grid grid-cols-5 gap-1">
              {gradePreview.candidates.map((candidate) => (
                <div
                  key={candidate.model_id}
                  className="rounded-lg border border-border/70 bg-card px-2 py-2 text-center"
                >
                  <p className="font-semibold text-foreground">{candidate.label}</p>
                  <p className="mt-1 font-mono tabular-nums">
                    {formatInterval(candidate.interval_days)}
                  </p>
                  <p className="mt-0.5 text-[10px]">{candidate.weight_percent.toFixed(1)}%</p>
                </div>
              ))}
            </div>
          </div>
        </details>

        {(error || reviewPhase === "arena-error") && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            <ArrowCounterClockwise className="mt-0.5 shrink-0" size={17} />
            <div>
              <p className="font-semibold">{t("algorithmArena.commitFailed")}</p>
              <p className="mt-0.5 text-xs opacity-80">
                {error ?? t("algorithmArena.selectionSafe")}
              </p>
            </div>
          </div>
        )}
      </div>

      <div
        data-testid="arena-action-dock"
        className="relative z-10 flex shrink-0 flex-col-reverse gap-2 border-t border-border/70 bg-card pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] sm:flex-row sm:items-center sm:justify-between"
      >
        <p className="hidden text-xs text-muted-foreground sm:block">
          {t("algorithmArena.keyboardHint")}
        </p>
        <button
          type="button"
          disabled={!customValid || reviewPhase === "arena-committing"}
          onClick={() => void runCommit(confirmArenaSelection)}
          className="group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 font-semibold text-primary-foreground shadow-sm transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        >
          {reviewPhase === "arena-committing" ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />{" "}
              {t("algorithmArena.scheduling")}
            </>
          ) : (
            <>
              {t("algorithmArena.scheduleFor", { interval: formatInterval(chosenDays) })}{" "}
              <ArrowRight
                className="transition-transform group-hover:translate-x-0.5"
                weight="bold"
              />
            </>
          )}
        </button>
      </div>

      <div className="sr-only" aria-live="polite">
        {t("algorithmArena.selectedAnnouncement", {
          label: selectedLabel,
          interval: formatInterval(chosenDays),
          date: formatArenaDueDate(chosenDueAt ?? "", locale),
        })}
      </div>

      {coachStep > 0 && (
        <div
          className="absolute inset-x-4 bottom-[calc(5.75rem+env(safe-area-inset-bottom,0px))] z-20 mx-auto max-w-md rounded-2xl border border-primary/30 bg-popover p-4 text-popover-foreground shadow-2xl sm:bottom-24"
          role="status"
        >
          <div className="flex gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Sparkle weight="fill" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                {coachStep === 1
                  ? t("algorithmArena.coachTitle1")
                  : t("algorithmArena.coachTitle2")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {coachStep === 1 ? t("algorithmArena.coachBody1") : t("algorithmArena.coachBody2")}
              </p>
              <div className="mt-3 flex items-center gap-2">
                {coachStep === 1 ? (
                  <button
                    type="button"
                    onClick={() => setCoachStep(2)}
                    className="min-h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    {t("algorithmArena.showMe")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={completeCoach}
                    className="min-h-9 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
                  >
                    {t("algorithmArena.gotIt")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={completeCoach}
                  className="min-h-9 rounded-lg px-3 text-xs text-muted-foreground hover:bg-muted"
                >
                  {t("algorithmArena.dismiss")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
