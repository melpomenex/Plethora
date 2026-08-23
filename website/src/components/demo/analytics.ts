import type { WebsiteAnalyticsEvent } from '../../config/analytics.ts';
import type { ShowcaseEvent, ShowcaseState } from './machine.ts';

export function analyticsForShowcaseTransition(
  previous: ShowcaseState,
  next: ShowcaseState,
  event: ShowcaseEvent,
): WebsiteAnalyticsEvent[] {
  switch (event.type) {
    case 'takeover':
      return [{ name: 'showcase_takeover', sceneId: next.sceneId, layout: next.layout }];
    case 'action': {
      const events: WebsiteAnalyticsEvent[] = [
        {
          name: 'showcase_action',
          sceneId: previous.sceneId,
          actionId: event.actionId,
          layout: previous.layout,
        },
      ];
      if (!previous.completion && next.completion) {
        events.push({ name: 'showcase_complete', sceneId: next.sceneId, layout: next.layout });
      }
      return events;
    }
    case 'set-layout':
      if (previous.layout === next.layout) return [];
      return [
        {
          name: 'showcase_layout_switch',
          sceneId: next.sceneId,
          fromLayout: previous.layout,
          toLayout: next.layout,
        },
      ];
    case 'restart':
      return [{ name: 'showcase_restart', layout: next.layout }];
    case 'exit':
      return [{ name: 'showcase_exit', sceneId: previous.sceneId, layout: previous.layout }];
    default:
      return [];
  }
}
