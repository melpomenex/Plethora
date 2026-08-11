/**
 * Shared Schedule data-grid column definition (openspec change
 * unify-tag-editing-and-align-schedule-grid, task 5.1).
 *
 * The sticky header, virtualized rows, and data-grid expanded detail ALL use
 * this single track definition and these semantic keys, so corresponding
 * labels and values stay on the same geometric tracks under vertical overflow,
 * horizontal overflow, and pane resize. `GRID_COLUMNS` is the canonical CSS
 * `grid-template-columns` value; `GRID_COLUMN_KEYS` describes each track's
 * semantic meaning in order.
 */

export type ScheduleGridColumnKey =
  | "expand"
  | "title"
  | "type"
  | "priority"
  | "interval"
  | "reps"
  | "lapses"
  | "due"
  | "difficulty"
  | "stability"
  | "retrievability"
  | "progress"
  | "estimatedTime"
  | "actions";

/**
 * 14 tracks. The title track keeps a readable minimum (`minmax(160px, 1fr)`)
 * so labels never compress into illegible text; the grid as a whole scrolls
 * horizontally inside its pane when the pane is narrower.
 */
export const GRID_COLUMNS =
  "1.5rem minmax(160px, 1fr) 2.5rem 3rem 4rem 3rem 3rem 5rem 4.5rem 6rem 5rem 4rem 6.5rem 6.5rem";

/** Semantic keys for each track of {@link GRID_COLUMNS}, in order. */
export const GRID_COLUMN_KEYS: ScheduleGridColumnKey[] = [
  "expand",
  "title",
  "type",
  "priority",
  "interval",
  "reps",
  "lapses",
  "due",
  "difficulty",
  "stability",
  "retrievability",
  "progress",
  "estimatedTime",
  "actions",
];

/**
 * The metric columns duplicated in the expanded data-grid detail, with their
 * track index (0-based) into {@link GRID_COLUMN_KEYS}. Used by the grid-mode
 * `ScheduleItemDetails` to place duplicate metrics on their semantic columns.
 */
export const GRID_METRIC_COLUMNS: { key: ScheduleGridColumnKey; index: number }[] = [
  { key: "priority", index: 3 },
  { key: "interval", index: 4 },
  { key: "reps", index: 5 },
  { key: "lapses", index: 6 },
  { key: "due", index: 7 },
  { key: "difficulty", index: 8 },
  { key: "stability", index: 9 },
  { key: "retrievability", index: 10 },
  { key: "progress", index: 11 },
  { key: "estimatedTime", index: 12 },
];
