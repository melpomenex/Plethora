## Context

The AI Flashcard Studio (`src/components/review/FlashcardStudioModal.tsx`) generates flashcards from a document via an LLM chat loop. The document text the LLM sees is decided by a single `contextContent` memo that branches on a `contextSelection.mode` of `full | chapters | pages | excerpt | search`. "chapters" uses a coarse heading splitter (`chapterUtils.getChapterTitles` / `buildChapterQAContext`); the other modes approximate or paste text. None of them let a user point at an *exact, authoritatively-bounded* section.

In contrast, the document Assistant (`AssistantPanel.tsx`, mirrored in `DocumentQATab.tsx`) already solves this precisely:

- A `#` in the input opens `src/components/common/SectionMentionPopup.tsx`.
- The section tree is built by `src/utils/sectionIndex.ts` (`buildDocumentSections`), which merges markdown headings with PDF/EPUB outlines into `SectionNode`s with `startChar/endChar` ranges.
- On send, `resolveSectionFocusedContext` (sectionIndex.ts:519) re-resolves the selected nodes against freshly fetched text, enforces a token budget, adds neighbor context, and returns content + a `SectionSourceReference`.
- `createDocumentQaRequestContent` (sectionContextRequest.ts:24) wraps it into the prompt; `sourceContext` is stamped on the assistant message for provenance.
- `useDocumentSections` (hook) memoizes the tree/flat list and exposes `getById`, `breadcrumbsFor`, token estimates.

The Studio already loads document text the same way (`loadDocumentQaText`) and routes through the same `chatWithContext` IPC. So all the heavy lifting exists and is proven; this change is about *wiring the existing machinery into the Studio*, not building a parallel system.

## Goals / Non-Goals

**Goals:**

- Let a user scope Flashcard Studio generation to a precise section via `#`, with identical UX and resolution semantics to the Assistant.
- Introduce a first-class `sections` context mode in the Context Control panel.
- Reuse `SectionMentionPopup`, `useDocumentSections`, `resolveSectionFocusedContext`, and `createDocumentQaRequestContent` verbatim — no duplication of parsing/resolution logic.
- Preserve section provenance on generated cards via `sourceContext`.
- Additive only: existing modes keep working untouched.

**Non-Goals:**

- Cross-document `@{documentId}` mentions (the Studio is single-document per session; out of scope).
- Changing the Rust `llm_chat_with_context` contract or `chatWithContext` API.
- Migrating the existing `chapters`/`pages` modes onto the new section resolver (kept as-is to avoid behavior churn; can be a follow-up).
- NotebookLM path changes beyond passing through the resolved section text as `contextContent`.

## Decisions

### Decision 1: Reuse `useDocumentSections` + `SectionMentionPopup` as-is

Build the section tree with `useDocumentSections({ documentId, content: selectedDocumentText, pdfOutline?, epubToc?, contentHash? })` (it already reads outlines from `useDocumentOutlineStore`), and render the existing `SectionMentionPopup` above the chat `<textarea>`.

- **Rationale:** The popup already supports fuzzy filter, virtualization, token badges, breadcrumbs, expand/collapse, and keyboard nav. Rebuilding it would diverge from the Assistant.
- **Alternative considered:** Building a bespoke section picker inside the Context Control panel. Rejected — it would duplicate the popup and miss the `#`-in-textarea affordance the user explicitly asked to mirror.

### Decision 2: Track section focus as a new `sections` context mode on `ContextSelection`

