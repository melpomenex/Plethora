## Context

Currently, `StudyModeWorkspace.tsx` flattens all AI failures to raw error strings (e.g. `Task study-mode-mind-map produced structured output that failed validation: empty response...`), classifies errors only as `offline | ai`, lacks scope-switch stale-response guards on async loads, does not register mobile sheets with `overlayStack`, and has broken `speechSynthesis` fallback and ephemeral `blob:` URL persistence in `studyMediaCache.ts`.

## Goals / Non-Goals

**Goals:**
- Map `AIError` / `AIErrorCategory` (`src/lib/ai/errors.ts`) into structured, human-readable `StudyModeErrorPresentation` (title, explanation, recovery actions, optional collapsible technical detail).
- Prevent stale async responses from mutating state after a document, scope, or session change via monotonic request-epoch guards.
- Persist draft written practice answers in session snapshot so switching tabs or toggling Read/Study does not lose typed work.
- Register transient Study Mode sheets/drawers with `registerOverlayDismissal` (`src/lib/overlayStack.ts`) so Escape and native mobile Back work cleanly without duplicate global Back listeners.
- Fix `PlayableAudioLessonPlayer` / `PlayableSlidesPlayer` `speechSynthesis` fallback and `studyMediaCache` honesty.
- Validate end-to-end with unit, integration, Rust, build, benchmark, and Playwright visual tests.

**Non-Goals:**
- Creating a parallel AI error framework outside `src/lib/ai/errors.ts`.
- Adding fake progress bars or synthetic telemetry.

## Decisions

1. **Error Taxonomy Mapper (`studyErrorTaxonomy.ts`)**: Inspect `AIError.category` (plus message heuristics for non-`AIError` exceptions like empty response / malformed structured output / verification failure / source unavailable / consent denied / local-only restriction) to produce concise user copy + exact applicable actions (`retry`, `open-ai-settings`, `inspect-source`, `dismiss`).
2. **Stale-Response Guard**: Track `activeScopeEpochRef` in `StudyModeWorkspace` (incremented on every `scopeKey` or `documentId` change); discard any async session load, evidence load, or generation result whose captured epoch no longer matches, and cancel in-flight tasks via `taskController.cancelAll()` on scope change or unmount.
3. **Mobile & Escape Stack**: Register open preferences drawer, history panel, scope popover, and mobile companion sheet with `registerOverlayDismissal` so `dispatchApplicationBack` dismisses them before navigating away from the document tab.
4. **Theme & WebKitGTK Performance**: Use only Plethora semantic tokens (`bg-background`, `bg-card`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`), avoiding heavy `backdrop-blur` on large scrollable surfaces so WebKitGTK and animated/e-ink themes remain crisp and fast.
