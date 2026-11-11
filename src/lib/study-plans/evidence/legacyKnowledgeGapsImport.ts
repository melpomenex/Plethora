/**
 * Legacy knowledge-gap localStorage import (C6-T05).
 *
 * Imports old `plethora-knowledge-gaps` rows as unverified historical
 * records with rule `legacy-localstorage-v1`. Old masteryEstimate/variance
 * are preserved ONLY as import provenance, never as current mastery.
 * After accepted commit renames key to backup; failed import never deletes.
 */

import {
  LEGACY_GAPS_BACKUP_KEY,
  LEGACY_GAPS_STORAGE_KEY,
  LEGACY_IMPORT_RULE_ID,
  type LegacyKnowledgeGap,
} from '../../../types/knowledgeGaps';
import type { KnowledgeGapView } from '../../../types/learningEvidence';

export interface LegacyGapPreview {
  total: number;
  active: number;
  dismissed: number;
  resolved: number;
  invalid: number;
  sample: LegacyKnowledgeGap[];
}

export function readLegacyGapsRaw(storage: Pick<Storage, 'getItem'>): {
  gaps: LegacyKnowledgeGap[];
  raw: string | null;
} {
  const raw = storage.getItem(LEGACY_GAPS_STORAGE_KEY);
  if (!raw) return { gaps: [], raw: null };
  try {
    const parsed = JSON.parse(raw) as { gaps?: LegacyKnowledgeGap[] } | LegacyKnowledgeGap[];
    const gaps = Array.isArray(parsed) ? parsed : parsed.gaps ?? [];
    return { gaps: gaps.filter((g) => g && typeof g.id === 'string'), raw };
  } catch {
    return { gaps: [], raw };
  }
}

export function previewLegacyKnowledgeGapsImport(
  storage: Pick<Storage, 'getItem'>,
): LegacyGapPreview {
  const { gaps } = readLegacyGapsRaw(storage);
  let active = 0;
  let dismissed = 0;
  let resolved = 0;
  let invalid = 0;
  for (const g of gaps) {
    if (!g.kind || !g.conceptName) {
      invalid += 1;
      continue;
    }
    if (g.status === 'dismissed') dismissed += 1;
    else if (g.status === 'resolved') resolved += 1;
    else active += 1;
  }
  return { total: gaps.length, active, dismissed, resolved, invalid, sample: gaps.slice(0, 3) };
}

/** Deterministic retry-safe id for a legacy row (no random UUIDs). */
export function legacyGapImportKey(gap: LegacyKnowledgeGap): string {
  return createHashSync(`${gap.id}|${gap.kind}|${gap.conceptName}|${gap.status}`);
}

function createHashSync(input: string): string {
  // FNV-1a 64-bit hex, deterministic without async crypto; sufficient as
  // idempotency key namespace (native enforces UNIQUE legacy_import_key).
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c + 31), 16777619);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Converts legacy rows to canonical historical views. Old mastery numbers
 * are kept only inside evidence description/provenance, never as observedMean.
 */
export function convertLegacyGapsToViews(gaps: LegacyKnowledgeGap[]): KnowledgeGapView[] {
  return gaps
    .filter((g) => g && g.id && g.kind && g.conceptName)
    .map((g) => ({
      id: `legacy_${legacyGapImportKey(g)}`,
      kind: g.kind,
      conceptId: g.conceptId ?? `legacy:${legacyGapImportKey(g)}`,
      conceptName: g.conceptName,
      planId: null,
      nodeId: null,
      ruleId: LEGACY_IMPORT_RULE_ID,
      status: g.status === 'dismissed' || g.status === 'resolved' ? g.status : 'active',
      evidence: (g.evidence ?? []).map((e) => ({
        recordId: e.recordId,
        kind: e.kind,
        description: e.description,
        learningEvidenceId: null,
        sourceRefId: null,
        payload: {
          legacyLocalstorageV1: true,
          legacyId: g.id,
          legacyMasteryEstimate: g.masteryEstimate ?? null,
          legacyVariance: g.variance ?? null,
          legacyNote: 'Unverified historical import; not a current mastery measurement.',
        },
      })),
      demonstrated: null,
      firstDetectedAt: g.detectedAt,
      lastDetectedAt: g.detectedAt,
      evidenceCutoff: g.detectedAt,
    }));
}

export async function executeLegacyKnowledgeGapsImport(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>,
  commit: (views: KnowledgeGapView[], keys: string[]) => Promise<void>,
): Promise<{ imported: number; backupKey: string }> {
  const { gaps, raw } = readLegacyGapsRaw(storage);
  if (raw === null || gaps.length === 0) return { imported: 0, backupKey: LEGACY_GAPS_BACKUP_KEY };
  const views = convertLegacyGapsToViews(gaps);
  const keys = gaps.map(legacyGapImportKey);
  // Commit first; only rename original key after accepted commit.
  await commit(views, keys);
  try {
    storage.setItem(LEGACY_GAPS_BACKUP_KEY, raw);
  } catch {
    // Backup write failure must not delete original data.
    return { imported: views.length, backupKey: LEGACY_GAPS_BACKUP_KEY };
  }
  storage.removeItem(LEGACY_GAPS_STORAGE_KEY);
  return { imported: views.length, backupKey: LEGACY_GAPS_BACKUP_KEY };
}

export { LEGACY_GAPS_STORAGE_KEY, LEGACY_GAPS_BACKUP_KEY, LEGACY_IMPORT_RULE_ID };
export type { LegacyKnowledgeGap };
