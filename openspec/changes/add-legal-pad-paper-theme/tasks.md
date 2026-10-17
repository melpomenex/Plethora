## 1. Baseline and integration contracts

Phases reference decisions D1–D18 in `design.md` and tests T01–T16 in `test-matrix.md`. Checked entries record verified implementation work; unchecked entries remain open, including implemented adapters whose complete acceptance evidence is pending. Mandatory order: 1 → 2/3 → 4. Asset production (3) and schema/resolver work (2) can proceed independently after 1. Once 4 is stable, chrome (5), HTML (6), EPUB (7), PDF/Markdown (8), and RSS (9) can proceed independently in distinct files, coordinating shared resolver changes. Mobile/display (10), controls (11), and accessibility (12) can overlap reader work after their contracts exist; final gates (13) depend on all integrations. Parallelism is a task dependency plan, not a request to spawn agents now. HDR future exploration is excluded from these implementation tasks.

- [x] 1.1 Reconcile current HEAD/working tree against the investigation anchors and active EPUB/RSS/assistant/geometry changes; produce an ownership note in `docs/theme-materials/legal-pad/validation.md` and verify no unrelated work is overwritten.
- [ ] 1.2 Record baseline theme/startup/readers and benchmark/bundle state using current scripts, with fixed fixture/runtime versions; verify baseline failures and measurements are separated from candidate changes and no invented measurements enter the report.
- [ ] 1.3 Establish deterministic HTML/EPUB/PDF/RSS/Markdown fixtures listed in test-matrix, with original-file hashes; verify fixture licensing, offline operation and all document classifications/layout metadata used by tests.

## 2. Schema, palette, applied appearance and settings

- [x] 2.1 Add optional registered paper metadata and `BUILTIN_THEMES.LEGAL_PAD` in `src/types/theme.ts`; add allowlisted `src/themes/materials.ts` and normalization; verify T01 accepts legacy/unknown/invalid imports and rejects arbitrary resource references.
- [x] 2.2 Add `src/themes/legalPad.ts` with D7 candidate palette and explicit warm Material roles, inheriting incumbent chrome scales; register it in builtin and eager fallback without static catalog import; verify builtin deduplication, static/light classification, role and alias tests, and deliberately update the picker catalog-count assertion.
- [x] 2.3 Extend ThemeContext with additive `appliedTheme` and a memoized resolved-appearance hook using `src/themes/resolveThemeAppearance.ts`; retain committed `theme`; verify preview/commit/revert semantics and existing materialRoles/rating/modeAccent context tests.
- [x] 2.4 Add normalized `appearance.materialPreferences` keyed by preset with D15 defaults and nested merge; preserve in-progress settingsStore changes; verify persisted partial/invalid/reset/reload cases and existing settings migration suites.
- [x] 2.5 Resolve effective accessibility/resource flags and trusted asset/density choice independently from saved settings; verify T02/T13 behavior and no unsupported hint is interpreted as a proven capability.
- [x] 2.6 Extend HTML reader token resolution to accept effective appearance and composited asset bounds while reusing existing color helpers; verify contrast tests, theme-first ordering and E-Ink/preview output without adding P3 parsing to numeric color helpers.

## 3. Production paper asset pipeline

- [ ] 3.1 Acquire/author a rights-cleared paper source per D3 and create source/provenance/license records under `assets/theme-materials/legal-pad/`; verify scale/color target, source rights and absence of rules/edges/glare/unique coarse motifs before derivative work.
- [ ] 3.2 Produce 4096 master and seamless 2048 working source, separate fibers/macro variation and document reproducible processing; verify offset seams plus 3×3 tiling and 100% physical-resolution phone crop reviews.
- [ ] 3.3 Export all D3 named WebP grain/detail/density derivatives, PNG fallbacks, macro variants and preview into `public/theme-materials/legal-pad/v1/`; verify dimensions/alpha/profile/byte ceilings and lossless crop comparisons.
- [ ] 3.4 Create manifest with hashes, source/license/encoder settings, color/luminance extrema and total byte budget; verify automated asset checks and composed worst-patch contrast inputs against each D7 base.
- [x] 3.5 Implement bounded host decode preparation and absolute trusted URL resolution, with one fallback attempt and stale revision guards; verify mocked preferred/PNG failure, remote-base isolation and no eager decoding of other variants.
- [ ] 3.6 Integrate bounded baseline material into existing `public/sw.js` cache/version policy and native packaged asset paths; verify first offline activation after install, cache refresh cleanup and failure-to-color behavior without caching all high-density variants eagerly.

