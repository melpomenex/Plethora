import { useEffect, useMemo, useRef, useState } from "react";
import { CircleNotch, Warning, X } from "@phosphor-icons/react";
import type {
  ItemContentStats,
  ItemHistoryStats,
  ItemScheduleStats,
  ItemStatsDetail,
  ItemTimeStats,
  Metric,
  StatsItemType,
} from "../../api/item-stats";
import { previewReviewIntervals, formatInterval, type PreviewIntervals } from "../../api/review";
import { useItemStats } from "../../hooks/useItemStats";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { formatDate, formatDateTime, formatDuration, formatDurationCompact } from "../../utils/date";
import { formatMetric } from "../../utils/itemStats";
import { ActivityStrip, RatingDistributionChart } from "./StatsVisuals";
import { IntervalGrowthChart, RetentionCurveChart } from "./StatsCurves";

/**
 * The full Item Statistics view.
 *
 * Imported lazily from the Details popover's "Full stats" action so neither
 * this module nor the charting it pulls in lands in the entry chunk.
 *
 * Sections with no data for the current item type are omitted entirely rather
 * than rendered empty, and every metric shows *why* it has no value: a real
 * number (including zero), an explicit "not recorded" note, or nothing at all.
 */

export interface ItemStatsModalProps {
  itemType: StatsItemType;
  itemId: string;
  title: string;
  onClose: () => void;
}

/** Elements a focus trap should cycle through. */
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const handler = (event: MediaQueryListEvent) => setPrefers(event.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  return prefers;
}

interface StatRowProps {
  label: string;
  /** `null` omits the row entirely — the metric does not apply here. */
  value: string | null;
  /** Rendered muted, so "not recorded" never reads as a real measurement. */
  isMuted?: boolean;
}

