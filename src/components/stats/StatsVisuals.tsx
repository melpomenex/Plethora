import { useMemo } from "react";
import type { ItemStatsEvent, RatingDistribution } from "../../api/item-stats";
import { useI18n } from "../../lib/i18n";
import { formatDate } from "../../utils/date";
import { formatDurationCompact } from "../../utils/date";

/**
 * Hand-rolled statistics visuals.
 *
 * These are CSS and inline SVG in the style of `ReviewHeatmap`, which uses no
 * charting library at all — `recharts` is reserved for the interval-growth and
 * retention curves, where it earns its weight. Keeping the simple visuals
 * library-free means the modal's chunk stays small even before code-splitting
 * does its part.
 *
 * Every chart here carries an equivalent table, marked up for screen readers,
 * so the same values are available without sight.
 */

const RATING_KEYS = ["again", "hard", "good", "easy"] as const;

const RATING_COLORS: Record<(typeof RATING_KEYS)[number], string> = {
  again: "bg-red-500/70",
  hard: "bg-amber-500/70",
  good: "bg-emerald-500/70",
  easy: "bg-sky-500/70",
};

interface RatingDistributionChartProps {
  distribution: RatingDistribution;
}

export function RatingDistributionChart({ distribution }: RatingDistributionChartProps) {
  const { t } = useI18n();

  const total = RATING_KEYS.reduce((sum, key) => sum + distribution[key], 0);
  const labels: Record<(typeof RATING_KEYS)[number], string> = {
    again: t("queue.again"),
    hard: t("queue.hard"),
    good: t("queue.good"),
    easy: t("queue.easy"),
  };

  if (total === 0) {
    return <div className="text-xs text-muted-foreground">{t("itemStats.chart.noData")}</div>;
  }

  return (
    <figure className="space-y-2">
      <figcaption className="text-xs text-muted-foreground">
        {t("itemStats.chart.ratingDistribution")}
      </figcaption>

      {/* The bars are decorative; the table below carries the same numbers. */}
      <div className="space-y-1" aria-hidden="true">
        {RATING_KEYS.map((key) => {
          const count = distribution[key];
          const share = total === 0 ? 0 : (count / total) * 100;
          return (
            <div key={key} className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 text-muted-foreground">{labels[key]}</span>
              <span className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                <span
                  className={`block h-full rounded-full ${RATING_COLORS[key]}`}
                  style={{ width: `${share}%` }}
                />
              </span>
              <span className="w-6 shrink-0 text-right font-semibold text-foreground">{count}</span>
            </div>
          );
        })}
      </div>

      <table className="sr-only">
        <caption>
          {t("itemStats.chart.dataTable", { chart: t("itemStats.chart.ratingDistribution") })}
        </caption>
        <tbody>
          {RATING_KEYS.map((key) => (
            <tr key={key}>
              <th scope="row">{labels[key]}</th>
              <td>
                {t("itemStats.chart.ratingCount", {
                  rating: labels[key],
                  count: distribution[key],
                  total,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

interface ActivityStripProps {
  events: ItemStatsEvent[];
  /** Indexes into `events` that were lapses, marked on the strip. */
  lapsePositions: number[];
}

/**
 * A compact strip of every recorded interaction, one cell per event, shaded by
 * how long it lasted and marked where the item lapsed.
 */
export function ActivityStrip({ events, lapsePositions }: ActivityStripProps) {
  const { t } = useI18n();
  const lapses = useMemo(() => new Set(lapsePositions), [lapsePositions]);

  const maxSeconds = useMemo(
    () => events.reduce((max, event) => Math.max(max, event.activeSeconds ?? 0), 0),
    [events],
  );

  if (events.length === 0) {
    return <div className="text-xs text-muted-foreground">{t("itemStats.history.noEvents")}</div>;
  }

  return (
    <figure className="space-y-2">
      <figcaption className="text-xs text-muted-foreground">
        {t("itemStats.chart.activityStrip")}
      </figcaption>

      <div className="flex flex-wrap gap-1" aria-hidden="true">
        {events.map((event, index) => {
          const seconds = event.activeSeconds ?? 0;
          // Opacity, not colour, carries magnitude — the lapse marker needs
          // colour to itself so it stays distinguishable.
          const intensity = maxSeconds > 0 ? 0.25 + (seconds / maxSeconds) * 0.75 : 0.4;
          return (
            <span
              key={`${event.at}-${index}`}
              className={`h-3 w-3 rounded-sm ${
                lapses.has(index) ? "bg-red-500" : "bg-primary"
              }`}
              style={{ opacity: lapses.has(index) ? 1 : intensity }}
              title={`${formatDate(event.at)} · ${formatDurationCompact(seconds)}`}
            />
          );
        })}
      </div>

      <table className="sr-only">
        <caption>
          {t("itemStats.chart.dataTable", { chart: t("itemStats.chart.activityStrip") })}
        </caption>
        <thead>
          <tr>
            <th scope="col">{t("itemStats.history.columnDate")}</th>
            <th scope="col">{t("itemStats.history.columnDuration")}</th>
            <th scope="col">{t("itemStats.history.lapseMarker")}</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event, index) => (
            <tr key={`${event.at}-row-${index}`}>
              <td>{formatDate(event.at)}</td>
              <td>{formatDurationCompact(event.activeSeconds ?? 0)}</td>
              <td>{lapses.has(index) ? t("itemStats.history.lapseMarker") : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
