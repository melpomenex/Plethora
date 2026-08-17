/**
 * Per-stage wall-clock timing for pipeline diagnostics (design D11).
 *
 * Timings are diagnostics only — never inputs to scoring — so measurement
 * noise cannot make an import non-deterministic.
 */

import type { StageTimings } from './types';

export interface StageTimer {
  /** Record the duration of one stage and return it. */
  mark<K extends keyof StageTimings>(stage: K, start: number): number;
  timings(): StageTimings;
}

export function createStageTimer(): StageTimer {
  const timings: StageTimings = {};
  return {
    mark(stage, start) {
      const duration = Math.max(0, Math.round(now() - start));
      timings[stage] = (timings[stage] ?? 0) + duration;
      return duration;
    },
    timings() {
      return { ...timings };
    },
  };
}

export function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
