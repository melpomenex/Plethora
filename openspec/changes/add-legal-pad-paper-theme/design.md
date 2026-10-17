## Context

Planning is complete and implementation is in progress. See `proposal.md` for the product scope and the implementation evidence section for subsequent findings. Investigation is anchored to HEAD `f1f598c1b7cb92efd2c79f4cd13015bea98f6792` plus the working tree inspected on 2026-10-17. Existing unrelated modifications (including settingsStore, extract UI, and a progressive-summary change) are not part of this proposal. Source line references below are investigation anchors, not promises that line numbers survive implementation.

### Verified application and reader paths

| Area | Current evidence | Gap / implementation consequence |
|---|---|---|
| Registry/schema | `src/types/theme.ts:130–181`, `src/themes/builtin.ts:1` and `builtInThemes` export; `src/themes/fallback.ts` | Theme has colors/effects/customCSS, no material. Builtins are lazy at provider startup; do not eagerly import the catalog to fix one saved theme. |
| Application | `src/main.tsx:552–595` nests ThemeProvider inside PresentationProvider; `src/contexts/ThemeContext.tsx:69–213,267–343` writes color aliases, derived roles, fonts, attributes, custom stylesheet, native vibrancy | Applied preview differs from committed `theme`; iframe consumers can see committed colors. Legal Pad needs an authoritative applied snapshot and early restoration. |
| M3/color | `src/themes/materialRoles.ts:deriveMaterialRoles`, `src/themes/color.ts:50–105`; `src/index.css:356` | Explicit extended roles win. Neutral derivation deliberately reduces chroma, so Legal Pad must explicitly pin its golden container ladder. Color parser handles hex/rgb(a), not P3; keep numerical input colors in sRGB. |
| Shell | `src/components/layout/AdaptiveAppScaffold.tsx:17–25`, `MainLayout.tsx:66–80`, `src/index.css:949–983` | Backdrop is z0 below a z10 child; app shell is opaque `bg-background`. Animated-theme selectors broadly clear background shorthands. Do not set `data-theme-animation` on static paper or reuse those selectors. |
| Animation / Linux | `ThemeBackdrop.tsx:19–77,109–170`, `src-tauri/src/graphics.rs:1–110`, `src-tauri/src/main.rs:31–58` | Renderer has WebGL2/Canvas2D/static guards, mobile animation defaults off, battery scaling. Linux policy owns hardware/software and NVIDIA DMABUF exceptions. Paper needs neither renderer nor graphics-policy change. |
| HTML | `DocumentViewer.tsx:6280–6345`, `htmlReader/{documentKind,prepareHtmlDocument,readerThemeTokens,readerStylesheet,articleReaderStyles,compatibilityReaderStyles}.ts` | Classified canonical, raw-fallback, browser-capture, arXiv, OCR and raw HTML; opaque backgrounds on html/body and legacy `.page` can hide paper. Canonical article nodes are preserved on style updates. `ensureReaderStylesheet` carries the packaged CSP nonce. Reader measure is **66ch**, not an assumed 65ch. |
| EPUB | `EPUBViewer.tsx:810–850,851–1194,1197–1294,1555–1590,1660–1732,2041–2085` | Theme-first palette avoids child-effect/parent-DOM races. Three paths: rendition default/select, override stylesheet, inline critical html/body colors. Hooks now install overrides before cleanup and preserve epub.js style IDs; first display is explicitly themed and verified. Existing universal color/font resets and publisher stylesheet removal are unsafe for fixed layout/original mode. Cover detection alone does not classify fixed-layout sections. |
| PDF | `PDFViewer.tsx:4128–4208`, `PDFViewer.css:1–60,418–435`, `PdfCanonicalReflowRenderer.tsx`, `PdfReflowRenderer.tsx` | `documents.pdfSettings.reflowTheme` is system/light/dark; light/dark set inline backgrounds. Both reflow renderers share the mobile-reflow wrapper. Original canvas/highlight/text stack is z1/z2/z3; do not decorate/filter inside this stack. Graphical fallback images remain original. |
| Markdown/text | `MarkdownViewer.tsx:64–80,156–180,213–247`; `DocumentViewer` type routing | Markdown renders host DOM; highlights/search mutate anchored nodes surgically. Apply background on its existing scroll owner, not by rerendering HTML. Plain text/fallback text inherits the host paper surface; media viewers only get paper chrome. |
| RSS | `RSSFullContentView.tsx:115–122,186–221,308–327`; `src/types/rssCustomization.ts:RSS_DEFAULTS,resolveRssPreferences,rssReadingStyle`; `RSSScrollMode.tsx:2076,2271`; `RSSReader.tsx` callers | Full-content reads uiStore light/dark as global theme and maps system to light/slate. Four literal viewport/header palettes and Tailwind prose colors override app tokens. Shared RSS helper correctly leaves system colors inherited; explicit light/dark/sepia/slate/oled remain independent. Global/feed inheritance already exists; use it, do not create a third preference store. |
| Extracts | `RichContentRenderer.tsx:76–90,201–230,282–283`, `tabs/ExtractReader.tsx:147`, `review/{ExtractScrollItem,FlashcardScrollItem}.tsx` | Rich iframe snapshots computed colors only when HTML/expand/mode changes; live theme does not update it. Transparent body can inherit its parent visually, but iframe token updates and code/table fills still need integration. Keep iframe sandbox and URL cleanup. Some rating controls remain hardcoded. |
| Mobile / accessibility | `MobileLayoutWrapper.tsx:116`, `MobileNavigation.tsx`, `styles/mobile.css`, `useVisualViewport.ts`, `PresentationContext.tsx:153–174`, `index.css:2523–2690,3029–3068,4644–4668` | Safe-area and viewport geometry already have owners. Root `data-display-mode=eink` overrides tokens; root CSS does not enter iframes. Existing forced-colors/contrast handling is partly command-palette-specific, not an app-wide paper guarantee. |
| Preview/testing | `ThemePicker.tsx:41–59,114–145`, `ThemeGallery.tsx:28–99`; `playwright.config.ts`; `src/visual/scholarly-reader.visual.spec.ts:16–73` | Swatches/mockups are flat. Existing harness tests nonce behavior, live style updates, semantic content, contrast and zoom. Screenshot defaults are Chromium, 390×844, 2% maximum difference; no native HDR proof. |
| Packaging / first paint | `index.html:78,166`, `src/main.tsx:152,244`, `src-tauri/tauri.conf.json:32–37`, `public/sw.js:49–75,231–237` | Boot/loading surfaces are dark literals, main window transparent, packaged CSP restricts style injection. SW image runtime caching alone does not guarantee a never-opened theme offline. Precache a bounded fallback. |

