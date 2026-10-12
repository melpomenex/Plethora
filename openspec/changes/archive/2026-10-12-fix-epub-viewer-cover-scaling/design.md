## Context

When an EPUB is opened in `EPUBViewer.tsx`, epub.js renders each spine section in an `<iframe>`. The `applyContentOverrides` function applies `#epub-override-styles` to enforce reader theme colors and base typography.

Currently, `#epub-override-styles` sets:
```css
img {
  max-width: 100% !important;
  height: auto !important;
  display: block !important;
  margin: 1em auto !important;
}
```
Crucially, there is no `max-height` constraint, no `object-fit: contain`, no rule for `<svg>`, and no cover-specific layout handling. Furthermore, the iframe `<body>` receives substantial reading padding (`2rem 3rem` desktop, `1.25rem 1rem 4.5rem` mobile, plus `padding-bottom: 80px`).

In continuous scrolled mode (`flow: "scrolled"`), epub.js sizes each section iframe to its content's `textHeight()`. Without a vertical boundary, a book cover image expands to the full reader width (e.g., 1200px) and its proportional height expands to 1800–2400px. The iframe is resized to match, and the user only sees the top fraction of the cover in their viewport.

See `proposal.md` for motivation and `specs/epub-viewer-cover-scaling/spec.md` for requirements.

## Goals / Non-Goals

**Goals:**
- Ensure EPUB cover images and illustrations fit completely inside the reader viewport on all screens (desktop, mobile, tablet) without vertical or horizontal cropping.
- Detect cover sections reliably and apply full-viewport, centered layout rules with zero padding.
- Support both `<img>` and `<svg>` cover implementations (including Calibre `<svg>` wrappers and fixed-dimension SVGs).
- Keep reader viewport dimensions synchronized with the host container on initial render and during resize.

**Non-Goals:**
- Modifying document grid or library card cover rendering (covered separately in `fix-epub-cover-scaling`).
- Modifying non-EPUB document viewers (PDF, Markdown, HTML, Video).
- Altering reading typography or margins on text-heavy chapters.

## Decisions

### Decision 1: Viewport dimension injection via CSS Custom Properties
- **Choice**: Inject `--epub-viewport-height` and `--epub-viewport-width` on `:root` / `html` of each content document based on `viewerRef.current?.clientHeight` (falling back to `window.innerHeight`).
- **Rationale**: Inside an iframe in continuous mode, standard `100vh` resolves to the iframe element's height, which can expand with unconstrained content. Injecting CSS variables driven by the host container allows `max-height: calc(var(--epub-viewport-height, 100vh) - ...)` to bind reliably to the actual visible reader window.
- **Alternatives considered**: Calculating and setting fixed inline pixel dimensions on every image element in JavaScript. This is brittle, breaks on window resize, and fails with dynamically inserted elements.

### Decision 2: Multi-signal cover section detection
- **Choice**: Implement a helper `isEpubCoverSection(contents)` that classifies a section as a cover if:
  1. `contents.section?.index === 0` and the section has no substantial text (`doc.body.textContent.trim().length < 100`) and contains an `<img>` or `<svg>`; OR
  2. `section.href` or `section.idref` matches `/cover|titlepage/i`; OR
  3. `section.properties` includes `"cover-image"`; OR
  4. The document contains `<meta name="calibre:cover">` or `<body class="...cover...">` or `[epub:type*="cover"]`; OR
  5. The body contains an `<img>` or `<svg>` with zero text content.
- **Rationale**: Ebooks in the wild use varying conventions (Calibre, Adobe InDesign, Sigil, EPUB 2 guide, EPUB 3 landmarks, or plain first-page images). A multi-signal heuristic ensures broad compatibility while preventing false positives on text chapters.
- **Alternatives considered**: Checking only `index === 0`. Some books have a dedication or half-title at index 0 and cover at index 1, or start with chapter 1 with no cover.

### Decision 3: Dedicated Cover Page Styling
- **Choice**: Mark cover sections with class `epub-cover-page` on `doc.body`. When `epub-cover-page` is present:
  - Remove intrusive padding (`padding: 0 !important; margin: 0 !important;`).
  - Constrain container height to `var(--epub-viewport-height, 100vh)`.
  - Use flexbox centering to center the cover artwork both vertically and horizontally.
  - Scale `img` and `svg` with `max-width: 100% !important; max-height: var(--epub-viewport-height, 100vh) !important; object-fit: contain !important;`.
- **Rationale**: Covers are visual title presentations that should be displayed cleanly edge-to-edge or centered without body reading padding pushing them off-screen.

### Decision 4: Safe scaling for in-chapter images and SVGs
- **Choice**: In general chapter content, style `img` and `svg` with `max-height: calc(var(--epub-viewport-height, 100vh) - 5rem) !important` and `object-fit: contain !important`.
- **Rationale**: Figures, maps, and illustrations inside chapters should also fit within a single view without exceeding the reader window.

### Decision 5: Dynamic Resize Synchronization
- **Choice**: In `EPUBViewer.tsx`'s container `ResizeObserver`, update `--epub-viewport-height` and `--epub-viewport-width` on all mounted documents returned by `rendition.getContents()`.
- **Rationale**: Immediate reactivity when the window is resized or side panels toggle, without requiring full section re-renders.

## Risks / Trade-offs

- **[Risk]**: A first chapter that has an illustration alongside text might be misclassified as a cover page.
  - *Mitigation*: The heuristic checks `textContent.trim().length < 100`. If a page has substantial text, it is treated as a regular chapter (where images still get `max-height` constraints but keep reading padding and text layout).
- **[Risk]**: SVG images with missing `viewBox` or hardcoded pixel dimensions.
  - *Mitigation*: In the content hook, inspect `<svg>` elements; if `viewBox` is missing, construct it from `width` and `height` attributes, and set `preserveAspectRatio="xMidYMid meet"`.
