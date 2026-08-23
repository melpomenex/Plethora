import type { WebsiteAnalyticsEvent } from '../../config/analytics.ts';
import { trackWebsiteEvent } from '../../config/analytics.ts';
import type { DemoState } from '../../config/demo-contract.ts';
import { analyticsForTransition } from './analytics.ts';
import {
  INITIAL_DEMO_STATE,
  parseDemoSearch,
  restartDemo,
  transition,
  type DemoEvent,
} from './machine.ts';
import { defaultShellFromUserAgent, toggleShell, type DemoShell } from './shell.ts';

export interface DemoSession {
  state: DemoState;
  shell: DemoShell;
  started: boolean;
}

export function createDemoSession(options: {
  search?: string;
  userAgent?: string;
  shell?: DemoShell;
} = {}): DemoSession {
  const hydrated = options.search
    ? transition(INITIAL_DEMO_STATE, { type: 'hydrate', ...parseDemoSearch(options.search) })
    : { ...INITIAL_DEMO_STATE };
  return {
    state: hydrated,
    shell: options.shell ?? defaultShellFromUserAgent(options.userAgent ?? ''),
    started: false,
  };
}

export function applyDemoEvent(
  session: DemoSession,
  event: DemoEvent,
  track: (event: WebsiteAnalyticsEvent) => void = trackWebsiteEvent,
): DemoSession {
  const nextState = transition(session.state, event);
  const { events, started } = analyticsForTransition(session.state, nextState, event, session.started);
  for (const analyticsEvent of events) track(analyticsEvent);
  return { ...session, state: nextState, started };
}

export function applyShellToggle(session: DemoSession): DemoSession {
  return { ...session, shell: toggleShell(session.shell) };
}

export function applyRestart(
  session: DemoSession,
  track: (event: WebsiteAnalyticsEvent) => void = trackWebsiteEvent,
): DemoSession {
  return applyDemoEvent(session, { type: 'restart' }, track);
}

export { restartDemo, toggleShell };
