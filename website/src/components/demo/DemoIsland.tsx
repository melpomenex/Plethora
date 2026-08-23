import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { WebsiteAnalyticsEvent } from '../../config/analytics.ts';
import { trackWebsiteEvent } from '../../config/analytics.ts';
import { DEMO_CATALOG_CAPTION, itemForKind } from './content.ts';
import type { DemoEvent } from './machine.ts';
import {
  applyDemoEvent,
  applyRestart,
  applyShellToggle,
  createDemoSession,
} from './session.ts';
import { DemoChrome, PhoneFrame, StageScreen, liveRegionText } from './StageScreens.tsx';
import { DEMO_KEYBOARD_HINT, DEMO_REGION_NAME, DEMO_STORY_STEPS } from './story.ts';
import './DemoIsland.css';

export interface DemoIslandProps {
  search?: string;
  userAgent?: string;
  track?: (event: WebsiteAnalyticsEvent) => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export default function DemoIsland({
  search,
  userAgent,
  track = trackWebsiteEvent,
}: DemoIslandProps) {
  const ua = userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const query = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  const [session, setSession] = useState(() => createDemoSession({ search: query, userAgent: ua }));

  const dispatch = useCallback(
    (event: DemoEvent) => {
      setSession((current) => applyDemoEvent(current, event, track));
    },
    [track],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault();
        dispatch({ type: 'advance' });
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        dispatch({ type: 'back' });
      }
    },
    [dispatch],
  );

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const item = itemForKind(session.state.contentKind);
  const live = useMemo(() => liveRegionText(session.state, item), [item, session.state]);

  return (
    <section
      className="demo-island demo-island-wrap"
      role="region"
      aria-label={DEMO_REGION_NAME}
      data-demo-island
    >
      <p className="demo-caption">{DEMO_CATALOG_CAPTION}</p>
      <p className="demo-keyboard">{DEMO_KEYBOARD_HINT}</p>
      <DemoChrome
        shell={session.shell}
        onToggle={() => setSession((current) => applyShellToggle(current))}
        onRestart={() => setSession((current) => applyRestart(current, track))}
        onBack={() => dispatch({ type: 'back' })}
      />
      <PhoneFrame shell={session.shell}>
        <StageScreen state={session.state} dispatch={dispatch} />
      </PhoneFrame>
      <div className="demo-live" aria-live="polite" aria-atomic="true">
        {live}
      </div>
      <h2 className="demo-script-heading">What happens in this demo</h2>
      <ol className="demo-script">
        {DEMO_STORY_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </section>
  );
}
