/**
 * Curated ranking presets.
 *
 * A preset is nothing but a named set of knob values — there is no preset
 * mechanism, no preset-only code path, and nothing a preset can express that six
 * sliders cannot. That is the property that makes "presets are fully
 * overridable" true by construction rather than by careful maintenance.
 *
 * The five pre-existing `PriorityPreset` strategies live in `utils/reviewUx.ts`
 * and resolve to a five-dimension `PriorityVector`. The four DAQE learning modes
 * below resolve to knob vectors. Both appear in the same dropdown (see
 * `queue-strategy-persistence`), so the union type here is what the settings
 * store persists.
 */

import {
  DAQE_KNOBS,
  coerceDaqeKnobs,
  defaultDaqeKnobs,
  validateDaqeKnobs,
  type DaqeKnobs,
} from "./knobs";

/** The five pre-existing strategies. Their vectors are unchanged. */
export const PRIORITY_PRESET_IDS = [
  "maximize-retention",
  "minimize-time",
  "aggressive-catchup",
  "exploratory",
  "project-focused",
] as const;
export type PriorityPresetId = (typeof PRIORITY_PRESET_IDS)[number];

/** The four DAQE learning modes. */
export const DAQE_PRESET_IDS = [
  "deep-work-sprint",
  "tired-mobile-commute",
  "ruthless-triage",
  "balanced-discovery",
] as const;
export type DaqePresetId = (typeof DAQE_PRESET_IDS)[number];

/** What one dropdown shows. */
export type QueueStrategyPresetId = PriorityPresetId | DaqePresetId;

export const QUEUE_STRATEGY_PRESET_IDS: readonly QueueStrategyPresetId[] = [
  ...PRIORITY_PRESET_IDS,
  ...DAQE_PRESET_IDS,
];

/**
 * The strategy a queue ranks by when nothing usable is stored.
 *
 * Also the answer for an id that no longer exists, so a settings blob written by
 * another build degrades to a sane order instead of no queue at all.
 */
export const DEFAULT_QUEUE_STRATEGY_PRESET_ID: PriorityPresetId = "maximize-retention";

/**
 * Which DAQE learning mode each strategy id stands in for when something needs a
 * `PriorityVector` rather than knobs.
 *
 * Only reached by surfaces that still rank by the pre-DAQE vector (the mobile
 * queue list, the queue route's ordering). Those surfaces have no knob set to
 * read, so a DAQE id has to borrow the vector preset that shares its intent.
 */
const DAQE_TO_PRIORITY_PRESET: Record<DaqePresetId, PriorityPresetId> = {
  "deep-work-sprint": "project-focused",
  "tired-mobile-commute": "minimize-time",
  "ruthless-triage": "aggressive-catchup",
  "balanced-discovery": "maximize-retention",
};

export interface DaqePresetDefinition {
  id: DaqePresetId;
  /** i18n key for the display name. */
  labelKey: string;
  /** i18n key for the one-line description. Required by `queue-strategy-persistence`. */
  descriptionKey: string;
  /** Every knob value this preset writes. */
  knobs: DaqeKnobs;
}

/**
 * The four DAQE presets.
 *
 * Values come straight from `queue-mode-presets`: Deep Work Sprint targets 4 with
 * goal relevance raised and interleaving lowered; Tired targets 2 with SRS weight
 * lowered and interleaving raised; Ruthless Triage raises pruning; Balanced
 * Discovery is the even-handed middle.
 *
 * Knobs a preset does not name are filled from the schema defaults, so the object
 * is a complete knob set and `applyPreset` never has to merge.
 */
