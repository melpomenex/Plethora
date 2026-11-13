# Verification Plan: Restore Assistant & Reader UX Continuity

## Automated Test Suites

### T01: Reader Table Layout Suite (Vitest)
- File: `src/components/viewer/__tests__/EPUBViewer.table.test.tsx`
- Scenarios:
  - Render an EPUB fixture containing a 6-column data table.
  - Assert computed style has `overflow-x: auto` and table width is not collapsed.
  - Assert table cells do not wrap words into single-character columns.

### T02: Theme Contrast Automated Audit (Vitest)
- File: `src/themes/__tests__/themeContrast.test.ts`
- Scenarios:
  - Evaluate all themes in `src/themes/builtin.ts`.
  - Calculate color contrast ratio (WCAG 2.1 formula) between `foreground` and `background`, and between `mutedForeground` and `muted`.
  - Assert that all text combinations meet or exceed 4.5:1 ratio.

### T03: Assistant Scroll Stability Suite (Vitest)
- File: `src/components/assistant/__tests__/useAssistantConversationScroll.test.ts`
- Scenarios:
  - Scroll conversation to 350px offset.
  - Simulate tab change to Reader and back to Assistant.
  - Assert scroll offset remains at 350px ($\pm 1\text{px}$) and `showLatest` button is `false`.

## Performance Benchmark Gate

- Command: `npm run bench:check`
- Assert that table rendering and scroll listener hooks maintain 60fps scrolling without layout thrashing.

## Current Issue #6 acceptance


| IDs | Task | Evidence |
| --- | --- | --- |
| U02 | 4.1 | Wrappers present. Native visual comparisons for the reported narrow table behavior pending. |
| U03 | 4.2 | Dark reader link/text contrast visible in issue attachments. Exact theme identity remains unconfirmed. Use computed token evidence. |
| U01 | 4.3 | Current Chromium suite passed 3/3 after browser install. Real webview, device and additional host transitions remain pending. |
