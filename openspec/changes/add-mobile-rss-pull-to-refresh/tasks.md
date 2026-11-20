## 1. Bulk refresh and outcome

- [x] 1.1 Expose the aggregate outcome of the existing RSS bulk refresh, coalesce overlapping all-feed requests, and adapt the result for `PullToRefresh`. Test successful sync, partial failure with successful updates still applied, total failure, and overlap with toolbar or scheduled refresh.

## 2. Mobile RSS integration

- [x] 2.1 Attach the shared gesture to the active mobile Feeds or Articles content region. Use the existing scrollers for Feeds and the List, Grid, and Magazine article layouts. Verify that short feed lists and empty article lists with subscriptions accept a pull, while scrolling below the top, short pulls, cancellation, and feed dragging leave the refresh uncommitted.
- [x] 2.2 Keep the active pane and selection stable when refreshed feed objects replace cached objects. Verify that a pull in Feeds after visiting a feed stays in Feeds, and that a pull in filtered Articles updates the selected scope in place while attempting every subscription.

## 3. End-to-end verification

- [ ] 3.1 Exercise the production RSS screen with touch input on native Android and in a mobile browser or PWA. Verify scrolling, the shared armed and outcome states, a retry after failure, the Refresh All button, and in-app refresh without a browser reload. Run the focused RSS and shared pull-to-refresh tests, including existing Queue and document gesture coverage where available.
