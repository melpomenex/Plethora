import { RagLocator } from '../../../types/rag';

export type CardForm =
  | 'qa'
  | 'cloze'
  | 'conceptual'
  | 'application'
  | 'compare_contrast'
  | 'image_occlusion';

export interface CardSourceRef {
  documentId: string;
  locator?: RagLocator;
  extractId?: string;
  conceptId?: string;
}

export interface CardProposal {
  id: string;
  form: CardForm;
  front: string;
  back: string;
  sourceQuote: string;
  difficulty: 'easy' | 'medium' | 'hard';
  qualityScore: number;
  sourceRef: CardSourceRef;
  duplicateMatch?: {
    similarity: number;
    existingFront: string;
  };
}
