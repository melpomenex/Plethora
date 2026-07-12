### Added

- **Deliberate-tap overlay activation in Queue Scroll Mode** — The overlay now requires a stationary tap on non-interactive content to show or hide, so ordinary touch scrolling, swipes, and minor tap jitter no longer reveal rating orbs or controls. A cancellable mobile long press temporarily surfaces the rating controls when you actually want them.
- **Content-only volume-key scrolling** — Hardware volume-key input in Queue Scroll Mode is now limited to document movement and never toggles overlay visibility, preserving both hidden and visible overlay states at scrollable positions and content boundaries.
- **Relocated EPUB controls in Queue Scroll Mode** — Embedded EPUBs no longer show the mobile bottom toolbar; progress, page navigation, table of contents, and reading-settings actions move into the top bar, while standalone EPUB reader chrome is preserved.

### Fixed & Improved

- **Faster RSS feed loading** — Feeds are now fetched with a single IPC call that retrieves the most recent articles across all feeds and groups them in memory, replacing N concurrent per-feed queries.
