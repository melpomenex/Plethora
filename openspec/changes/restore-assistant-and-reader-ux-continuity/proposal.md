## Why

Reading and conversational study require deep focus and visual clarity. Currently, tables in the EPUB reader are vertically squished into single-character columns because unconstrained tables are forced into a fixed width without horizontal scrolling (`screenshot_01`), dark themes exhibit severe illegibility due to near-black text on dark backgrounds (`screenshot_02`), and the Assistant panel resets scroll position during routine queue navigation or tab switches, accompanied by a flashing "Latest message" button (`screenshot_15`, `screenshot_16`, `screenshot_05`). Restoring visual continuity and scroll anchoring is essential for sustained reading comprehension.

## What Changes

- Wrap EPUB and Markdown reader tables in a responsive horizontal-scrolling container with `min-width: max-content`, preserving table structure and column widths.
- Audit and adjust CSS custom properties in `builtin.ts` and theme stylesheets to guarantee WCAG AA contrast (minimum 4.5:1) across all dark and night themes.
- Harden `useAssistantConversationScroll.ts` and `AssistantPanel.tsx` to maintain exact reading scroll offsets across tab switches and queue item transitions.
- Prevent rendering empty assistant message bubbles when stream chunks are buffered or uncommitted.

## Capabilities

### New Capabilities

- `assistant-and-reader-ux-continuity`: Responsive table layout in reading views, WCAG AA compliant dark theme contrast, seamless assistant scroll restoration across navigation, and empty-bubble suppression.

### Modified Capabilities

- `assistant-scroll-restoration`: Ensure conversation scroll offset is strictly preserved across queue item switching and tab toggling.
- `update-dark-theme-contrast`: Ensure all text elements meet minimum contrast ratios in dark presentation modes.

## Impact

- **Frontend**: `src/components/viewer/EPUBViewer.tsx`, `src/styles/reading.css`, `src/themes/builtin.ts`, `src/themes/resolveThemeAppearance.ts`, `src/components/assistant/useAssistantConversationScroll.ts`, `src/components/assistant/AssistantPanel.tsx`.
- **Invariants**: Document content, annotations, and reading progress bookmarks remain untouched. Assistant message history is preserved in SQLite without loss.
