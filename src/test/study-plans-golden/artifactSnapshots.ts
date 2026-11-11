/** C8-T03 normalized artifact snapshots: same normalized manifest twice. */
import { normalizeSnapshot } from './fixtures/aliases';

export interface GoldenManifest {
  plan: string;
  blueprint: string;
  attemptA: { score: number; total: number };
  evidence: Record<string, { mean: number; sessions: number }>;
}

export function buildGoldenManifest(): GoldenManifest {
  return {
    plan: 'Operating Systems — Synthetic Golden Plan',
    blueprint: 'A-BLUEPRINT',
    attemptA: { score: 9, total: 15 },
    evidence: {
      N1: { mean: 1, sessions: 1 },
      N2: { mean: 0.5, sessions: 1 },
      N3: { mean: 0.5, sessions: 1 },
      N4: { mean: 0.75, sessions: 1 },
      N5: { mean: 0.6, sessions: 1 },
    },
  };
}

export function normalizedManifest(aliasMap: Record<string, string>): unknown {
  return normalizeSnapshot(buildGoldenManifest(), aliasMap);
}