Extend `ContextMode` with `"sections"` and add a `selectedSectionIds: string[]` (or `selectedSectionNodes: SectionNode[]`) to `ContextSelection`. Update `normalizeContextSelection` to validate it (drop ids that aren't in the current tree on normalization). Making a `#` selection sets `mode = "sections"` and appends the id; deleting a `#{title}` token removes the matching id; emptying the list clears the focus (mode falls back to `full` to avoid an invalid state).

- **Rationale:** `ContextSelection` is already the single source of truth that drives both the `contextContent` memo and `handleSend`'s descriptor. Adding a mode there means the existing validation/summary/cost paths pick it up with minimal special-casing.
- **Alternative considered:** A separate `sectionFocus` state detached from `contextSelection`. Rejected — it would require parallel wiring in the memo, summary, and cost estimator, and could disagree with `mode`.

### Decision 3: `contextContent` memo resolves via `resolveSectionFocusedContext` at send-time

For `mode === "sections"`, the memo returns `undefined` (we don't pre-resolve on every keystroke). Resolution happens inside `handleSend`, mirroring AssistantPanel lines 1166–1204: call `resolveSectionFocusedContext(selectedNodes, allSections, freshlyLoadedText, { documentId, maxTokens })`, with a single transparent retry for transient first-load misses, then `createDocumentQaRequestContent` to shape the prompt. The resolved `sourceContext` is stamped on the assistant message.

- **Rationale:** Section ranges must be resolved against *current* text, not a stale snapshot held in the memo. The Assistant already established the "resolve at send with one retry" pattern; copying it keeps semantics identical and avoids re-resolving on every render.
- **Alternative considered:** Resolving inside the memo. Rejected — stale-text risk and unnecessary work on unrelated re-renders; the cost estimator only needs a token *estimate*, which `useDocumentSections.tokenEstimateFor` can provide cheaply without full resolution.

### Decision 4: Cost estimator uses cheap token estimate, not full resolution

For the live cost/token display, use `useDocumentSections`'s token estimate for the focused sections (sum of per-section estimates) rather than running `resolveSectionFocusedContext` on each change. Full resolution (with neighbor context + truncation) runs only at send time.

- **Rationale:** Keeps the input responsive; the estimate is already what `SectionMentionPopup` shows per row, so totals are consistent.

### Decision 5: Provenance via `sourceContext` on the assistant message

Extend the `ChatMessage` type in the Studio with an optional `sourceContext?: SectionSourceReference`, set it on the assistant message after a successful section-scoped generation. Generated `DraftCard`s carry the same reference so saved cards retain section provenance (consistent with how AssistantPanel attaches it for tool calls).

- **Rationale:** Enables future "regenerate from this section" and provenance display without another change.

## Risks / Trade-offs

- **Stale section ids after document re-import / edit** → `resolveSectionFocusedContext` already handles this via structural match + outline-text recovery, and returns diagnostics for unresolvable selections; the Studio will surface these as validation messages (spec: "Graceful handling of unresolved sections") rather than silently broadening to the whole document.
- **Two sources of section-like context (`chapters` vs `sections`) may confuse users** → `chapters` stays for backward compatibility, but `sections` is the recommended precise path. The `#` affordance only ever sets `sections`. Mitigation: clear mode labels and summaries; possible later deprecation of `chapters`.
- **Large files / many sections in the popup** → `SectionMentionPopup` already virtualizes with `@tanstack/react-virtual`, so this is handled.
- **Token-budget truncation of a very large focused section** → surfaced via the `truncated` flag from `resolveSectionFocusedContext`; the summary will note truncation, matching the Assistant.

## Migration Plan

No data migration. `ContextSelection` is component-local state (persisted only as passing context, not as a stored schema); `normalizeContextSelection` already normalizes unknown/missing fields to defaults, so older persisted states simply fall back to `full` mode. Rollback is reverting the component changes — no backend, storage, or IPC changes to unwind.

## Open Questions

- Should selecting a section via `#` *replace* the coarse `chapters` selection if one exists, or coexist? **Working assumption:** selecting a section switches `mode` to `sections` and supersedes `chapters` (modes are mutually exclusive by design); `chapters` selection is cleared. Confirm during implementation.
- For NotebookLM generations, the resolved section text is passed as `contextContent` and included in the `instructions` block — acceptable, since NotebookLM consumes the assembled text the same way it does for `excerpt` today. No special handling planned.