export const DAQE_PRESETS: readonly DaqePresetDefinition[] = [
  {
    id: "deep-work-sprint",
    labelKey: "daqePreset.deepWorkSprint",
    descriptionKey: "daqePreset.deepWorkSprintDesc",
    knobs: coerceDaqeKnobs({
      ...defaultDaqeKnobs(),
      energyTarget: 4,
      goalRelevance: 0.5,
      interleavingDiversity: 0.1,
    }),
  },
  {
    id: "tired-mobile-commute",
    labelKey: "daqePreset.tiredMobileCommute",
    descriptionKey: "daqePreset.tiredMobileCommuteDesc",
    knobs: coerceDaqeKnobs({
      ...defaultDaqeKnobs(),
      energyTarget: 2,
      srsDecayWeight: 0.2,
      interleavingDiversity: 0.4,
    }),
  },
  {
    id: "ruthless-triage",
    labelKey: "daqePreset.ruthlessTriage",
    descriptionKey: "daqePreset.ruthlessTriageDesc",
    knobs: coerceDaqeKnobs({
      ...defaultDaqeKnobs(),
      pruningAggressiveness: 0.6,
      srsDecayWeight: 0.4,
    }),
  },
  {
    id: "balanced-discovery",
    labelKey: "daqePreset.balancedDiscovery",
    descriptionKey: "daqePreset.balancedDiscoveryDesc",
    knobs: coerceDaqeKnobs({
      ...defaultDaqeKnobs(),
      srsDecayWeight: 0.35,
      goalRelevance: 0.25,
      interleavingDiversity: 0.25,
      pruningAggressiveness: 0.15,
    }),
  },
] as const;

export function getDaqePreset(id: DaqePresetId): DaqePresetDefinition {
  const found = DAQE_PRESETS.find((preset) => preset.id === id);
  if (!found) {
    throw new Error(`unknown DAQE preset: ${id}`);
  }
  return found;
}

/**
 * Write a preset's six knob values.
 *
 * Returns the knob set unchanged if the preset is somehow invalid, rather than
 * storing a partial set: a preset is data, and data can be corrupted by a bad
 * import or a hand-edit.
 */
export function applyPreset(id: DaqePresetId, current: DaqeKnobs): DaqeKnobs {
  const preset = getDaqePreset(id);
  const knobs = coerceDaqeKnobs(preset.knobs);
  return validateDaqeKnobs(knobs).ok ? knobs : current;
}

/**
 * Which preset, if any, the current knobs exactly match.
 *
 * Exact match, and deliberately so. The alternative — "the closest preset" — is
 * how a user ends up told they are running "Tired / Mobile Commute" when they have
 * nudged three sliders away from it. `null` is the honest answer once anything has
 * been adjusted.
 */
export function detectActivePreset(knobs: DaqeKnobs): DaqePresetId | null {
  for (const preset of DAQE_PRESETS) {
    const matches = DAQE_KNOBS.every(
      (spec) => knobs[spec.key] === preset.knobs[spec.key],
    );
    if (matches) return preset.id;
  }
  return null;
}

/** Every preset id in the dropdown, DAQE ones included. */
export function isQueueStrategyPreset(
  id: string,
): id is QueueStrategyPresetId {
  return (QUEUE_STRATEGY_PRESET_IDS as readonly string[]).includes(id);
}

/** One of the five pre-DAQE strategies, i.e. the ids `PriorityVector` weights exist for. */
export function isPriorityPresetId(id: string): id is PriorityPresetId {
  return (PRIORITY_PRESET_IDS as readonly string[]).includes(id);
}

/**
 * The persisted preset id, or `null`.
 *
 * A stored id that no longer exists — because a preset was renamed, or because the
 * value came from an older build — reads as "no preset" rather than throwing, so a
 * stale settings blob cannot make the queue unopenable.
 */
export function coerceStoredPresetId(value: unknown): QueueStrategyPresetId | null {
  return typeof value === "string" && isQueueStrategyPreset(value) ? value : null;
}

/**
 * The stored strategy id as a `PriorityPreset`, which is all the pre-DAQE
 * ranking surfaces understand.
 *
 * Nine ids go in; five come out, so every read of
 * `smartQueue.queueStrategyPreset` resolves through here. Three call sites used
 * to cast the stored string to `PriorityPreset` instead, which handed a DAQE id
 * straight to `getPriorityScore` — where the weight lookup missed and rendering
 * the queue threw `Cannot read properties of undefined (reading 'retentionRisk')`.
 * An unknown id resolves to the default for the same reason `coerceStoredPresetId`
 * does not throw: a stale blob must not make the queue unopenable.
 */
export function resolvePriorityPresetId(value: unknown): PriorityPresetId {
  const stored = coerceStoredPresetId(value);
  if (!stored) return DEFAULT_QUEUE_STRATEGY_PRESET_ID;
  if (isPriorityPresetId(stored)) return stored;
  return DAQE_TO_PRIORITY_PRESET[stored];
}