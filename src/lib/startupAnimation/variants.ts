/**
 * Choreography variant registry (design D5 tables, D12 extensibility seam).
 *
 * Phase scripts are pure data consumed by timeline.ts — the machine, driver,
 * and component never hardcode phase content. Future variants (Highlight
 * Peck, Flashcard Peck, …) add registry entries without architectural change.
 */

import type { KPVariantId, PhaseScript } from "./types";

/**
 * Desktop canonical script (3 fragments / 3 pecks).
 * Branded span entrance→wordmark = 1520 ms (design range 1200–1800 ms).
 *
 * `idleAt` is the END OF CONSOLIDATION, not wordmark end: per the
 * lifecycle spec's slow-startup requirement, a not-yet-ready app settles
 * into the stable idle pose beside the completed knowledge structure
 * (cards + connectors visible); the resolve epilogue (converge + wordmark)
 * plays from idle once readiness arrives. The phases after idleAt are the
 * resolve/reveal epilogue timing table.
 */
const DESKTOP: PhaseScript = {
  formFactor: "desktop",
  fragmentCount: 3,
  peckCount: 3,
  phases: [
    { name: "entrance", start: 0, end: 120 },
    { name: "fragments", start: 100, end: 320 },
    { name: "notice", start: 340, end: 500 },
    { name: "peck-1", start: 520, end: 700 },
    { name: "peck-2", start: 720, end: 880 },
    { name: "peck-3", start: 900, end: 1160 },
    { name: "consolidate", start: 1060, end: 1260 },
    { name: "converge", start: 1260, end: 1400 },
    { name: "wordmark", start: 1380, end: 1520 },
    { name: "hold", start: 1520, end: 1640 },
    { name: "reveal", start: 1640, end: 1890 },
  ],
  brandedSpanEnd: 1520,
  idleAt: 1260,
  revealAt: 1640,
  revealEnd: 1890,
};

/**
 * Phone script (2 fragments / 2 pecks) — a deliberately simpler composition,
 * not a shrunken desktop scene. Branded span = 1080 ms (range 700–1200 ms).
 * idleAt = consolidate end (same slow-startup semantics as desktop).
 */
const PHONE: PhaseScript = {
  formFactor: "phone",
  fragmentCount: 2,
  peckCount: 2,
  phases: [
    { name: "entrance", start: 0, end: 100 },
    { name: "fragments", start: 80, end: 260 },
    { name: "notice", start: 280, end: 420 },
    { name: "peck-1", start: 440, end: 580 },
    { name: "peck-2", start: 600, end: 740 },
    { name: "consolidate", start: 740, end: 880 },
    { name: "converge", start: 880, end: 1000 },
    { name: "wordmark", start: 1000, end: 1080 },
    { name: "hold", start: 1080, end: 1160 },
    { name: "reveal", start: 1160, end: 1380 },
  ],
  brandedSpanEnd: 1080,
  idleAt: 880,
  revealAt: 1160,
  revealEnd: 1380,
};

/** Registry keyed by variant id (single initial entry per design D12). */
export const KP_VARIANTS: Record<KPVariantId, { desktop: PhaseScript; phone: PhaseScript }> = {
  "knowledge-peck": { desktop: DESKTOP, phone: PHONE },
};
