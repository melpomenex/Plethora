/**
 * Central catalog of user-facing scheduler metadata.
 *
 * Persisted ids (`fsrs`, `sm2`, `sm5`, `sm8`, `sm15`, `sm18`, `sm20`) are a
 * compatibility contract (DB `algorithm_type`, settings, sync payloads) and are
 * intentionally NOT renamed here — only the presentation layer changes.
 * Rating semantics stay sourced from `supermemo-grades.ts`; this catalog is
 * display metadata only. View code must resolve labels through this module
 * instead of hardcoding algorithm names.
 */

import type { LearningSettings } from "../stores/settingsStore";
import { getRatingSchema, type RatingSchema } from "./supermemo-grades";

export type SchedulerId = LearningSettings["algorithm"];

export interface SchedulerInfo {
  /** Persisted identifier — never rename (compatibility contract). */
  id: SchedulerId;
  /** User-facing product name. */
  label: string;
  /** i18n key for the behavior-focused description shown in settings. */
  descriptionKey: string;
  /** Shown in compact statistics contexts. */
  shortLabel: string;
  /** True when the label is the third-party scheduler's own name. */
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
  sm2: {
    id: "sm2",
    label: "Plethora Classic",
    shortLabel: "Classic",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  sm5: {
    id: "sm5",
    label: "Plethora Classic 5",
    shortLabel: "Classic 5",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  sm8: {
    id: "sm8",
    label: "Plethora Classic 8",
    shortLabel: "Classic 8",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  sm15: {
    id: "sm15",
    label: "Plethora Classic 15",
    shortLabel: "Classic 15",
    descriptionKey: "learningSettings.classicDesc",
    thirdParty: false,
  },
  sm18: {
    id: "sm18",
    label: "Plethora Adaptive",
    shortLabel: "Adaptive",
    descriptionKey: "learningSettings.adaptiveDesc",
    thirdParty: false,
  },
  sm20: {
    id: "sm20",
    label: "Plethora Precision",
    shortLabel: "Precision",
    descriptionKey: "learningSettings.precisionDesc",
    thirdParty: false,
  },
};

/** Schedulers offered in the main learning settings selector, in order. */
export const SELECTABLE_SCHEDULERS: SchedulerInfo[] = [
  SCHEDULER_CATALOG.fsrs,
  SCHEDULER_CATALOG.sm18,
  SCHEDULER_CATALOG.sm20,
  SCHEDULER_CATALOG.sm2,
];

/** Legacy selectors expose the full historical id set. */
export const LEGACY_SELECTABLE_SCHEDULERS: SchedulerInfo[] = [
  SCHEDULER_CATALOG.fsrs,
  SCHEDULER_CATALOG.sm18,
  SCHEDULER_CATALOG.sm20,
  SCHEDULER_CATALOG.sm15,
  SCHEDULER_CATALOG.sm8,
  SCHEDULER_CATALOG.sm5,
  SCHEDULER_CATALOG.sm2,
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
// Arena competitor ids are serialized and order-stable (`sm2`, `sm15`, `sm19`,
// `sm20`, `fsrs`); only their display labels are Plethora product names. These
// MUST stay in sync with Rust `ArenaModelId::label()` / `ARENA_MODEL_NAMES` in
// `src-tauri/src/algorithms/sm20/`.

export type ArenaModelId = "sm2" | "sm15" | "sm19" | "sm20" | "fsrs";

export const ARENA_MODEL_LABELS: Record<ArenaModelId, string> = {
  sm2: "Plethora Classic",
  sm15: "Classic 15",
  sm19: "Classic 19",
  sm20: "Plethora Precision",
  fsrs: "FSRS",
};

/** Ordered arena labels matching SM20_ARENA_MODEL_ORDER in api/review.ts. */
export const ARENA_MODEL_LABEL_ORDER: string[] = [
  ARENA_MODEL_LABELS.sm2,
  ARENA_MODEL_LABELS.sm15,
  ARENA_MODEL_LABELS.sm19,
  ARENA_MODEL_LABELS.sm20,
  ARENA_MODEL_LABELS.fsrs,
];

export function arenaModelLabel(id: ArenaModelId | string | undefined): string {
  return ARENA_MODEL_LABELS[id as ArenaModelId] ?? String(id ?? "");
}
