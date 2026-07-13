## Why

When importing OPML feeds in web mode, the application uploads the OPML file to the backend server (if host is localhost/127.0.0.1). However, the client-side code behaves incorrectly by checking `result.feeds.length` which is undefined upon a successful server-side import, showing a misleading "No feeds were found" warning. If the server-side call fails, the client falls back to parsing and saving feeds to browser local storage. This creates a state mismatch: when the server is online/available, it returns server feeds (excluding the local storage ones), but when the server is offline/unavailable, it falls back to local storage (showing the imported feeds), causing a "glitchy" experience where subscribed feeds sometimes appear and sometimes do not.

## What Changes

- Update client-side OPML import validation to verify `count` instead of `result.feeds.length` to ensure successful server-side imports are correctly accepted.
- Ensure that if the client falls back to local import in web mode, it utilizes `subscribeToFeedAuto` rather than raw `subscribeToFeed` (which only writes to local storage), facilitating correct propagation to available backends.
- Ensure client-side UI states reload correctly after a successful OPML import.

## Capabilities

### New Capabilities
<!-- Capabilities being introduced. Replace <name> with kebab-case identifier (e.g., user-auth, data-export, api-rate-limiting). Each creates specs/<name>/spec.md -->

### Modified Capabilities
<!-- Existing capabilities whose REQUIREMENTS are changing (not just implementation).
     Only list here if spec-level behavior changes. Each needs a delta spec file.
     Use existing spec names from openspec/specs/. Leave empty if no requirement changes. -->
- `rss-import-navigation`: Modify OPML import validation and fallback subscription logic to correctly persist feeds.

## Impact

- `src/components/media/RSSReader.tsx` (modifying `handleImportOPML` implementation)
