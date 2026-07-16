### Added

- **Queue nav remembers your last position** — Clicking the "Queue" entry (sidebar, mobile bottom-nav, and dashboard quick-action) now reactivates whichever queue-related tab you were most recently viewing — the plain list *or* Scroll Mode — instead of always landing on the list. If you were reading inside Scroll Mode and navigated away, tapping "Queue" drops you back on that document at its live position, so you no longer have to notice and re-open Scroll Mode manually. First-time navigation is unchanged: when no queue tab exists yet, it still opens the list.

### Fixed & Improved

- **Stale-tab resilience** — The "most recently active" resolution now skips closed or missing tabs gracefully instead of erroring, with unit tests covering the MRU ordering and the undefined fallback.