## 4. Reusable static material primitives

- [x] 4.1 Implement the single background recipe in `src/themes/paperMaterialCss.ts` and `src/styles/paper-material.css`, imported through existing styles; verify A→F paint order, role-specific fills and explicit layer size/repeat/position lists (T04).
- [x] 4.2 Add opt-in chrome/reading/inset markers to existing surface owners, with no anchored-content wrappers/pseudo-elements; verify pointer hit tests, selection node identity and compatibility with md-state/focus/radius clipping.
- [ ] 4.3 Implement D4 detail/DPR ceilings and D6 pane-width rules/margin eligibility using existing layout/pane sizing; verify 320/360/390/768 widths, RTL/landscape/zoom, fixed texture scale and margin outside content without padding changes.
- [x] 4.4 Add central appearance apply/cleanup and async cancellation across theme switches; verify T03/T15 remove material variables/attributes/image references and preserve animation/vibrancy behavior on incumbent themes.

## 5. Application shell and navigation coverage

- [ ] 5.1 Apply unruled material to AdaptiveAppScaffold/MainLayout shell owners, body/root edges and toolbar placements; verify no data-theme-animation for paper, no blanket transparency, and no hidden texture behind opaque utility wrappers.
- [ ] 5.2 Integrate `Toolbar.tsx`, `common/Tabs.tsx`, mobile wrapper/navigation and safe-area fills using existing surface tokens; verify desktop top/left/right navigation and mobile fullscreen/nav boundaries through T05/T14 captures.
- [ ] 5.3 Integrate DashboardTab, DocumentsTab and actual library grid/list/card children identified by imports; replace only obscuring palette literals; verify readable metadata, unchanged cover pixels and both full/empty/loading layouts.
- [ ] 5.4 Integrate settings/search/CommandCenter/CommandPalette/context-menu owners and their local palette tokens; verify opaque result/popover surfaces, keyboard focus and existing command-palette visual contracts.
- [ ] 5.5 Extend shared md3/dialogSurface/Modal/ResponsiveDialogSheet/menu/toast surfaces for paper insets without changing portals/z-contracts; verify keyboard Escape/focus restoration and mobile modal occlusion tests.
- [ ] 5.6 Integrate assistant desktop/mobile conversation, response/composer/input surfaces; verify selected text and attached media remain accurate, keyboard reachability and existing assistant scope/composer tests pass.
- [ ] 5.7 Integrate queue/review/flashcard/extract/annotation/knowledge-panel chrome, retaining graph scenes and semantic rating tokens; verify T05 study flows and no paper filter on canvas/media/graph content.
- [ ] 5.8 Audit touched app surfaces for remaining opaque white/gray fills, gradients, skeleton/error/empty states; deliver coverage checklist with screenshots and verify each T05 owner has an intentional paper or source-media treatment.

## 6. HTML and rich extract readers

- [x] 6.1 Feed resolved applied appearance into DocumentViewer and article/compatibility builders via existing reader token/stylesheet interfaces; verify canonical/raw/browser/arXiv/OCR backgrounds and nonce-authorized style update in T06.
- [ ] 6.2 Separate initial compatibility cleanup from live appearance updates; preserve app stylesheet and article/anchor nodes; verify Range/node identity, persisted annotations, search and TTS during preview/revert/typography changes.
- [ ] 6.3 Apply material to correct html/body/page/inset owners without new universal resets; protect retained equations, SVG/semantic diagrams, tables, code and images; verify hostile-source sanitation, remote base and actual source hash invariance.
- [ ] 6.4 Update RichContentRenderer expanded-frame appearance in place from the applied snapshot, preserving sandbox/blob lifecycle and small unruled previews; verify T09/T13 live theme/accessibility updates without frame navigation.

