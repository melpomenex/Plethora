/**
 * Settle protocol (task 3.5, design D5).
 *
 * A stage settles when BOTH hold:
 *   (a) the app reports quiescence (no in-flight load/render/persistence), and
 *   (b) the tree's Pss varies by less than a configured fraction across three
 *       consecutive reads spaced a configured interval apart.
 *
 * If the condition is not met within the timeout, the sample is still taken
 * but the run is marked `reliable: false` with the reason. Marking rather than
 * retrying keeps the failure visible — a run that never settles is itself a
 * finding — and the gate refuses to issue a verdict from an unreliable run.
 */

import { sleep } from "./util.js";

/** Default settle parameters, recorded in every result. */
export const DEFAULT_SETTLE = {
  /** Maximum fraction the tree Pss may change across the three reads. */
  maxRelativeJitter: 0.01,
  /** Delay between consecutive Pss reads. */
  intervalMs: 500,
  /** Number of consecutive reads required within the fraction. */
  requiredConsecutiveReads: 3,
  /** Overall settle timeout. */
  timeoutMs: 30_000,
};

/**
 * Wait for the settle condition.
 *
 * @param {object} options
 * @param {() => Promise<number>} options.readTreePss - reads the current tree Pss.
 * @param {() => Promise<boolean>} options.appQuiescent - true when the app reports quiescence.
 * @param {Partial<typeof DEFAULT_SETTLE>} [options.settle]
 * @returns {{ settled: boolean, reason?: string, settleParams: object, readings: number[] }}
 */
export async function waitForSettle({ readTreePss, appQuiescent, settle = {} }) {
  const params = { ...DEFAULT_SETTLE, ...settle };
  const deadline = Date.now() + params.timeoutMs;
  const readings = [];

  let appQuiet = false;
  try {
    appQuiet = await appQuiescent();
  } catch {
    appQuiet = false;
  }
  if (!appQuiet) {
    return {
      settled: false,
      reason: "app quiescence signal never became true",
      settleParams: params,
      readings,
    };
  }

  while (Date.now() < deadline) {
    readings.push(await readTreePss());
    if (readings.length >= params.requiredConsecutiveReads) {
      const window = readings.slice(-params.requiredConsecutiveReads);
      const base = window[0];
      if (base > 0) {
        const maxDelta = Math.max(...window.map((v) => Math.abs(v - base)));
        if (maxDelta / base <= params.maxRelativeJitter) {
          return { settled: true, settleParams: params, readings };
        }
      }
    }
    await sleep(params.intervalMs);
  }

  return {
    settled: false,
    reason:
      `tree Pss did not stabilize within ${params.timeoutMs}ms ` +
      `(jitter threshold ${(params.maxRelativeJitter * 100).toFixed(1)}%, ` +
      `last readings ${readings.join(", ")} bytes)`,
    settleParams: params,
    readings,
  };
}
