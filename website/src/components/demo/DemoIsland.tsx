import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { WebsiteAnalyticsEvent } from '../../config/analytics.ts';
import { trackWebsiteEvent } from '../../config/analytics.ts';
import { analyticsForShowcaseTransition } from './analytics.ts';
import {
  canonicalShowcaseSearch,
  createShowcaseState,
  guidedProgress,
  parseShowcaseSearch,
  recommendedAction,
  transitionShowcase,
  type ShowcaseEvent,
  type ShowcaseState,
} from './machine.ts';
import { SceneImage } from './SceneImage.tsx';
import {
  NARRATIVE_SCENES,
  SHOWCASE,
  getShowcaseAsset,
  getShowcaseScene,
  type ShowcaseChapter,
  type ShowcaseHotspot,
} from './showcase.ts';
import './DemoIsland.css';

export interface DemoIslandProps {
  search?: string;
  variant?: 'homepage' | 'page';
  track?: (event: WebsiteAnalyticsEvent) => void;
}

const CHAPTERS: ReadonlyArray<{
  id: ShowcaseChapter;
  title: string;
  body: string;
}> = [
  {
    id: 'Collect',
    title: 'Build a working library.',
    body: 'Keep an essay beside books, audio, PDFs, and notes, with the next useful action already in view.',
  },
  {
    id: 'Read',
    title: 'Return to the exact thought.',
    body: 'Plethora reopens the essay where recognition starts to diverge from recall.',
  },
  {
    id: 'Understand',
    title: 'Work with the passage.',
    body: 'Select the claim in context, then choose only the actions the real reader supports.',
  },
  {
    id: 'Remember',
    title: 'Turn reading into retrieval.',
    body: 'Create a focused prompt, reveal the answer later, and grade what you could actually recall.',
  },
  {
    id: 'Return',
    title: 'Let the idea come back.',
    body: 'The review is scheduled, and the remembered claim returns beside its neighboring ideas.',
  },
];

const SCENE_LABELS: Readonly<Record<string, string>> = {
  'library.ready': 'Library ready',
  'reader.open': 'Essay open',
  'reader.selected': 'Passage selected',
  'remember.preview': 'Card preview',
  'review.question': 'Review question',
  'review.answer': 'Review answer',
  'review.scheduled': 'Review scheduled',
  'connections.context': 'Knowledge connections',
};

function liveMessageFor(state: ShowcaseState): string {
  if (state.notice) return state.notice;
  const scene = getShowcaseScene(state.sceneId);
  if (!scene) return 'The product preview returned to its first scene.';
  const action = recommendedAction(state);
  if (state.completion) return `${scene.narration} The guided flow is complete.`;
  return action ? `${scene.narration} Next action: ${action.label}.` : scene.narration;
}

