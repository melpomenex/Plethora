### Added

- **Mobile context menus now open as native Android-style bottom sheets** — On phones, right-click / long-press menus (card, deck, and the generic context menu) render as thumb-reachable bottom sheets with a full-screen scrim, instead of desktop-style floating menus. The scrim absorbs the first dismissive tap, so tapping anywhere outside the sheet reliably closes it — fixing the long-standing "menu won't go away" bug where the legacy floating menus swallowed the first tap-away. Submenus that were hover flyouts on desktop (e.g. "Move to Deck", "Set Priority") become drill-in panels with a back button, since hover doesn't exist on touch.

### Fixed & Improved

- **Fixed "Failed to load PDF" on older Android WebViews (e.g. Boox Palma)** — The PDF.js worker is now bootstrapped via `GlobalWorkerOptions.workerPort` (a self-built Worker) rather than a `workerSrc` URL string. Vite rewrites the `new URL(..., import.meta.url)` form into a relative asset reference that resolves correctly under Tauri's custom protocol, and passing a Worker instance skips the throwing `workerSrc` getter that PDF.js's fake-worker fallback was hitting. The new worker entry also installs the `Promise.try` / `Uint8Array.toHex` polyfills PDF.js v5 needs on older WebViews, so the worker no longer throws on its first message.
