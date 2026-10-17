# Validation and acceptance plan

This is a plan, not a test report. No application build, new texture, device capture, contrast certificate, performance measurement, HDR output verification, or production golden has been produced by this proposal. All numeric limits below are **proposed acceptance targets** until implementation measures them. Existing goldens establish incumbent layout, not a Legal Pad visual target.

## Evidence and reproducibility

Record build SHA + local diff, asset manifest hashes, OS/device/WebView provider/version, screen profile/DPR, accessibility/detail/reader preferences, dataset, tool/version, ambient conditions, brightness and refresh-rate settings. Store an implementation report under `docs/theme-materials/legal-pad/validation.md`, linked to screenshots/traces and asset `manifest.json`. Use device-local artifacts or appropriate repository-size-controlled links; redact user content and use deterministic fixtures.

For paired performance measurements use current unchanged baseline and candidate with identical fixture/settings/runtime: alternate A/B order, 3 warmups then ≥20 timing runs, medians and p95, no background sync/transcription/downloads. Cold startup requires ≥10 cold-process launches per build; label cold filesystem/cache state rather than assuming reboot clears everything. Power requires ≥3 paired 20-minute steady-state runs with fixed brightness/refresh/network state; stabilize temperature first and report variance. If measurement noise obscures a threshold, repeat under controlled conditions; do not manufacture a pass or change a baseline solely to silence a failure.

## Platform classes

| Class | Required environment / purpose |
|---|---|
| A | Physical Pixel 9 Pro XL or equivalent DPR≥3 OLED Android 14+; actual packaged Tauri WebView, system provider/version recorded; portrait/landscape, native selection, chapter transition, power. Compare Chrome separately. |
| B | Physical 4 GiB Android LCD phone DPR2 (e.g. representative Moto G class), installed supported OS/provider; Subtle/Authentic resource fallback, 60Hz scrolling. |
| C | Physical recent OLED iPhone (e.g. iPhone 16 Pro or newer), supported installed iOS and WKWebView; safe areas, keyboard sheet, native selection and app/PWA comparison. Device availability is not claimed here. |
| D | iPad/tablet or equivalent 768–1024 CSS px reading pane, split view; pane-size ruling and density, portrait/landscape. |
| E | Linux desktop on Intel/AMD hardware acceleration at DPR1; release build WebKitGTK/version recorded, 1280×900 and resizable 1440×1000. |
| F | Linux software/llvmpipe path using existing `PLETHORA_GPU_MODE=software`; plus NVIDIA native installation if in release support pool, preserving policy. |
| G | Windows 11 + installed WebView2, ordinary sRGB LCD and HDR-capable monitor with OS HDR both off/on; SDR theme consistency, move between displays. |
| H | macOS WKWebView on P3 display, optional external SDR monitor; gamut gates, DPR changes, window moves; no HDR claim. |
| I | Browser/PWA Chromium and WebKit-based environments, online/offline, forced-colors and reduced-transparency capability as available; PWA refresh/offline restore after installation. |
| J | E-Ink phone/tablet or known existing emulation + one physical supported e-paper device before claiming physical e-paper QA; plain monochrome and original-media preservation. |

Mandatory release rows are A/B/C/E/F/G/H/I; D/J can use responsive/emulated coverage initially but physical status must be disclosed in validation. An unavailable mandatory native device means its platform acceptance remains pending, not passed. Do not substitute a simulator for OLED/P3/power/native-selection evidence. Production HDR is disabled on every class; no physical HDR experiment is required to ship this SDR-first feature.

## Fixtures

- Small real EPUB3 reflow fixture with two chapters, persisted CFI, TOC, SVG/math, inline cover, illustrations, semantic color legend, ruby/RTL and typography controls; an EPUB2 fixture with default layout semantics.
- Mixed EPUB with per-spine `pre-paginated` section override, separate fixed-layout illustrated book, cover-only section and missing/malformed layout metadata; source files/checksums immutable.
- HTML canonical scholarly article with abstract, hero/figure, caption, table overflow, footnotes, MathML/KaTeX, code and references; browser-capture/raw/arXiv/OCR-HTML fixtures; injected hostile style/script + remote base URL fixture; capture-failed recovery notice.
- PDF with text, colored chart, equation, image and scanned page; all page/crop/columns/original modes, canonical/legacy reflow, OCR fallback. Use same render engine/font/runtime for original-pixel comparisons.
- Markdown/plain-text fixture with headings/lists/code/table/math/images, persisted annotation and search anchors.
- RSS deterministic global/two-feed store, conflicting explicit overrides, 500 article list and ≥50 long articles, images/tables, basic/full/Story/Scroll readers, magazine/grid/list/compact layouts; no live network dependency.
- Dashboard/library with ≥200 documents; queue/flashcards/extracts/assistant/knowledge panel; each loading/empty/error state. Use existing visual-harness stubs for APIs; do not require live LLM or public feed.