Existing tests were read as well as inventoried: `src/themes/__tests__/builtin.test.ts` asserts animated-wrapper transparency; `src/contexts/__tests__/ThemeContext.materialRoles.test.tsx` covers role/alias emission; `src/components/settings/__tests__/ThemePicker.test.tsx` covers live preview/search and contains a hardcoded catalog-count assertion; `htmlReader/__tests__/readerThemeTokens.test.ts` checks all builtins for text/link/border contrast and reader stylesheet behavior. Adding a theme must update the count expectation deliberately while preserving those contracts. They do not yet certify textured contrast, real EPUB content lifecycle, or native paper rendering.

The committed scholarly-reader snow tablet golden was inspected: typography, article hierarchy, outlined abstract and figures are the incumbent structure. The mobile settings capture was inspected as a historical layout reference; it is not an authority for current colors/controls. Searches in repository assets/public/source image paths and the provided visualization workspace found no relevant Legal Pad material/reference asset. No production texture exists to certify; unrelated logos, promo imagery and screenshots are unsuitable. No texture has been generated or optimized in this planning task.

### Existing contracts and concurrent changes

Read the existing `material-tokens`, `material-reader-chrome`, `html-viewer-theming`, `themed-html-rendering`, `theme-styled-content-capture`, `html-reader-controls`, `animated-themes-visibility`, `eink-display-mode`, `gpu-theme-rendering`, and RSS preference specifications. `rss-preference-profile` concerns feedback learning, not appearance; do not attach cosmetic changes to it. New RSS paper behavior belongs to `paper-reader-integration`.

`material-reader-chrome` currently promises identical document rendering after the Material migration. The delta explicitly permits a selected paper material, while retaining migration isolation and all interaction geometry. `themed-html-rendering` broadly recolors content; its delta scopes cosmetic recoloring to reading text and protects semantic media. Browser capture sanitation/source persistence requirements are unchanged.

Coordinate with active `fix-mobile-epub-theme-regression`, `fix-rss-customization-settings`, `theme-aware-mode-accent`, `fix-session-customize-mobile-layering`, `fix-bottom-rating-dock-overlap`, and `unify-assistant-experience`. Source already contains parts of these changes. Preserve their lifecycle/portal/geometry protections and test against current source; do not replay stale designs or make their completion a prerequisite. Ongoing PDF navigation/selection fixes own scheduling and anchors, which this feature must not refactor.

## Goals / Non-Goals

**Goals:** one deterministic appearance snapshot; a small reusable static material; explicit owner for every visible background; authentic assets without a graphics engine; correct theme preview and live iframe updates; preserved source fidelity; excellent SDR/high-DPI baseline; measured mobile/Linux release evidence.

**Non-goals:** new reader engines, source rewriting, retro notebook UI geometry, new fonts forced on readers, per-line baseline alignment, a generic material marketplace/editor, runtime texture synthesis, native brightness manipulation, or production HDR. Proposed modules and example types below are implementation contracts, not application code introduced by this proposal.

## Decisions

### D1 — Optional structured metadata, constrained preset registry

**Choose:** add `Theme.material?: { kind: 'paper'; preset: 'legal-pad-archival-v1' }`, with an extensible exported preset-ID type owned by `src/themes/materials.ts`. Keep intensity, rule metrics, asset URLs and licensing in an app-owned immutable registry, not arbitrary imported theme CSS/remote texture URLs. Add `BUILTIN_THEMES.LEGAL_PAD = 'legal-pad'`; put the theme definition in `src/themes/legalPad.ts` and register/re-export it from builtin. Inherit incumbent chrome typography, spacing, radius and shadows; never change document typography from the theme.

**Alternative:** one large customCSS string per theme, or a full material/shader schema. The former duplicates reader rules and misses previews; the latter creates unnecessary import/security/configuration surface. Unknown/malformed material kinds or preset IDs are ignored with a plain-palette fallback; existing themes remain valid. Theme import/export retains recognized metadata but cannot select unregistered assets. No dynamic CSS URLs from user input. **Risk/mitigation:** schema drift → type/normalization tests and a single registry contract. **Owners:** theme types, registry, importer, builtin tests.

### D2 — One applied appearance snapshot, including preview

**Choose:** keep `theme` as the committed value and add `appliedTheme` to ThemeContext, reflecting preview or committed theme. Derive a memoized `ResolvedThemeAppearance` from appliedTheme + paper preferences + accessibility/resource policy. It contains sRGB color roles, material preset/effective detail, resolved asset URLs, reader tokens, display/accessibility flags and a revision key. Provide it through a small `useResolvedThemeAppearance` hook; plain resolver functions live in `src/themes/resolveThemeAppearance.ts`. Readers receive the resolved values, not an independent `getComputedStyle` race. Existing non-paper consumers may continue using committed theme until deliberately migrated.

Reuse `resolveReaderThemeTokens` and existing color/role helpers; extend its input for effective accessibility colors and validated texture bounds. Do not reimplement color math or replace all app theming. Resolve E-Ink explicitly before building iframe CSS; a theme-first EPUB palette must not accidentally defeat monochrome root overrides. Forced-colors inside frames also gets its own media rules.

**Alternative:** observe root mutations or wait an extra effect/frame for CSS. Rejected because previews, platform overrides and children can remain inconsistent. **Risk/mitigation:** extra rerenders → memoized scalar snapshot, stable CSS serialization, no scroll state dependencies. **Owners:** ThemeContext, reader token resolver, reader adapters, context tests.

#### Shared implementation boundary

Keep the following small, typed interface boundary; names may follow local conventions but responsibilities must not split into parallel per-reader material systems:

- `resolveThemeAppearance(appliedTheme, preferences, environment)` is pure and returns `{ themeId, variant, colors, readerTokens, paper, accessibility, revision }`. `colors` is the complete effective sRGB role/alias map; `readerTokens` retains the existing 66ch contract. `paper` is null or `{ presetId, requestedDetail, effectiveDetail, grainUrl, variationUrl, ruling, margin, displayTier }`. `accessibility` includes effective E-Ink, forced-colors and contrast mode. `revision` changes only when an appearance input changes and guards async asset work.
- `resolvePaperMaterial(preset, preferences, environment)` selects registered URLs/density/fallback and normalized options; it never reads content DOM, performs layout or starts a scheduler. Host asset preparation owns decode promises and publishes a new resolved asset selection on failure.
- `paperMaterialCss(resolvedPaper, surfaceRole)` produces app-owned CSS declarations from finite presets/numbers and already trusted absolute URLs. The same layer lists feed host styles and iframe builders; typography and content sanitation are separate existing responsibilities. Resolve logical margin eligibility from the actual pane/padding, with no per-scroll measurement.
- `useResolvedThemeAppearance()` is the React-facing snapshot subscription; content hooks consume its latest immutable value/ref. Initial frame styles and subsequent in-place updates use the same snapshot. No independent provider per reader or duplicate source-of-truth storage is introduced.

### D3 — Authentic source, deterministic offline derivatives

