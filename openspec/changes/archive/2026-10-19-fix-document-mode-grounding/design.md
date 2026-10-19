## Context

See `proposal.md` for motivation. The current state that shapes the fix:

- `runAssistantTurn` (`src/lib/ai/assistant/orchestrator.ts:253`) sends every `Document`-scope
  turn through the injected `libraryExecutor` whenever one exists, regardless of whether
  `sourceContent` is present. The Assistant sidebar always injects one
  (`src/components/assistant/AssistantPanel.tsx:1773`); the configured turn adapter injects one
  for single-document Document scope (`src/lib/ai/assistant/configuredTurn.ts:43`).
- `askLibrary` (`src/lib/ai/tasks/definitions/libraryTask.ts:380`) answers a zero-chunk
  retrieval with the library-worded string and `evidenceLevel: "none"`, which the orchestrator
  turns into the visible "library does not appear to contain material" answer plus
  `suggestSwitchToChat`.
- Viewers already resolve live context before the turn: the reader trims the loaded document
  (or PDF window / transcript) for the prompt (`DocumentViewerWrapper.tsx:378`,
  `src/utils/tokenizer.ts:33`). That evidence currently reaches `runAssistantTurn` but is
  discarded in the Document-scope branch.
- `library-qa`, `assistant-conversation-scopes`, `ai-library-rag`, and `document-qa-workspace`
  are the archived specs whose requirements this change redefines; the in-flight
  `unify-assistant-experience` change owns the routing table, attachments, and frozen-source
  guards, so this fix must not duplicate or fork that model.

## Goals / Non-Goals

**Goals:**

- Document scope answers from the active source's live evidence whenever that evidence exists.
- Document-restricted retrieval is a fallback (no live evidence) and an optional coverage path,
  never a substitute for evidence the user can see.
- Honest, scope-correct empty states and coverage disclosure.
- One shared policy so sidebar, Document Q&A workspace, and configured turn adapter behave
  identically.

**Non-Goals:**

- Redesigning scope selection, attachments, or the routing table (`unify-assistant-experience`).
- Building a map-reduce/progressive summarization pipeline for oversized documents.
- Changing Library-scope retrieval or Chat-scope behavior.
- Indexing, backfill, or index-freshness UX changes.

## Decisions

### D1 — Document-scope evidence precedence lives in the orchestrator

`runAssistantTurn` selects evidence in this order for `scope === "document"`:

1. Live active-source evidence (`sourceContent` or `selectionExcerpt`) → answer directly through
   the chat executor; do not call `libraryExecutor`.
2. No live evidence, `libraryExecutor` available → document-restricted retrieval (existing
   frozen-filter path) as fallback.
3. Neither → the existing honest missing-evidence outcome with `suggestSwitchToChat`.

Chat and Library scope branches are untouched (`library` always uses retrieval; `chat` stays
unrestricted). Tool-intent turns keep the existing step-5 behavior where retrieval fills an
empty source.

*Alternatives considered:* (a) fix only `AssistantPanel` by not injecting the executor in
Document scope — rejected: leaves `configuredTurn`/workspace adapters broken and spreads policy
across surfaces; (b) merge retrieval chunks into live content — rejected: adds latency and
citation ambiguity for no gain when the content is already present, and complicates the
"strictly from this document" contract.

### D2 — Empty-evidence copy is produced where the answer is produced

