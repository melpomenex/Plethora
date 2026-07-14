### Added

- **6-state rating joystick for SM-18 / SM-20** — On touch devices, the classic 4-direction swipe-to-rate is replaced by a drag-anchored "stick shift" joystick that exposes all six native grades (0–5). Press and drag anywhere on the card: up-row zones give pass grades (Hard / Good / Easy), down-row zones give fail grades (Blackout / Wrong / Almost). The knob follows your thumb, each zone lights up in its grade color, and a haptic tick fires whenever you cross into a new zone. Release in a zone to rate; release in the dead-center to cancel. The native grade now flows end-to-end so SM-18/SM-20 no longer squeeze six grades into four buttons. FSRS / SM-2 and desktop are unchanged (4-axis swipe + tappable grid + keyboard 0–5).

### Fixed & Improved

- **SM-20 preview inversion on imported .apkg cards** — Imported Anki decks land with a zeroed FSRS memory state (`difficulty = 0.0`), which mapped to an out-of-distribution edge bucket of the M3 matrix and collapsed the pass-branch interval below the fail-branch — so the transparency panel showed an inverted preview (fail > pass) and cards scheduled incorrectly. The fallback path now coerces degenerate difficulties to the SM-20 default (0.3). A regression test guards this.
- **Native-grade detection widened to SM-18** — SM-18 shares SM-20's 0–5 grade scale (pass ≥ 3), so the native 6-grade UI now activates for both algorithms instead of SM-20 alone.
- **Stale SM-20 optimizer import removed** — A leftover dynamic import in the learning settings screen (already unused) was removed, fixing a Vercel build failure path.
