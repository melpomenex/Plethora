import {
  DEMO_PRIMARY_PATH,
  type DemoContentKind,
  type DemoStage,
  type DemoState,
} from '../../config/demo-contract.ts';
import { DEMO_ITEMS } from './content.ts';

/** Task name; same sequence as the shared `DEMO_PRIMARY_PATH` contract. */
export const DEMO_HAPPY_PATH = DEMO_PRIMARY_PATH;

export const DEMO_CONTENT_KINDS: DemoContentKind[] = [
  'article',
  'book',
  'pdf',
  'podcast',
  'video',
];

export const DEFAULT_PASSAGE_IDS: Record<DemoContentKind, string> = {
  article: DEMO_ITEMS.article.passage.id,
  book: DEMO_ITEMS.book.passage.id,
  pdf: DEMO_ITEMS.pdf.passage.id,
  podcast: DEMO_ITEMS.podcast.passage.id,
  video: DEMO_ITEMS.video.passage.id,
};

export const INITIAL_DEMO_STATE: DemoState = {
  contentKind: 'article',
  stage: 'library',
  passageId: DEFAULT_PASSAGE_IDS.article,
};

const KIND_SET = new Set<string>(DEMO_CONTENT_KINDS);
const HAPPY_STAGE_SET = new Set<string>(DEMO_HAPPY_PATH);

export type DemoEvent =
  | { type: 'advance' }
  | { type: 'back' }
  | { type: 'select-kind'; kind: DemoContentKind }
  | { type: 'select-passage' }
  | { type: 'remember' }
  | { type: 'reveal' }
  | { type: 'rate'; rating: 1 | 2 | 3 | 4 | 5 }
  | { type: 'restart' }
  | { type: 'hydrate'; kind?: string; stage?: string; passageId?: string };

export function isDemoContentKind(value: unknown): value is DemoContentKind {
  return typeof value === 'string' && KIND_SET.has(value);
}

export function isHappyPathStage(value: unknown): value is DemoStage {
  return typeof value === 'string' && HAPPY_STAGE_SET.has(value);
}

export function isDemoRating(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

export function defaultPassageId(kind: DemoContentKind): string {
  return DEFAULT_PASSAGE_IDS[kind];
}

function libraryState(kind: DemoContentKind): DemoState {
  return {
    contentKind: kind,
    stage: 'library',
    passageId: defaultPassageId(kind),
  };
}

export function restartDemo(state: Pick<DemoState, 'contentKind'> = INITIAL_DEMO_STATE): DemoState {
  return libraryState(isDemoContentKind(state.contentKind) ? state.contentKind : 'article');
}

function withStage(state: DemoState, stage: DemoStage, extra: Partial<DemoState> = {}): DemoState {
  const next: DemoState = {
    contentKind: state.contentKind,
    stage,
    passageId: defaultPassageId(state.contentKind),
  };
  if (extra.rating !== undefined) next.rating = extra.rating;
  return next;
}

function happyIndex(stage: DemoStage): number {
  return DEMO_HAPPY_PATH.indexOf(stage);
}

/** Invalid kinds, off-path stages (`connect`), and unknown passages snap to library. */
export function clampDemoState(input: unknown): DemoState {
  if (!input || typeof input !== 'object') return { ...INITIAL_DEMO_STATE };
  const record = input as Record<string, unknown>;
  const kind = isDemoContentKind(record.contentKind) ? record.contentKind : 'article';
  const passageRaw = record.passageId;
  const passageOmitted = passageRaw === undefined || passageRaw === null || passageRaw === '';
  const passageId = passageOmitted ? defaultPassageId(kind) : String(passageRaw);
  const passageValid = passageId === defaultPassageId(kind);

  if (!isDemoContentKind(record.contentKind) || !isHappyPathStage(record.stage) || !passageValid) {
    return libraryState(kind);
  }

  const next = withStage({ ...INITIAL_DEMO_STATE, contentKind: kind }, record.stage);
  if (
    (record.stage === 'schedule' || record.stage === 'complete' || record.stage === 'review-rate') &&
    isDemoRating(record.rating)
  ) {
    next.rating = record.rating;
  }
  return next;
}

export function parseDemoSearch(search: string): { kind?: string; stage?: string; passageId?: string } {
  const raw = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  return {
    kind: params.get('kind') ?? undefined,
    stage: params.get('stage') ?? undefined,
    passageId: params.get('passageId') ?? params.get('passage') ?? undefined,
  };
}

export function transition(state: DemoState, event: DemoEvent): DemoState {
  switch (event.type) {
    case 'restart':
      return restartDemo(state);
    case 'hydrate':
      return clampDemoState({
        contentKind: event.kind,
        stage: event.stage,
        passageId: event.passageId,
      });
    case 'select-kind': {
      if (!isDemoContentKind(event.kind)) return restartDemo(state);
      if (state.stage !== 'library') return libraryState(event.kind);
      return {
        contentKind: event.kind,
        stage: 'item',
        passageId: defaultPassageId(event.kind),
      };
    }
    case 'select-passage': {
      if (state.stage !== 'passage') return restartDemo(state);
      return withStage(state, 'explain');
    }
    case 'remember': {
      if (state.stage !== 'remember-confirm') return restartDemo(state);
      return withStage(state, 'card');
    }
    case 'reveal': {
      if (state.stage !== 'review-prompt') return restartDemo(state);
      return withStage(state, 'review-reveal');
    }
    case 'rate': {
      if (state.stage !== 'review-rate' || !isDemoRating(event.rating)) return restartDemo(state);
      return withStage(state, 'schedule', { rating: event.rating });
    }
    case 'advance': {
      if (!isHappyPathStage(state.stage)) return restartDemo(state);
      if (state.stage === 'complete') return state;
      if (state.stage === 'review-rate') return restartDemo(state);
      if (state.stage === 'passage') return withStage(state, 'explain');
      if (state.stage === 'remember-confirm') return withStage(state, 'card');
      if (state.stage === 'review-prompt') return withStage(state, 'review-reveal');
      const index = happyIndex(state.stage);
      const nextStage = DEMO_HAPPY_PATH[index + 1];
      if (!nextStage) return state;
      return withStage(state, nextStage, state.rating !== undefined ? { rating: state.rating } : {});
    }
    case 'back': {
      if (!isHappyPathStage(state.stage)) return restartDemo(state);
      const index = happyIndex(state.stage);
      if (index <= 0) return libraryState(state.contentKind);
      const prev = DEMO_HAPPY_PATH[index - 1]!;
      const keepRating = prev === 'schedule' || prev === 'complete';
      return withStage(state, prev, keepRating && state.rating !== undefined ? { rating: state.rating } : {});
    }
    default:
      return restartDemo(state);
  }
}
