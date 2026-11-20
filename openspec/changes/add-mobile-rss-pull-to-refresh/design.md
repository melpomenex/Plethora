## Context

`RSSReader` uses the mobile shell to switch between Feeds, Articles, and Reader. Feeds owns a sidebar scroller. Articles has separate scroll regions for List, Grid, and Magazine, with List supplying its scroll element to the virtualizer. `refreshAllFeeds("manual")` already fetches subscriptions with bounded concurrency, reloads the RSS state, and reports an aggregate result through toolbar feedback. The shared `PullToRefresh` component uses the callback's promise to choose its success or failure state.

## Goals / Non-Goals

**Goals**

- Use each browsing pane's existing scroll position to recognize a pull and keep the refresh indicator visible within that pane.
- Give touch and toolbar users the same all-feed sync semantics, including updated unread counts and accurate failure feedback.

**Non-Goals**

- Gesture integration is limited to the Feeds and Articles content regions in the existing mobile shell. Feed fetches and persistence use the current RSS APIs.

## Decisions

### Attach the shared gesture to the active list

Follow the mobile Queue integration. Place `PullToRefresh` around the scrollable content, below the pane controls, with a full-height gesture area and the inner scroller marked `data-scroll-container`. Explicit markers cover short lists that an overflow check alone would miss. Provide a full-height target for the Articles empty state when subscriptions exist. Keep the List virtualizer attached to its existing scroll element. Contain vertical overscroll on the mobile RSS scroller so the gesture stays within the app in the browser or PWA.

### Await the existing bulk operation

Expose the aggregate outcome from `refreshAllFeeds` and pass it through a gesture adapter that resolves after a successful reload and rejects on a full or partial failure. Keep the operation's result safe for the toolbar, scheduler, and command palette callers that fire and forget. Preserve the worker loop's ability to apply successful updates when individual feeds fail. Use a synchronous reference to the in-flight all-feed promise so overlapping triggers wait on the same run. Disable gesture starts while RSS sync is busy, including during the existing import sync state.

### Preserve pane selection when feed data reloads

The mobile navigation effect currently reacts to the selected feed object. `loadFeeds` can replace that object on refresh even when its identity is unchanged. Use stable selection identity or explicit navigation actions to distinguish a feed being updated from a feed being selected. Keep the active pane, feed or folder scope, and current filter during refresh, while applying the existing manual unread-session reset.

## Risks / Trade-offs

- **Gesture conflict with native scrolling or feed dragging** → Preserve the inner scroll containers, suspend pull recognition during feed dragging, and verify vertical scrolling, feed taps, and drag handles on touch input.
- **Feedback interrupted by React re-renders** → Keep the gesture mounted through reloads and verify that changes to the busy flag and callback leave the shared indicator enough time to show its outcome and reset. Scope any timer cleanup fix to the shared component's lifecycle.
