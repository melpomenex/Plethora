## Why

Plethora's live command palette opens onto an almost empty search surface and hides the most useful next steps behind typing. Replace it with the user's reference command hub, matching its composition and black-and-gold finish 1:1 while making reading, review, capture, search, and library assistance immediately usable.

## What Changes

- Rebuild the live `CommandCenter` / `GlobalSearch` surface around the supplied image: a focused search field, All / Actions / Documents / Library / Cards / Settings chips, six quick-action tiles, a rich Resume reading card, and four Ask Plethora example prompts.
- Preserve the reference image in `reference/command-palette-target.png`; define measured geometry, typography, material, iconography, focus treatments, and a visual comparison gate instead of leaving “1:1” to interpretation.
- Wire Resume reading, Open recent document, Review due cards, Ask about your library, Open settings, and Create a note to real application flows. Reading metadata, cover, due count, last position, and excerpts come from available user data.
- Give every category, View all, See all actions, See examples, document overflow, and suggestion an explicit behavior. Add a small note composer and durable note-saving path because the current RSS note editor is not a general library-note workflow.
- Keep typed command/content search, exact-hit jumps, help queries, URL import, platform availability checks, and saved/recent searches working in the same palette.
- Surface applicable “Actions in this view” before the general hub content in supported readers; use the screenshot composition unchanged on the dashboard.
- Add coherent keyboard selection, focus containment and restoration, announced states, touch-sized targets, responsive layouts, and honest empty/loading/error/offline states.
- Keep the app shell outside the overlay unchanged and retain lazy, bounded data loading for large libraries.

## Capabilities

### New Capabilities

- `command-palette-hub`: Reference-matched command hub presentation, useful home content, category browsing, quick actions, reading resume, note capture, assistant handoff, keyboard/accessibility behavior, responsive states, and bounded loading.

### Modified Capabilities

- `contextual-palette-actions`: Replace the empty-query flat-command presentation with a named contextual section ahead of the command hub, retaining applicability filtering, priority, and dispatch to existing active-view handlers.

## Impact

- Primary UI: `src/components/search/GlobalSearch.tsx`, `src/components/search/CommandCenter.tsx`, and palette-scoped styles in `src/index.css`; extract focused presentation components under `src/components/search/`.
- Shared contracts: `src/components/common/CommandPalette.tsx`, `src/components/search/sectionRegistry.ts`, `src/commandPalette/`, UI/tab stores, startup/document/review data, document-opening helpers, and translation entries.
- Integration: existing grounded library-assistant workflow, help workflow, document/import APIs, plus a minimal note-composer save adapter. No new AI provider, retrieval engine, search engine, or library-wide indexing job.
- Validation: meaningful component/interaction tests, existing palette shortcut and navigation regressions, deterministic desktop/mobile visual captures, TypeScript/build checks, and the repository's local `npm run bench:check` gate during implementation. No new visual or animation dependency is planned.