function StatRow({ label, value, isMuted }: StatRowProps) {
  if (value === null) return null;
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-sm font-semibold ${isMuted ? "text-muted-foreground italic" : "text-foreground"}`}>
        {value}
      </dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground border-b border-border pb-1">{title}</h3>
      {children}
    </section>
  );
}

/** Whether a metric should render as the muted "not recorded" note. */
function isUntracked<T>(metric: Metric<T> | undefined | null): boolean {
  return metric?.state === "untracked";
}

function TimeSection({ time, itemType }: { time: ItemTimeStats; itemType: StatsItemType }) {
  const { t } = useI18n();
  const notRecorded = t("itemStats.notRecorded");
  const duration = (metric: Metric<number>) => formatMetric(metric, formatDuration, notRecorded);

  // Actual against estimated is the comparison a reader actually wants; it
  // only exists when both halves do.
  const actual = time.totalActiveSeconds.state === "value" ? time.totalActiveSeconds.value : null;
  const estimated =
    time.estimatedReadingSeconds.state === "value" ? time.estimatedReadingSeconds.value : null;
  const comparison =
    itemType === "document" && actual !== null && estimated !== null && estimated > 0
      ? `${formatDurationCompact(actual)} / ${formatDurationCompact(estimated)}`
      : null;

  return (
    <Section title={t("itemStats.section.time")}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatRow
          label={t("itemStats.time.total")}
          value={duration(time.totalActiveSeconds)}
          isMuted={isUntracked(time.totalActiveSeconds)}
        />
        <StatRow
          label={t("itemStats.time.queue")}
          value={duration(time.queueSeconds)}
          isMuted={isUntracked(time.queueSeconds)}
        />
        <StatRow
          label={t("itemStats.time.reader")}
          value={duration(time.readerSeconds)}
          isMuted={isUntracked(time.readerSeconds)}
        />
        <StatRow
          label={t("itemStats.time.sessionCount")}
          value={formatMetric(time.sessionCount, (value) => `${value}`, notRecorded)}
          isMuted={isUntracked(time.sessionCount)}
        />
        <StatRow
          label={t("itemStats.time.longestSession")}
          value={duration(time.longestSessionSeconds)}
          isMuted={isUntracked(time.longestSessionSeconds)}
        />
        <StatRow
          label={t("itemStats.time.averageSession")}
          value={duration(time.averageSessionSeconds)}
          isMuted={isUntracked(time.averageSessionSeconds)}
        />
        <StatRow
          label={t("itemStats.time.medianSession")}
          value={duration(time.medianSessionSeconds)}
          isMuted={isUntracked(time.medianSessionSeconds)}
        />
        <StatRow
          label={t("itemStats.time.estimatedReading")}
          value={comparison ?? duration(time.estimatedReadingSeconds)}
          isMuted={comparison === null && isUntracked(time.estimatedReadingSeconds)}
        />
      </dl>
    </Section>
  );
}

function ScheduleSection({
  schedule,
  preview,
  animate,
}: {
  schedule: ItemScheduleStats;
  preview: PreviewIntervals | null;
  animate: boolean;
}) {
  const { t } = useI18n();
  const notRecorded = t("itemStats.notRecorded");
  const number = (metric: Metric<number>) =>
    formatMetric(metric, (value) => (Math.round(value * 100) / 100).toString(), notRecorded);
  const days = (metric: Metric<number>) =>
    formatMetric(metric, (value) => formatInterval(value), notRecorded);

  return (
    <Section title={t("itemStats.section.schedule")}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatRow
          label={t("itemStats.schedule.stability")}
          value={number(schedule.stability)}
          isMuted={isUntracked(schedule.stability)}
        />
        <StatRow
          label={t("itemStats.schedule.difficulty")}
          value={number(schedule.difficulty)}
          isMuted={isUntracked(schedule.difficulty)}
        />
        <StatRow
          label={t("itemStats.schedule.retrievability")}
          value={formatMetric(
            schedule.retrievability,
            (value) => `${Math.round(value * 100)}%`,
            notRecorded,
          )}
          isMuted={isUntracked(schedule.retrievability)}
        />
        <StatRow
          label={t("itemStats.schedule.currentInterval")}
          value={days(schedule.currentIntervalDays)}
          isMuted={isUntracked(schedule.currentIntervalDays)}
        />
        <StatRow
          label={t("itemStats.schedule.nextInterval")}
          value={days(schedule.nextIntervalDays)}
          isMuted={isUntracked(schedule.nextIntervalDays)}
        />
        <StatRow
          label={t("itemStats.schedule.dueDate")}
          value={formatMetric(schedule.dueDate, (value) => formatDateTime(value), notRecorded)}
          isMuted={isUntracked(schedule.dueDate)}
        />
        <StatRow
          label={t("itemStats.schedule.intervalModifier")}
          value={formatMetric(
            schedule.intervalModifier,
            (value) => `${value.toFixed(1)}x`,
            notRecorded,
          )}
          isMuted={isUntracked(schedule.intervalModifier)}
        />
      </dl>

      {preview && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {t("itemStats.schedule.previewIntervals")}
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs">
            {(
              [
                ["again", t("queue.again")],
                ["hard", t("queue.hard")],
                ["good", t("queue.good")],
                ["easy", t("queue.easy")],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="rounded-md bg-muted/60 p-2">
                <div className="text-muted-foreground">{label}</div>
                <div className="font-semibold text-foreground">{formatInterval(preview[key])}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <IntervalGrowthChart data={schedule.intervalHistory} animate={animate} />
        <RetentionCurveChart data={schedule.retentionCurve} animate={animate} />
      </div>
    </Section>
  );
}

function HistorySection({ history }: { history: ItemHistoryStats }) {
  const { t } = useI18n();
  const notRecorded = t("itemStats.notRecorded");
  const lapses = new Set(history.lapsePositions);

  const surfaceLabel = (surface: string) => {
    if (surface === "reader") return t("itemStats.history.surface.reader");
    if (surface === "review") return t("itemStats.history.surface.review");
    return t("itemStats.history.surface.queue");
  };

  // An empty string, not a dash: a reading session genuinely has no rating,
  // and the spec rules out bare placeholders for a metric that does not apply.
  // In a table the equivalent of omitting the metric is an empty cell.
  const ratingLabel = (rating: number | null) => {
    switch (rating) {
      case 1:
        return t("queue.again");
      case 2:
        return t("queue.hard");
      case 3:
        return t("queue.good");
      case 4:
        return t("queue.easy");
      default:
        return "";
    }
  };

  return (
    <Section title={t("itemStats.section.history")}>
      {history.isLeech && (
        <div
          className="flex items-start gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600"
          data-testid="leech-indicator"
        >
          <Warning className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">{t("itemStats.history.leech")}</div>
            <div>
              {t("itemStats.history.leechDescription", {
                count: history.lapses.state === "value" ? history.lapses.value : 0,
                threshold: history.leechThreshold,
              })}
            </div>
          </div>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatRow
          label={t("itemStats.history.lapses")}
          value={formatMetric(history.lapses, (value) => `${value}`, notRecorded)}
          isMuted={isUntracked(history.lapses)}
        />
      </dl>

      <div className="grid gap-4 sm:grid-cols-2">
        <RatingDistributionChart distribution={history.ratingDistribution} />
        <ActivityStrip events={history.events} lapsePositions={history.lapsePositions} />
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">{t("itemStats.history.timeline")}</div>
        {history.events.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            {t("itemStats.history.noEvents")}
          </div>
        ) : (
          <div className="max-h-64 overflow-auto rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/80">
                <tr>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    {t("itemStats.history.columnDate")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    {t("itemStats.history.columnDuration")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    {t("itemStats.history.columnRating")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    {t("itemStats.history.columnInterval")}
                  </th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">
                    {t("itemStats.history.columnSurface")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {history.events.map((event, index) => (
                  <tr
                    key={`${event.at}-${index}`}
                    className={`border-t border-border ${lapses.has(index) ? "bg-red-500/5" : ""}`}
                  >
                    <td className="px-2 py-1">{formatDate(event.at)}</td>
                    <td className="px-2 py-1">
                      {event.activeSeconds === null
                        ? notRecorded
                        : formatDurationCompact(event.activeSeconds)}
                    </td>
                    <td className="px-2 py-1">
                      {ratingLabel(event.rating)}
                      {lapses.has(index) && (
                        <span className="ml-1 text-red-500">
                          ({t("itemStats.history.lapseMarker")})
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1">
                      {/* Empty, not a dash: a reading session produces no
                          interval, and that is an omission rather than an
                          unknown value. */}
                      {event.resultingIntervalDays === null
                        ? ""
                        : formatInterval(event.resultingIntervalDays)}
                    </td>
                    <td className="px-2 py-1">{surfaceLabel(event.surface)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

function ContentSection({ content }: { content: ItemContentStats }) {
  const { t } = useI18n();
  const notRecorded = t("itemStats.notRecorded");
  const count = (metric: Metric<number>) => formatMetric(metric, (value) => `${value}`, notRecorded);

  return (
    <Section title={t("itemStats.section.content")}>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatRow
          label={t("itemStats.content.created")}
          value={formatMetric(content.createdAt, (value) => formatDate(value), notRecorded)}
          isMuted={isUntracked(content.createdAt)}
        />
        <StatRow
          label={t("itemStats.content.firstSeen")}
          value={formatMetric(content.firstSeenAt, (value) => formatDate(value), notRecorded)}
          isMuted={isUntracked(content.firstSeenAt)}
        />
        <StatRow
          label={t("itemStats.content.age")}
          value={formatMetric(
            content.ageDays,
            (value) => t("itemStats.content.ageValue", { count: value }),
            notRecorded,
          )}
          isMuted={isUntracked(content.ageDays)}
        />
        <StatRow
          label={t("itemStats.content.words")}
          value={count(content.wordCount)}
          isMuted={isUntracked(content.wordCount)}
        />
        <StatRow
          label={t("itemStats.content.characters")}
          value={count(content.characterCount)}
          isMuted={isUntracked(content.characterCount)}
        />
        <StatRow
          label={t("itemStats.content.progress")}
          value={formatMetric(
            content.progressPercent,
            (value) => `${Math.round(value)}%`,
            notRecorded,
          )}
          isMuted={isUntracked(content.progressPercent)}
        />
        <StatRow
          label={t("itemStats.content.extractsYielded")}
          value={count(content.extractsYielded)}
          isMuted={isUntracked(content.extractsYielded)}
        />
        <StatRow
          label={t("itemStats.content.flashcardsYielded")}
          value={count(content.flashcardsYielded)}
          isMuted={isUntracked(content.flashcardsYielded)}
        />
        <StatRow
          label={t("itemStats.content.priority")}
          value={formatMetric(
            content.priorityScore,
            (value) => `${Math.round(value * 10) / 10}`,
            notRecorded,
          )}
          isMuted={isUntracked(content.priorityScore)}
        />
        <StatRow
          label={t("itemStats.content.prioritySlider")}
          value={count(content.prioritySlider)}
          isMuted={isUntracked(content.prioritySlider)}
        />
        <StatRow
          label={t("itemStats.content.category")}
          value={formatMetric(content.category, (value) => value, notRecorded)}
          isMuted={isUntracked(content.category)}
        />
      </dl>

      {content.tags.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t("itemStats.content.tags")}</div>
          <div className="flex flex-wrap gap-1">
            {content.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

export function ItemStatsModal({ itemType, itemId, title, onClose }: ItemStatsModalProps) {
  const { t } = useI18n();
  const { settings } = useSettingsStore();
  const prefersReducedMotion = usePrefersReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<PreviewIntervals | null>(null);

  const { detail, isDetailLoading, detailError } = useItemStats({
    itemType,
    itemId,
    isSummaryOpen: false,
    isDetailOpen: true,
    leechThreshold: settings.learning.leechThreshold,
  });

  // The per-rating preview already has a command of its own and only exists
  // for flashcards; reusing it beats duplicating scheduler maths in the stats
  // read path.
  useEffect(() => {
    if (itemType !== "learning-item") {
      setPreview(null);
      return;
    }
    let active = true;
    previewReviewIntervals(itemId)
      .then((result) => {
        if (active) setPreview(result);
      })
      .catch(() => {
        if (active) setPreview(null);
      });
    return () => {
      active = false;
    };
  }, [itemType, itemId]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Focus stays inside until dismissal; Escape closes, and the caller returns
  // focus to the control that opened this.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const container = dialogRef.current;
      if (!container) return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const sections = useMemo(() => buildSections(detail), [detail]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("itemStats.modalTitle", { title })}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl border border-border bg-popover text-popover-foreground shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="truncate text-sm font-semibold">
            {t("itemStats.modalTitle", { title })}
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={t("itemStats.close")}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-auto px-4 py-4">
          {isDetailLoading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CircleNotch className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              {t("itemStats.loading")}
            </div>
          )}

          {detailError && <div className="text-xs text-destructive">{t("itemStats.error")}</div>}

          {detail && sections.length === 0 && (
            <div className="text-xs text-muted-foreground italic">{t("itemStats.noData")}</div>
          )}

          {detail?.time && <TimeSection time={detail.time} itemType={itemType} />}
          {detail?.schedule && (
            <ScheduleSection
              schedule={detail.schedule}
              preview={preview}
              animate={!prefersReducedMotion}
            />
          )}
          {detail?.history && <HistorySection history={detail.history} />}
          {detail?.content && <ContentSection content={detail.content} />}

          {detail?.rankByTimeInvested.state === "value" && (
            <div className="text-xs text-muted-foreground">
              {t("itemStats.time.rank")}:{" "}
              <span className="font-semibold text-foreground">
                {t("itemStats.time.rankValue", {
                  rank: detail.rankByTimeInvested.value.rank,
                  total: detail.rankByTimeInvested.value.total,
                })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Which sections this item type actually has data for. */
function buildSections(detail: ItemStatsDetail | null): string[] {
  if (!detail) return [];
  const present: string[] = [];
  if (detail.time) present.push("time");
  if (detail.schedule) present.push("schedule");
  if (detail.history) present.push("history");
  if (detail.content) present.push("content");
  return present;
}
