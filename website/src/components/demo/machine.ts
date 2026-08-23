import {
  SHOWCASE,
  SHOWCASE_SCENE_IDS,
  getShowcaseAsset,
  getShowcaseScene,
  hasShowcaseAsset,
  type ShowcaseAction,
  type ShowcaseLayout,
} from './showcase.ts';

export type ShowcaseMode = 'narrative' | 'guided' | 'explore';

export interface ShowcaseState {
  mode: ShowcaseMode;
  sceneId: string;
  layout: ShowcaseLayout;
  pathHistory: string[];
  hasTakenControl: boolean;
  completion: boolean;
  notice: string | null;
}

export type ShowcaseEvent =
  | { type: 'takeover'; sceneId?: string }
  | { type: 'action'; actionId: string }
  | { type: 'back' }
  | { type: 'restart' }
  | { type: 'exit' }
  | { type: 'set-layout'; layout: ShowcaseLayout }
  | { type: 'set-mode'; mode: 'guided' | 'explore' }
  | { type: 'destination'; sceneId: string }
  | { type: 'clear-notice' };

export interface ParsedShowcaseSearch {
  scene?: string;
  layout?: string;
}

const DEFAULT_SCENE_ID = 'library.ready';
const LAST_SCENE_ID = SHOWCASE.guidedPath.at(-1) ?? 'connections.context';
const GUIDED_SCENE_SET = new Set<string>(SHOWCASE_SCENE_IDS);

export function isShowcaseLayout(value: unknown): value is ShowcaseLayout {
  return value === 'desktop' || value === 'mobile';
}

export function parseShowcaseSearch(search: string): ParsedShowcaseSearch {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return {
    scene: params.get('scene') ?? undefined,
    layout: params.get('layout') ?? undefined,
  };
}

export function resolveSceneForLayout(sceneId: string, layout: ShowcaseLayout): string {
  if (GUIDED_SCENE_SET.has(sceneId) && hasShowcaseAsset(sceneId, layout)) return sceneId;

  const catalogScene = getShowcaseScene(sceneId);
  if (
    catalogScene &&
    catalogScene.fallbackSceneId !== sceneId &&
    hasShowcaseAsset(catalogScene.fallbackSceneId, layout)
  ) {
    return catalogScene.fallbackSceneId;
  }

  const requestedIndex = SHOWCASE.guidedPath.indexOf(sceneId);
  if (requestedIndex >= 0) {
    for (let distance = 1; distance < SHOWCASE.guidedPath.length; distance += 1) {
      const before = SHOWCASE.guidedPath[requestedIndex - distance];
      const after = SHOWCASE.guidedPath[requestedIndex + distance];
      if (before && hasShowcaseAsset(before, layout)) return before;
      if (after && hasShowcaseAsset(after, layout)) return after;
    }
  }
  return DEFAULT_SCENE_ID;
}

export function clampShowcaseState(input: Partial<ShowcaseState>): ShowcaseState {
  const layout = isShowcaseLayout(input.layout) ? input.layout : 'desktop';
  const requestedScene = typeof input.sceneId === 'string' ? input.sceneId : DEFAULT_SCENE_ID;
  const sceneId = resolveSceneForLayout(requestedScene, layout);
  const mode: ShowcaseMode =
    input.mode === 'guided' || input.mode === 'explore' || input.mode === 'narrative'
      ? input.mode
      : 'narrative';
  const history = Array.isArray(input.pathHistory)
    ? input.pathHistory.filter(
        (entry): entry is string =>
          typeof entry === 'string' && GUIDED_SCENE_SET.has(entry) && hasShowcaseAsset(entry, layout),
      )
    : [];
  return {
    mode,
    sceneId,
    layout,
    pathHistory: history,
    hasTakenControl: input.hasTakenControl === true || mode !== 'narrative',
    completion: sceneId === LAST_SCENE_ID,
    notice: typeof input.notice === 'string' ? input.notice : null,
  };
}

export function createShowcaseState(options: {
  search?: string;
  defaultLayout?: ShowcaseLayout;
  mode?: ShowcaseMode;
} = {}): ShowcaseState {
  const parsed = parseShowcaseSearch(options.search ?? '');
  const layout = isShowcaseLayout(parsed.layout) ? parsed.layout : options.defaultLayout ?? 'desktop';
  const sceneId = resolveSceneForLayout(parsed.scene ?? DEFAULT_SCENE_ID, layout);
  const mode = options.mode ?? 'narrative';
  return clampShowcaseState({
    mode,
    sceneId,
    layout,
    hasTakenControl: mode !== 'narrative',
    pathHistory: [],
  });
}

