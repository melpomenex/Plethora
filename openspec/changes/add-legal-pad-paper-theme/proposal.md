## Why

Plethora can recolor its chrome, but its opaque wrappers, separate reader palettes, and iframe lifecycles cannot yet deliver a consistent tactile paper experience. **Legal Pad — Archival Yellow** (`legal-pad`) should make navigating, reading, annotating, and studying feel like working with premium yellow stationery, with authentic fibers and restrained ruling, including on high-density phones.

## What Changes

- Register a static light theme with a complete, deliberately warm Material 3 palette; preserve Plethora's existing component geometry and reader typography controls.
- Add optional, allowlisted paper-material metadata and shared CSS material recipes, with packaged high-density texture variants, subtle macro variation, blue ruling, and a muted red margin. Navigation uses unruled paper; compatible reading surfaces use ruled paper.
- Integrate dashboard, library, navigation, tabs, mobile bars, settings, search/command palette, dialogs/sheets/menus, assistant, queue, flashcards, extracts, annotations, and knowledge-panel chrome.
- Resolve global versus reader appearance explicitly: follow-app reading inherits the material; existing explicit PDF/RSS palettes win; add a minimal follow-app/original choice for EPUB. Preserve native PDF pixels, fixed-layout EPUBs, covers, images, equations, and meaningful publisher styling.
- Extend the existing HTML token/stylesheet pipeline and EPUB rendition lifecycle, and reconcile RSS full-content's independent palettes with the shared RSS preference path. Theme changes update presentation without modifying imported source files or replacing anchored article content.
- Add real material previews and three focused preferences: detail (Subtle/Authentic/Maximum), notebook ruling, and red margin. Default to Authentic, ruling on, margin on where space permits. Runtime resource limits may reduce detail without changing the saved choice.
- Ship excellent sRGB SDR everywhere and cautiously gated, colorimetrically matched Display-P3 enhancement. Production HDR remains disabled: document platform evidence and a separate verification path instead of claiming that P3, OLED, high DPR, or an HDR media query proves HDR output.
- Specify accessibility, safe-area, offline, lifecycle, screenshot, and native-device performance gates. All new numerical budgets are acceptance targets pending measurement.

## Capabilities

### New Capabilities

- `paper-theme-material`: Optional material contract, static layering, asset quality/density/fallback, display tiers, resource policy, and cleanup.
- `legal-pad-theme`: Registration, whole-application surface treatment, controls, persistence, preview/commit/revert, startup, responsive presentation, and accessible paper colors.
- `paper-reader-integration`: Reader appearance precedence and content integrity across EPUB, PDF page/reflow, Markdown/plain text, RSS modes, and reading-adjacent surfaces.

### Modified Capabilities

- `html-viewer-theming`: Add material-aware, nonce-authorized iframe presentation through the existing reader stylesheet without replacing content.
- `themed-html-rendering`: Extend saved-content and extract rendering to material-aware presentation with semantic-media exceptions; retain safe sanitization and structural reading behavior.
- `material-reader-chrome`: Clarify the migration isolation requirement to permit deliberately selected reader materials while preserving typography, content geometry contracts, and original page fidelity.

## Impact

Frontend work centers on `src/types/theme.ts`, `src/themes/`, `ThemeContext`, `settingsStore`, the theme picker/gallery, `src/index.css` and mobile styles, shared surfaces, `DocumentViewer`/`htmlReader`, `EPUBViewer`, `PDFViewer` and both reflow renderers, `MarkdownViewer`, `RichContentRenderer`, and RSS readers/preferences. Add production asset sources/manifest and packaged derivatives, offline caching, visual fixtures, and focused unit/integration coverage. No database migration, new graphics framework, native HDR configuration, rendering-engine replacement, or runtime image generation is planned.

Coverage includes Tauri Android/iOS/macOS/Windows/Linux and browser/PWA. Native launch/system surfaces remain governed by platform APIs; reader/app first-paint backgrounds must be coherent after appearance restoration. Risks are hidden material behind opaque wrappers, iframe CSS resets/CSP, selection or CFI drift, oversaturated or incorrectly decoded textures, repeated-image memory, Linux software-rendering cost, and conflict with ongoing reader/RSS/assistant work. The design supplies owners and release gates for each.

Non-goals: application implementation in this change's planning phase; production asset generation now; source-file recoloring; filtering PDF canvases; decorative animation; a general material editor; temperature and ruling-intensity controls; shipping unverified HDR. Expected outcome: a complete default stationery experience, reliable overrides and accessibility fallbacks, and no material interaction/performance regression.
