export type KnowledgeGapKind =
  | 'weak_prerequisite'
  | 'missing_concept'
  | 'repeatedly_failed'
  | 'read_never_reviewed'
  | 'disconnected_cluster'
  | 'weak_transfer';

export interface GapEvidence {
  recordId: string;
  kind: 'review_lapse' | 'unreviewed_reading' | 'graph_edge' | 'assessment';
  description: string;
}

export interface KnowledgeGap {
  id: string;
  kind: KnowledgeGapKind;
  conceptId?: string;
  conceptName: string;
  masteryEstimate: number; // 0.0 to 1.0
  variance: number; // Uncertainty: higher = less data
  evidence: GapEvidence[];
  status: 'active' | 'dismissed' | 'resolved';
  detectedAt: string;
}

export function formatGapTitle(gap: KnowledgeGap): string {
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
