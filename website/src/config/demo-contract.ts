export type DemoContentKind = 'book' | 'article' | 'pdf' | 'podcast' | 'video';

export type DemoStage =
  | 'library'
  | 'item'
  | 'reader'
  | 'passage'
  | 'explain'
  | 'remember-confirm'
  | 'card'
  | 'review-prompt'
  | 'review-reveal'
  | 'review-rate'
  | 'schedule'
  | 'connect'
  | 'complete';

export interface DemoState {
  contentKind: DemoContentKind;
  stage: DemoStage;
  passageId: string;
  rating?: 1 | 2 | 3 | 4 | 5;
}

export const DEMO_PRIMARY_PATH: DemoStage[] = [
  'library',
  'item',
  'reader',
  'passage',
  'explain',
  'remember-confirm',
  'card',
  'review-prompt',
  'review-reveal',
  'review-rate',
  'schedule',
  'complete',
];
