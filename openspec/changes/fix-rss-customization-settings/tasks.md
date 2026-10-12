## 1. Shared contract and persistence

- [x] 1.1 Consolidate frontend RSS preference types/defaults and add independent thumbnail_size/card_height fields, numeric validation, and effective preference resolution; verify tests cover defaults, enum/range validation, and fractional line height.
- [x] 1.2 Add an additive SQLite migration and extend Rust preference models, repository mappings, and HTTP defaults for reader/layout fields; verify a migrated database and HTTP round trip retain every exposed field.
- [x] 1.3 Implement field-presence-aware HTTP updates and correctly scoped global/feed/user lookups; verify repository tests cover partial updates, explicit null clearing, global inheritance, and isolation between feeds/users.
- [x] 1.4 Merge native raw preference updates and resolve defaults/global/feed overrides consistently with HTTP; verify storage tests cover unrelated-field preservation, clears, and reloads.
- [x] 1.5 Implement idempotent migration of legacy full-content typography/width values with explicit RSS precedence, retaining extra full-content themes without competing typography writes; verify migration tests cover existing values, missing values, and repeated runs.

## 2. Modal state and layering

- [x] 2.1 Initialize the customization draft from effective preferences on open/scope change and discard canceled changes; verify component tests cover reopen, feed switching, and stale async responses.
- [x] 2.2 Await saves, show pending/error state, preserve failed drafts, and stage complete defaults including cleared filters on Reset; verify deferred-save tests and reset/retry behavior.
- [x] 2.3 Preserve decimal slider input and use stable unique radio-group identities; verify selecting 1.7 retains its value and independent groups do not interfere.
- [x] 2.4 Move RSS Customization onto the shared dialog/portal infrastructure above bottom navigation with mobile tabs, scrollable content, safe-area sizing, focus containment, and Escape dismissal; verify mobile screenshot/hit-test coverage and keyboard focus restoration.

## 3. Reader integration

- [x] 3.1 Centralize reader style mapping and apply typography to actual prose elements in the basic preview; verify browser-computed paragraph size, family, fractional line height, alignment, width, and theme respond to changes.
- [x] 3.2 Integrate shared preferences into RSSFullContentView and route inline typography updates through the shared save path; verify controls and modal stay synchronized across rerenders/reloads.
- [x] 3.3 Integrate shared preferences and metadata visibility into Story view; verify the same computed-style and metadata assertions as the basic preview.
- [x] 3.4 Integrate scope-aware preferences, shared reading appearance, filters, and sorting into RSSScrollMode; verify article sequence and rendered styles match the active scope.
- [x] 3.5 Apply theme and author/date/feed-icon visibility consistently across supported reader paths and explain Original-view limitations; verify hidden metadata leaves no separators and theme colors remain readable on desktop/mobile.

## 4. Article presentation and sorting

- [x] 4.1 Give Card, List, and Compact distinct presentations and apply density across standard, Magazine, and Grid layouts; verify representative browser screenshots and virtualized scrolling at each density.
- [x] 4.2 Implement independent thumbnail size, thumbnail visibility, card height, and excerpt length; verify Small/Large visibly differ and card/image changes preserve the excerpt setting.
- [x] 4.3 Wire responsive column counts into Magazine and Grid and honor metadata settings across applicable layouts; verify wide/narrow viewport column counts and author/date/icon toggles.
- [x] 4.4 Extract or reuse shared filter/sort logic with plain-text reading-time estimates, deterministic tie handling, and correct directional labels; verify all five filters and all four sorts in both directions using representative articles, ties, and missing dates.
- [x] 4.5 Replace unsupported smart-view claims with documented Compact List, Reading List, and Unread First presets, and localize applicability hints/labels; verify preset field combinations and saved/reloaded behavior, including unread precedence.

- [x] 4.6 Preserve article categories through ingestion, SQLite persistence, and HTTP/native mapping; verify parsed categories survive an article round trip and still match the category filter after reload.

## 5. Integration verification

- [x] 5.1 Run focused frontend and Rust persistence tests, frontend type/build checks, and lint for changed files; record exact commands/results and resolve failures attributable to this change.
- [ ] 5.2 Exercise the complete settings matrix on desktop/mobile across standard, Magazine, Grid, basic preview, full-content, Story, and Scroll, in native and HTTP modes; record observed behavior after Save, reopen, feed switching, Reset, and reload, including modal coverage of bottom navigation.
- [x] 5.3 Run `npm run bench:check` locally and investigate any regression; if an intentional performance/bundle change is required, update its baseline with written rationale and run the applicable script tests.
- [x] 5.4 Validate the completed change with `openspec validate fix-rss-customization-settings --strict` and document remaining platform limitations without marking unverified checks complete.
