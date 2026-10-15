## Why

On mobile the only thing a text selection can do today is create an extract: `DocumentViewer` shows a single floating lightbulb button (`src/components/viewer/DocumentViewer.tsx:7386`). Meanwhile the app already ships the whole AI half of the feature unused — `explainPassage`/`answerPassage` in `src/lib/ai/passageAI.ts` have tests but zero UI callers, and `runAiAction`/`useAiAvailability` already route between Android on-device Gemini Nano and the configured cloud provider. Readers on Android have AI available and no thumb-reachable way to ask "what does this mean?" about the sentence they just selected.

## What Changes

- Selecting text on mobile opens the existing bottom-sheet menu (`MobileContextMenuSheet`) instead of a lone lightbulb button. The sheet lists the current extract action plus AI actions.
- AI actions on the selection: **Explain**, **Summarize**, **Simplify**, **Define/Key terms**, and **Ask a question about this** (free-text follow-up). Results stream into the same sheet.
- Actions route through the existing `runAiAction` resolver: Android on-device model when it is ready and preferred, otherwise the configured cloud provider. When neither path exists, AI rows are hidden and the sheet degrades to today's extract/copy/highlight rows.
- The result view offers **Copy**, **Create extract from result**, and **Retry**, so an AI answer can flow back into the study material rather than being a dead end.
- The same sheet is reused for transcript and RSS/queue reading surfaces that already produce a text selection, so the behaviour is not PDF-only.
- Fix `passageAI`'s cloud path: it currently calls `generateNativePrompt` (the Android bridge) on both branches, so the non-Android path cannot work as written.

## Capabilities

### New Capabilities
- `mobile-selection-ai-actions`: what the mobile selection sheet offers, how actions resolve to an AI path, how results are presented, and how the feature degrades when no AI is configured.

### Modified Capabilities

(none — no existing spec in `openspec/specs/` covers text selection or AI routing)

## Impact

- `src/components/viewer/DocumentViewer.tsx` — replaces the floating mobile lightbulb with the sheet; keeps the existing selection detection effect.
- New `src/components/viewer/SelectionAiSheet.tsx` (or `common/`) built on `MobileContextMenuSheet` (`variant="content"`).
- `src/lib/ai/passageAI.ts` — add summarize/simplify/define adapters, fix the cloud branch.
- `src/lib/ai/provider.ts`, `useAiAvailability.ts` — consumed as-is for gating and routing.
- Transcript/queue selection surfaces (`QueueScrollPage`, `TranscriptPanel`) — reuse the sheet.
- i18n strings for the new rows; no new dependencies.
