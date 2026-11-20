# Implementation verification notes

## Chat route inventory (task 1.1)

The app shares React chat components between Tauri and browser/PWA builds unless
noted below. Tauri uses `invokeCommand` and request-scoped Rust LLM commands;
browser/PWA uses browser `fetch` for supported provider streaming endpoints.

| Surface and mounted entry point | Answer executor and contract | Existing cancellation / lifecycle |
| --- | --- | --- |
| Assistant desktop, mobile, and web: `AssistantPanel` (`src/components/assistant/AssistantPanel.tsx`) | `runAssistantTurn`; ordinary text/document/video answers stream through the configured provider. Apple Foundation uses its chunk callback. Library scope previews only the structured answer and retains validated citations. Tool-enabled turns filter protocol payloads from previews and parse/execute only after generation under the existing intent/approval rules. | Each attempt has an `AbortController` and conversation epoch. Stop, retry, conversation/source change, and teardown reject late results. Preview stays outside message history until a completed answer is accepted.
| PWA Assistant (`PwaAssistantButton`) | `runAssistantTurn`; same streamed text/document path with an optional Apple Foundation executor. | Per-attempt controller and identity guard; Stop, close, and source changes invalidate pending work. Preview is separate from stored messages.
| Document Q&A (`DocumentQATab`) | `runAssistantTurn`; direct document answers stream, Library scope previews its validated answer field and preserves citation/source mapping, and tool calls are parsed/executed after the answer. | Per-attempt controller, status and preview UI; late results are ignored after Stop or context change.
| Ask Sheet | `runConfiguredAssistantTurn`; cloud and configured local providers use the shared preview callbacks; retrieval uses validated `askLibrary`. | Owns an `AbortController`; superseding/closing the sheet aborts work. Answer preview stays separate from accepted answer/history.
| Ask Plethora product help (`AskPlethoraModal`) | `askPlethora` streams its answer field while retrieving help chunks, then returns the validated structured answer with mapped source refs/citations. | Per-attempt abort and identity checks; Stop/close discards the pending preview.
| Tutor (`TutorSheet` through `TutorSession`) | `TutorSession` streams structured tutor output; the preview extractor exposes only its `content` answer field before final validation. | Uses per-attempt `AbortController`; cancellation is wired to the run. Retrieval and response validation remain owned by `TutorSession`.
| Socratic Margin Thread | `answerQuestion` in `src/api/ai.ts`, a legacy `answer_question` command returning a completed string. This route remains completion-only. | Shows preparation/model status and Stop; attempt identity prevents late results from changing the thread.
| Flashcard Studio conversational reply | `streamChatWithContext`; answer text is filtered incrementally, then thinking/card payloads are parsed after completion. Cards remain drafts and retain their existing validation/action flow. | Per-attempt controller and Stop; late results do not append a completed message.
| NotebookLM chat | `notebooklmAsk` (`notebooklm_ask`) returns one completed `AskResponse`; answer and thinking are separated after completion. This desktop bridge remains completion-only. | Shows status and Stop; request epoch rejects late completion after cancellation/context change.

### Verified source anchors

- Shared chat transport and contextual request entry points: `src/api/llm/index.ts:119`, `:159`, `:226`.
- Assistant routing and post-response tool handling: `src/lib/ai/assistant/orchestrator.ts:46`, `:171`, `:472`, `:516`.
- Assistant and PWA call sites: `src/components/assistant/AssistantPanel.tsx:2743`, `src/components/assistant/PwaAssistantButton.tsx:336`.
- Document Q&A call site and Library executor: `src/components/tabs/DocumentQATab.tsx:1697`.
- Ask Sheet controller and shared configured turn: `src/components/assistant/AskSheet.tsx:206`, `:223`.
- Product help structured result: `src/features/help/AskPlethoraModal.tsx:83`, `src/features/help/AskPlethoraModal.tsx:99`.
- Tutor answer-only structured preview and abort signal: `src/components/tutor/TutorSheet.tsx:157`, `:181`, `:186`; extraction contract in `src/lib/ai/tutor/context.ts`.
- Socratic legacy completion-only call: `src/components/viewer/SocraticMarginThread.tsx:71`, `src/api/ai.ts:156`.
- Flashcard Studio contextual reply and card parsing: `src/components/review/FlashcardStudioModal.tsx:2328`, `:2351`.
- NotebookLM completion-only chat bridge: `src/components/notebooklm/NotebookLMChat.tsx:162`, `:178`, `src/api/integrations.ts:879`.
- Browser buffered provider endpoints: `src/lib/browser-backend.ts:4943`; browser Tauri event listeners are currently no-ops at `src/lib/tauri.ts:749`.
- Native stream events and cancellation registry: `src-tauri/src/commands/llm.rs:23`, `:702`, `:746`.

## Verification coverage

- Native request ownership and terminal behavior: `streamChatWithLLM.test.ts`
  covers interleaved request IDs, the final chunk before done, errors after a
  chunk, cancellation while a render batch is pending, and contextual command
  fields. Rust's SSE line-buffer test covers records split across reads.
- Browser provider transport: `browserLlmTransport.test.ts` covers segmented
  OpenAI SSE and terminal usage, Anthropic text-only deltas, buffered response
  from the same endpoint, retained context/policy/scope/attachments, and abort.
- Shared task lifecycle: `runTask.test.ts` covers stream metadata, cancellation,
  timeout, coalescing, late subscriber replay, subscriber-scoped cancellation,
  and provider identity isolation. Existing structured-output tests continue to
  cover validation and repair.
- Preview filtering: `answerStreamFilter.test.ts` checks split reasoning
  delimiters, native and fenced tool payloads, Flashcard Studio card payloads,
  ordinary Markdown/JSON examples, and malformed or unclosed payloads. The UI
  receives only cumulative filtered snapshots; final content is filtered again
  before acceptance.
- Timed UI flows: controlled unresolved provider promises in
  `AssistantPanelMobileEpoch.test.tsx` cover desktop and narrow mobile layouts;
  `PwaAssistantButton.test.tsx` covers PWA. Each asserts the model status and a
  readable fragment while the request is unresolved, then Stop aborts, a late
  completion is ignored, and a retry creates exactly one final reply.
- Route coverage: `DocumentQATab.test.tsx`, `AskSheet.test.tsx`,
  `SocraticMarginThread.test.tsx`, Tutor context tests, Library answer tests,
  and Flashcard Studio's filter/flow tests cover wrapped answers, citations,
  cancellation guards, and completion-only routes. Podcast scope-persistence
  tests confirm detached episode turns still persist while ordinary chat
  teardown aborts.
- Final frontend run: 13 focused files, 175 tests passed. Native LLM unit run:
  11 tests passed. `npm run build:check` passed documentation validation,
  TypeScript, Vite, and the bundle budget (30.1 MB total, 32 MB limit).
- `npm run bench:check` compared all 77 benchmarks with no regressions and
  passed the bundle check. It reported 10 stale-baseline warnings where the
  measured code was over 25% faster; no performance baseline needed changing.
- `openspec validate stream-llm-responses --strict` passed.

## Bundle budget adjustment

The build reported a 31,513,136-byte bundle against the previous 31,450,000-byte
limit after adding streaming transport and pending-reply UI. The total budget in
`scripts/bundle-budgets.json` was raised to 32,000,000 bytes; the individual
bundle limits were not changed. The updated budget check passes.
