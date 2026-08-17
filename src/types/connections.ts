import { RagCitation } from './rag';

export type ConnectionRelation =
  | 'same_as'
  | 'prerequisite_of'
  | 'example_of'
  | 'contradicts'
  | 'supports'
  | 'extends'
  | 'analogous_to'
  | 'definition_of'
  | 'application_of'
  | 'related_to';

export interface ConnectionSuggestion {
  id: string;
  relation: ConnectionRelation;
  leftDocumentId: string;
  leftQuote: string;
  rightCitation: RagCitation;
  score: number;
  explanation: string;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
}

export function formatRelationLabel(relation: ConnectionRelation): string {
  switch (relation) {
    case 'same_as':
      return 'Identical Concept';
    case 'prerequisite_of':
      return 'Foundational Prerequisite';
    case 'example_of':
      return 'Concrete Example';
    case 'contradicts':
      return 'Direct Contradiction / Conflict';
    case 'supports':
      return 'Supporting Evidence';
    case 'extends':
      return 'Extends & Expands';
    case 'analogous_to':
      return 'Structural Analogy';
    case 'definition_of':
      return 'Formal Definition';
    case 'application_of':
      return 'Practical Application';
    case 'related_to':
      return 'Semantic Relationship';
  }
}
