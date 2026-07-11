### Added

- **Android volume-rocker page navigation** — On Android, the volume keys now drive page turns or scrolling inside the EPUB and document readers when a reader mode is enabled, while leaving normal system-volume behavior untouched everywhere else. `MainActivity` forwards `KEYCODE_VOLUME_*` into the WebView as `VolumeUp`/`VolumeDown` keyboard events and only suppresses the system volume change when the reader synchronously calls `preventDefault()`; otherwise it reproduces Android's default volume UI.
- **E-ink page-key support** — The reader navigation handler now also treats `PageUp`/`PageDown` as page-turn keys, so e-ink devices whose firmware remaps the physical page-turn buttons to those keys work out of the box. "Page" mode turns pages once per press (repeats suppressed); "Scroll" mode takes advantage of key repeat for continuous smooth scrolling.

### Fixed & Improved

- **Unified volume-rocker handling** — Extracted the duplicated volume-key logic from `DocumentViewer` and `EPUBViewer` into a single shared `handleVolumeRockerNavigation` utility (with unit tests covering key mapping, repeat handling, and the disabled/no-op path), and promoted `volumeRockerScroll` to a typed `VolumeRockerMode` so both viewers stay in sync.
