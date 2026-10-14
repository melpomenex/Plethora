# Validation

## Passing checks

- `npx vitest run` focused capture, ingress, API, dashboard, navigation, lifecycle, and localization suites: 72 tests passed across 9 files. After the final test additions, the three affected files were rerun: 38 tests passed across 3 files.
- `npm run test:browser-extension`: 56 tests passed.
- `cargo test --lib share_ --no-fail-fast`: 6 tests passed, including capture repository and metadata merge coverage.
- `cargo test -p plethora-folder-import`: 13 tests passed.
- `npx tsc --noEmit`: passed.
- `npx vite build && node scripts/check-bundle-budget.mjs`: passed; measured entry 5 KB, one PDF worker, and 24.4 MB total.
- `npx openspec validate unify-dashboard-capture-activity --strict`: passed.
- `git diff --check`: passed.

## Existing or environment-limited failures

- `npm run build:check` stops in the existing documentation preflight before frontend compilation. It reports missing frontmatter in `docs/product/features/platform/apple-core-ai-packaging.md`, missing `settings`, `actions`, and `## Rationale` in `docs/product/features/platform/ios-capabilities.md`, and a broken `platform.desktop` reference. The standalone TypeScript check and production Vite build passed.
- `cargo fmt --check` reports broad formatting differences across existing Rust files; it was not applied because formatting the repository would create unrelated churn.
- `npm run bench:check` ran all benchmark suites, then failed the performance budget with 14 failures across unrelated areas: command palette selection, precision scheduling, Anki import, audio-edition position lookup, reader speech indexing, TTS cache operations, haptic admission, startup timeline, and tab rendering. It also reported stale-baseline warnings for faster unrelated measurements. This change adds no benchmark and does not alter those code paths, so no unrelated baseline was recalibrated. The production bundle budget passed separately as listed above.
- The host is Linux, with no iOS simulator tooling and no connected Android device or emulator (`adb devices -l` was empty; `emulator` and `xcrun` were unavailable). Native handoff coverage could not be performed.
- The browser inventory exposed only the Codex in-app browser and no desktop extension instance. Responsive preview checks were performed at 390×844 and 768×1024; a wide-desktop preview could not be completed because the local development server exited during resizing. On a subsequent local web-mode startup, the app remained on its loading screen. A live desktop extension save and the full native/desktop appearance and input matrix therefore remain unverified.
- The Impeccable detector completed its initial review and one confirmation pass on the changed UI targets. It returned 46 advisories, all for pre-existing font-size declarations on unchanged lines; it reported no new actionable findings in the changed UI.