function navigate(state: ShowcaseState, sceneId: string): ShowcaseState {
  const resolved = resolveSceneForLayout(sceneId, state.layout);
  if (resolved === state.sceneId) return { ...state, notice: null };
  return {
    ...state,
    sceneId: resolved,
    pathHistory: [...state.pathHistory, state.sceneId],
    completion: resolved === LAST_SCENE_ID,
    notice: null,
  };
}

export function recommendedAction(state: ShowcaseState): ShowcaseAction | undefined {
  const scene = getShowcaseScene(state.sceneId);
  return scene?.actions.find(
    (action) =>
      action.recommended &&
      getShowcaseAsset(state.sceneId, state.layout)?.hotspots.some(
        (hotspot) => hotspot.id === action.id,
      ),
  );
}

export function transitionShowcase(
  input: ShowcaseState,
  event: ShowcaseEvent,
): ShowcaseState {
  const state = clampShowcaseState(input);
  switch (event.type) {
    case 'takeover': {
      const sceneId = resolveSceneForLayout(event.sceneId ?? state.sceneId, state.layout);
      return {
        ...state,
        mode: 'guided',
        sceneId,
        hasTakenControl: true,
        completion: sceneId === LAST_SCENE_ID,
        notice: null,
      };
    }
    case 'action': {
      if (state.mode === 'narrative') return state;
      const scene = getShowcaseScene(state.sceneId);
      const asset = getShowcaseAsset(state.sceneId, state.layout);
      const action = scene?.actions.find((candidate) => candidate.id === event.actionId);
      const hotspot = asset?.hotspots.find((candidate) => candidate.id === event.actionId);
      if (!action || !hotspot || action.nextSceneId !== hotspot.nextSceneId) return state;
      if (!hasShowcaseAsset(action.nextSceneId, state.layout)) {
        return {
          ...state,
          notice:
            action.id === 'explain-selection'
              ? 'The explanation step needs a live provider, so this preview continues with Learn this.'
              : 'That destination is not available in this layout. Choose another action or layout.',
        };
      }
      return navigate(state, action.nextSceneId);
    }
    case 'back': {
      const previous = state.pathHistory.at(-1);
      if (!previous) return state;
      return {
        ...state,
        sceneId: previous,
        pathHistory: state.pathHistory.slice(0, -1),
        completion: previous === LAST_SCENE_ID,
        notice: null,
      };
    }
    case 'restart':
      return {
        ...state,
        mode: 'guided',
        sceneId: DEFAULT_SCENE_ID,
        pathHistory: [],
        hasTakenControl: true,
        completion: false,
        notice: null,
      };
    case 'exit':
      return {
        ...state,
        mode: 'narrative',
        pathHistory: [],
        hasTakenControl: false,
        notice: null,
      };
    case 'set-layout': {
      if (!isShowcaseLayout(event.layout) || event.layout === state.layout) return state;
      const sceneId = resolveSceneForLayout(state.sceneId, event.layout);
      return {
        ...state,
        layout: event.layout,
        sceneId,
        pathHistory: state.pathHistory.map((entry) => resolveSceneForLayout(entry, event.layout)),
        completion: sceneId === LAST_SCENE_ID,
        notice:
          sceneId === state.sceneId
            ? null
            : `This scene is not available on ${event.layout}. The nearest equivalent is shown.`,
      };
    }
    case 'set-mode':
      if (state.mode === 'narrative') return state;
      return { ...state, mode: event.mode, notice: null };
    case 'destination': {
      if (state.mode !== 'explore') return state;
      if (!GUIDED_SCENE_SET.has(event.sceneId)) {
        return { ...state, notice: 'That destination is not part of this product preview.' };
      }
      return navigate(state, event.sceneId);
    }
    case 'clear-notice':
      return { ...state, notice: null };
    default:
      return state;
  }
}

export function guidedProgress(state: Pick<ShowcaseState, 'sceneId'>): {
  current: number;
  total: number;
} {
  const index = SHOWCASE.guidedPath.indexOf(state.sceneId);
  return { current: Math.max(0, index) + 1, total: SHOWCASE.guidedPath.length };
}

export function canonicalShowcaseSearch(state: Pick<ShowcaseState, 'sceneId' | 'layout'>): string {
  const params = new URLSearchParams({ scene: state.sceneId, layout: state.layout });
  return `?${params.toString()}`;
}
