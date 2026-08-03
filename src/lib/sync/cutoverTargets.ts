/**

 Cutover drain/seed target registries (migrate-sync-to-delta-log Phase 6
 wiring). The phase functions in `cutover.ts` (`runDrainPhase`,
 `runSeedPhase`) take arrays of targets; this module is where those targets
 come from at runtime — each replicated map / entity module registers its
 drain target (ensureReady + a diagnostic count) and its seed target
 (readAllRows) here, and the boot-time cutover orchestrator
 (`deltaLog/cutoverOrchestrator.ts`) lists whatever has been registered.

 This mirrors the existing `coverageRegistry` pattern (which collects
 `ensureReady` per domain for adapter-coverage assertions) but adds the two
 pieces the cutover phases additionally need: a live entry count for the
 drain progress display, and a SQLite row reader that carries each row's
 existing HLC verbatim for seeding.

 Registration is idempotent: re-registering the same domain replaces the
 previous target (room switch re-initializes every map, then re-registers).

*/

import type { DrainTarget, SeedTarget } from "./cutover";

// --- drain targets ---------------------------------------------------------

const drainTargets = new Map<string, DrainTarget>();

export function registerCutoverDrainTarget(target: DrainTarget): () => void {
  drainTargets.set(target.domain, target);
  return () => {
    if (drainTargets.get(target.domain) === target) drainTargets.delete(target.domain);
  };
}

export function listCutoverDrainTargets(): DrainTarget[] {
  return Array.from(drainTargets.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

// --- seed targets ----------------------------------------------------------

const seedTargets = new Map<string, SeedTarget>();

export function registerCutoverSeedTarget(target: SeedTarget): () => void {
  seedTargets.set(target.domain, target);
  return () => {
    if (seedTargets.get(target.domain) === target) seedTargets.delete(target.domain);
  };
}

export function listCutoverSeedTargets(): SeedTarget[] {
  return Array.from(seedTargets.values()).sort((a, b) => a.domain.localeCompare(b.domain));
}

// --- reset (tests + room switch) -------------------------------------------

export function __clearCutoverTargetsForTest(): void {
  drainTargets.clear();
  seedTargets.clear();
}
