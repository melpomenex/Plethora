/**
 * Central catalog of user-facing scheduler metadata.
 *
 * Rating semantics stay sourced from `rating-grades.ts`; this catalog is
 * display metadata only. View code must resolve labels through this module
 * instead of hardcoding algorithm names.
 */

import type { ArenaModelId, SchedulerId } from "./schedulerIdentity";
import { getRatingSchema, type RatingSchema } from "./rating-grades";

export type { ArenaModelId, SchedulerId } from "./schedulerIdentity";

export interface SchedulerInfo {
  id: SchedulerId;
  label: string;
  descriptionKey: string;
  shortLabel: string;
  thirdParty: boolean;
}

export const SCHEDULER_CATALOG: Record<SchedulerId, SchedulerInfo> = {
  fsrs: {
    id: "fsrs",
    label: "FSRS-6",
    shortLabel: "FSRS-6",
    descriptionKey: "learningSettings.fsrsDesc",
    thirdParty: true,
  },
  adaptive: {
    id: "adaptive",
    label: "Plethora Adaptive",
    shortLabel: "Adaptive",
    descriptionKey: "learningSettings.adaptiveDesc",
    thirdParty: false,
  },
  precision: {
    id: "precision",
    label: "Plethora Precision",
    shortLabel: "Precision",
    descriptionKey: "learningSettings.precisionDesc",
    thirdParty: false,
  },
  classic: {
    id: "classic",
    label: "Plethora Classic",
    shortLabel: "Classic",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_5: {
    id: "classic_5",
    label: "Plethora Classic 5",
    shortLabel: "Classic 5",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_8: {
    id: "classic_8",
    label: "Plethora Classic 8",
    shortLabel: "Classic 8",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_15: {
    id: "classic_15",
    label: "Plethora Classic 15",
    shortLabel: "Classic 15",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
};

/** Schedulers offered in the main learning settings selector, in order. */
export const SELECTABLE_SCHEDULERS: SchedulerInfo[] = [
  SCHEDULER_CATALOG.fsrs,
  SCHEDULER_CATALOG.adaptive,
  SCHEDULER_CATALOG.precision,
  SCHEDULER_CATALOG.classic,
];

/** Legacy selectors expose the full historical id set. */
export const LEGACY_SELECTABLE_SCHEDULERS: SchedulerInfo[] = [
  SCHEDULER_CATALOG.fsrs,
  SCHEDULER_CATALOG.adaptive,
  SCHEDULER_CATALOG.precision,
  SCHEDULER_CATALOG.classic_15,
  SCHEDULER_CATALOG.classic_8,
  SCHEDULER_CATALOG.classic_5,
  SCHEDULER_CATALOG.classic,
];

export function schedulerInfo(id: SchedulerId | string | undefined): SchedulerInfo | undefined {
  return SCHEDULER_CATALOG[id as SchedulerId];
}

export function schedulerLabel(id: SchedulerId | string | undefined): string {
  return schedulerInfo(id)?.label ?? String(id ?? "");
}

export function schedulerShortLabel(id: SchedulerId | string | undefined): string {
  return schedulerInfo(id)?.shortLabel ?? String(id ?? "");
}

export function schedulerDescriptionKey(id: SchedulerId | string | undefined): string {
  return schedulerInfo(id)?.descriptionKey ?? "";
}

export function schedulerRatingSchema(id: SchedulerId | undefined): RatingSchema {
  return getRatingSchema(id);
}

// ── Algorithm Arena model labels ─────────────────────────────────────────────
// Arena competitor ids are serialized and order-stable (`m1`–`m5`); only their
// display labels are Plethora product names. Keep in sync with Rust
// `ArenaModelId::label()` in `src-tauri/src/algorithms/precision/mod.rs`.

export const ARENA_MODEL_LABELS: Record<ArenaModelId, string> = {
  m1: "Plethora Classic",
  m2: "Classic 15",
  m3: "Classic 19",
  m4: "Plethora Precision",
  m5: "FSRS",
};

/** Ordered arena labels matching ARENA_MODEL_ORDER in api/review.ts. */
export const ARENA_MODEL_LABEL_ORDER: string[] = [
  ARENA_MODEL_LABELS.m1,
  ARENA_MODEL_LABELS.m2,
  ARENA_MODEL_LABELS.m3,
  ARENA_MODEL_LABELS.m4,
  ARENA_MODEL_LABELS.m5,
];

export function arenaModelLabel(id: ArenaModelId | string | undefined): string {
  return ARENA_MODEL_LABELS[id as ArenaModelId] ?? String(id ?? "");
}
