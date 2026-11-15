# Proposal: Progressive Disclosure, Command Spine & Context Navigation

## Why

Power-user telemetry (`DaqeScoreBreakdown`, `FSRSInspector`, stability/difficulty/retrievability badges, raw numeric priority sliders) currently clutters reading and review views by default, creating visual noise for learners who simply want to focus on comprehension. Simultaneously, common queue and authoring commands are scattered across hover toolbars instead of a unified searchable `Cmd/Ctrl + K` command spine, isolated extracts lose their surrounding document context during queue review, and `ExtractsList.tsx` / `DocumentMinimap.tsx` do not visualize the hierarchy connecting a root document, child extracts, and grandchild flashcards.

## What Changes

### ADDED
- **Global UI Density Mode (`Zen Mode` vs. `Architect Mode`)**: `densityMode: "zen" | "architect"` persisted in `uiStore.ts` (`localStorage` key `plethora_ui_density_mode`), toggled anywhere via `Cmd/Ctrl + \` or the Command Palette. Zen Mode hides raw SRS/DAQE telemetry HUDs; Architect Mode reveals them.
- **Ghost Context Peek (`Hold Alt` / Elastic Overscroll)**: `GhostContextPeek.tsx` inside `ExtractScrollItem.tsx` that reveals the breadcrumb hierarchy (`Document > Chapter > Section`) plus 2 preceding and 2 succeeding parent paragraphs in muted ghost typography when holding `Alt` or overscrolling upward at `scrollTop === 0`.
- **Parent-Child Subway Minimap**: `SubwayMinimap.tsx` in document/extract sidebars rendering a vertical SVG/CSS transit graph (`Root Document -> Child Extracts -> Grandchild Flashcards`) with mastery badges (`Mastered`, `In Queue`, `Unread`) and 1-click split-reference navigation.

### MODIFIED
- **Universal Command Palette (`src/commandPalette/registry.tsx` & `CommandPalette.tsx`)**: Add fuzzy-searchable actions for view navigation, queue ordering mode swaps (`Adaptive` <-> `Strict Manual`), Zen/Architect density toggle, extract/cloze/docked-Q&A creation, and theme switching, each rendered with right-aligned `kbd` hotkey hints.
- **Review & Queue HUDs (`ScrollOverlayControls.tsx`, `FlashcardScrollItem.tsx`, `ExtractScrollItem.tsx`, `FSRSInspector.tsx`)**: Respect `uiStore.densityMode` so telemetry badges collapse in Zen Mode and appear seamlessly in Architect Mode.

### REMOVED
- Unconditional rendering of raw `stability`, `difficulty`, `R-value`, and `DaqeScoreBreakdown` HUD panels inside Zen reading/review surfaces.

## Capabilities

### New Capabilities
- `progressive-disclosure-navigation`: Dual-density Zen/Architect telemetry progressive disclosure, expanded command palette spine with hotkey hints, Alt/overscroll Ghost Context Peek for isolated extracts, and visual Parent-Child Subway Minimap.

### Modified Capabilities
- None.

## Impact

- **Frontend Stores & Registries**: `src/stores/uiStore.ts`, `src/commandPalette/registry.tsx`, `src/components/common/CommandPalette.tsx`.
- **Frontend Components**: `src/components/queue/ScrollOverlayControls.tsx`, `src/components/review/FlashcardScrollItem.tsx`, `src/components/review/ExtractScrollItem.tsx`, `src/components/review/GhostContextPeek.tsx` (new), `src/components/viewer/SubwayMinimap.tsx` (new), `src/components/extracts/ExtractsList.tsx`, `src/components/viewer/DocumentViewer.tsx`.
- **Settings Search Check**: Note that `densityMode` is a live HUD toggle in `uiStore` (`Cmd/Ctrl + \`), not a static `<Settings />` form row; if also mirrored into `InterfaceSettings`, it MUST register in `settingsSearchCatalog.ts` and `settingsSearchCoverage.ts`. Keeping `densityMode` as a HUD/Command Palette toggle avoids requiring Settings page catalog edits.
- **Risks**: Holding `Alt` in browser/Linux window managers can focus the window menu bar if not `preventDefault()`-handled; mitigated cleanly with `KeyboardEvent.key === "Alt"` listener scoping and an explicit clickable/touch peek toggle button alongside overscroll.