function SimulatorStage({
  state,
  dispatch,
  onAssetFailure,
  focusRequest,
}: {
  state: ShowcaseState;
  dispatch: (event: ShowcaseEvent) => void;
  onAssetFailure: () => void;
  focusRequest: number;
}) {
  const scene = getShowcaseScene(state.sceneId)!;
  const asset = getShowcaseAsset(state.sceneId, state.layout)!;
  const progress = guidedProgress(state);
  const recommended = recommendedAction(state);
  const visibleActionIds =
    state.mode === 'guided'
      ? recommended
        ? [recommended.id]
        : []
      : asset.hotspots.map((hotspot) => hotspot.id);

  function activate(hotspot: ShowcaseHotspot) {
    dispatch({ type: 'action', actionId: hotspot.id });
  }

  return (
    <div
      className={`showcase-simulator showcase-simulator--${state.layout}`}
      data-showcase-simulator
      data-stage={state.sceneId}
      data-mode={state.mode}
    >
      <div className="showcase-simulator__header">
        <div className="showcase-prompt" tabIndex={-1}>
          <p className="showcase-prompt__progress">
            {state.mode === 'explore' ? 'Explore' : `Guided ${progress.current} of ${progress.total}`}
          </p>
          <h3>{SCENE_LABELS[state.sceneId] ?? scene.chapter}</h3>
          <p>
            {state.completion
              ? 'The idea is scheduled and connected. You can explore any captured product moment.'
              : recommended
                ? `Try: ${recommended.label}`
                : scene.narration}
          </p>
        </div>

        <div className="showcase-mode-switch" aria-label="Preview mode">
          <button
            type="button"
            className="showcase-tab"
            aria-pressed={state.mode === 'guided'}
            onClick={() => dispatch({ type: 'set-mode', mode: 'guided' })}
          >
            Guided
          </button>
          <button
            type="button"
            className="showcase-tab"
            aria-pressed={state.mode === 'explore'}
            onClick={() => dispatch({ type: 'set-mode', mode: 'explore' })}
          >
            Explore
          </button>
        </div>
      </div>

      {state.mode === 'explore' ? (
        <label className="showcase-destination">
          Product moment
          <select
            value={state.sceneId}
            onChange={(event) => dispatch({ type: 'destination', sceneId: event.currentTarget.value })}
          >
            {SHOWCASE.guidedPath.map((sceneId) => (
              <option key={sceneId} value={sceneId}>
                {SCENE_LABELS[sceneId] ?? sceneId}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {state.notice ? <p className="showcase-notice">{state.notice}</p> : null}

      <div className="showcase-product-stage" data-layout={state.layout}>
        {state.layout === 'desktop' ? (
          <p className="showcase-detail-hint">Desktop detail. On a narrow screen, pan inside the frame to inspect it.</p>
        ) : null}
        <div className="showcase-product-stage__pan">
          <SceneImage
            asset={asset}
            interactive
            visibleActionIds={visibleActionIds}
            recommendedActionId={recommended?.id}
            focusRequest={focusRequest}
            loading="eager"
            sizes={state.layout === 'desktop' ? '(max-width: 767px) 720px, 72vw' : '390px'}
            onAction={activate}
            onAssetFailure={onAssetFailure}
          />
        </div>
      </div>

      <div className="showcase-controls">
        <div className="showcase-layout-switch" aria-label="Product layout">
          <button
            type="button"
            className="showcase-tab"
            aria-pressed={state.layout === 'desktop'}
            onClick={() => dispatch({ type: 'set-layout', layout: 'desktop' })}
          >
            Desktop
          </button>
          <button
            type="button"
            className="showcase-tab"
            aria-pressed={state.layout === 'mobile'}
            onClick={() => dispatch({ type: 'set-layout', layout: 'mobile' })}
          >
            Mobile
          </button>
        </div>
        <div className="showcase-history-controls">
          <button
            type="button"
            className="showcase-button showcase-button--quiet"
            disabled={state.pathHistory.length === 0}
            onClick={() => dispatch({ type: 'back' })}
          >
            Back
          </button>
          <button
            type="button"
            className="showcase-button showcase-button--quiet"
            onClick={() => dispatch({ type: 'restart' })}
          >
            Restart
          </button>
          <button
            type="button"
            className="showcase-button showcase-button--quiet"
            onClick={() => dispatch({ type: 'exit' })}
          >
            Exit demo
          </button>
        </div>
      </div>
      <p className="showcase-preview-note">
        Guided product preview. Highlighted regions are the available actions.
      </p>
    </div>
  );
}

export default function DemoIsland({
  search = '',
  variant = 'homepage',
  track = trackWebsiteEvent,
}: DemoIslandProps) {
  const parsedSearch = useMemo(() => parseShowcaseSearch(search), [search]);
  const [state, setState] = useState(() =>
    createShowcaseState({
      search,
      mode: variant === 'page' ? 'guided' : 'narrative',
    }),
  );
  const [activeChapter, setActiveChapter] = useState<ShowcaseChapter>('Collect');
  const [isVisible, setIsVisible] = useState(true);
  const [hasHydrated, setHasHydrated] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');
  const [urlReady, setUrlReady] = useState(variant !== 'page');
  const [focusRequest, setFocusRequest] = useState(0);
  const rootRef = useRef<HTMLElement>(null);
  const chapterRefs = useRef(new Map<ShowcaseChapter, HTMLElement>());
  const takeoverRef = useRef<HTMLAnchorElement>(null);
  const resumeRef = useRef<HTMLButtonElement>(null);
  const focusNextRef = useRef(false);
  const restoreExitFocusRef = useRef(false);
  const impressionRef = useRef(false);
  const viewedChaptersRef = useRef(new Set<ShowcaseChapter>());

  useEffect(() => {
    setHasHydrated(true);
  }, []);

  const dispatch = useCallback(
    (event: ShowcaseEvent) => {
      if (event.type === 'exit') {
        focusNextRef.current = false;
        restoreExitFocusRef.current = true;
      } else if (
        event.type === 'takeover' ||
        event.type === 'action' ||
        event.type === 'back' ||
        event.type === 'restart' ||
        event.type === 'set-layout' ||
        event.type === 'destination'
      ) {
        focusNextRef.current = true;
        setFocusRequest((current) => current + 1);
      }
      setState((current) => {
        const next = transitionShowcase(current, event);
        for (const analyticsEvent of analyticsForShowcaseTransition(current, next, event)) {
          track(analyticsEvent);
        }
        setLiveMessage(liveMessageFor(next));
        return next;
      });
    },
    [track],
  );

  useEffect(() => {
    if (variant === 'page') {
      const defaultLayout = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop';
      setState(createShowcaseState({ search: window.location.search, defaultLayout, mode: 'guided' }));
      setUrlReady(true);
      return;
    }
    if (parsedSearch.layout) return;
    const mobile = window.matchMedia('(max-width: 767px)').matches;
    if (!mobile) return;
    setState((current) => transitionShowcase(current, { type: 'set-layout', layout: 'mobile' }));
  }, [parsedSearch.layout, variant]);

  useEffect(() => {
    if (variant !== 'page' || !urlReady) return;
    const query = canonicalShowcaseSearch(state);
    if (window.location.search !== query) {
      window.history.replaceState(null, '', `${window.location.pathname}${query}${window.location.hash}`);
    }
  }, [state.layout, state.sceneId, urlReady, variant]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || (variant === 'page' && !urlReady)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
        setIsVisible(visible);
        if (visible && !impressionRef.current) {
          impressionRef.current = true;
          track({
            name: 'showcase_impression',
            sceneId: state.sceneId,
            layout: state.layout,
            surface: variant === 'page' ? 'demo-page' : 'homepage',
          });
        }
      },
      { rootMargin: '180px 0px', threshold: 0.01 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [state.layout, state.sceneId, track, urlReady, variant]);

  useEffect(() => {
    if (variant !== 'homepage' || state.mode !== 'narrative') return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const chapter = visibleEntries[0]?.target.getAttribute('data-chapter') as
          | ShowcaseChapter
          | null
          | undefined;
        if (!chapter) return;
        setActiveChapter(chapter);
        if (!viewedChaptersRef.current.has(chapter)) {
          viewedChaptersRef.current.add(chapter);
          track({
            name: 'showcase_chapter',
            chapterId: chapter,
            sceneId: NARRATIVE_SCENES[chapter],
            layout: state.layout,
          });
        }
      },
      { rootMargin: '-24% 0px -48% 0px', threshold: [0.05, 0.25, 0.5, 0.75] },
    );
    for (const element of chapterRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [state.layout, state.mode, track, variant]);

  useEffect(() => {
    if (state.mode !== 'narrative' || !restoreExitFocusRef.current) return;
    restoreExitFocusRef.current = false;
    const frame = requestAnimationFrame(() => {
      (variant === 'page' ? resumeRef.current : takeoverRef.current)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state.mode, variant]);

  useEffect(() => {
    if (!focusNextRef.current) return;
    focusNextRef.current = false;
    let frame = 0;
    let attempts = 0;
    const focusRecommendedAction = () => {
      const root = rootRef.current;
      const hotspot = root?.querySelector<HTMLElement>(
        '[data-showcase-hotspot][data-recommended="true"]',
      );
      if (hotspot) {
        hotspot.focus();
        return;
      }
      attempts += 1;
      if (attempts < 60) {
        frame = requestAnimationFrame(focusRecommendedAction);
        return;
      }
      root?.querySelector<HTMLElement>('.showcase-prompt')?.focus();
    };
    frame = requestAnimationFrame(focusRecommendedAction);
    return () => cancelAnimationFrame(frame);
  }, [state.layout, state.mode, state.sceneId]);

  useEffect(() => {
    if (state.mode === 'narrative') return;
    const action = recommendedAction(state);
    if (!action) return;
    const nextAsset = getShowcaseAsset(action.nextSceneId, state.layout);
    const source = nextAsset?.formats.webp.at(-1)?.path;
    if (!source) return;
    const image = new Image();
    image.decoding = 'async';
    image.src = source;
  }, [state.layout, state.mode, state.sceneId]);

  const handleAssetFailure = useCallback(() => {
    track({ name: 'showcase_asset_failure', sceneId: state.sceneId, layout: state.layout });
    setLiveMessage('The product scene could not be loaded. The story and retry control remain available.');
  }, [state.layout, state.sceneId, track]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    const root = rootRef.current;
    const target = event.target;
    if (!root || !(target instanceof HTMLElement) || !root.contains(target)) return;
    if (event.key === 'Escape' && state.mode !== 'narrative') {
      event.preventDefault();
      dispatch({ type: 'exit' });
      return;
    }
    if (!target.matches('[data-showcase-hotspot]')) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const hotspots = [...root.querySelectorAll<HTMLElement>('[data-showcase-hotspot]')];
    if (hotspots.length < 2) return;
    event.preventDefault();
    const currentIndex = hotspots.indexOf(target);
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    hotspots[(currentIndex + direction + hotspots.length) % hotspots.length]?.focus();
  }

  const narrativeSceneId = NARRATIVE_SCENES[activeChapter];
  const desktopNarrativeAsset = getShowcaseAsset(narrativeSceneId, 'desktop')!;
  const mobileNarrativeAsset = getShowcaseAsset(narrativeSceneId, 'mobile')!;

  return (
    <section
      ref={rootRef}
      id={variant === 'homepage' ? 'demo' : undefined}
      className={`reading-desk reading-desk--${variant} ${isVisible ? 'is-visible' : 'is-offscreen'} ${state.mode !== 'narrative' ? 'is-interactive' : ''}`}
      role="region"
      aria-labelledby="reading-desk-title"
      data-home-demo-slot={variant === 'homepage' ? '' : undefined}
      data-testid={variant === 'homepage' ? 'home-demo-slot' : 'demo-page'}
      data-demo-island
      onKeyDown={handleKeyDown}
    >
      <header className="reading-desk__intro">
        <p className="reading-desk__label">Reading Desk</p>
        <h2 id="reading-desk-title">
          {variant === 'page' ? 'Try the Plethora flow.' : 'From first read to useful recall.'}
        </h2>
        <p>
          Follow one licensed, fictional reading through the real Plethora interface, from library to connected recall.
        </p>
      </header>

      {variant === 'homepage' ? (
        <div className="reading-desk__narrative">
          <ol className="reading-desk__chapters" aria-label="Reading Desk chapters">
            {CHAPTERS.map((chapter) => {
              const sceneId = NARRATIVE_SCENES[chapter.id];
              const mobileAsset = getShowcaseAsset(sceneId, 'mobile')!;
              return (
                <li
                  key={chapter.id}
                  ref={(element) => {
                    if (element) chapterRefs.current.set(chapter.id, element);
                    else chapterRefs.current.delete(chapter.id);
                  }}
                  className={chapter.id === activeChapter ? 'is-active' : ''}
                  data-chapter={chapter.id}
                  aria-current={chapter.id === activeChapter ? 'step' : undefined}
                >
                  <p className="reading-desk__chapter-name">{chapter.id}</p>
                  <h3>{chapter.title}</h3>
                  <p>{chapter.body}</p>
                  <div className="reading-desk__chapter-media">
                    {hasHydrated || chapter.id === 'Collect' ? (
                      <SceneImage
                        asset={mobileAsset}
                        sizes="(max-width: 767px) calc(100vw - 40px), 390px"
                      />
                    ) : null}
                  </div>
                  {chapter.id === 'Remember' ? (
                    <a
                      ref={takeoverRef}
                      className="showcase-button showcase-button--primary reading-desk__takeover"
                      href="/demo?scene=review.question&layout=mobile"
                      onClick={(event) => {
                        event.preventDefault();
                        dispatch({ type: 'takeover', sceneId });
                      }}
                    >
                      Try the flow
                    </a>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <div className="reading-desk__stage" aria-label={`${activeChapter} product scene`}>
            {state.mode === 'narrative' ? (
              <div className="reading-desk__device-composition" data-chapter-stage={activeChapter}>
                <div className="reading-desk__desktop-frame">
                  <SceneImage
                    asset={desktopNarrativeAsset}
                    loading={activeChapter === 'Collect' ? 'eager' : 'lazy'}
                    sizes="(max-width: 1180px) 68vw, 820px"
                    onAssetFailure={handleAssetFailure}
                  />
                </div>
                <div className="reading-desk__phone-frame" aria-label="The same scene in Plethora mobile">
                  <SceneImage
                    asset={mobileNarrativeAsset}
                    loading="lazy"
                    sizes="220px"
                    onAssetFailure={handleAssetFailure}
                  />
                </div>
              </div>
            ) : (
              <SimulatorStage
                state={state}
                dispatch={dispatch}
                onAssetFailure={handleAssetFailure}
                focusRequest={focusRequest}
              />
            )}
          </div>
        </div>
      ) : state.mode === 'narrative' ? (
        <div className="reading-desk__resume">
          <p>The preview is paused. Resume at the current product moment or return to the homepage story.</p>
          <p>
            <button
              ref={resumeRef}
              type="button"
              className="showcase-button showcase-button--primary"
              onClick={() => dispatch({ type: 'takeover' })}
            >
              Resume flow
            </button>
            <a className="showcase-button showcase-button--quiet" href="/#demo">
              Reading Desk
            </a>
          </p>
        </div>
      ) : (
        <SimulatorStage
          state={state}
          dispatch={dispatch}
          onAssetFailure={handleAssetFailure}
          focusRequest={focusRequest}
        />
      )}

      <div className="showcase-live" aria-live="polite" aria-atomic="true">
        {liveMessage}
      </div>
    </section>
  );
}