## Automated coverage and acceptance mapping

| ID | Requirement / test | Assertions |
|---|---|---|
| T01 | Registration + schema (`legal-pad-theme`) | ID/name/light/static classification; catalog deduplication and lazy/fallback equality; no animation effect; all roles/aliases valid; legacy/custom theme normalization and import/export behavior. |
| T02 | Material bounds (`paper-theme-material`) | All manifest URLs local and licensed; dimensions/bytes/hashes/profiles/alpha match; density table and effective resource limits; WebP failure→PNG→plain paper; no repeat retry loop. |
| T03 | Preview/persistence (`legal-pad-theme`) | Pointer/keyboard preview, cancellation, Escape, close/unmount, commit and reload; committed settings unchanged by preview; frames/host all see same revision; nested defaults/reset and theme switch cleanup. |
| T04 | Layer/owner contract (`paper-theme-material`) | Computed backgrounds contain recipe on named owners, children don't hide it; rules off for chrome; no decor DOM in anchor subtree, no animation/canvas/filter/negative stacking or pointer interception. |
| T05 | Global surface inventory (`legal-pad-theme`) | Dashboard/library cards/list/grid/sidebar/toolbar/tab/mobile-nav/settings/search/palette/dialog/sheet/context-menu/assistant/composer/queue/flashcard/extract/knowledge chrome/empty/loading/error; opaque panel and readable focus/state/bounds. |
| T06 | HTML (`html-viewer-theming`, `themed-html-rendering`) | All classifications; effective reading/inset backgrounds; same stylesheet and live Range/node/anchor identity during theme preview; nonce style applied under packaged CSP, untrusted style blocked; material URL resolves host origin despite remote base; sanitization/source unchanged. |
| T07 | EPUB (`paper-reader-integration`) | Call-order guard before display; actual content hooks + rendered backstop; insertRule failure; all open/future chapter frames agree; no initial white frame; app→app style-only CFI stability; original/fixed/cover skip cleanup; publisher restore and CFI/listeners on toggle; destruction/late decode cleanup. |
| T08 | PDF (`paper-reader-integration`) | Original canvas pixels identical with paper off/on and same source/settings (mask unchanged interaction overlays); no filter/renderer config changes; text-layer bounds/selection unchanged; system reflow paper; explicit light/dark no material; canonical/legacy/OCR/graphical fallback work. |
| T09 | Markdown/text/extracts (`paper-reader-integration`, `themed-html-rendering`) | Host paper present, live extract iframe style update without iframe reload, valid source links, same anchor offsets, semantic code/table/math/image preservation, blob lifecycle intact. |
| T10 | RSS (`paper-reader-integration`) | System follows actual applied theme/preview; global/feed/null precedence; explicit light/dark/sepia/slate/oled preserved; full-content does not resolve app choice through uiStore variant; all reader/layout paths and selection/assistant work. |
| T11 | Touch/selection/accessibility | Pointer hit testing under decor, native handles manual pass, drag-to-select/copy/extract/annotation/search/TTS/EPUB CFI; keyboard focus/reader order; no changed bounds for pure material switch; 200% zoom and 320 CSS px readable reflow. |
| T12 | Contrast / color tiers | Composed texture extrema + state/highlight interactions meet thresholds; sRGB fallback and matched P3 fixtures; force unsupported CSS/gamut; production HDR stays disabled even when dynamic-range high reports true. |
| T13 | E-Ink / high contrast | Live toggle changes host and frames; no decor, monochrome roles, crisp controls, original media unchanged unless user's grayscale setting; forced-colors system colors; reduced-motion static paper retained without transitions. |
| T14 | Mobile startup and resilience | Saved legal-pad eager fallback, guarded bootstrap and packaged CSP, orientation/keyboard safe areas, old texture resolves after switch ignored, asset/network/decode failures readable, offline restore, no white frame exposure after known appearance. |
| T15 | Existing theme regressions | Snow, obsidian-noir, animated jellyfish and custom no-material themes preserve incumbent roles/layout/visibility; no material URLs/attributes/style leftovers or changed animation policy. |
| T16 | End-to-end resources | Budgets below, long scroller RSS/EPUB chapter churn, hidden/unfocused idle; decorate no new frame scheduler and no scroll React commits. |

