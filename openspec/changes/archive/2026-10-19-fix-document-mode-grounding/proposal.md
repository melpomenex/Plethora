## Why

With `Document` scope selected in the Assistant, the open document's text is visible in the
reader and already resolved as live context, yet the turn is routed through library retrieval
whenever the surface provides a retrieval adapter. For a document that is not (yet) in the
semantic index — or for whole-document requests like "summarize this document" that no top-k
similarity query captures — retrieval returns zero chunks and the Assistant answers
"The library does not appear to contain material relevant to this question" while showing
"Switch to Chat to use general knowledge". The document plainly contains the material; the
answer is wrong about what was searched and discards the strongest evidence available.

## What Changes

- Document scope answers from the active source's live content first. When the reader/workspace
  has resolved document text, transcript, focused section, or selection available, that evidence
  grounds the answer; a retrieval pass no longer replaces it.
- Document-filtered retrieval becomes an explicit fallback and coverage path: it is used when
  live content is unavailable (extraction pending/failed) or when the request needs coverage
  beyond the loaded window. Retrieval stays restricted to the active document's id (existing
  fail-closed guards unchanged).
- Honest, scope-correct empty states: in Document scope a no-evidence outcome must say the
  active document does not contain the evidence — never that "the library" lacks material — and
  still offers the one-click switch to Chat. The library-scope wording stays as-is for Library.
- Whole-document intents ("summarize this document", "what is this about") use the document's
  full text when it fits the resolved prompt budget; when it does not, the answer uses the
  loaded window plus document-filtered retrieval and the request records partial ("window")
  coverage instead of implying the whole document was analyzed.
- Apply the same evidence policy to every Document-scope adapter that holds live content:
  the Assistant sidebar, the Document Q&A workspace (selected document), and the configured
  turn adapter used by workspaces without their own provider picker.
- No changes to provider privacy gating, local-only/AI-excluded rules, retrieval-only mode, or
  citation validation.

## Capabilities

### New Capabilities
<!-- None: this change corrects existing Document-scope behavior. -->

### Modified Capabilities
- `assistant-conversation-scopes`: the "Document scope enforces strict source grounding"
  requirement gains live-source precedence, the retrieval fallback, document-scoped
  missing-evidence wording, and coverage honesty for window-limited answers.
- `library-qa`: the scope-resolution requirement no longer mandates semantic-index retrieval for
  Document scope when the active document's live content is available; retrieval in Document
  scope is fallback/coverage restricted to the active document.
- `ai-library-rag`: the "Honest handling of weak or missing evidence" requirement distinguishes
  an empty Document-scope retrieval result (evidence missing from the active document, after live
  content was unavailable) from a Library-scope empty result, and forbids the library-wide
  "does not appear to contain material" claim in Document scope when live document evidence
  exists.
- `document-qa-workspace`: the "Ordinary knowledge answers remain grounded in the selected
  sources" requirement states that Document-scope questions with one selected document use that
  document's text as primary evidence, with document-restricted retrieval as fallback.

## Impact

- **Engine**: `src/lib/ai/assistant/orchestrator.ts` (Document-scope branch ordering, fallback
  and honesty outcome), `src/lib/ai/assistant/promptBuilder.ts` (coverage disclosure only if a
  gap remains).
- **Surfaces/adapters**: `src/components/assistant/AssistantPanel.tsx`,
  `src/lib/ai/assistant/configuredTurn.ts`, `src/features/documentQa/workspaceGrounding.ts`
  (load and pass the active document text for single-document Document scope).
- **Task layer**: `src/lib/ai/tasks/definitions/libraryTask.ts` (scope-aware empty-evidence
  copy), consumed by `src/lib/ai/askSheet/scope.ts` Document scope.
- **Tests**: orchestrator routing/fallback/honesty cases, AssistantPanel Document-scope
  regression (live content used, no library-empty claim), workspace grounding, libraryTask copy.
- **Overlap**: `openspec/changes/unify-assistant-experience` (in flight) owns the routing table
  and attachment model; this change is a narrow evidence-selection fix that must land in the
  orchestrator's Document branch and stay compatible with that table. No benchmark-suite change
  expected; the standard `npm run bench:check` gate still applies.
