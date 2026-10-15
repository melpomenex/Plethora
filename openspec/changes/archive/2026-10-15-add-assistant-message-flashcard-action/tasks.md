## 1. Shared helpers

- [x] 1.1 Add `assistantMessageFlashcards.ts` with eligibility, request builder, and source-context helper
- [x] 1.2 Add unit tests for helpers

## 2. Assistant request pipeline

- [x] 2.1 Extract `submitAssistantRequest()` from `handleSendMessage()`
- [x] 2.2 Support `sourceContentOverride`, empty history, captured document context, skip memory
- [x] 2.3 Pin tool execution context via ref for document-switch safety
- [x] 2.4 Bypass `resolveForPrompt` when `sourceContentOverride` is set

## 3. UI

- [x] 3.1 Add Flashcards button (Copy | Flashcards | Share) with Brain/CircleNotch loading
- [x] 3.2 Improve mobile visibility and i18n labels for message actions
- [x] 3.3 Wire `handleCreateFlashcardsFromMessage`

## 4. Tests & validation

- [x] 4.1 Add `AssistantPanelMessageFlashcards.test.tsx` integration tests
- [x] 4.2 Run typecheck, unit tests, and frontend build