## 7. EPUB appearance and lifecycle

- [ ] 7.1 Add normalized `documents.epubSettings.appearance=app|publisher` default app and localized two-choice reader control; verify persisted legacy defaults, explicit choice, and no interference with existing font/size/line-height preferences.
- [x] 7.2 Resolve package/spine layout precedence and cover classification before applying overrides; verify EPUB2 defaults, mixed per-section fixed layout and conservative unknown cases with fixture tests.
- [ ] 7.3 Integrate material through rendition default/select, override style and critical inline fallback paths; keep explicit rendition-before-display, insertRule guard and first-content verification; verify realistic content hooks and T07 no-flash readiness under stylesheet failure.
- [ ] 7.4 Gate publisher stylesheet/inline cleanup and universal resets by app+reflow compatibility; verify fixed/cover/original fixtures keep original styles, graphics/semantic colors and book layout.
- [ ] 7.5 Implement Original book restoration from immutable source when app cleanup already occurred, saving/restoring CFI and existing listener ownership; verify app→publisher→app toggles preserve location and reading actions without stale geometry.
- [ ] 7.6 Update all present/future frames on applied snapshot/accessibility changes, clean hooks/subscriptions on destruction and guard late decode; verify chapter churn, preview/revert and retained selection/TTS/CFI navigation.

## 8. PDF, Markdown and other document surfaces

- [ ] 8.1 Add paper surroundings to original PDF page/crop/column modes without touching render background, canvas pixels or z1/z2/z3 stack; verify T08 original-canvas equality and text-layer alignment under selection/zoom.
- [ ] 8.2 Apply paper to canonical and legacy reflow only for existing reflowTheme=system; preserve explicit light/dark and figures/graphical fallbacks; verify both renderers, OCR text, image scaling and source-anchor navigation.
- [ ] 8.3 Apply paper to existing Markdown/plain-text scroll owners, preserve renderMarkdown and surgical highlights/search; verify T09 text offsets/copy/paste/annotations/math/code/table and unchanged typography controls.
- [ ] 8.4 Check remaining DocumentViewer/TabRegistry formats and OCR/export fallback paths; verify text-based compatible content gets the intended paper owner while original media/live cross-origin pages retain source rendering.

## 9. RSS integration and override semantics

- [x] 9.1 Extend shared RSS appearance resolution from `rssReadingStyle` with the applied snapshot; retain defaults/global/feed/null precedence and explicit palette enums; verify all T10 preference cases and no schema/migration regression.
- [ ] 9.2 Replace RSSFullContentView's system→uiStore light/slate path with shared resolution; integrate viewport/header/content/link/controls while retaining explicit palette branches; verify all six existing theme modes and preview/revert.
- [ ] 9.3 Integrate basic/Story reader and both RSSScrollMode reading owners; verify font/width/line-height preferences, selected text/annotations/assistant and no texture per article generation.
- [ ] 9.4 Integrate RSS feed card/list/compact/magazine/grid/navigation/preview owners using unruled chrome and ruled expanded reading; verify layout switching, thumbnails/figures and sticky headers in T10 captures.
- [x] 9.5 Relabel persisted system choice as App theme, preserve existing legacy preference migration and save/reset error handling; verify global/feed isolation, null reset and async feed navigation with current native/browser APIs.

## 10. Mobile continuity and color capability

- [ ] 10.1 Add guarded legal-pad prepaint palette restoration through the existing trusted startup path and eager fallback definition; verify saved-theme cold launch, CSP and loading/error boundaries on packaged Android/iOS without blocking on textures.
- [ ] 10.2 Complete safe-area/keyboard/orientation/fullscreen presentation using existing useVisualViewport/mobile geometry; verify T14 filmstrips, no stretching/seams/white frame and native gestures/selection handles on A/C.
- [ ] 10.3 Add fail-closed P3 syntax/gamut gates and initially empty or evidence-backed tested-platform allowlist; emit colorimetrically matched CSS overrides only; verify forced capability-off SDR, no parseColor P3 input and display-move handling.
- [ ] 10.4 Verify and record display-tier status on mandatory platform classes, keep production HDR disabled regardless of media queries and document native/browser differences; verify no HDR badge, brightness setting or unsupported native config change ships.

