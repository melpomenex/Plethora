## Context

The Assistant panel already supports `/20rules` via `knowledgeFormulation.ts`, tool-call parsing, MCP execution, and `ChatFlashcardCollection`. Users need a one-click path from any genuine Assistant answer without duplicating that architecture or polluting conversations with full response text.

## Goals / Non-Goals

**Goals:**
- Reuse `buildTwentyRulesSystemPrompt()`, existing tool calls, MCP, and artifact UI.
- Clicked message is the sole formulation source; unrelated chat history excluded.
- Preserve `documentId`/deck association from the learning context at click time.
- Programmatic request via shared `submitAssistantRequest()` (no `setInput` + send race).
- Accessible, touch-friendly message actions.

**Non-Goals:**
- New flashcard subsystem, backend API, or Flashcard Studio integration.
- Broad Assistant rewrite or shared-module extraction of `parseToolCalls` (future work).
- Memory-system redesign.

## Decisions

### Decision 1: Shared `submitAssistantRequest()`
Extract the post-composer core of `handleSendMessage()` into `submitAssistantRequest(request)` with explicit fields:
- `requestContent` — LLM user turn (may include `/20rules` prefix)
- `displayContent` — compact user bubble (e.g. "Create flashcards from this response")
- `conversationHistoryOverride` — `[]` for message-scoped generation
- `sourceContentOverride` — clicked Assistant `content`; bypasses `resolveForPrompt`
- `capturedDocumentContext` — `{ documentId, documentTitle }` snapshot at click time
- `skipMemoryExtraction` — true for synthetic flashcard actions
- `originatingMessageId` — per-message loading spinner

`handleSendMessage()` becomes a thin wrapper that reads composer state and calls the shared function.

### Decision 2: Source isolation in `callLLM`
When `sourceContentOverride` is set:
1. Skip `resolveForPrompt`, section focus, selection focus, and document fallback.
2. Set `finalResolvedContent` to the override (trimmed clicked message).
3. Pass empty `conversationHistory` from the request.
4. User prompt uses stripped `/20rules` directive from `buildAssistantMessageFlashcardRequest()`.

The override is **source material**, wrapped in the system/tool path—not executable instructions.

### Decision 3: Document-switch race safety
At request start, capture `conversationKey`, `documentId`, and `documentTitle` into `toolExecutionContextRef`. `normalizeToolParameters` and `resolveDocumentTitleForCards` read the ref first, falling back to live `context` only when unset. Cleared in `finally`.

### Decision 4: Message eligibility
`canCreateFlashcardsFromMessage(message)` returns false for:
- non-assistant, empty content
- IDs prefixed `assistant-confirm-`
- placeholder content `Running tool calls...`
- educational `/20rules` reminder (heading `### 🧠 20 Rules`)

### Decision 5: Conversation & memory UX
- User bubble shows localized short label, not the full source or internal prompt.
- `skipMemoryExtraction: true` for flashcard actions to avoid polluting `MEMORY.md`.

### Decision 6: Mobile action visibility
Action row: `opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100`. Wire `aria-label`/`title` via i18n for Copy, Share, and Flashcards.

## Risks / Trade-offs

- **Apple FM path** returns text without tool execution — same limitation as typed `/20rules`; no provider-specific workaround in this change.
- **Ambiguous answers** without prior user question may yield weaker cards — acceptable; we do not inject chat history by default.

## Migration Plan

No storage schema changes. Additive UI and helper module only.
