# Change: Implement Plethora Automatic Semantic Connections

> Wave 2 — Intelligence (after `implement-plethora-intelligence-cross-library-semantic-indexing-and-rag`). Capability: `semantic_connections` (cloud-assisted discovery); local discovery via on-device/BYO backends remains available.

## Why

While reading, Plethora should surface high-signal relationships to previously consumed knowledge — "You encountered this concept 7 months ago", "This conflicts with something you highlighted in another book", "These two authors define this concept differently", "You have four related cards", "This concept appears in three queued items" — without turning the reader into a notification hellscape. The Plethora bird mascot becomes the subtle UX affordance for genuinely useful discoveries.

## What exists today
- Retrieval substrate (proposal 7): `rag_query` with citations and `source_kind` coverage.
- **Concept-link backend, unpopulated**: `concepts` + `concept_links` tables (10 relation types: same-as, prerequisite-of, example-of, contradicts, supports, extends, analogous-to, definition-of, application-of, related-to), `created_by='ai'` proposals with accept/dismiss workflow, dismissal fingerprints blocking re-proposal, `MAX_AI_LINKS_PER_DAY=200` anti-spam (`database/concept_repository.rs`, `commands/concept_links.rs`). The agent tool `propose_link` is stub-gated ("landing separately" — `src/lib/ai/agent/tools/proposals.ts:358`) and no TS callers exist.
- Reading-time context: `RecallPromptOverlay`/`useRecallPrompts` proves the interruption-policy pattern (30s eligibility tick, fingerprint dedup, sibling overlay); `interruptionPolicy.ts` gates intrusiveness.
- Queue metadata for "appears in your queue" statements (queue projections incl. playlist items).

## What Changes

### 1. Connection discovery engine (`src-tauri/src/connections/` + tasks)
- **Trigger points**: (a) reader dwell — the current viewport's chunk (passage-classification already scores read passages; reuse the viewport-chunk source); (b) extract/highlight creation; (c) idle batch over recently read items.
- **Discovery methods**: retrieval-based (top similar past chunks with temporal distance + format diversity heuristics) and model-based (a `connection-analysis` AI task producing typed relation candidates with confidence + evidence quotes). Both routes write **proposals** through the existing concept-link/relationship store: extend `concept_links` usage with a lightweight `connection_suggestions` view or reuse concepts directly (implementation chooses; fingerprint dedup mandatory).
- **Statement templates**: each suggestion carries structured evidence `{ relation, left_ref, right_ref (RagCitation), temporal_gap?, card_count?, queue_hits? }` so UI renders precise statements, not vibes.

### 2. Ranking, confidence, dedup
- Score = semantic similarity × relation confidence × novelty (not-seen-recently) × diversity penalty (avoid five hits from one book); hard cap on suggestions per document per day (default 5, user-tunable 0–20) extending the `MAX_AI_LINKS_PER_DAY` budget; dismissal feeds fingerprints (never re-propose the same pair).

### 3. UX — calm by construction
- **In-reader surface**: a quiet "related" affordance in the reader margin (bird-marked, count-badged, collapsed by default; **never a modal, never auto-expanding**); e-ink renders a static text variant; keyboard shortcut + command-palette entry.
- **Connections inbox**: a reviewable list (accept → persisted concept link / extract-note; dismiss → fingerprint; snooze) accessible from dashboard and reader; history of accepted connections.
- **Contextual statements**: rendered from structured evidence with clickable citations (proposal 7's `CitationChips`).
- Interruption policy: no connection surfaces during active review sessions or focus timer; suppressed in `vim` normal mode focus.

### 4. Local vs cloud execution boundary
- Local route: on-device Nano or BYO providers via the task engine (works Free with user's own keys, matching existing AI philosophy).
- Cloud route (`semantic_connections` capability): higher-quality model-based discovery as a job (proposal-5 framework), chunk-text sent per privacy disclosure; honors AI-exclusion flags.

## Impact

### Affected Specs
- `semantic-connections` — New (discovery, ranking, budgets, calm-UX invariants, inbox lifecycle).

### Affected Code Areas
- New `src-tauri/src/connections/`, `src/lib/ai/tasks/definitions/connectionTask.ts`, `src/stores/connectionsStore.ts`, `src/components/connections/{ConnectionsAffordance,ConnectionsInbox}.tsx`; wire `propose_link` agent tool un-stub; reader margin integration (`DocumentViewer` chrome, additive); i18n 6 locales.

### Non-goals
- No graph visualization (9), no gap detection (10), no auto-created flashcards, no push notifications, no cross-user social features.

## Dependencies

### Hard dependencies
- Proposal 7 (rag_query + citations + source_kind).

### Soft dependencies
- Proposal 9 (accepted connections enrich the graph; concepts store shared) — coordinate schema ownership: 9 owns `concepts`/`concept_links` evolution; this change is their primary producer via proposals.

### May run concurrently
- 9 (consumer/producer split agreed), 13 (card-count statements read decks read-only).

### Must not start yet
- 10/11 (consume accepted-connection signals).

## Shared interfaces
- Consumes `rag_query`; produces accepted links via existing `commands/concept_links.rs` accept/dismiss API (owned by 9); `connection_suggestions` lifecycle commands owned here.

## Ownership boundaries
- **May modify**: new connections modules, reader-margin mount points (additive), `proposals.ts` tool un-stub, its stores/UI.
- **Must treat as external**: concept schema (9), retrieval internals (7), reader internals beyond mount points, scheduling.

## Collision risks
- `concept_repository.rs`/concept commands (with 9 — 9 owns schema, this owns workflow volume); `DocumentViewer.tsx` chrome (add-only); settings sections (new `connections` subtree).

## Integration contract
- Emits `connection-suggested`/`connection-accepted` events; accepted links visible to 9's graph and 10's signals; suggestion records include `RagCitation` evidence.

## Testing & acceptance

### Tests
- Ranking unit tests (score composition, diversity penalty, novelty); dedup/fingerprint (dismissed pair never re-proposed); daily caps enforced across trigger points.
- Interruption policy: no affordance updates during review/focus (state-machine test).
- Statement rendering from structured evidence (snapshot tests per template incl. temporal and queue-hit variants).
- E2E: seeded fixture library → read document → exactly N suggestions, each with resolvable citations; accept persists concept link; inbox history.
- Performance: discovery adds no synchronous work to reading path (all async, viewport-chunk amortized; bench for viewport hook if measurable → baseline update).

### Acceptance criteria
- Reading with connections enabled shows ≤ cap/day high-signal suggestions, each clickable to sources, dismissible forever; disabled setting = zero surfaces and zero background discovery jobs; local-only mode works.

### Must remain unchanged
- Reading/review flows untouched when feature off (and structurally unaffected when on); existing recall-prompt behavior.

## Open questions
1. Default suggestion cadence (cap/day default 5) — tunable, product-validated later.
2. Whether connections ever appear inside review sessions (default no).
