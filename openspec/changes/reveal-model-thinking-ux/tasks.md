## 1. Shared Response Normalization

- [x] 1.1 Identify the conversational response and streaming paths used by the assistant panel, document Q&A, and other chat surfaces; record the integration points in the implementation review. Whole responses enter through `callLLM` in `AssistantPanel.tsx`, `chatWithContext` in `DocumentQATab.tsx` and `PwaAssistantButton.tsx`; `TutorSheet.tsx` is the live chunk stream. `NotebookLMChat.tsx` and the Flashcard Studio chat render completed conversational messages.
- [x] 1.2 Add an incremental parser that separates thinking segments from answer text and verify it handles delimiters split across chunks, multiple segments, ordinary responses, and unmatched delimiters. Focused parser tests pass.
- [x] 1.3 Connect completion and visible error lifecycle events to the normalized response state; verify incomplete thinking remains separated and receives the correct status. The streaming tutor exposes running and interrupted previews; one-shot chats use their existing pending status and mark received thinking complete.

## 2. Thinking Disclosure UX

- [x] 2.1 Build a reusable collapsed-by-default thinking disclosure with streamed content, in-progress/completed/interrupted states, and keyboard-accessible expanded state; verify each state is observable in the component. Focused component tests pass.
- [x] 2.2 Integrate the shared normalized response and disclosure into the assistant panel and verify thinking tags never appear in its rendered transcript. New and legacy message paths use the shared component.
- [x] 2.3 Integrate the same behavior into document Q&A and remaining conversational AI surfaces; verify their disclosure labels, states, and answer rendering match the assistant panel. Integrated document Q&A, AskSheet, PWA Assistant, tutor, NotebookLM chat, and Flashcard Studio chat.

## 3. Integration Validation

- [x] 3.1 Validate streamed and completed responses with and without thinking content, including interrupted streams and failures; verify the scenarios in `specs/assistant-thinking-display/spec.md` behave consistently across chat surfaces. Parser and disclosure tests pass (6/6); ESLint reports no errors on changed files.
- [x] 3.2 Verify persisted/reloaded conversational responses preserve the answer/thinking separation where chat history is stored, and existing messages without thinking tags render unchanged. Optional `thinking` fields persist without migration; older raw tagged messages are normalized at render and when reused as assistant context.
