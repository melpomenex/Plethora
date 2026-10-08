## Why

Readers select a passage and then ask the Assistant about it, but today the selected text does not reliably take precedence as the question's context, and the select → right-click → "Ask a question" path does not carry the selection into a continuing multi-turn conversation. Users who ask "tell me more about this" or "look it up" get answers confined to the fed document text instead of a useful blend of selection focus, surrounding document context, and broader knowledge / web lookup.

## What Changes

- Selection text becomes the primary Assistant context: whenever a non-empty selection exists at ask-time it is quoted first in the prompt, with surrounding document/window context kept as secondary grounding.
- Select → right-click → "Ask a question" hands off into the Assistant window as a started multi-turn thread: selection pre-filled/quoted, document reference attached, input focused, and follow-ups retain the original selection without requiring re-selection.
- The Assistant answers selection questions from selection + document context first, but when the user explicitly asks for more ("what else", "look it up", "beyond this document", chapter-level questions) it expands beyond the fed text using model knowledge and, when a Brave key is configured, live web search with cited sources.
- No change to unrelated selection actions (highlight, copy, dictionary, flashcard, extract) or to Assistant behavior when there is no selection.

## Capabilities

### New Capabilities
- `selection-aware-assistant`: selection-precedence context resolution and select-to-Ask multi-turn handoff in the document reader.
- `assistant-external-lookup`: explicit user-triggered expansion beyond document context via model knowledge and optional Brave web search with citations.

### Modified Capabilities
<!-- None — no existing spec REQUIREMENTS change. contextual-palette-actions and extract-reader-stability are related but untouched. -->

## Impact

- Affected code: `src/utils/assistantContext.ts` (selection precedence), `src/utils/assistantProvider.ts`, selection handoff hosts (`DocumentViewerWrapper`, selection bar/menu/sheet `ask` handlers routing via `selectionActionRegistry.ts`), Assistant panel/store/thread model, Brave search service + settings (key detection).
- APIs/services: Brave Search (only when key configured and user requests lookup); otherwise no new external dependencies.
- UX: Assistant window focus/open behavior on Ask handoff; quoted-selection display in thread; follow-up input retains context chip.
