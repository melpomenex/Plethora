## 1. AI task adapters

- [x] 1.1 Rewrite `explainPassage` and `answerPassage` in `src/lib/ai/passageAI.ts` to use `runAiAction({ onDevice, cloud }, label, requirement)`; the cloud branch calls `answerQuestion` from `src/api/ai.ts` instead of `generateNativePrompt`
- [x] 1.2 Add `summarizePassage` (on-device `summarize()`, cloud `summarizeContent`)
- [x] 1.3 Add `simplifyPassage` (on-device prompt, cloud `simplifyContent`) and `keyTermsPassage` (on-device prompt, cloud `extractKeyPoints`)
- [x] 1.4 Truncate the passage to `resolveTokenBudget` before sending and return a `truncated` flag so the UI can say the input was shortened
- [x] 1.5 Extend `src/lib/ai/__tests__/passageAI.test.ts`: each adapter takes the cloud path when `resolveAiPath` returns `cloud`, the on-device path when it returns `ondevice`, a cancellation does not fall back, and truncation sets the flag

## 2. Selection sheet component

- [x] 2.1 Create `src/components/viewer/SelectionActionsSheet.tsx` on `MobileContextMenuSheet` with `variant="content"`; props `{ open, text, onClose, onCreateExtract, onCreateExtractFromResult? }`
- [x] 2.2 Render the menu mode: selection preview (truncated) + "Create extract" and "Copy" rows using `mobileSheetItemClass` and `copySelectionTextToClipboard`
- [x] 2.3 Gate the AI rows on `useAiAvailability("prompt")`; render Explain / Summarize / Simplify / Key terms / Ask a question only when a path exists
- [x] 2.4 Implement the "Ask a question" input mode (text field + submit) feeding `answerPassage`
- [x] 2.5 Implement the result mode: streamed/complete output, Copy, Retry, "Create extract from result", and the grounding note when `grounded` is false
- [x] 2.6 Own an `AbortController` — cancel on close and on a Cancel control; show the error state with Retry when a request fails on every path
- [x] 2.7 Surface the downloadable/downloading on-device state with a start-download action when no cloud provider is configured
- [x] 2.8 Add i18n keys for every new row, state, and message

## 3. Wire into DocumentViewer

- [x] 3.1 Replace the floating lightbulb block (`src/components/viewer/DocumentViewer.tsx:7386`) with `SelectionActionsSheet`, keeping the existing `mobileSelection` detection effect
- [x] 3.2 Route "Create extract" to the existing `handleMobileExtract` path so document id, page number and `selectionContext` are unchanged
- [x] 3.3 Route "Create extract from result" through the same `computeExtractPageNumber`/`selectionContext` values with the result text
- [x] 3.4 Drop the 5s auto-hide timer while the sheet is open, and close the sheet on selection clear / Escape / scrim tap
- [x] 3.5 Decide and implement the passage sent to the model: selection plus surrounding context where the surface already has it

## 4. Other reading surfaces

- [x] 4.1 Mount the sheet in `TranscriptPanel` for mobile transcript selections
- [x] 4.2 Mount the sheet in `QueueScrollPage` for RSS/article selections, wiring `onCreateExtract` to its existing extract path

## 5. Verification

- [x] 5.1 Component tests: sheet opens on selection, AI rows hidden when `useAiAvailability` reports unavailable, result mode renders output, Retry re-runs the action
- [x] 5.2 Test that closing the sheet mid-request aborts and issues no cloud fallback
- [x] 5.3 Run `npm run lint` and the vitest suite
- [ ] 5.4 Verify on an Android device: on-device path with the model ready, cloud path with on-device disabled, and no-AI degradation; confirm the sheet does not collide with the OS selection toolbar
  - Done: on-device path — Explain on an EPUB selection in the queue returned in ~20s via Gemini Nano (185 tokens); no collision with the OS selection toolbar
  - Remaining: cloud path with on-device disabled, and no-AI degradation
