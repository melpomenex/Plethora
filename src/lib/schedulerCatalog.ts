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
export {
  isProductionScheduler,
  normalizeToProductionScheduler,
  PRODUCTION_SCHEDULER_ID,
} from "./schedulerIdentity";

export type SchedulerLifecycle = "production" | "legacy";

/** User-visible lifecycle status for each canonical scheduler id. */
export const SCHEDULER_LIFECYCLE: Record<SchedulerId, SchedulerLifecycle> = {
  fsrs: "production",
  precision: "production",
  adaptive: "production",
  classic: "production",
  classic_5: "legacy",
  classic_8: "legacy",
  classic_15: "legacy",
};

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
    label: "FSRS-7",
    shortLabel: "FSRS-7",
    descriptionKey: "learningSettings.fsrsDesc",
    thirdParty: true,
  },
  precision: {
    id: "precision",
    label: "SM-20",
    shortLabel: "SM-20",
    descriptionKey: "learningSettings.precisionDesc",
    thirdParty: false,
  },
  adaptive: {
    id: "adaptive",
    label: "SM-18",
    shortLabel: "SM-18",
    descriptionKey: "learningSettings.adaptiveDesc",
    thirdParty: false,
  },
  classic: {
    id: "classic",
    label: "SM-2",
    shortLabel: "SM-2",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_5: {
    id: "classic_5",
    label: "SM-5",
    shortLabel: "SM-5",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_8: {
    id: "classic_8",
    label: "SM-8",
    shortLabel: "SM-8",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  classic_15: {
    id: "classic_15",
    label: "SM-15",
    shortLabel: "SM-15",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
};

/** Schedulers offered in the main learning settings selector, in order. */
export const SELECTABLE_SCHEDULERS: SchedulerInfo[] = [
  SCHEDULER_CATALOG.fsrs,
  SCHEDULER_CATALOG.precision,
  SCHEDULER_CATALOG.adaptive,
  SCHEDULER_CATALOG.classic,
];

/** Legacy selectors expose the full historical id set. */
export const LEGACY_SELECTABLE_SCHEDULERS: SchedulerInfo[] = [
  SCHEDULER_CATALOG.fsrs,
  SCHEDULER_CATALOG.precision,
  SCHEDULER_CATALOG.adaptive,
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
// display labels are algorithm names. Keep in sync with Rust
// `ArenaModelId::label()` in `src-tauri/src/arena_model_identity.rs`.

export const ARENA_MODEL_LABELS: Record<ArenaModelId, string> = {
  m1: "SM-2",
  m2: "SM-15",
  m3: "SM-19",
  m4: "SM-20",
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
