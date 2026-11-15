# Design: Progressive Disclosure, Command Spine & Context Navigation

## Context

- `src/stores/uiStore.ts` (lines 1–126) currently tracks sidebar collapse, active drawers, and modal visibility via Zustand without `densityMode`.
- `src/commandPalette/registry.tsx` (lines 1–902) defines `CommandItem` entries consumed by `src/components/common/CommandPalette.tsx`.
- `src/components/review/ExtractScrollItem.tsx` (lines 1–585) renders isolated extract text using `documentTitle`, `extract`, and parent metadata without surrounding parent paragraphs.
- `src/components/review/FSRSInspector.tsx` and `src/components/queue/DaqeScoreBreakdown.tsx` render detailed SRS/DAQE diagnostics.
- `src/components/extracts/ExtractsList.tsx` and `src/components/viewer/DocumentMinimap.tsx` show extracts as a flat list and thin scrollbar rather than a structural parent-child tree.

## Goals / Non-Goals

**Goals:**
- Separate serene comprehension (`"zen"`) from power-user diagnostics (`"architect"`) behind a 1-keystroke persistent toggle (`Cmd/Ctrl + \`).
- Centralize view navigation, queue ordering toggles, density mode, theme switching, and extraction commands inside `Cmd/Ctrl + K` with clear `kbd` badges.
- Restore spatial grounding for isolated queue extracts via transient Alt-hold / overscroll `GhostContextPeek`.
- Replace purely linear extract lists with a visual `SubwayMinimap` encoding parent-child lineage and mastery state.

**Non-Goals:**
- Implementing `GhostContextPeek` for external websites without cached document text (uses `parentDocument.content` already stored in SQLite).
- Persisting `densityMode` inside SQLite user preferences unless requested later (Zustand + `localStorage` matches `uiStore` patterns).

## Decisions

### 1. `useUIStore` Density Slice (`src/stores/uiStore.ts`)

```ts
export type UIDensityMode = "zen" | "architect";

// Added to UIStore interface:
densityMode: UIDensityMode;
setDensityMode: (mode: UIDensityMode) => void;
toggleDensityMode: () => void;
```
- Initialized lazily from `localStorage.getItem("plethora_ui_density_mode")` (`"zen"` fallback if unset or invalid).
- Telemetry components (`DaqeScoreBreakdown`, `FSRSInspector` inline badge, raw `priorityScore`/`stability`/`difficulty`/`retrievability` rows) wrap in `<div data-architect-telemetry="true">` and only mount when `densityMode === "architect"`.

### 2. Command Palette Registry Expansion (`src/commandPalette/registry.tsx` & `CommandPalette.tsx`)

Add structured `shortcut?: string` (already present or normalized on `CommandItem`) rendered on the trailing edge of each palette row as styled `<kbd>` tokens (`Cmd+\`, `Cmd+Shift+Q`, etc.). Register commands:
- `view.toggle-density`: `"Toggle Zen / Architect Mode"` (`shortcut: "Mod+\\"`)
- `queue.ordering-adaptive`: `"Queue: Switch to Adaptive Ordering"`
- `queue.ordering-strict-manual`: `"Queue: Switch to Strict Manual Ordering"`
- `queue.ordering-toggle`: `"Queue: Toggle Adaptive / Strict Manual Ordering"`
- `extract.open-docked-qa`: `"Extract: Open Docked Q&A Split-Sheet"` (`shortcut: "Mod+Shift+Q"`)
- `theme.cycle`: `"Theme: Switch / Cycle Color Theme"`

### 3. Ghost Context Peek Resolution (`src/components/review/GhostContextPeek.tsx`)

Pure context extraction utility `extractSurroundingParagraphs(parentContent: string, extractText: string, radius = 2)`:
1. Normalizes HTML/Markdown into clean text paragraphs (`split(/\n\s*\n|<\/p>/i)` stripping tags cleanly).
2. Finds the paragraph index containing a normalized substring prefix (`extractText.slice(0, 64).trim()`) or character offset if `extract.source_offset` is present.
3. Extracts heading breadcrumb stack (`extractHeadingBreadcrumb`) from preceding `<h1>..<h4>` or Markdown `#..####` headings up to the matched paragraph.
4. Returns `{ breadcrumb: string[]; before: string[]; after: string[] }` (`slice(Math.max(0, idx - 2), idx)` and `slice(idx + 1, idx + 3)`).
5. Triggered in `ExtractScrollItem.tsx` via:
   - `window` `keydown`/`keyup` checking `e.key === "Alt"` (ignoring when `metaKey/ctrlKey/shiftKey` or editable target is active).
   - Wheel overscroll upward (`onWheel`: if `container.scrollTop <= 0 && e.deltaY < -35`, toggle/hold peek for 2500ms or until downward scroll).
   - Accessible toolbar chip button (`Peek Context (Alt)`) so mouse/trackpad-only or accessibility users can toggle it too.

### 4. Parent-Child Subway Minimap (`src/components/viewer/SubwayMinimap.tsx`)

Mastery classification helper `classifyNodeMastery(stats)`:
- `"mastered"`: `stability !== undefined && stability >= 21`
- `"in_queue"`: `(reps ?? 0) > 0 || Boolean(nextReview)`
- `"unread"`: otherwise

Renders a vertical transit line (`border-l-2` / SVG metro rails) with nodes:
- Level 0: Root `Document` node (`circle` filled emerald/slate)
- Level 1: `Child Extract` nodes indented with curved metro branch connector + snippet + mastery pill
- Level 2: `Grandchild Flashcard` nodes nested under each extract with Q&A/Cloze icon + mastery dot + click-to-open side-by-side (`onOpenSideBySide(node)`).

## Risks / Trade-offs

- **`Alt` Key Interception on Linux Desktops**: Pressing bare `Alt` on some GTK/WebKit configurations opens or focuses menu bars. **Mitigation**: Keep an explicit toggle chip button next to Ghost Context Peek and support upward overscroll gesture so users are never dependent on OS `Alt` pass-through.
- **Large Documents During Paragraph Matching**: Regex splitting huge (>1MB) documents on every render could drop frames. **Mitigation**: Memoize `extractSurroundingParagraphs` lazily inside `GhostContextPeek` *only when* `isPeeking === true`.

## Migration Plan

1. Add `densityMode` slice to `src/stores/uiStore.ts` + bind `Cmd/Ctrl + \` + hide telemetry in `zen` mode (`UX02-T01`).
2. Expand `src/commandPalette/registry.tsx` and right-aligned hotkey hints in `CommandPalette.tsx` (`UX02-T02`).
3. Build `GhostContextPeek.tsx` and wire Alt-hold/overscroll into `ExtractScrollItem.tsx` (`UX02-T03`).
4. Build `SubwayMinimap.tsx` and mount into `ExtractsList.tsx` / `DocumentViewer.tsx` (`UX02-T04`).