**Choose:** photograph/scan unruled premium yellow paper with rights to redistribute, under diffuse neutral light with a color target and a physical scale. Remove page edges, rules, handwriting, glare, dust clumps and camera vignetting. Capture true fibers; do not use random CSS noise. A commissioned/generated paper reference is acceptable only as a fallback source if reviewed for convincing nonrepeating fibers and its provenance/license is recorded. It is not automatically an HDR source.

Author a 4096×4096, 16-bit, color-managed TIFF **offline master**, plus a seam-clean 2048×2048 working master. Store master/source records in `assets/theme-materials/legal-pad/` (large lossless source may be external with stable checksum and reproducible acquisition instructions; no binary-lfs assumption). Separate high-pass neutral fiber detail from low-frequency pigmentation; suppress absolute illumination baked into the tile. Edge-match using offset-and-retouch, not a kaleidoscope mirror seam. Review a 3×3 tile and an unbroken phone crop at 100% device resolution before approval. Use fixed source processing settings recorded in `manifest.json`.

**Alternative:** runtime turbulence/canvas, a giant full-screen 4K JPEG, or decorative SVG grain. Rejected for realism, memory, compatibility or idle cost. **Risk/mitigation:** artificial grain/compression rings → uncompressed crop comparisons and full-resolution device review. **Owners:** asset pipeline/manifest and visual QA; no assets are produced by this planning change.

#### Production asset contract

Runtime paths are stable same-origin `/theme-materials/legal-pad/v1/`; use `new URL(path, document.baseURI)` in the host, pass absolute trusted URLs into all frames. An imported article's remote `<base>` or EPUB blob base must never resolve paper URLs. `public/` assets are packaged into Tauri and included in PWA cache planning.

| Filename / family | Dimensions | Purpose / target encoded ceiling |
|---|---:|---|
| `grain-authentic-512.webp`, `-1024.webp`, `-1536.webp` | 512² / 1024² / 1536² | Alpha neutral fibers, 1×/2×/3× candidates at a 512 CSS px tile; ≤60/180/340 KiB |
| `grain-subtle-512.webp`, `-1024.webp` | 512² / 1024² | Same source, reduced alpha, resource-saving detail; ≤45/140 KiB |
| `grain-maximum-1024.webp`, `-1536.webp`, `-2048.webp` | 1024² / 1536² / 2048² | Same physical scale, stronger bounded detail, 2×/3×/4×; ≤190/360/600 KiB |
| `grain-fallback-512.png` | 512² | Optimized alpha PNG, Subtle intensity, ≤160 KiB; WebP decode/network/CSP error fallback |
| `variation-512.webp` | 512² | Seamless low-frequency neutral alpha pigmentation; ≤35 KiB, 1536 CSS px tile |
| `variation-512.png` | 512² | Lossless fallback, ≤80 KiB |
| `preview-384.webp` | 384×256 | Small composite paper/rules preview, ≤45 KiB; readable representative hierarchy |
| `manifest.json`, `LICENSE.txt` | text | Version, creator/source/license, hashes, profiles, dimensions, alpha bounds, process settings, encoded sizes, texture color/luminance extrema and reviewed crops |

All ceilings are **targets**, not measured values; total shipped raster payload target ≤2.5 MiB. Use visually lossless WebP RGBA (lossless preferred for fibers; permit near-lossless only if fine structure passes review); do not blur source to hit a byte ceiling. PNG baseline handles WebP failure explicitly through the asset resolver, since a failed CSS image-set candidate does not reliably try the next candidate. Cache a host `Image.decode()` promise per selected URL; failure switches the snapshot to PNG once, then color+rules if PNG fails. Do not loop retries or block reader display. Keep at most one selected grain family/density active, plus macro and preview; don't decode every variant to test it.

AVIF is **not shipped initially**: fine alpha detail and decode cost offer no verified advantage here, and the baseline does not need its HDR representation. A later format comparison must beat WebP bytes/decode/quality on all target engines with explicit PNG fallback. Every derivative is tagged/converted to sRGB (D65); grayscale detail is encoded as neutral color + bounded alpha, never interpreted as unprofiled CMYK or as wide-gamut RGB by accident. Record the encoder and ICC handling. No remote CDN, runtime synthesis, data-URL copies per iframe, HDR metadata or source-license ambiguity.

### D4 — Density is physical sampling, not stretching

**Choose:** fixed 512 CSS px grain tile; Authentic selects 512 at DPR≤1, 1024 at 1<DPR≤2, 1536 at DPR>2. Maximum selects 1024/1536/2048 at DPR≤2 / ≤3 / >3, bounded by resource policy. Subtle uses 512 or 1024 with a 2× ceiling. The 4K master is never a runtime asset. The macro tile stays 1536 CSS px, making repeated grain/macro features less coincident. Assets must be independently seamless; do not animate or randomize positions.

Explicit resolved URL is authoritative for every host/frame. CSS image-set may express the density candidates only if it respects the policy ceiling; a browser must not independently promote an iframe to 4×. Standard interpolation (`image-rendering:auto`), no pixelated/crisp-edges/sharpen filters. Zoom may resample; preserve accessibility zoom over grain sharpness. DPR changes from display moves trigger a debounced appearance update; orientation/keyboard resize changes clipping only, not texture scale. **Alternative:** cover/viewport stretching; rejected because fiber size changes with window shape. **Risk:** recognizable periodic fibers → reject unique coarse motifs and inspect tall/landscape tiling. **Owners:** registry/resolver, shared CSS, density fixtures.

### D5 — Static background recipe and precise layer ownership

**Choose:** a reusable CSS background recipe serialized by `src/themes/paperMaterialCss.ts`, consumed by `src/styles/paper-material.css` and iframe styles. Mark **existing** surface elements `data-paper-surface="chrome|reading|inset"`; do not wrap text or add nodes inside anchored content. Each owner paints its own opaque base. Avoid decorative pseudo-elements entirely on article/text nodes: background paint cannot enter selection geometry, intercept pointers, collide with `md-state::after`, or require extra z-index layers.

Paint order, bottom to top:

1. **A** opaque semantic base (`--paper-base` chosen per surface).
2. **B** alpha fiber image, repeated at 512 CSS px.
3. **C** subtle alpha macro image at 1536 CSS px; combined macro/fiber amplitude is bounded by the manifest.
4. **D** repeating blue horizontal gradient, reading surfaces only.
5. **E** one red logical-start gutter rule, reading surfaces with enough room only.
6. **F** all normal content, selections, highlights, controls and media.

CSS `background-image` is serialized in reverse order E,D,C,B over the A background-color. Per-layer sizes/positions/repeats are explicit lists. Use ordinary source-over alpha; no blend/filter/backdrop-filter or `will-change`. Detail variants bake alpha multipliers (Subtle 0.55×, Authentic 1×, Maximum 1.25×) into the texture; rules have their own independent alpha. No opacity on the element/content. No negative z-index, full-height texture DOM, full-page screenshots as backgrounds, or transformed reader ancestors.

