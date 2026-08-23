import type { WebsiteAnalyticsEvent } from '../../config/analytics.ts';
import type { DemoState } from '../../config/demo-contract.ts';
import type { DemoEvent } from './machine.ts';

export function analyticsForTransition(
  prev: DemoState,
  next: DemoState,
  event: DemoEvent,
  started: boolean,
): { events: WebsiteAnalyticsEvent[]; started: boolean } {
  if (event.type === 'restart') {
    return { events: [{ name: 'demo_restart' }], started: false };
  }

  const events: WebsiteAnalyticsEvent[] = [];
  let isStarted = started;
  const engaged =
    event.type === 'advance' ||
    event.type === 'select-kind' ||
    event.type === 'select-passage' ||
    event.type === 'remember' ||
    event.type === 'reveal' ||
    event.type === 'rate';

  if (engaged && !isStarted && next.stage !== 'library') {
    events.push({ name: 'demo_start', kind: next.contentKind });
    isStarted = true;
  }

  if (prev.stage !== next.stage || prev.contentKind !== next.contentKind) {
    events.push({ name: 'demo_stage', stage: next.stage, kind: next.contentKind });
  }

  if (next.stage === 'complete' && prev.stage !== 'complete') {
    events.push({ name: 'demo_complete', kind: next.contentKind });
  }

  return { events, started: isStarted };
}
