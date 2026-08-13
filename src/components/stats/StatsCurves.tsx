import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { IntervalPoint, RetentionPoint } from "../../api/item-stats";
import { useI18n } from "../../lib/i18n";

/**
 * The two curves that earn a charting library: interval growth across an
 * item's repetitions, and its own retention decay.
 *
 * `recharts` already has its own manual chunk (see `vite.config.ts`), and this
 * module is only reachable from the lazily-imported modal, so nothing here can
 * grow the entry chunk.
 *
 * Both charts carry a screen-reader table with the same values, and both
 * disable their entry animation when the user has asked for reduced motion.
 */

interface CurveProps {
  /** Animations are suppressed under `prefers-reduced-motion`. */
  animate: boolean;
}

export function IntervalGrowthChart({
  data,
  animate,
}: CurveProps & { data: IntervalPoint[] }) {
  const { t } = useI18n();

  if (data.length < 2) {
    return <div className="text-xs text-muted-foreground">{t("itemStats.chart.noData")}</div>;
  }

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">
        {t("itemStats.schedule.intervalGrowth")}
      </figcaption>

      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="repetition" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="intervalDays"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={animate}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>
          {t("itemStats.chart.dataTable", { chart: t("itemStats.schedule.intervalGrowth") })}
        </caption>
        <tbody>
          {data.map((point) => (
            <tr key={point.repetition}>
              <th scope="row">
                {t("itemStats.schedule.repetitionLabel", { count: point.repetition })}
              </th>
              <td>{t("itemStats.schedule.days", { count: Math.round(point.intervalDays) })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function RetentionCurveChart({
  data,
  animate,
}: CurveProps & { data: RetentionPoint[] }) {
  const { t } = useI18n();

  if (data.length < 2) {
    return <div className="text-xs text-muted-foreground">{t("itemStats.chart.noData")}</div>;
  }

  const chartData = data.map((point) => ({
    day: point.day,
    retention: Math.round(point.retention * 100),
  }));

  // A table with one row per day would be 60 rows of noise to listen through;
  // a decade sample conveys the same shape.
  const sampled = chartData.filter((point, index) => index % 10 === 0 || index === chartData.length - 1);

  return (
    <figure className="space-y-1">
      <figcaption className="text-xs text-muted-foreground">
        {t("itemStats.schedule.retentionCurve")}
      </figcaption>

      <div aria-hidden="true">
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey="retention"
              stroke="hsl(var(--chart-2, #22c55e))"
              strokeWidth={2}
              dot={false}
              isAnimationActive={animate}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <table className="sr-only">
        <caption>
          {t("itemStats.chart.dataTable", { chart: t("itemStats.schedule.retentionCurve") })}
        </caption>
        <tbody>
          {sampled.map((point) => (
            <tr key={point.day}>
              <th scope="row">{t("itemStats.schedule.days", { count: point.day })}</th>
              <td>{point.retention}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
