# Tasks: Restore Assistant & Reader UX Continuity

## 1. EPUB & Reader Table Formatting

- [ ] 1.1 Update `src/components/viewer/EPUBViewer.tsx:1078` CSS injection to set `overflow-x: auto` and `min-width: max-content` on tables.
- [ ] 1.2 Update `src/styles/reading.css` `.reading-prose table` to ensure horizontal scrolling wrapper and comfortable cell padding.
- [ ] 1.3 Add Vitest component test in `src/components/viewer/__tests__/EPUBViewer.table.test.tsx` verifying that multi-column tables do not crush column widths below min-content.

## 2. Dark Theme Contrast Hardening

- [ ] 2.1 Audit color values in `src/themes/builtin.ts` across Midnight, Dark, and High Contrast palettes.
- [ ] 2.2 Correct low-contrast text tokens to ensure minimum 4.5:1 contrast against dark container backgrounds.
- [ ] 2.3 Add automated contrast audit test in `src/themes/__tests__/themeContrast.test.ts` computing contrast ratios for all builtin themes.

## 3. Assistant Conversation Scroll Restoration & Empty Bubble Filtering

- [ ] 3.1 Update `src/components/assistant/AssistantPanel.tsx:891` to anchor scroll keys by `conversationId` rather than transient presentation wrappers.
- [ ] 3.2 Refactor `src/components/assistant/useAssistantConversationScroll.ts` to preserve reading scroll position when switching tabs or items in the same conversation.
- [ ] 3.3 Filter out empty assistant message bubbles in `AssistantPanel.tsx` until text content arrives or render typing indicator.
- [ ] 3.4 Add Vitest test in `src/components/assistant/__tests__/useAssistantConversationScroll.test.ts` asserting scroll stability across tab switches.
- [ ] 3.5 Run `npm run bench:check` to ensure no performance regression.
