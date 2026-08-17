export type CardOptimizationKind =
  | 'rewrite'
  | 'split'
  | 'merge'
  | 'retire'
  | 'generate_application'
  | 'clarify';

export interface CardOptimizationDraft {
  front?: string;
  back?: string;
  splitCards?: Array<{ front: string; back: string }>;
}

export interface CardOptimizationProposal {
  id: string;
  kind: CardOptimizationKind;
  targetCardIds: string[];
  deckId?: string;
  evidence: string;
  confidence: number; // 0.0 to 1.0
  draft?: CardOptimizationDraft;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
}

export function formatOptimizationTitle(proposal: CardOptimizationProposal): string {
  switch (proposal.kind) {
    case 'rewrite':
      return 'Simplify & Clarify Formulation';
    case 'split':
      return 'Split into Minimum Information Cards';
    case 'merge':
      return 'Merge Duplicate / Same-Fact Cards';
    case 'retire':
      return 'Retire Outdated / Stale Card';
    case 'generate_application':
      return 'Generate Practical Application Question';
    case 'clarify':
      return 'Disambiguate Overloaded Prompt';
  }
}
