# RSS customization verification

## Implemented behavior

- One validated preference contract supplies all readers. Font size applies to rendered paragraphs; fractional line height, family, width, alignment and theme use the same source in basic, full-content, Story and Scroll views.
- The shared dialog portals above bottom navigation, contains keyboard focus, supports Escape, and has responsive tabs and a scrollable mobile body. Drafts load effective values, cancel cleanly, await persistence, retain failed saves, and reset filters along with appearance.
- Card/List/Compact, all densities, responsive Magazine/Grid columns, metadata visibility, independent thumbnails/card height and excerpt length have working rendering paths.
- Five filters and four directional sorts share deterministic helpers. Category data now survives ingestion, SQLite storage, and HTTP/native article mapping. Older articles without categories require a feed refresh to populate them.
- HTTP updates retain field presence, empty strings and explicit null clearing; global/feed/user records are isolated. Native updates merge local records and inherit global preferences. Legacy local reader preferences migrate once in native/local mode; extra reader themes remain supported.

## Automated checks

| Check | Result |
| --- | --- |
| Focused Vitest suites | 5 suites, 29 tests passed |
| Chromium browser regressions | 6 tests passed |
| TypeScript `npx tsc --noEmit` | Passed |
| Production `npx vite build` | Passed |
| `npm run check:bundle` | Passed: entry 5 KB, total 24.3 MB |
| ESLint for changed runtime and browser fixture files | 0 errors, 7 pre-existing warnings |
| Rust `cargo check --lib --manifest-path src-tauri/Cargo.toml` | Passed |
| SQLite/model/category tests | 4 tests passed, including every preference field in the HTTP effective-response round trip |
| OpenSpec strict validation | Passed |
| `git diff --check` | Passed |
| Performance gate | Final isolated `npm run bench:check` passed all 50 baselines and bundle budget. No baseline changes. |

Commands for focused tests:

```sh
npx vitest run src/types/__tests__/rssCustomization.test.ts src/api/__tests__/rss_customization.test.ts src/components/media/__tests__/rssCustomizationPanel.test.tsx src/components/media/__tests__/rssArticleDocument.test.ts src/components/media/__tests__/rssSelectionMenu.test.tsx
npx playwright test src/visual/rss-customization.visual.spec.ts
cargo test --lib --manifest-path src-tauri/Cargo.toml rss_customization -- --nocapture
npm run bench:check
```

The browser fixtures use production reader components and controlled HTTP responses. Tests inspect actual paragraph styles at 390×844 and 1440×1000 (24px font size, 1.7 line height, monospace, justify and light/dark text color), save and reload 28px, hit-test the bottom toolbar beneath the dialog, verify Tab remains in the dialog, and verify Escape restores trigger focus. Layout checks exercise metadata, excerpts, independent image size, columns, all three presentations and all three densities. A 50-article standard-reader fixture scrolls to the final virtualized row for each presentation/density combination. Unit tests cover all filters/sorts, presets, deferred saves, reset, failed saves, reopen, scope changes and native/local inheritance. Rust tests use real SQLite migrations and repositories.

## Validation limits and unrelated failures

- `npm run build:check` stops in the existing documentation validator: `docs/product/features/platform/apple-core-ai-packaging.md` lacks its frontmatter delimiter, and `ios-capabilities.md` has missing required sections and a broken platform.desktop link. The independent type, Vite and bundle checks pass. These unrelated documents were left untouched.
- No physical Android/iOS device or native Tauri WebView smoke test was performed. Browser mobile coverage emulates viewport dimensions and does not certify physical safe-area behavior. HTTP browser tests use a controlled server fixture, supplemented by real backend SQLite tests; an end-to-end running-server/native-device matrix remains open under task 5.2.
- Legacy `reader_*` migration currently covers native/local preference storage; importing browser-local legacy settings into a remote HTTP preference account is not covered.
- Ripwire contract inspection reports the panel parameter-count contract unchanged and no incompatible callers found. Quality scans flag conventional labeled-form/handler duplication and expanded typed Rust field mappings. These were inspected: reusing the general SettingsRow would lose label/control association, and expanded Option<Option<T>> declarations encode the required missing/null distinction. Existing large reader components remain complex; no unrelated architecture refactor was added.

Performance investigation: a concurrent Rust rebuild coincided with nine benchmark failures. Suspending that owned compiler process during measurement reduced this to a borderline unchanged Anki import result (2.212 versus a 2.189 allowed cost). A final isolated full gate passed, confirming no reproducible regression from this change. The compiler resumed after each measurement; unrelated benchmark sources and baselines were not edited.