The scroll **viewport** owns the background, with `background-attachment:scroll`: a stable visible paper plane, content scrolls over it. Do not use attachment:fixed (mobile repaint risk) or local on a document-length layer. Each EPUB content document is a new sheet; phase resets at a chapter. Root html paints the frame gutter, body is transparent where it would otherwise hide root paper; the recipe remains on a single owner. Host/frame gutters match in base color without pretending separately scrolling sheets share line phase. Inset code/tables/abstracts use solid or Subtle unruled paper; images and diagrams retain their own pixels and opaque backing when needed.

**Alternative:** one full-screen translucent backdrop, or absolutely positioned composited texture layers. The first is hidden by cards and leaks through overlays; the second adds layer memory and stacking/selection edge cases with no static-material benefit. **Risk/mitigation:** opaque nested owners can still conceal texture → map and mark owners explicitly, test computed background and pixels. **Owners:** shared CSS, shell, reader adapters, M3 surfaces.

### D6 — Ruling and red margin are decorative, never a baseline grid

**Choose:** default blue `#8199A0` at 0.18 alpha, one CSS px thickness, every 32 CSS px on phone reading panes (<600px), 36px on wider panes. Use media/container sizing based on the **reading pane**, not the device's total screen width. Rule phase begins 24px from pane block-start; no line tracks any baseline. Ink, not blue, carries hierarchy. Actual sampled contrast remains the acceptance gate; rules are not controls and need not meet a 3:1 decorative contrast.

Margin color `#BB7972` at 0.35 alpha, one CSS px. Place at `max(8px, safe-inline-start + 6px)` on compact panes, and 24px from the paper edge on wide panes. It must be at least 8px before the content's existing inline-start padding, outside list markers and selection affordances. With 16px reader padding this means at most an 8px rule position; **hide** if the inequality cannot be met rather than increasing padding, reducing measure or intersecting text. Hide on pane width <360px, original/fixed-layout/media-only surfaces, or unknown vertical-writing layout. Mirror with logical start for horizontal RTL; do not change document direction. Landscape uses pane-width and safe-left/right, not a portrait assumption. Ruling may pass under prose but opaque figure/table/code islands mask it naturally. Disable margin when ruling is off; retain the saved margin choice for re-enabling.

**Alternative:** line-height-aware ruling requires baseline, paragraph, heading, column and media layout intervention; rejected for this release. User typography/font, size, line-height, paragraph spacing, width and zoom remain authoritative, with canonical HTML's 66ch default and existing PDF/RSS measures retained. **Risk/mitigation:** moiré or busy rules on high-DPI panels → inspect 1× device pixels and 200% zoom, reduce alpha before accepting. **Owners:** recipe, pane responsiveness, typography regression fixtures.

### D7 — Explicit warm color tokens and surface vocabulary

**Choose:** sRGB initial implementation palette below; these are **calibration candidates**, not visually validated production values. Establish actual texture extrema and review representative phone/desktop renders before freezing `legalPad.ts`. Record any changes and final contrast report with approved goldens; do not arbitrarily choose remaining roles at implementation time.

| Theme roles | Candidate value |
|---|---|
| background, onBackground, text | `#F5DF85`, `#30271F`, `#30271F` |
| surface, onSurface, card | `#F8E69A`, `#30271F`, `#F8E69A` |
| surfaceVariant, input, muted alias | `#EAD27B`, `#FFF0B4`, surfaceVariant |
| toolbar, sidebar | `#EED68A`, `#E8CF7D` |
| textSecondary, onSurfaceVariant | `#61503A`, `#61503A` |
| primary, onPrimary | `#354E62`, `#FFF4CF` |
| primaryContainer, onPrimaryContainer | `#E2DCA7`, `#263F52` |
| secondary, onSecondary | `#665437`, `#FFF4CF` |
| secondaryContainer, onSecondaryContainer | `#E9D59D`, `#3D3020` |
| tertiary, onTertiary | `#7D4945`, `#FFF4CF` |
| tertiaryContainer, onTertiaryContainer | `#F1D0B8`, `#4C2723` |
| error, onError, errorContainer, onErrorContainer | `#9B3028`, `#FFF4CF`, `#F5CDB2`, `#531D18` |
| success, warning | `#365C39`, `#78510C` |
| link, modeAccent | `#284E68`, `#7D4945` |
| outline, border, outlineVariant | `#786747`, `#786747`, `#C8AD66` |
| surfaceContainerLowest, Low, base, High, Highest | `#FFF0B4`, `#F9E89F`, `#F4E095`, `#EED68A`, `#E7CC7C` |
| surfaceBright, surfaceDim | `#FFF0B4`, `#DCC06C` |
| inverseSurface, onInverseSurface, inversePrimary | `#393025`, `#FFF0B4`, `#B7CDD3` |
| scrim | `rgba(36,29,20,0.42)` |

Use subdued graphite primary text and underlined blue links. OutlineVariant is decorative only; interactive boundaries use outline. Warm tonal elevation and a small approved texture on navigation/cards create organization; no fake torn edges/heavy shadows. The *nominal* paper colors are insufficient evidence for contrast: see D16.

**Alternative:** seed-only derivation loses the saturated paper family; global yellow overrides damage other themes/content. **Risk/mitigation:** dark/gray cards from derived ramp → pin every listed extended role and audit aliases/popovers/rating-color resolution. **Owners:** theme definition, materialRoles tests, token compliance.

### D8 — Shell, portals, and every app surface have an owner

**Choose:** keep `.app-shell` opaque with its own paper background; keep body/#root/adaptive shell coherent at edges. Add `data-theme-material="paper"` at root but never `data-theme-animation`. Do not clear `.bg-background` globally. Existing opaque utility fills become deliberate independent paper owners or transparent only within the named owner when they serve no visual purpose. Bound clipping to each owner's border radius using background-clip; do not introduce overflow clipping that cuts menus/focus. Preserve app z-index contracts and existing portals.

