## 1. Safe session and handoff state

- [x] 1.1 Extend the typed library handoff with explicit open-workspace/prefill intents and acknowledgement by request id, keeping existing question callers compatible; verify handoff unit tests cover bare entry, document context, repeated identical requests, and an old acknowledgement leaving a newer request intact.
- [x] 1.2 Add optional normalized draft and submitted-scope/evidence metadata to the existing Q&A persistence shapes; verify session tests round-trip mention/section drafts and new message metadata, tolerate old/malformed records, and preserve existing storage keys, caps, migration, and citations.
- [x] 1.3 Flush outgoing messages/drafts before handoff, New conversation, and session switches, restoring the draft on resume/reload; verify component tests preserve all three paths and retain the live draft if storage fails.
- [x] 1.4 Defer pending entry/session changes while generation is running, with a dismissible pending-entry notice and explained disabled mutations; verify a delayed answer is saved only to its originating session and duplicate bare entries coalesce.

## 2. Route the command hub to Document Q&A

- [x] 2.1 Replace the palette handoff host's selection-sheet rendering with the existing Document Q&A navigation path; verify integration coverage closes the palette, reactivates an existing tab in another pane, and never renders the selection sheet for this action.
- [x] 2.2 Consume pending entry only after destination activation/session hydration, with idempotent request handling; verify delayed mounting, remount/Strict Mode, and newer-request races produce exactly one intended preparation with no automatic submission.
- [x] 2.3 Implement clean-library-session reuse and complete suggestion prefill, preserving the outgoing session/draft and revalidating document context; verify the bare tile inserts no themes question, a document summary visibly targets its document, and repeat bare activation creates no duplicate tab/session.
- [x] 2.4 Make the tile navigable for empty-library/missing-provider setup states on supported platforms and update its destination description; verify quick-action keyboard/pointer/touch tests and genuine unsupported-platform fallbacks.
- [x] 2.5 Keep related-document search, review suggestions, product help, and reader selection Ask on their established routes; verify focused command-hub and selection-Ask regression tests cover these boundaries.

## 3. Composer-first workspace and source selection

- [x] 3.1 Build the single-composer start state and transcript transition with existing app primitives, concise natural-language guidance, a visible source control, and labeled Ask; verify an ordinary first question needs no mention syntax and input/focus/draft survive the first-send layout transition.
- [x] 3.2 Replace the small focus dropdown with searchable Whole library/Choose document selection from eligible metadata, including collection wording and visible mention/section overrides; verify selection, override removal, long titles, and missing/ineligible targets without silent scope broadening.
- [x] 3.3 Add local Find connections, Compare viewpoints, and Summarize a document starters, with summary opening the source picker when needed; verify they prepare editable questions, preserve existing text, focus appropriately, and make zero model/retrieval calls before Ask.
- [x] 3.4 Put web search and existing document/section/flashcard tools in secondary controls while exposing the effective source state; verify library entry defaults web search off and advanced controls retain their behavior.
- [x] 3.5 Keep wide-screen history and add a responsive History drawer/sheet; consolidate primary New conversation and put Clear conversation in overflow with confirmation; verify touch/keyboard users can resume, rename, and delete without hover or lost drafts.

## 4. Grounded answers and evidence continuity

- [x] 4.1 Route ordinary library/chosen-document knowledge questions through the existing grounded task using submission-time eligible document-id filters; verify single-document, collection, local-only/AI-excluded, unavailable-source, and empty-eligible-set cases never retrieve a broader corpus or bypass provider policy.
- [x] 4.2 Preserve specialized section/chapter, explicit web search, and `/20rules`/card-creation routes; verify existing section-context tests and tool-result/session tests still pass and saved effects are not replayed.
- [x] 4.3 Persist each new answer's actual submitted scope and available evidence metadata, mapping only valid source references into evidence counts without breaking citation numbering; verify changing scope, saving/reloading, and legacy message loading keep the answer's own source association.
- [x] 4.4 Add the compact evidence summary and expandable source excerpts through the existing citation component and navigation helpers; verify cited passage opening, unresolved/deleted-source fallback, copy-with-sources, and absence of duplicate legacy source footers.

## 5. Recovery, accessibility, and localization

- [x] 5.1 Replace the empty-library dead end with a usable composer and Import documents recovery, and expose relevant setup/settings recovery for the chosen answering mode; verify drafts survive both round trips and missing setup causes no automatic generation.
- [x] 5.2 Add honest accessible processing/weak-evidence/retrieval-error states and explicit retry using the failed turn's question/scope identity; verify a retry restores editable input and cannot duplicate user turns, replay completed tool effects, or fall through to unsupported general-knowledge answers.
- [x] 5.3 Implement desktop handoff focus, intentional touch keyboard entry, IME-safe Enter, Shift+Enter, inner-surface Escape, dialog focus return, accessible names/status, and 40px effective targets; verify focused interaction tests and a complete keyboard pass.
- [x] 5.4 Localize new/changed strings across `en`, `es`, `fr`, `de`, `ja`, and `zh`; verify the i18n completeness suite and inspect long translated labels without clipping essential actions.
- [x] 5.5 Apply only existing theme tokens, typography, surfaces, and reduced-motion behavior; verify rendered light and dark/gold variants at desktop and 360px, with 200% zoom, long titles, and software-keyboard/safe-area checks.

## 6. Integration and local performance acceptance

- [x] 6.1 Run focused suites for handoff, command-hub navigation, Q&A sessions, Q&A component/section behavior, citations, and i18n (including `libraryAskHandoff.test.ts`, `GlobalSearchHub.test.tsx`, `documentQaSessions.test.ts`, `DocumentQATab.test.tsx`, `DocumentQASources.test.tsx`, and `i18n-completeness.test.ts`); record the commands and results and resolve regressions introduced by the change.
- [x] 6.2 Run TypeScript and relevant lint checks on the implementation; verify no new errors in changed modules and document any independently reproduced pre-existing blocker.
- [x] 6.3 Inspect one batched desktop/mobile visual pass and confirm corrections once, covering empty/active conversations, history, source selection, evidence, setup/error states, and supported theme/motion variants; record captures and observed results in a change-local validation note.
- [x] 6.4 Verify workspace/source-picker use with at least 3,000 seeded document metadata records and instrument the entry path; confirm bounded displayed results and no eager content extraction, embedding, model, or retrieval work before explicit Ask.
- [x] 6.5 Run `npm run bench:check` locally against the built frontend so both performance and bundle gates pass; if an intentional performance/bundle change requires a baseline update, include the corresponding rationale with that update and verify the gate again.
- [x] 6.6 Run `openspec validate improve-library-qa-entry-and-workspace --strict` and record an end-to-end smoke test: palette entry → choose source → explicit Ask → inspect citation → return → start/resume conversation with preserved draft; verify all capability scenarios are accounted for before marking the change implemented.