`askLibrary` gains an explicit evidence-scope input (e.g. `scope: "document" | "library"`,
defaulted by callers; `askInScope` maps its own scope). With zero chunks and document scope it
returns a document-worded answer ("This document does not appear to contain material relevant
to this question.") and still no model call; Library scope keeps today's wording. The
orchestrator passes the request scope through its executor adapters, so the rendered string,
`evidenceLevel`, and `suggestSwitchToChat` stay consistent.

*Alternatives considered:* rewriting the string in the orchestrator after the fact — rejected:
leaves `askInScope`/AskSheet document scope and persisted results inconsistent, and duplicates
honesty logic outside the task that owns it.

### D3 — Whole-document intents get the largest affordable evidence

When a Document-scope turn is a whole-document request (bounded localization-aware matcher for
summarize/overview/"what is this about") and the adapter holds a document id, the adapter
(not the engine) attempts to load the canonical document text via the existing
`loadDocumentQaText`/`extractDocumentText` path and passes it as `sourceContent` if it fits the
resolved prompt budget. When it does not fit, the loaded window is used together with
document-filtered retrieval, and the turn is marked partial (D4). The orchestrator stays free of
document/store access so its routing and honesty branches remain unit-testable.

*Alternatives considered:* always load full text — rejected (PDF/OCR extraction cost on every
question); engine-owned loader callback — rejected as a second, hidden IO path in a pure module.

### D4 — Coverage is explicit end to end

Adapters pass `sourceCoverage` (`"full"`, `"window"`, or `"chunks"`) into `runAssistantTurn`.
`promptBuilder` already prints `Source Coverage:` in the source header and reports it in
diagnostics; this change adds one system instruction when coverage is `window`/`chunks` so the
model does not claim to have reviewed the whole source. Document-scope answers that relied on
retrieval remain covered by the existing chunk count.

### D5 — Selection keeps precedence

A captured selection stays the first untrusted block (`SELECTION_PRECEDENCE_INSTRUCTION`), and
Document scope with a selection answers selection-first, then document context, mirroring the
existing Chat behavior. No change to selection capture or pinning.

## Risks / Trade-offs

- [A narrow question in a very long document may be better served by retrieval than by the
  loaded window] → Retrieval remains the fallback whenever live content is absent, and D3 marks
  window answers as partial; a follow-up "search the rest of this document" iteration can add
  window+chunks enrichment later (Open Question).
- [Behavior change for existing tests that assert Document scope always calls the executor] →
  Update the orchestrator/acceptance tests alongside the change and add explicit cases for
  live-content precedence and the fallback paths.
- [Overlap with `unify-assistant-experience` edits in orchestrator/adapters] → Touch only the
  Document branch and adapter evidence plumbing (no routing-table, attachment, or guard
  changes); re-verify against that change's dispatcher before landing.
- [Loading full text for summary intents can be slow for OCR'd PDFs] → Only whole-document
  intents trigger it, results flow through the existing document content cache, and failure
  degrades to the loaded window.

## Migration Plan

No settings, persisted data, or wire formats change. Ship as a code change with the test
updates listed in `tasks.md`; rollback is a straight revert. Because answers and citations are
persisted per message, conversations created before the fix keep their stored text.

## Open Questions

- Whether Document scope should opportunistically combine the loaded window with
  document-restricted retrieval chunks for non-summary questions. Deferrable: the fallback and
  coverage markers already keep answers honest, and adding fusion would not change the specs.

## Implementation Notes (recorded during apply)

- **D3/D4 concretization**: whole-document intent recognition lives in
  `src/lib/ai/assistant/documentIntent.ts` (bounded pattern list with a focused-target guard so
  "summarize this section" never triggers a whole-document path). Coverage originates in the
  viewer: `ResolvedAssistantContext.coverage` is `"window"` only when `trimToTokenWindow`
  actually changed the resolved content, so adapters forward a fact rather than a guess.
- **Deviation — oversized canonical text**: when a configured/workspace adapter loads canonical
  text larger than the resolved source budget, it is trimmed with `trimToTokenWindow` and marked
  `"window"` (rather than sending the full text and relying on backend clamping). This keeps the
  prompt-budget promise and the coverage marker truthful.
- **Workspace direct answers**: `askQaKnowledge` now returns a message built from the
  orchestrator turn when the document's own text answered the question (no retrieval ran), so
  `qaWorkspace.sourceUnavailable` is reserved for genuinely empty turns.
- **Library scope** behavior, guards, and citation validation were left untouched; the Document
  scope branch gates retrieval on `hasSourceContent` only.

