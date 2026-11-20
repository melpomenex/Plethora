## Why

On mobile, RSS readers have to reach for the Refresh All button to check for new articles. Pulling down from the top of the feed or article list should refresh subscriptions using the same gesture already available in Queue.

## What Changes

- Add pull-to-refresh to the mobile RSS Feeds and Articles panes. A deliberate pull from the top followed by release refreshes all subscribed feeds, regardless of the visible feed or filter.
- Use the shared mobile refresh indicator for pull progress, sync progress, and the outcome. Keep the current pane visible and update its content in place.
- Keep the Refresh All button available as a tap and accessibility alternative.

## Capabilities

### New Capabilities

### Modified Capabilities

- `mobile-pull-to-refresh` extends the shared gesture and feedback to mobile RSS browsing and defines how it triggers a refresh of all subscriptions.

## Impact

- `src/components/media/RSSReader.tsx` integrates the gesture with the existing manual Refresh All operation and RSS scroll regions.
- `src/components/mobile/PullToRefresh.tsx` provides the shared gesture, localized status, and reduced-motion behavior.
- The change is scoped to the existing mobile shell and RSS client UI.