| Surface family / current owners | Treatment and scope |
|---|---|
| AdaptiveAppScaffold / MainLayout / `Toolbar.tsx`, `common/Tabs.tsx`, mobile wrapper/navigation | Chrome: shaded unruled base, subtle fibers, no macro beyond 1% luminance; match all safe-area edges and toolbar placements. |
| DashboardTab, DocumentsTab and their actual library grid/list/card children | Chrome plane plus slightly illuminated inset cards; metadata stays ≥4.5:1; covers/thumbnails stay original. No rules on every list row. |
| SettingsTab and Appearance settings / ThemePicker/Gallery | Unruled paper; inset input fills; actual material samples in picker and gallery; retain search/filter/keyboard behavior. |
| `search/CommandCenter`, `common/CommandPalette`, menus/context menus | Opaque warm popover, minimal/no grain behind dense results; focus/state tokens. Existing command-hub local tokens must resolve from active palette. |
| `md3/` surfaces, `common/Modal`, `adaptive/ResponsiveDialogSheet`, toast/dialogSurface contracts | Shared surface recipes; paper inside portal panel, scrim outside. Never make dialogs translucent to reveal shell. Honor existing overlay geometry. |
| `assistant/AssistantPanel`, mobile assistant host and response content | Chrome panel, unruled conversation; inset response sheets and solid composer/input; replace decorative slate fills where they obscure paper, preserve provider/status semantic distinctions and attached media. |
| QueueTab / review queue / flashcards / ExtractReader / extracts | Unruled queue cards and flashcard fronts/backs; ruled long prose only. Existing RatingOrb/resolved rating tokens remain the action language; repair literal rating fills in touched readers without changing scheduling. |
| Graph knowledge panels / network/sphere tabs | Paper surrounds, inspectors, search and node-detail cards; preserve the graph's canvas/3D scene, legends and meaningful node colors. Do not recolor rendered visualization pixels. |
| Empty/loading/error/skeleton states, transient navigation surfaces | Same opaque base before content arrives, paper visible without shimmer required. Semantic status text/icons remain legible. |
| Other audio/video/YouTube/image/browser tabs discovered in TabRegistry | Paper chrome only; no recoloring of artwork, video, cross-origin web pages, or native player content. |

**Alternative:** transparent everything to show a single backdrop repeats the prior visibility bug and harms modal legibility. **Risk/mitigation:** hidden white/gray panels → screenshot both fill and representative content, assert surface coverage, inspect opaque literal inventory before final acceptance. **Owners:** listed components and existing primitive styling contracts; do not undertake unrelated layout redesign.

### D9 — Reader precedence is explicit and format-aware

Apply this order: (1) accessibility projection (forced colors/E-Ink/high contrast), (2) source-fidelity restriction, (3) explicit reader appearance choice, (4) applied global theme/material, (5) plain color fallback on asset failure. Accessibility changes presentation only, never stored reader preferences or source data. Resource policy reduces decoration, never chooses a different reader palette.

| Format / preference | Paper behavior |
|---|---|
| Canonical saved/imported article and ordinary reflow HTML | Follow applied theme by existing contract; paper on root reading owner, opaque white body/abstract/page fills replaced with appropriate paper surfaces. No new appearance selector required. |
| Legacy/raw/browser-capture HTML, arXiv, OCR-HTML | Use existing classification and compatibility stylesheet, scoped material background rules for `.page` and semantic islands. Do not introduce a broader element reset than existing compatibility behavior. OCR background page scans/figures remain pixels; reading text can inherit. |
| Live external/cross-origin page | Paper surrounding chrome only; never attempt to inject beyond allowed same-origin reader documents. |
| EPUB reflow | New `documents.epubSettings.appearance: 'app'|'publisher'`, default app. App follows applied paper; publisher preserves book styling and shows paper only outside the rendition. Expose two-choice "Reader appearance: App theme / Original book" in existing EPUB settings, with a short fixed-layout explanation when applicable. |
| EPUB fixed layout / cover / unknown layout | Preserve publisher document and graphics by default; only surround with paper. Classify package and per-spine rendition layout (`pre-paginated`/`reflowable`) with section override priority. Unknown layout is conservative original; ordinary EPUB default semantics must be resolved from package metadata, not inferred from presence of an image. |
| PDF original page/cropped/columns/scanned / original image view | Paper on surroundings/toolbars only. No canvas tint/filter, alpha overlay, changed renderer background parameter, altered pixel scale, or material inside text/highlight stack. |
| PDF reflow canonical and legacy | Existing system means app/material; explicit light/dark retains plain palette and no paper/rules. "Use app theme" label clarifies the existing system choice; do not change stored enum. Keep original-page/figure fallback pixels and image scaling options. |
| Markdown and plain text | Paper on existing scroll/content owner; preserve renderMarkdown, anchor map, code/table/math styles, font/measure defaults and search marks. |
| RSS all app-rendered article paths | Effective global/feed `theme_mode=system` means app/material; explicit palettes win only within reader content. See D12. |
| Extract HTML / annotation previews | Warm parent surface; update frame tokens/material only when an expanded full-content reading surface needs paper. Small previews are unruled; do not generate textures per extract. |

**Alternative:** blanket global CSS or force paper over explicit preferences; rejected for user control/source integrity. **Risk/mitigation:** visually similar scanned and reflow content → test both and assert original image/canvas equality. **Owners:** reader adapters, settings normalizer, source classification.

### D10 — EPUB lifecycle extends existing guards rather than replacing them

**Choose:** resolve appearance before `display`; assign matching opaque host/iframe placeholder immediately. Preserve `patchThemesInsertRuleGuard`, critical inline color fallback, `applyRenditionTheme(rendition)` before first display, install-first cleanup, rendered verification and initial-content readiness. Modify all three styling layers so `background` shorthands cannot erase paper. For app/reflow sections, keep a single material owner on html with transparent body, serialized absolute asset URLs, explicit light color-scheme, and existing reader typography. Add material/background-image checks to verification when decoration is available, but asset failure satisfies readiness with correct opaque base. Never hide content indefinitely waiting for a texture.

Gate publisher cleanup and universal color/font rules by reflow + app appearance. In publisher/fixed/cover mode preserve publisher styles and omit destructive resets; when toggling to Original, reload only the **current rendition content** from immutable book data if publisher styles had already been removed. Capture CFI/location, restore it after normal layout, reattach selection/TTS listeners, and clear stale geometry through existing invalidation. Switching only between app themes updates styles without book reload. Future chapter content hooks always read the current snapshot/ref; theme toggles cannot leave detached frames subscribed. Use existing detacher ownership for unload/destroy and clean per-frame appearance attributes/style URLs.

Retain Android insertRule fallback and use nonce-authorized app styles wherever the packaged CSP requires them; never relax CSP. Do not delete epub.js-owned styles. Preserve semantic class-color legend/SVG/math content by scoped prose resets rather than universal `*` foreground/background destruction in new material rules. **Alternative:** install an independent paper hook after existing themes; rejected because existing cleanup/shorthand can erase it and ordering repeats white flashes. **Risk/mitigation:** publisher restore changes pagination → CFI restoration tests at chapter boundaries/fixed sections and real mobile chapter-transition capture. **Owners:** EPUBViewer and its realistic rendition/content tests.

### D11 — HTML tokens and sanitation stay in their established pipeline

**Choose:** optional material serialization alongside reader token CSS; share the same recipe, not a second stylesheet framework. Both article and compatibility builders consume the resolved snapshot. Extend `#html-viewer-styles` in place with the existing nonce; attach initial opaque palette before frame exposure, then decor opportunistically. Preserve the canonical preparation/sanitization path and app-owned CSS marker during style cleanup. Theme-only updates must not assign srcdoc/innerHTML, strip inline styles again, re-extract an article, or recreate highlight/anchor nodes. Separate initial compatibility cleanup from live appearance updates.