## Screenshot golden plan

Extend `src/visual/scholarlyReaderHarness.ts` and existing entrypoint for HTML; add `src/visual/legalPadHarness.tsx`, `public/legal-pad-harness.html`, and `src/visual/legal-pad.visual.spec.ts` for shared chrome, reader fixtures, preview and error/override variants. Integrate actual production styles/components; no hand-drawn substitute paper. Browser tests verify both computed CSS and pixels, since a declaration alone cannot prove a successful image decode. Fix font/image loading and texture phase before capture. New goldens require visual review; the existing 2% pixel allowance is a ceiling, not permission to overlook seams or unreadable text.

Use names `legal-pad-{surface}-{viewport}-{detail}-{appearance}.png`. Viewports are **CSS px**; include DPR in test context/output metadata and use distinct snapshot names for DPR variants.

| Capture group | Viewport / DPR | States |
|---|---|---|
| Chrome overview: dashboard/library/nav | 390×844 / 3, 1280×900 / 1 | Authentic SDR; actual thumbnail/code/status content |
| Settings + picker/gallery + dialog/palette | 390×844 / 3, 1280×900 / 1 | Actual paper preview, focus, commit/revert; portal sheets with keyboard open |
| HTML scholarly reader | 390×844 / 3, 844×390 / 3, 768×1024 / 2, 1280×900 / 1 | Authentic SDR font16/line1.6; image, equation, table overflow and abstract |
| HTML detail/type/zoom | 390×844 / 3, 360×800 / 2 | Subtle, Maximum, ruling off, margin auto-hidden; font12/20/32 and 200% zoom; no baseline-grid expectation |
| EPUB | 390×844 / 3, 844×390 / 3, 1280×900 / 1 | Reflow, chapter2, original, cover and fixed layout; theme preview/cancel |
| PDF | 390×844 / 3, 768×1024 / 2 | Original with paper surrounds, canonical + legacy reflow, explicit dark/light, selected text and original figure fallback |
| Markdown/plain/extract | 390×844 / 3, 1280×900 / 1 | Highlight/search/TTS, rendered code/table/math; expanded rich extract |
| RSS | 390×844 / 3, 844×390 / 3, 1280×900 / 1 | Feed card/list + magazine/grid, basic/full/Story/Scroll reading; system and explicit sepia/oled overrides |
| Assistant/review/knowledge | 390×844 / 3, 1280×900 / 1 | Composer focused, conversation/selection sheet, queue/flashcard/rating/extract; untouched graph scene |
| Accessibility/fallback | 390×844 / 3, 1280×900 / 1 | E-Ink, forced colors, high contrast, reduced detail/transparency, missing assets, SDR capability off; side-by-side matched P3 patch capture is diagnostic only |
| Incumbent regressions | Existing committed viewport contexts | Snow/obsidian/jellyfish/custom; no wholesale golden refresh |

Pair browser screenshots with filmstrip captures during actual device startup, navigation and EPUB chapter transitions; sampled still goldens cannot prove absence of flashes. Any single exposed white/un-themed frame after appearance is known is a defect, even if the final screenshot looks correct. Browser fake media-query results test fallback logic, not true P3/HDR output.

## Performance targets and method

Compare candidate to the same build with no paper decoration, plus a real default static theme for overall overhead. Keep fonts, reader preferences, page dimensions, documents, brightness, refresh rate and network conditions equal. Account for all WebView/GPU processes when measuring resident memory; JS heap alone omits decoded textures.

