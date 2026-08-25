/**
 * Fixed scenario stage sequence (task 3.6; extended by
 * eliminate-long-running-memory-growth tasks 4.1/4.2).
 *
 * The driver walks an ordered list of phases. Each phase carries the app steps
 * to drive (open/close operations), and the driver takes one memory sample
 * after the phase settles (plus one per repeated cycle — each cycle is its own
 * phase):
 *
 *   fresh idle → one document → two tabs → four tabs → all closed →
 *   N single-document open/close cycles → N multi-document open/close cycles →
 *   N TTS cycles (alternating persistent-cache hit/miss variants) →
 *   N audio-edition cycles (generate → cancel → retry → delete) →
 *   [optional idle soak, sampled periodically, not just at settle] →
 *   final idle
 *
 * Documented defaults: cycleCount 8, ttsCycles 12 (6 hit + 6 miss),
 * editionCycles 6 with editionSections 4 sections each (task 4.1).
 *
 * `closeTab` steps reference a prior `open` of the same phase via `tabRef`
 * (e.g. "open:0" = the tab opened by the first open step); the driver resolves
 * the placeholder to the real app tab id from the app's report.
 */

/** Documented default cycle count (chosen in task 9.4). */
export const DEFAULT_CYCLE_COUNT = 8;

/** Documented defaults for the TTS / edition stages (task 4.1). */
export const DEFAULT_TTS_CYCLES = 12;
export const DEFAULT_EDITION_CYCLES = 6;
export const DEFAULT_EDITION_SECTIONS = 4;

/**
 * Idle-soak tier presets (task 4.2). `npm run bench:memory -- --soak=<tier>`.
 * The driver samples the tree every `sampleIntervalMs` for `durationMs`.
 */
export const SOAK_TIERS = {
  quick: { durationMs: 5 * 60_000, sampleIntervalMs: 30_000 },
  dev: { durationMs: 30 * 60_000, sampleIntervalMs: 30_000 },
  nightly: { durationMs: 4 * 60 * 60_000, sampleIntervalMs: 60_000 },
  extended: { durationMs: 11 * 60 * 60_000, sampleIntervalMs: 120_000 },
};

/** Sample keys for the fixed stages. */
export const STAGE_KEYS = {
  idleFresh: "idle-fresh",
  oneDoc: "one-doc",
  twoTabs: "two-tabs",
  fourTabs: "four-tabs",
  allClosed: "all-closed",
  singleCycles: "single-cycles",
  multiCycles: "multi-cycles",
  ttsCycles: "tts-cycles",
  editionCycles: "edition-cycles",
  idleSoak: "idle-soak",
  idleFinal: "idle-final",
};

export const CYCLE_KEY_SEPARATOR = "/";

/** One phase: steps to drive, then a sample after settle. A phase with a
 * `soak` config is sampled periodically instead (task 4.2). */
export function phase(key, steps, extra = {}) {
  return { key, steps, ...extra };
}

const open = (corpusId) => ({ op: "open", corpusId });
const closeRef = (tabRef) => ({ op: "closeTab", tabRef });

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value >= 1 ? value : fallback;
}

/**
 * Build the ordered scenario phases.
 *
 * @param {object} [options]
 * @param {number} [options.cycleCount=8]
 * @param {number} [options.ttsCycles=12]
 * @param {number} [options.editionCycles=6]
 * @param {number} [options.editionSections=4]
 * @param {keyof typeof SOAK_TIERS} [options.soak] - idle-soak tier name
 * @returns {Array<{key: string, steps: Array<object>}>}
 */
export function buildScenarioStages({
  cycleCount = DEFAULT_CYCLE_COUNT,
  ttsCycles = DEFAULT_TTS_CYCLES,
  editionCycles = DEFAULT_EDITION_CYCLES,
  editionSections = DEFAULT_EDITION_SECTIONS,
  soak = null,
} = {}) {
  if (!Number.isInteger(cycleCount) || cycleCount < 1) {
    throw new Error(`cycleCount must be a positive integer, got ${cycleCount}`);
  }
  const soakConfig = soak ? SOAK_TIERS[soak] : null;
  if (soak && !soakConfig) {
    throw new Error(`unknown soak tier "${soak}" (available: ${Object.keys(SOAK_TIERS).join(", ")})`);
  }

  const phases = [];
  phases.push(phase(STAGE_KEYS.idleFresh, []));
  phases.push(phase(STAGE_KEYS.oneDoc, [open("pdf-1")]));
  phases.push(phase(STAGE_KEYS.twoTabs, [open("epub-1")]));
  phases.push(
    phase(STAGE_KEYS.fourTabs, [open("pdf-2"), open("epub-2")]),
  );
  phases.push(phase(STAGE_KEYS.allClosed, [{ op: "closeAll" }]));

  // N single-document cycles: open pdf-1, close the tab just opened.
  for (let cycle = 0; cycle < cycleCount; cycle++) {
    phases.push(
      phase(`${STAGE_KEYS.singleCycles}${CYCLE_KEY_SEPARATOR}${cycle}`, [
        open("pdf-1"),
        closeRef("open:0"),
      ]),
    );
  }

  // N multi-document cycles: open pdf-1 + epub-1, close both.
  for (let cycle = 0; cycle < cycleCount; cycle++) {
    phases.push(
      phase(`${STAGE_KEYS.multiCycles}${CYCLE_KEY_SEPARATOR}${cycle}`, [
        open("pdf-1"),
        open("epub-1"),
        closeRef("open:0"),
        closeRef("open:1"),
      ]),
    );
  }

  // N TTS cycles: alternate cache-hit (fixed text) / cache-miss (salted text)
  // variants so both the persistent-cache-hit Blob minting and the synthesis
  // path are exercised every other cycle (task 4.1).
  const ttsCount = positiveInt(ttsCycles, DEFAULT_TTS_CYCLES);
  for (let cycle = 0; cycle < ttsCount; cycle++) {
    phases.push(
      phase(`${STAGE_KEYS.ttsCycles}${CYCLE_KEY_SEPARATOR}${cycle}`, [
        { op: "ttsCycle", variant: cycle % 2 === 0 ? "miss" : "hit", cycle },
      ]),
    );
  }

  // N audio-edition cycles: K sections each (generate → cancel → retry →
  // delete) through the same store actions the UI uses (task 4.1).
  const editionCount = positiveInt(editionCycles, DEFAULT_EDITION_CYCLES);
  for (let cycle = 0; cycle < editionCount; cycle++) {
    phases.push(
      phase(`${STAGE_KEYS.editionCycles}${CYCLE_KEY_SEPARATOR}${cycle}`, [
        { op: "editionCycle", sections: editionSections, cycle },
      ]),
    );
  }

  // Optional idle soak: periodic samples keyed by elapsed seconds (task 4.2).
  if (soakConfig) {
    phases.push(phase(STAGE_KEYS.idleSoak, [], { soak: soakConfig }));
  }

  phases.push(phase(STAGE_KEYS.idleFinal, []));
  return phases;
}