Keep articleAsset URL handling and sanitized remote media policy unchanged. Only app-owned material references can bypass article asset resolution. Scope cosmetic foreground changes to prose and controls; figures, SVG/math/KaTeX, semantic color keys and intentionally colored data remain meaningful. Existing compatibility cleanup limitations do not justify new destructive material rules; add focused exceptions for affected retained semantic content. `capture-failed` keeps its notice and paper chrome without pretending readable content exists.

**Alternative:** inject arbitrary raw source styles or disable sanitizer/CSP for texture URLs; rejected. **Risk/mitigation:** article `<base>` resolves trusted images remotely → absolute host URLs + packaged CSP test + offline failed-request assertion. **Owners:** htmlReader modules, DocumentViewer, `RichContentRenderer`.

### D12 — RSS uses one appearance resolver and existing preference inheritance

**Choose:** extend `rssReadingStyle`/a small sibling pure resolver to accept the resolved app appearance, return palette/material metadata and style values; full-content stops using uiStore light/dark for its palette. Effective RSS values continue through `resolveRssPreferences`: defaults < global < feed; null means inherit. Keep `system` persisted, relabel it "App theme" in appearance controls. Preserve explicit `light`, `dark` (slate alias), `sepia`, `slate`, `oled`, and migrations already owned by fix-rss-customization-settings. Do not silently reinterpret explicit historical palettes as app-following.

Replace full-content viewport/header palette classes only in the system branch; explicit branches keep their visual choice. Convert SafeHTML fixed blue links/prose and opaque white/gray helper controls into effective reader tokens with semantic exceptions. Consume the same resolved values in basic preview, full-content, Story view, RSSScrollMode's two reading owners, and card/list/compact/magazine/grid article paths found through RSSReader. Feed navigation/list chrome always follows global paper; explicit reader palettes do not repaint the sidebar. Default list previews use unruled paper; expanded reading uses rules. Sticky headers and assistant overlays have opaque chrome paper, not blurred/translucent text backgrounds.

**Alternative:** a new `legal-pad` RSS enum or another localStorage key; rejected because it locks one global theme into RSS and splits inheritance. **Risk/mitigation:** inherited vs explicit values lost on save → tests for global changes, feed override/null reset, invalid values, and async feed navigation with existing persistence APIs. **Owners:** rssCustomization, RSSReader/FullContent/ScrollMode and modal controls; no SQL migration.

### D13 — Mobile safe areas and first paint share existing geometry

**Choose:** extend material backgrounds beneath existing safe padding and visual-viewport height; do not add a new viewport listener or duplicate safe-area padding. Account for inline safe-left/right in landscape and bottom navigation/dialog boundaries already measured by BottomControlsGeometry. Background scale remains constant through keyboard/orientation/toolbar changes. Inputs keep solid illuminated fill and native selection handles.

Add the small Legal Pad palette (not texture bytes/catalog) to the eager fallback path so a saved ID resolves immediately. Reuse its definition without importing builtin. Add a minimal guarded bootstrap read of `plethora-last-theme` for legal-pad in the existing prepaint entry path, using the same shared generated fallback palette constants; do not deserialize arbitrary custom CSS before startup. ThemeProvider then owns all later writes. Loading/error boundaries consume bootstrap base after appearance selection. Texture failure or hydration may reveal flat warm paper briefly, never a white/black reader flash. Native OS splash/permission dialogs remain native; do not claim theme control before the application can read its saved preference. Document that limit in release QA.

**Alternative:** eagerly bundle the entire catalog or block boot on texture decode. Rejected for startup regressions. **Risk/mitigation:** prepaint script violates packaged nonce/CSP → use existing trusted bundled bootstrap/carrier contract and test actual packaged launch, not just Vite. **Owners:** fallback/theme provider, index/bootstrap, mobile CSS and existing viewport hooks.

### D14 — SDR first, matched P3 second, HDR gated out

Terminology: **DPR/high PPI** changes sampling detail, **wide gamut** changes chromaticity range, **Display-P3** is a color space, **HDR** requires extended luminance representation and an actual output path, and **EDR** is platform presentation headroom. OLED names panel technology; none proves the others. An 8-bit SDR WebP/PNG remains SDR on a phone with HDR video support.

**Tier 1:** all production assets and numeric theme colors are sRGB SDR; no brightness manipulation. This is the release-quality reference.

**Tier 2:** optional P3 CSS colors after `CSS.supports('color','color(display-p3 1 1 1)')` **and** `(color-gamut: p3)`. Perform media-change subscription once in appearance ownership, remove on cleanup. Keep ThemeColors in hex for existing parsing/contrast. Emit P3 only in CSS material overrides/iframe serialization; do not feed it into `parseColor` or automatically override whole semantic role sets. Convert the approved sRGB paper base and relevant warm surfaces colorimetrically to Display-P3 (D65) instead of copying RGB numbers between spaces. Initially keep the same physical color, then allow only reviewed small chroma changes with an sRGB proof; no additional texture asset or mandatory gamut expansion. A capability claim is feature availability, not proof of color accuracy. Unverified packaged combinations stay Tier 1 by a small tested-platform allowlist; no native wide-color activity change in this feature.

**Tier 3:** **disabled for this release**. Repository inspection found no verified HDR material pipeline, paper HDR asset, native headroom management, or device measurements. Browser documentation about HDR images does not establish support through a Tauri app, CSS background tiling, iframe compositing and OS window surface. The platform matrix and future experiment below prevent fake-HDR marketing.

| Platform / engine | What is established | Release policy / necessary evidence |
|---|---|---|
| Android Tauri / selected system WebView | Engine/provider varies; native Android wide-color and Ultra HDR APIs exist but do not prove WebView composition. Manifest has no explicit colorMode opt-in in inspected source. | SDR default; allow matched P3 only after packaged test on named provider/version/device. HDR off. Compare Chrome separately; never infer WebView from Chrome. |
| iOS Tauri / WKWebView | WebKit announced HDR web images in Safari 26; engine changes include gain-map compositing fixes. | SDR default; P3 after packaged validation. HDR off until actual WKWebView + app surface + local texture path verified, including child frames. |
| macOS Tauri / WKWebView | OS-supplied engine; same need to distinguish Safari and embedded view. | SDR/P3 tested combinations; HDR off, test SDR/HDR monitor moves and EDR headroom in future experiment. |
| Windows / WebView2 | Edge-based runtime; OS HDR setting, runtime and compositor all matter. | SDR/P3 tested combinations; no HDR claim from browser identity or media query. |
| Linux / WebKitGTK | Distro engine versions and existing hardware/software compatibility policy vary. | SDR release reference, P3 only after verified managed display pipeline. No HDR claim; retain software-raster fallback and GPU policy unchanged. |
| Browser/PWA | Browser APIs may report gamut/dynamic range independently of native app behavior. | SDR always works; P3 behind gates and browser test. Any future HDR evidence applies only to exact browser/OS/display path tested. |