| Metric | Proposed acceptance target | Instrumentation / workload |
|---|---|---|
| Initial JS/bundle | Additional initial compressed JS ≤10 KiB; runtime raster ≤2.5 MiB total, lazy except bounded fallback | Existing bundle gate plus asset inventory; no catalog/image bytes in entry JS |
| Cold start usable surface | Added median ≤max(50ms,5% of baseline), p95 ≤max(100ms,10%) | Native startup marks/filmstrip, ≥10 paired cold processes; no texture on critical boot path |
| Theme switch | Opaque correct palette ≤100ms p95; cached full material ≤200ms p95; cold decode ≤500ms p95 on A/E | User action→paint marks + filmstrip; uncached B budget ≤800ms, paper base stays usable throughout |
| Main-thread stalls | No new paper-attributable task >50ms after startup; resolver/serializer ≤5ms p95 on B/F | DevTools/Safari profiler, repeated preview/commit with 2 live readers; traces distinguish existing work |
| Scroll smoothness | At 60Hz p95 frame interval ≤20ms on A/E; missed-frame proportion increases ≤2 percentage points on all classes, frame p95 regression ≤10% | 60s steady scroll each: long HTML, 200-page reflow, 500 RSS items, ≥10 EPUB chapters; F report relative target as primary |
| Idle work | Zero new decorative RAF callbacks/timers and zero paper-attributable continuous GPU submissions; total idle CPU delta ≤1 percentage point | 60s stationary and hidden/unfocused native trace after settle |
| Memory | Incremental aggregate WebView/GPU resident median ≤32 MiB Authentic / ≤64 MiB Maximum for app+one reader; after 20 theme cycles warmed steady-state growth ≤8 MiB | Native process/GPU tools, same mounted-reader cap; 10-minute document/RSS run no document-length linear growth |
| EPUB chapter change | Added p95 ≤max(30ms,5%); zero exposed white frames; no rising listener/style counts | Instrument display/readiness, navigate 20 chapters forward/back under theme changes |
| RSS update/list | Existing list responsiveness p95 regression ≤10%; decoration adds no React commits solely on scroll | React profiler + scroll trace and 500 items; shared image URL/decode, no per-card asset construction |
| Power / thermal | Steady 20-minute reading power increase ≤5% vs same-luminance flat theme; no new thermal throttling level | Android Perfetto/Battery Historian or available power instrumentation; iOS Instruments Energy Log; ≥3 paired physical-device runs, report variance |
| Linux compatibility | No material-created crash/blank view; F frame/CPU limits above and no repeated full-window paint while idle | Existing software override, WebKitGTK profiler, hardware run and optional NVIDIA DMABUF path |

These are engineering targets, not claims of user-visible measurements. Byte/size/contrast constraints are deterministic gates. A noisy power estimate cannot certify ≤5%; mark it pending and obtain reliable physical evidence. If a target is missed, reduce image/detail/layer costs first; document any justified target change for explicit review instead of editing perf baselines to mask regressions.

## Verification commands and release checklist

During implementation, run focused Vitest suites for builtin/materialRoles/color, ThemeContext/ThemePicker, HTML tokens/preparation, EPUB lifecycle, PDF reflow/selection, RSS preferences and RichContentRenderer, plus new resolver/assets tests. Use actual file paths in the implementation test report. Run `npm run test:visual -- src/visual/legal-pad.visual.spec.ts src/visual/scholarly-reader.visual.spec.ts src/visual/pdf-reflow.visual.spec.ts` and the existing material-contracts suite. Run type/lint/build validation according to current repository scripts (`npm run build:check`, focused lint, `npm run test:scripts`, `npm run bench:check`; memory gate if changed paths affect retained state). Note package.json currently runs script tests from `*.test.mjs` although AGENTS describes `*.test.ts`: invoke the npm script as authoritative instead of inventing a command.

`bench:check` compares `anchorHz/benchHz` to `scripts/perf-baselines.json`, default tolerance 1.25×, then bundle budget; pure benchmark inputs must use seededRandom and consume results, return void, no network/fs/Tauri. If measured work intentionally changes cost/bundle size, update corresponding baseline/budget with rationale in the same implementation change, never to conceal an unknown regression. No GitHub Actions gate substitutes for local validation.

Run native packaged builds and recorded tests on mandatory classes, verify PWA fallback assets cached before offline theme activation, and check original imported-file hashes remain identical. Freeze palette, asset manifest and goldens only after all deterministic checks and mandatory physical SDR checks pass. Report unverified optional platform/gamut behavior honestly; leave P3 allowlist empty where unverified and HDR disabled everywhere. This proposal itself requires only `openspec validate add-legal-pad-paper-theme --strict` and artifact/scope checks, not application benchmarks.
