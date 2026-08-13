/**
 * Presentation rules for the three states a statistics metric can be in.
 *
 * The payload distinguishes them so the UI does not have to guess, and the
 * spec forbids collapsing them: a metric that genuinely reads `0` must show
 * `0`, one that predates tracking must say so, and one that does not apply to
 * the item type must be omitted rather than shown empty. A bare `--` for all
 * three is exactly what this replaces.
 */

import type { Metric } from "../api/item-stats";

export type MetricPresentation<T> =
  /** Render this value — including a genuine zero. */
  | { kind: "value"; value: T }
  /** Render an explicit "not recorded" note. Never substitute zero. */
  | { kind: "notRecorded" }
  /** Render nothing at all; the metric does not exist for this item type. */
  | { kind: "omit" };

export function presentMetric<T>(
  metric: Metric<T> | null | undefined,
): MetricPresentation<T> {
  if (!metric) return { kind: "omit" };

  switch (metric.state) {
    case "value":
      return { kind: "value", value: metric.value };
    case "untracked":
      return { kind: "notRecorded" };
    case "notApplicable":
      return { kind: "omit" };
    default:
      // An unknown state from a newer backend is safest omitted: showing an
      // unlabelled blank would be the placeholder the spec rules out.
      return { kind: "omit" };
  }
}

/**
 * Format a metric for display.
 *
 * Returns `null` when the metric should be omitted entirely, so a caller can
 * write `if (text === null) return null` and skip the row.
 */
export function formatMetric<T>(
  metric: Metric<T> | null | undefined,
  format: (value: T) => string,
  notRecordedLabel: string,
): string | null {
  const presentation = presentMetric(metric);
  switch (presentation.kind) {
    case "value":
      return format(presentation.value);
    case "notRecorded":
      return notRecordedLabel;
    case "omit":
      return null;
  }
}

/** Whether a metric has a real value to render. */
export function hasValue<T>(metric: Metric<T> | null | undefined): boolean {
  return presentMetric(metric).kind === "value";
}
