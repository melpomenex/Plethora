/**
 * Ranking knob schema, validation, and curated presets.
 *
 * These are the contract the knob panel, the settings store, and the Tauri
 * `rank_queue` command all validate against. The Rust side has its own copy in
 * `src-tauri/src/models/daqe.rs`; the two must agree on ranges and defaults, and
 * `daqeParity.test.ts` asserts that they do.
 */

export interface DaqeKnobs {
  /** Weight on spaced-repetition urgency. 0–1, default 0.40. */
  srsDecayWeight: number;
  /** Weight on relevance to the active goal. 0–1, default 0.30. */
  goalRelevance: number;
  /** The user's energy target. Integer 1–5, default 3. */
  energyTarget: number;
  /** Weight on the interleaving penalty. 0–1, default 0.20. */
  interleavingDiversity: number;
  /** Weight on the friction penalty. 0–1, default 0.10. */
  pruningAggressiveness: number;
  /** Dwell inactivity cutoff in milliseconds. 15 000–120 000, default 45 000. */
  afkIdleTimeoutMs: number;
}

export interface KnobSpec {
  key: keyof DaqeKnobs;
  labelKey: string;
  descriptionKey: string;
  min: number;
  max: number;
  /** Slider step. `energyTarget` is integral, so its step is 1. */
  step: number;
  default: number;
  /** Whether the value must be a whole number. */
  integer: boolean;
}

/**
 * The six knobs, in panel order.
 *
 * Declared as data rather than written out per control so the renderer, the
 * validator, and the i18n coverage check all read the same list — a knob that is
 * not in this table does not exist as far as validation is concerned, which is
 * what makes "an out-of-range value can never be stored" checkable.
 */
export const DAQE_KNOBS: readonly KnobSpec[] = [
  {
    key: "srsDecayWeight",
    labelKey: "daqeKnob.srsDecayWeight",
    descriptionKey: "daqeKnob.srsDecayWeightDesc",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.4,
    integer: false,
  },
  {
    key: "goalRelevance",
    labelKey: "daqeKnob.goalRelevance",
    descriptionKey: "daqeKnob.goalRelevanceDesc",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.3,
    integer: false,
  },
  {
    key: "energyTarget",
    labelKey: "daqeKnob.energyTarget",
    descriptionKey: "daqeKnob.energyTargetDesc",
    min: 1,
    max: 5,
    step: 1,
    default: 3,
    integer: true,
  },
  {
    key: "interleavingDiversity",
    labelKey: "daqeKnob.interleavingDiversity",
    descriptionKey: "daqeKnob.interleavingDiversityDesc",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.2,
    integer: false,
  },
  {
    key: "pruningAggressiveness",
    labelKey: "daqeKnob.pruningAggressiveness",
    descriptionKey: "daqeKnob.pruningAggressivenessDesc",
    min: 0,
    max: 1,
    step: 0.05,
    default: 0.1,
    integer: false,
  },
  {
    key: "afkIdleTimeoutMs",
    labelKey: "daqeKnob.afkIdleTimeout",
    descriptionKey: "daqeKnob.afkIdleTimeoutDesc",
    min: 15_000,
    max: 120_000,
    step: 5_000,
    default: 45_000,
    integer: true,
  },
] as const;

export const DAQE_KNOB_SPECS: Readonly<Record<keyof DaqeKnobs, KnobSpec>> =
  Object.fromEntries(DAQE_KNOBS.map((spec) => [spec.key, spec])) as Record<
    keyof DaqeKnobs,
    KnobSpec
  >;

/** The documented defaults, derived from the schema rather than restated. */
export function defaultDaqeKnobs(): DaqeKnobs {
  return Object.fromEntries(
    DAQE_KNOBS.map((spec) => [spec.key, spec.default]),
  ) as unknown as DaqeKnobs;
}

export interface KnobValidationResult {
  ok: boolean;
  /** The offending knob, when `ok` is false. */
  key?: keyof DaqeKnobs;
  error?: string;
}

function checkSpec(spec: KnobSpec, value: unknown): KnobValidationResult {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return {
      ok: false,
      key: spec.key,
      error: `${spec.key} must be a finite number`,
    };
  }
  if (spec.integer && !Number.isInteger(value)) {
    return {
      ok: false,
      key: spec.key,
      error: `${spec.key} must be a whole number`,
    };
  }
  if (value < spec.min || value > spec.max) {
    return {
      ok: false,
      key: spec.key,
      error: `${spec.key} must be between ${spec.min} and ${spec.max}`,
    };
  }
  return { ok: true };
}

/** Validate one knob value against its spec. */
export function validateKnob(
  key: keyof DaqeKnobs,
  value: unknown,
): KnobValidationResult {
  const spec = DAQE_KNOB_SPECS[key];
  if (!spec) {
    return { ok: false, error: `unknown knob: ${String(key)}` };
  }
  return checkSpec(spec, value);
}

/**
 * Validate a whole knob set.
 *
 * Returns every offending key rather than the first, because the panel shows all
 * six controls at once and a user who has several out of range should see that
 * once rather than one error per save.
 */
export function validateDaqeKnobs(knobs: unknown): KnobValidationResult {
  if (!knobs || typeof knobs !== "object") {
    return { ok: false, error: "knobs must be an object" };
  }
  const record = knobs as Record<string, unknown>;
  for (const spec of DAQE_KNOBS) {
    const result = checkSpec(spec, record[spec.key]);
    if (!result.ok) return result;
  }
  return { ok: true };
}

/**
 * Apply an update to a knob set, validating first.
 *
 * Returns the *existing* set unchanged when the update is invalid. This is the
 * whole reason the function returns a new object or the old one rather than
 * mutating: an out-of-range slider position must never be able to overwrite the
 * stored value, even transiently.
 */
export function applyKnobUpdate(
  knobs: DaqeKnobs,
  key: keyof DaqeKnobs,
  value: number,
): DaqeKnobs {
  if (!validateKnob(key, value).ok) return knobs;
  return { ...knobs, [key]: value };
}

/**
 * Coerce a stored or external knob set into a valid one, filling anything
 * missing or invalid from the schema defaults.
 *
 * Used when reading persisted settings, which may predate a knob, come from an
 * older build, or have been hand-edited.
 */
export function coerceDaqeKnobs(candidate: unknown): DaqeKnobs {
  const record = (candidate ?? {}) as Record<string, unknown>;
  const result = {} as DaqeKnobs;
  for (const spec of DAQE_KNOBS) {
    const value = record[spec.key];
    result[spec.key] =
      checkSpec(spec, value).ok ? (value as number) : spec.default;
  }
  return result;
}