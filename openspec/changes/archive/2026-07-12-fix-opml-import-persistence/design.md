## Context

When the user imports an OPML file in the web client, the application attempts to upload it to the backend server when host is `localhost` or `127.0.0.1`.
- On success, the API `/api/rss/opml/import` returns `{ imported: count }`. However, the client expects `result.feeds` to contain the imported feeds, which is undefined, resulting in an empty array `importedFeeds` and triggering a false warning "No feeds were found in this OPML file.".
- If the HTTP upload fails, it falls back to locally parsing the OPML content, obtaining `importedFeeds`, and then subscribing to them. However, in non-Tauri mode, it calls `subscribeToFeed(feed)` directly. `subscribeToFeed` only writes to browser local storage, bypassing the HTTP backend (which should be used via `subscribeToFeedAuto`).
- This causes inconsistent states: when the server is responsive, it returns server-side feeds, but when it is down, it falls back to local storage (where the feeds are saved), making the imported feeds appear and disappear.

## Goals / Non-Goals

**Goals:**
- Fix OPML import validation to use `count === 0` instead of `importedFeeds.length === 0` to support server-side responses.
- Update the client fallback subscription loop in `RSSReader.tsx` to use `subscribeToFeedAuto` instead of `subscribeToFeed`, ensuring that local fallbacks correctly try to write to the HTTP backend when available.
- Ensure that the imported feeds list is reloaded correctly via `loadFeeds` after import.

**Non-Goals:**
- Change the server-side OPML import endpoint schema or behavior.

## Decisions

### Update Validation to `count === 0`
- **Option A**: Parse the OPML on the client anyway to verify the list of feeds, even if importing on the server.
- **Option B (Chosen)**: Trust the backend's reported import count. If `count === 0`, report that no feeds were found. This avoids redundant client-side parsing and aligns with backend-driven import design.

### Use `subscribeToFeedAuto` for client-side fallback subscriptions
- **Option A**: Keep using `subscribeToFeed` but add custom HTTP backend check inside `RSSReader.tsx`.
- **Option B (Chosen)**: Use `subscribeToFeedAuto` which is already designed to automatically choose between Tauri backend, HTTP backend, and local storage (fallback). This reduces code duplication and leverages the existing unified subscription abstraction.

## Risks / Trade-offs

- [Risk] If some individual feeds fail to import via the HTTP backend during the fallback loop, they might be logged as warnings, but they will correctly fall back to browser local storage.