## 11. Appearance controls and previews

- [x] 11.1 Add three localized D15 paper controls and reset in existing Appearance settings, visible for committed paper theme; verify nested persistence, resource-downgrade helper, defaults and ruling/margin dependency without saving effective policy.
- [x] 11.2 Replace Legal Pad flat-only swatch with bounded real-material sample and extend gallery preview through the shared recipe; verify texture/ruling visible, no animated badge, offscreen preview asset laziness and existing picker search/keyboard behavior.
- [ ] 11.3 Verify full preview lifecycle across host/HTML/EPUB/RSS/extracts and selection/bookmarks; exercise hover/focus/Enter/Escape/close/unmount and reload, asserting no persisted preview changes or material leakage (T03/T15).

## 12. Accessibility, contrast and content integrity

- [ ] 12.1 Generate a contrast report from actual composed texture extrema for every text/foreground/control/state pair, including ruling, highlights, code/table/inset surfaces; calibrate D7 palette/asset amplitudes until D16 thresholds pass and record approved values/hashes.
- [ ] 12.2 Integrate live E-Ink/forced-colors/high-contrast/reduced-transparency states into host and frames; verify decoration suppression, readable system/monochrome colors and original-media behavior without changing saved choices.
- [ ] 12.3 Scope highlight/search/TTS presentation improvements to paper-compatible text/reflow surfaces, preserving stored IDs/colors and original PDF page overlays; verify distinct non-color cues and readable selected text.
- [ ] 12.4 Exercise keyboard focus/navigation/screen-reader semantics, 320px reflow, 200% zoom and reader font12/20/32 controls, native touch/copy/selection/extract/TTS/CFI; verify T11/T13 pass without new text wrappers or source mutations.

## 13. Automated, visual, native and release gates

- [ ] 13.1 Add/extend focused unit/integration suites for schema/normalizers/appearance/assets, ThemeContext/ThemePicker, all reader lifecycles and RSS precedence; verify T01–T15 assertions including failure/error/cancellation cases pass using production-shaped mocks.
- [ ] 13.2 Extend scholarly reader and add legal-pad visual harness/spec plus deterministic fixtures and screenshot groups in test-matrix; verify actual decoded texture pixels at DPR1/2/3, all required surfaces and reviewed goldens without blanket refresh.
- [ ] 13.3 Run paired startup/theme-switch/scroll/chapter/RSS/idle/memory profiles on mandatory platform classes with controlled fixtures; verify T16 targets, no growing resource retention and source hash equality, recording traces and unresolved platform gaps honestly.
- [ ] 13.4 Run physical Android/iOS steady-state power/thermal and native selection/transition checks per test-matrix; verify targets through repeated paired evidence, or reduce effective detail and rerun the affected checks before platform acceptance.
- [ ] 13.5 Run current type/build/focused-lint/script tests, targeted visual/material-contract suites and `npm run bench:check` locally; verify failures are triaged, deterministic seeded benchmark protocol retained and any intentional budget/baseline change has measured rationale.
- [ ] 13.6 Confirm incumbent snow/obsidian/jellyfish/custom themes, original PDF/fixed-layout EPUB, offline activation and failure fallback; verify T15 no material leakage or changed animation/Linux graphics policy.
- [ ] 13.7 Complete `docs/theme-materials/legal-pad/validation.md` with coverage, calibrated palette, asset/license manifest, measured-vs-target results, native evidence and SDR/P3/HDR status; verify all mandatory rows are passed and optional unknowns disclosed before marking implementation complete.
- [ ] 13.8 Document user controls, App theme vs explicit/original behavior, offline/fallback and rollback; run `openspec validate add-legal-pad-paper-theme --strict` and verify every normative requirement maps to passed evidence before archiving the implementation change.
