## Context

`WebArticleImportDialog` allows users to import web articles and PDFs by URL, previewing parsed metadata and rendered content before saving. See proposal.md for the motivation behind fixing its mobile display.

Currently, `WebArticleImportDialog`:
- Renders inline inside `DocumentsView` and `Toolbar` without `createPortal`, causing stacking and z-index collisions with the mobile layout shell and bottom navigation bar.
- Uses `bg-background` and `bg-card/50` for container backgrounds, which resolve to transparent surfaces under scenic and jellyfish themes (`:root[data-theme-id="..."] .bg-background:not(.app-shell) { background: transparent !important; }`).
- Uses a fixed desktop layout with a horizontal `flex` row containing a `w-96` (384px) left panel and a `flex-1` right panel, completely overflowing mobile viewports and pushing the article preview offscreen.

## Goals / Non-Goals

**Goals:**
- Portal `WebArticleImportDialog` to `document.body` via `createPortal`.
- Ensure an opaque, high-contrast modal surface across all themes (scenic, jellyfish, light, dark, and high-contrast) with a proper scrim backdrop.
- Detect mobile presentation via `useMobileShell()`.
- Adapt mobile shell layout:
  - Full-screen container with safe-area insets (`env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`).
  - Clean mobile navigation header with back/close touch targets.
  - Responsive layout for article input and options.
  - When preview is available, support mobile segment/tab switching (`[Details]` vs `[Preview]`) or clean vertical stacking with a docked sticky import button.
- Maintain existing 2-column desktop layout on wide viewports without regressions.

**Non-Goals:**
- Modifying the article extraction pipeline (`src/utils/articleImport/`) or core fetch engines.
- Modifying document store persistence contracts or metadata schema.

## Decisions

### 1. Root Portal Rendering (`createPortal`)
- **Decision**: Render the dialog using `createPortal(..., document.body)`.
- **Rationale**: Isolates the modal from parent transform, overflow, and stacking context limitations in `mobile-main-content` and ensures it displays above `MobileNavigation` (z-index 50+).
- **Alternative considered**: Keeping it inline and increasing z-index. Rejected because stacking contexts created by parent CSS transforms or opacity trap child `fixed` elements.

### 2. Opaque Surface & Theming Protection
- **Decision**: Apply `modal-content`, `bg-card`, and explicit surface container styling to the dialog surface.
- **Rationale**: Themes with glass/scenic backdrops explicitly treat `.modal-content` as opaque surface containers (`background: var(--color-surface) !important; backdrop-filter: none !important;`). This guarantees that background document cards never show through.
- **Scrim**: Use `bg-black/70 backdrop-blur-sm` for the backdrop overlay.

### 3. Mobile Adaptive View Flow
- **Decision**: In mobile shell mode (`isMobileShell`):
  - When no preview is loaded: render single-column URL input, format selector (if PDF), tags, quick tags, and fetch button.
  - When preview is loaded: display a mobile segmented control at the top of the content area to toggle between `[Preview]` and `[Options]` (or smooth stacked scroll view), defaulting to `Preview` so users immediately see the fetched article, with the "Import to Library" button docked at the bottom above the safe-area inset.
- **Rationale**: Phones have limited horizontal space (360–430px) and vertical height. Forcing both columns simultaneously causes severe clipping. Segmenting allows full-height inspection of the article preview iframe or text while preserving access to tag adjustments.
- **Alternative considered**: Stacking both columns vertically in a single scroll container. This severely reduces the height available for the article preview iframe and creates nested scroll trap issues on mobile.

### 4. Touch-Friendly Controls & Safe Area Compliance
- **Decision**: Ensure all buttons (Fetch, Tags, Close, Import) have a minimum touch target size of 44px on mobile, with input fields sized at `text-base` to prevent unwanted iOS/Android automatic zoom on focus. Wrap quick-tag pills cleanly with appropriate gap spacing.

## Risks / Trade-offs

- **[Risk]** Iframe scrolling on mobile touch screens can capture scroll gestures.
  - **Mitigation**: Apply `touch-action: pan-y` and allow text preview fallback mode; provide clean viewport margins.
- **[Risk]** Mobile keyboard appearance may resize viewport.
  - **Mitigation**: Use `100dvh` / `h-full` within the flex layout with `overflow-y-auto` so the active input remains scrollable into view.
