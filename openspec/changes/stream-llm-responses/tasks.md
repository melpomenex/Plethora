## 1. Chat inventory and transport

- [x] 1.1 Trace mounted chat entry points to their actual answer executor. Record each surface, its browser or native route, text or wrapped-answer contract, and cancellation behavior in the implementation verification notes. Include text, grounded, tool-enabled, and completion-only chat routes.
- [x] 1.2 Scope Tauri chunk, completion, error, and cancellation handling to each request. Verify with interleaved native streams, an error after a chunk, cancellation during a pending render batch, and a final chunk arriving immediately before completion.
- [x] 1.3 Add browser transport streaming where the configured endpoint exposes it and normalize native and browser results through the existing provider interfaces. Verify real incremental delivery, segmented records, terminal metadata, abort, and the same-provider completion-only path with controlled responses.
- [x] 1.4 Share context assembly and request policy with the buffered contextual path. Verify streaming preserves provider and model selection, endpoint pinning where applicable, context budgets, source scope, attachments, and request authorization.

## 2. Reply filtering and lifecycle

- [x] 2.1 Classify answer text before emitting chat preview updates. Verify incremental and final output with native tool events, fenced tool calls, fenced JSON, bare tool payloads, reasoning delimiters, malformed or truncated payloads, and ordinary Markdown and code examples. Test adversarial split points and assert that internal text never enters the preview DOM, even briefly.
- [x] 2.2 Expose answer-only previews for supported wrapped chat replies using their existing answer-field and validation contracts. Verify split escapes and keys, unknown fields, invalid final replies, and citation checks. Confirm only validated results enter history or expose message actions and that preview processing cannot invoke tools or mutate records.
- [x] 2.3 Wire chat progress to the active conversation and attempt, with subscriber-scoped cancellation for coalesced requests. Verify concurrent conversations, a late-joining subscriber, Stop, retry, timeout, switching conversations, teardown, and late events after terminal completion. Confirm a stopped or superseded attempt cannot write a completed message.
- [x] 2.4 Reuse or add chat pending-reply UI with localized status, partial text, and one in-place final message. Verify visible pre-text progress, accessible stage announcements, stable focus and scroll position, and interrupted text that stays outside future model context.

## 3. Chat surface integration

- [x] 3.1 Wire Assistant on desktop and mobile and the web/PWA Assistant, including grounded and tool-enabled turns. Verify a real fragment before completion for Chat and document context, stage updates for source preparation and tools, and final tool approval and citation behavior.
- [x] 3.2 Wire Document Q&A and Library Q&A, including the Ask Sheet and any mounted Library Q&A entry points found in the inventory. Verify a reply appears before completion when the provider can expose it, final citations retain their source mapping, and retrieval failures retain their established behavior.
- [x] 3.3 Wire Ask Plethora, Tutor and its conversational entry points, and reader chats such as Socratic Margin Thread. Verify delayed reply chunks behave consistently with existing answer validation and the user's reading position.
- [x] 3.4 Wire the conversational reply in Flashcard Studio and any remaining chat entries. Verify chat prose streams without showing internal card payloads and existing card validation and actions remain intact. For NotebookLM chat and other completion-only paths, verify immediate status, one final reply, and ignored late results after cancellation or context change.

## 4. End-to-end verification

- [x] 4.1 Run focused frontend and Rust tests, then use timed mock responses in desktop, narrow mobile, and PWA chat flows. Observe pre-reply status, readable text before completion, no protocol payloads at any point, one final message, and a clean stop and retry. Record coverage for the inventory from 1.1, including a completion-only route.
- [x] 4.2 Build the affected frontend targets, run `npm run bench:check`, and validate the change with `openspec validate stream-llm-responses --strict`. Confirm ordinary non-chat generation and artifact workflows still pass their existing regression tests.
