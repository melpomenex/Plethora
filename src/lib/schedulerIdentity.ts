/**
 * Canonical Plethora scheduler and arena model identifiers.
 *
 * Legacy SuperMemo-derived ids are recognized only through the normalizers in
 * this module — application logic must use canonical ids everywhere else.
 */

export type SchedulerId =
  | "fsrs"
  | "adaptive"
  | "precision"
  | "classic"
  | "classic_5"
  | "classic_8"
  | "classic_15";

export type ArenaModelId = "m1" | "m2" | "m3" | "m4" | "m5";

const SCHEDULER_IDS: readonly SchedulerId[] = [
  "fsrs",
  "adaptive",
  "precision",
  "classic",
  "classic_5",
  "classic_8",
  "classic_15",
];

const ARENA_MODEL_IDS: readonly ArenaModelId[] = ["m1", "m2", "m3", "m4", "m5"];

/** Legacy persisted scheduler ids → canonical SchedulerId. */
export const LEGACY_SCHEDULER_IDS = {
  sm2: "classic",
  sm5: "classic_5",
  sm8: "classic_8",
  sm15: "classic_15",
  sm18: "adaptive",
  sm20: "precision",
  classic_2: "classic",
  classic5: "classic_5",
  classic15: "classic_15",
} as const satisfies Record<string, SchedulerId>;

const LEGACY_ARENA_MODEL_IDS: Record<string, ArenaModelId> = {
  sm2: "m1",
  sm15: "m2",
  sm19: "m3",
  sm20: "m4",
  fsrs: "m5",
};

function isSchedulerId(raw: string): raw is SchedulerId {
  return (SCHEDULER_IDS as readonly string[]).includes(raw);
}

function isArenaModelId(raw: string): raw is ArenaModelId {
  return (ARENA_MODEL_IDS as readonly string[]).includes(raw);
}

export function normalizeSchedulerId(raw: string): SchedulerId {
  if (isSchedulerId(raw)) return raw;
  const mapped = LEGACY_SCHEDULER_IDS[raw as keyof typeof LEGACY_SCHEDULER_IDS];
  if (mapped) return mapped;
  return "fsrs";
}

/** Production scheduler ids — the user-facing schedulers. */
export const PRODUCTION_SCHEDULER_IDS: readonly SchedulerId[] = [
  "fsrs",
  "precision",
  "adaptive",
  "classic",
];

export const PRODUCTION_SCHEDULER_ID = "fsrs" as const satisfies SchedulerId;

/** Maps any persisted or legacy scheduler id to a supported production scheduler. */
export function normalizeToProductionScheduler(raw: string | undefined): SchedulerId {
  const id = normalizeSchedulerId(raw ?? PRODUCTION_SCHEDULER_ID);
  return isProductionScheduler(id) ? id : PRODUCTION_SCHEDULER_ID;
}

export function isProductionScheduler(raw: string | undefined): boolean {
  const id = normalizeSchedulerId(raw ?? PRODUCTION_SCHEDULER_ID);
  return (PRODUCTION_SCHEDULER_IDS as readonly string[]).includes(id);
}

export function normalizeArenaModelId(raw: string): ArenaModelId {
  if (isArenaModelId(raw)) return raw;
  const mapped = LEGACY_ARENA_MODEL_IDS[raw];
  if (mapped) return mapped;
  return "m1";
}

export function usesSixGradeScale(raw: string | undefined): boolean {
  const id = normalizeSchedulerId(raw ?? "fsrs");
  return id === "adaptive" || id === "precision";
}

export function isAdaptiveScheduler(raw: string | undefined): boolean {
  return normalizeSchedulerId(raw ?? "fsrs") === "adaptive";
}

export function isPrecisionScheduler(raw: string | undefined): boolean {
  return normalizeSchedulerId(raw ?? "fsrs") === "precision";
}

export function isClassicScheduler(raw: string | undefined): boolean {
  const id = normalizeSchedulerId(raw ?? "fsrs");
  return (
    id === "classic" ||
    id === "classic_5" ||
    id === "classic_8" ||
    id === "classic_15"
  );
}

/**
 * Legacy persisted learning-setting keys from before the canonical rename.
 * Their literals are confined to this exempt module (the terminology gate
 * forbids them elsewhere); settings rehydration reads them to migrate old
 * persisted state onto the canonical field names.
 */
export const LEGACY_LEARNING_KEYS = {
  pureKernel: "sm20PureM4",
  arenaReviewMode: "sm20ArenaReviewMode",
} as const;
