## 1. Selection-precedence context

- [x] 1.1 Extend `assistantContext.ts` resolvers (PDF/generic/X-thread) to emit normalized selection first with truncation marker plus doc title/locator, and verify `assistantContext.test.ts` covers selection-first ordering, truncation, and empty-selection fallback
- [x] 1.2 Wire all document reader Ask entry points to pass live selection + doc ref into the resolver, and verify selecting a paragraph then asking addresses the selection in a manual check plus unit test for handler wiring

## 2. Select-to-Ask multi-turn handoff

- [x] 2.1 Implement single Ask handoff for `ask` action id (bar/menu/sheet) that opens/focuses the Assistant window, seeds a thread with selection snapshot + doc ref, posts the question, and focuses follow-up input, and verify right-click Ask creates a visible thread with quoted excerpt in UI test
- [x] 2.2 Persist pinned selection snapshot in the Assistant thread/store across turns with visible context chip + Clear, new-selection reseeds new context, and verify follow-up without highlight still answers from original selection and Clear reverts to plain context

## 3. Expand-beyond-document with Brave

- [x] 3.1 Add explicit expansion detection (lookup phrasing + optional Lookup toggle) that answers doc-first then expands, and verify "look it up" triggers expansion while plain "what does this say" stays document-confined in tests
- [x] 3.2 Reuse `brave_web_search` Tauri command when key configured (timeout + graceful fallback with disclosure when missing/failing), format source-labeled answers with citations, and verify key-present includes cited web results and key-absent answers from knowledge with disclosure note

## 4. Regression and validation

- [x] 4.1 Run related suites (`assistantContext`, `assistantProvider`, selection registry, DocumentQATab/Brave) and `openspec validate --change selection-aware-document-ask`, and verify all pass with no unrelated selection actions changed