External evidence checked 2026-10-17 (primary sources): [Tauri engine/provider mapping](https://v2.tauri.app/reference/webview-versions/); [Tauri engine architecture](https://github.com/tauri-apps/tauri/blob/dev/README.md); [CSS Color 4 predefined spaces](https://www.w3.org/TR/css-color/); [Media Queries 5 dynamic range](https://www.w3.org/TR/mediaqueries-5/#dynamic-range); [Android wide-color app setup](https://developer.android.com/training/wide-color-gamut); [Android Ultra HDR](https://developer.android.com/media/grow/ultra-hdr); [WebKit HDR image announcement](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/#hdr-images); [WebKit 26.4 gain-map rendering correction](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/); [WebView2 engine documentation](https://learn.microsoft.com/en-us/microsoft-edge/webview2/). These substantiate constraints and investigation directions, not tested Plethora capabilities. A retrieved Chromium revision explicitly disabled Android HDR for WebView; it is historical evidence, not a current universal verdict. Current main source could not be retrieved during this investigation, so WebView HDR remains unverified rather than declared impossible.

Future HDR work is a **separate change**, not a blocking implementation task: compare an SDR-base JPEG gain-map reference (Ultra HDR/ISO gain-map metadata validated) and a 10-bit PQ/HLG AVIF with explicit primaries/transfer metadata. Test inline image and actual CSS-tile/frame path independently, matching the SDR base to approved paper. Validate decoder output, compositor path, OS window support, hardware luminance relative to SDR reference white and tone mapping when headroom disappears. Use physical photometer evidence/native diagnostics; screenshots alone may be tone-mapped. Limit experimental paper white to SDR reference white with only tiny highlights ≤1.2× reference white as an initial **target**, do not seek display peak nits. Preserve comfortable average luminance, expose disable, avoid filters/opacity transforms that collapse the HDR path, and fall back to the packaged SDR material on any failed gate. Do not raise device brightness or request global HDR window configuration for the present theme.

**Alternative:** saturation/brightness tricks or `(dynamic-range:high)` as enable switch; rejected as technically false and uncomfortable. **Risk/mitigation:** P3 mismatches existing color math → matched CSS-only override, sampled comparisons and fail-closed allowlist. **Owners:** appearance resolver, CSS serializer, device evidence documentation; Rust/manifest unchanged in the initial implementation.

### D15 — Small persistent customization, separate effective policy

**Choose:** add optional `appearance.materialPreferences` keyed by registered preset ID. Each paper value is `{ detail: 'subtle'|'authentic'|'maximum'; ruling: boolean; margin: boolean }`; absent/invalid entries normalize to Authentic/true/true. Use existing settings persistence/merge mechanisms, with a nested normalizer to prevent partial objects deleting defaults. No new DB table, no new independent reader localStorage keys. User visual choices follow existing settings sync semantics; effective device quality/accessibility state never syncs or overwrites the choice.

Show the three controls in Appearance only for the committed paper theme, below the picker, with localized labels and a small noninteractive reading sample. Preview is ephemeral and uses saved/default preferences, never saves a theme ID or material preference. Picker Escape, pointer leave, close, unmount restores the committed snapshot everywhere; Enter/click commits. Gallery and picker sample share the production recipe/manifest; compact sample may use preview-384, while expanded gallery shows actual fibers/ruling. No animation badge. Reset restores three defaults for this preset; switching away removes material CSS/attributes and returns when reselected.

Defer separate Faint/Standard ruling intensity and three paper temperatures: they add calibration/test combinations without meaningful initial control beyond ruling and reduced detail. Maximum means denser/stronger validated fibers, **not HDR**. **Alternative:** expose every suggested knob or store detail per reader; rejected for complexity/inconsistent paper. **Risk/mitigation:** resource downgrades look like ignored settings → concise "Detail reduced for this device" helper only when applicable, no modal. **Owners:** settings store/merge, Appearance UI, preview components, i18n resources.

### D16 — Accessibility evaluates the composed material

**Choose:** normal text including secondary text ≥4.5:1, large text ≥3:1, focus/meaningful control boundaries ≥3:1 against each adjacent fill. Validate primary and on-colors, inputs, popovers, code, tables, selected/hover/focus states and all semantic status colors. Disabled controls remain identifiable with labels/icons and sufficient contrast where possible; do not lower all text opacity simply to signal disabled. Link underline and focus ring make state independent of color.

Texture pipeline records extrema after alpha compositing over every base candidate. A suggested paper-only envelope on main base is no more than ±0.025 relative luminance and macro ≤0.01; these are **targets** adjusted downward until every pair passes. Evaluate meaningful darkest/lightest patches plus rule/margin crossings, state layers and highlight compositing; test both percentile patches and the absolute worst case so isolated outliers are not silently exempted. Foreground pairs failing any meaningful region require darker ink or reduced grain, never removed accessibility features. Do not claim WCAG solely from nominal hex values.

On `forced-colors:active`, remove texture, macro and rules; use system Canvas/CanvasText/Highlight and automatic forced-color adjustment on app controls. E-Ink explicitly projects frame colors and removes all decor/shadows/translucency, following existing device-local display mode and optional grayscale media preference; paper never forces grayscale media itself. `prefers-contrast:more` suppresses decoration and strengthens ink/boundaries; reduced-transparency uses opaque fills. Reduced-motion does not disable a static texture; it suppresses cross-fades/transitions and preserves instant focus/state feedback. Semantic screen-reader DOM, reading order, touch gestures, selection handles, anchor/CFI/offset identities and TTS/search markup remain unchanged.

Highlight palette needs proof on yellow paper: use current accessible highlight resolver where applicable, distinguish persisted highlight/search/current TTS by outline/underline as well as hue, retain stored highlight IDs/colors, and update only **presentation**. PDF page-mode highlights remain on unchanged original pages; scoped paper rules target reflow marks only. **Alternative:** body filter/invert or global `*` color resets; rejected for media damage. **Risk/mitigation:** iframe ignores root accessibility state → snapshot + internal media CSS and live tests. **Owners:** color validation, readers/highlight styling, PresentationContext integration.

### D17 — Bounded resources with no decorative scheduler

**Choose:** no RAF/timer/observer per paper surface, canvas, WebGL, workers, scroll-driven image generation or continuous texture repaint. Backgrounds remain stable; a theme/detail/gamut/accessibility change is the only material React update. Decode once per URL in host preparation, reuse URL across surfaces; browser sharing is a possibility, not a memory guarantee. Keep no app-owned ImageBitmap/Blob/data copies. On leave cancel/revision-guard pending decode, clear references/listeners and material variables. Browser caches are managed by the engine, so do not promise immediate memory release.

Runtime effective detail: accessibility no-decor > user Subtle > constrained Subtle > Authentic/Maximum as selected. Constrained means memory hint ≤4 GiB when available, save-data, reported low-battery (<20% unplugged from existing BatteryContext if available), or a session decode failure. Unknown hints do not prove low resources and must not block the theme. Reuse existing battery ownership; no power polling. Do not assume on-battery means battery-saver, or claim unsupported OS saver detection. Offer Subtle as manual fallback everywhere. Linux software mode is tested explicitly; no new native GPU API is required solely to detect it. If profiles show Authentic too costly there, choose a conservative platform-specific effective ceiling with documented evidence before release.

Nominal decoded RGBA: 512²=1 MiB, 1024²=4 MiB, 1536²=9 MiB, 2048²=16 MiB, 4096²=64 MiB (not shipping). Add macro 1 MiB and account for mipmaps, backing stores, duplicated processes and frame copies. Active texture reference target ≤12 MiB Authentic / ≤20 MiB Maximum **per process copy**, not whole-app RSS. Existing reader-tab cap remains in charge of mounted readers.

All end-to-end targets and how to measure them are in `test-matrix.md`; none is an observed result. `npm run bench:check` gates pure-code CPU ratios and bundle budgets, **not GPU scroll power or native image memory**. Keep the seeded deterministic benchmark protocol and do not update baselines to hide an unexplained regression. Add targeted resolver/serialization benchmark only if its measured hot path warrants one. **Alternative:** persistent GPU-promoted layers + performance knobs; rejected until a profile proves need. **Risk/mitigation:** long scroller backing-store growth → viewport ownership, 10-minute trace, compare software compositor and many article cards. **Owners:** resolver/CSS, asset/cache lifecycle, native profiling.

### D18 — Tests prove real pixels, interaction and compatibility

**Choose:** extend current Vitest/Testing Library contracts and Playwright fixture patterns, plus actual packaged-device checks. `test-matrix.md` defines required cases, golden names, thresholds, timing methods and fixture inventory. Keep source/current theme comparison screenshots for snow/obsidian/animated jellyfish and custom themes to prove no material leakage; do not blindly update all goldens.

Realistic EPUB tests must execute hooks against content documents and expose `rendition.getContents` at the production location, not only assert theme API arguments. Test insertRule failure and nonce CSP. HTML tests preserve actual Range/node identity across preview, theme, typography and accessibility changes. PDF original canvas comparison excludes highlights and UI; reflow tests validate anchored source links. RSS tests render all four reader paths and actual effective feed preferences. Mobile goldens at DPR3 inspect fibers at physical resolution; browser emulation is insufficient for color/HDR/native selection claims.

**Alternative:** screenshots of swatches/mock reader, or jsdom-only tests; rejected because they cannot detect hidden textures, native white flashes or per-engine CSS rejection. **Risk/mitigation:** nondeterministic screenshots and hardware data → fixed source/fixture/phase, recorded browser/font/profile, repeated paired device measurements. **Owners:** visual harness, integration tests and native QA. Implementation is done only when required rows pass with saved evidence, and any future HDR statements have separate physical proof.

## Risks / Trade-offs

- [Visual ambition exceeds compressed asset quality] → Treat master/crop/device review and contrast extrema as asset gates; reject the asset instead of compensating with sharpening or heavier CSS.
- [App-wide scope produces accidental global resets] → Named surface inventory, opt-in material attributes, three scoped recipes, no blanket transparency and non-paper regression captures.
- [Fixed-layout/original EPUB source already had styles stripped] → Gate cleanup before first hook; reconstruct from immutable source on original-mode toggle; restore location and listener ownership.
- [EPUB/app theme effects disagree during preview or E-Ink] → One resolved applied snapshot, synchronous refs in hooks, controlled critical-color fallbacks.
- [Packaged CSP or imported base URL prevents texture] → Existing nonce carrier, trusted absolute URLs, production-CSP integration fixture, immediate solid-paper fallback and offline asset test.
- [Limited Android/Linux memory or repaint cost] → DPR ceilings, Subtle fallback, no full-document decoration layers, native profiles; do not claim browser cache reuse guarantees.
- [P3/HDR reports confuse hardware capability and output] → Keep SDR release quality; small verified P3 allowlist; production HDR off and no HDR badge.
- [OpenSpec and source overlap with active changes] → Re-read touched interfaces at implementation start, preserve existing protections, record conflict resolution without refactoring their subsystems.

## Migration Plan

1. Implement schema/resolver/snapshot and normalization additively; legacy and malformed settings resolve to existing palettes or paper defaults. Add Legal Pad to fallback and lazy registry without duplication.
2. Produce licensed assets and manifest offline; validate bytes/extrema/seams before integration, package stable URLs and PWA fallback precache.
3. Integrate shared CSS/chrome and independent reader adapters after snapshot/asset contracts stabilize. Preserve existing content IDs/persisted source bytes. EPUB appearance defaults app; PDF/RSS stored enum meaning stays intact. No reader source reimport or database migration.
4. Add controls/previews/bootstrap/a11y, then run test-matrix gates. Freeze production palette and texture hashes only after visual/device review and contrast reports; record results separately from targets.
5. Roll out the builtin selectable theme only when mandatory SDR/native gates pass; no feature hidden behind experimental HDR. P3 can remain disabled on unverified combinations without blocking the SDR theme.
6. Rollback: remove registration/material emission and hide controls; leave optional settings ignored and source data intact. ThemeProvider chooses its normal fallback for an unavailable ID; no destructive migrations, file edits or dependency rollback required. On live switching/preview cancellation restore prior attributes/styles and unsubscribe frame listeners.

There are no unresolved architectural choices. Device OS/WebView versions, final optically calibrated token adjustments, asset hash/encoder details, and actual measured budgets are validation outputs to record during implementation; they do not authorize skipping the chosen SDR architecture or its acceptance gates.


### Implementation evidence and adjustments (2026-10-17)

The current implementation uses the verified native 4096×4096 ambientCG Paper006 color map under CC0. Its original bit depth is 8-bit SDR; no upscaling, artificial 16-bit precision, HDR or calibrated physical scale is claimed. The smaller ImageGen reference was rejected when the user required a genuine high-resolution source. Runtime derivatives remain lossless WebP/PNG neutral alpha textures. Recorded opacity bounds and conservative contrast calculations led to secondary ink `#51422E` and meaningful border/outline `#6D5C3E`, replacing the provisional candidates. Shared semantic card classes are surface owners alongside explicit data attributes. Host readers with unknown/custom gutters suppress the margin conservatively. See `docs/theme-materials/legal-pad/validation.md` and the still-open tasks for incomplete acceptance; this note does not certify the complete release matrix.
