## Why

Users frequently receive high-quality explanations in the Assistant panel but must manually re-invoke `/20rules` or rephrase prompts to turn a specific answer into flashcards. A per-message action makes formulation one click away while reusing Plethora's existing 20 Rules pipeline, MCP card tools, and `ChatFlashcardCollection` UX.

## What Changes

- Add a **Flashcards** action (Brain icon) on eligible Assistant responses, ordered Copy | Flashcards | Share.
- Refactor the Assistant send path into a shared `submitAssistantRequest()` so programmatic flashcard generation avoids composer state hacks.
- When invoked, scope card generation to the **clicked Assistant message** only: empty conversation history, pinned source content override (bypasses `resolveForPrompt`), preserved document/deck metadata.
- Per-message loading state with duplicate-click prevention; improved mobile/touch visibility for the action row.
- Automated tests for eligibility, source isolation, document association, and regression coverage.

## Capabilities

### New Capabilities
- `assistant-message-flashcard-action`: Per-message flashcard generation from Assistant responses via the existing `/20rules` and MCP tool pipeline.

### Modified Capabilities
- `knowledge-formulation-rules`: Extends reuse to programmatic Assistant message actions (no new formulation prompts).

## Impact

- `src/components/assistant/AssistantPanel.tsx` — shared request pipeline, message actions, context pinning
- `src/features/assistant/assistantMessageFlashcards.ts` — eligibility + request builders (new)
- `src/lib/i18n/locales/*` — action label string
- Tests under `src/components/assistant/__tests__/`
