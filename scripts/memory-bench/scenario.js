/**
 * Fixed scenario stage sequence (task 3.6).
 *
 * The driver walks an ordered list of phases. Each phase carries the app steps
 * to drive (open/close operations), and the driver takes one memory sample
 * after the phase settles (plus one per repeated cycle — each cycle is its own
 * phase):
 *
 *   fresh idle → one document → two tabs → four tabs → all closed →
 *   N single-document open/close cycles → N multi-document open/close cycles →
 *   final idle
 *
 * Cycle count is configurable; the default is resolved in Phase 9 (task 9.4).
 *
 * `closeTab` steps reference a prior `open` of the same phase via `tabRef`
 * (e.g. "open:0" = the tab opened by the first open step); the driver resolves
 * the placeholder to the real app tab id from the app's report.
 */

/** Documented default cycle count (chosen in task 9.4). */
export const DEFAULT_CYCLE_COUNT = 8;

/** Sample keys for the fixed stages. */
export const STAGE_KEYS = {
  idleFresh: "idle-fresh",
  oneDoc: "one-doc",
  twoTabs: "two-tabs",
  fourTabs: "four-tabs",
  allClosed: "all-closed",
  singleCycles: "single-cycles",
  multiCycles: "multi-cycles",
  idleFinal: "idle-final",
};

export const CYCLE_KEY_SEPARATOR = "/";

/** One phase: steps to drive, then a sample after settle. */
export function phase(key, steps) {
  return { key, steps };
}

const open = (corpusId) => ({ op: "open", corpusId });
const closeRef = (tabRef) => ({ op: "closeTab", tabRef });

/**
 * Build the ordered scenario phases.
 *
 * @param {object} [options]
 * @param {number} [options.cycleCount=8]
 * @returns {Array<{key: string, steps: Array<object>}>}
 */
export function buildScenarioStages({ cycleCount = DEFAULT_CYCLE_COUNT } = {}) {
  if (!Number.isInteger(cycleCount) || cycleCount < 1) {
    throw new Error(`cycleCount must be a positive integer, got ${cycleCount}`);
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

  phases.push(phase(STAGE_KEYS.idleFinal, []));
  return phases;
}
