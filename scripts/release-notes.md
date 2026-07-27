### Added

- **AI Assistant context menu and mention breadcrumbs** — Added a right-click context menu to the Assistant panel for quick access to copying chat history, clearing history, and extracting/asking about selected text. Mention tags in the Assistant now display breadcrumb paths for sections.

### Fixed & Improved

- **External EPUB streaming** — EPUB files residing outside standard app storage directories (e.g. imported directly from user Documents or Downloads) are now lazily mirrored into app cache storage so the loopback HTTP server streams them smoothly without HTTP 403 authorization failures.
- **Section context resolution resilience** — Added a transparent retry mechanism when resolving AI Assistant section context right after opening a document or section, absorbing transient TOC/text offset discrepancies and eliminating "stale section" warnings.
