## 1. Implementation

- [x] 1.1 Update OPML import validation in `src/components/media/RSSReader.tsx` to check `count === 0` instead of `importedFeeds.length === 0`.
- [x] 1.2 Update client fallback subscription loop in `src/components/media/RSSReader.tsx` to use `subscribeToFeedAuto` instead of `subscribeToFeed` (and handle async execution).

## 2. Verification

- [x] 2.1 Run vitest test suite to verify RSS and OPML import functionality works correctly.
