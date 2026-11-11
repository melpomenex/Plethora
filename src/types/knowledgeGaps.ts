/**
 * Canonical knowledge-gap view types (C6-T05).
 *
 * Re-exports canonical gap types from learningEvidence and preserves
 * legacy localStorage shapes only as import provenance. No current
 * mastery is derived from legacy masteryEstimate/variance.
 */

import type {
  KnowledgeGapKind as CanonicalGapKind,
  KnowledgeGapView as CanonicalGapView,
  GapEvidenceRecord as CanonicalGapEvidence,
  ConceptMasterySummary,
} from './learningEvidence';

export type KnowledgeGapKind = CanonicalGapKind;
export type KnowledgeGap = CanonicalGapView;
export type GapEvidence = CanonicalGapEvidence;

/** Legacy localStorage gap shape (pre-C6, non-canonical). */
export interface LegacyKnowledgeGap {
  id: string;
  kind: KnowledgeGapKind;
  conceptId?: string;
  conceptName: string;
  masteryEstimate?: number;
  variance?: number;
  evidence: Array<{
    recordId: string;
    kind: 'review_lapse' | 'unreviewed_reading' | 'graph_edge' | 'assessment';
    description: string;
  }>;
  status: 'active' | 'dismissed' | 'resolved';
  detectedAt: string;
}

export const LEGACY_GAPS_STORAGE_KEY = 'plethora-knowledge-gaps';
export const LEGACY_GAPS_BACKUP_KEY = 'plethora-knowledge-gaps:backup:v1';
export const LEGACY_IMPORT_RULE_ID = 'legacy-localstorage-v1';

export function formatGapTitle(gap: CanonicalGapView | Pick<CanonicalGapView, 'kind' | 'conceptName'>): string {
  switch (gap.kind) {
    case 'weak_prerequisite':
      return `Weak Prerequisite: ${gap.conceptName}`;
    case 'missing_concept':
      return `Missing Concept: ${gap.conceptName}`;
    case 'repeatedly_failed':
      return `Repeated Lapses: ${gap.conceptName}`;
    case 'read_never_reviewed':
      return `Read but Unreviewed: ${gap.conceptName}`;
    case 'disconnected_cluster':
      return `Disconnected Knowledge Island: ${gap.conceptName}`;
    case 'weak_transfer':
      return `Weak Application Transfer: ${gap.conceptName}`;
  }
}

export type { ConceptMasterySummary };
