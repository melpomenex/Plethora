## Context

See `proposal.md` — Why. The relevant current state:

- Ingestion already persists the complete canonical transcript: `persist_canonical_youtube_transcript` (`src-tauri/src/youtube.rs:1164`) writes all segments to `youtube_transcripts.segments_json` and the complete `[M:SS]`-prefixed text to `documents.content`; `import_youtube_video_internal` (`src-tauri/src/youtube.rs:1534`) calls it at import. No segment cap exists in storage, chunking, or indexing.
- The Document Q&A read path fragments that stored transcript:
  - `askQaKnowledge` (`src/features/documentQa/workspaceGrounding.ts:54`) loads a single document's full text for `Document` scope, then head-truncates it with `trimToTokenWindow(loaded, 60% of context)` (`:103`); `trimToTokenWindow` keeps the head only (`src/utils/tokenizer.ts:83`).
  - `runAssistantTurn` runs the video context planner only when `sourceType === "video" && scope !== "library"` (`src/lib/ai/assistant/orchestrator.ts:192`), before the retrieval branch. The workspace default scope is `library` (`src/components/tabs/DocumentQATab.tsx:129`), so by default a selected video is answered by `askLibrary` top-k retrieval (`src/lib/ai/tasks/definitions/libraryTask.ts:332`, k = 8/12/18) and the branch at `orchestrator.ts:265` replaces `sourceContent` with retrieved chunks and sets `sourceCoverage: "chunks"`, triggering the "SOURCE COVERAGE LIMIT" prompt (`src/lib/ai/assistant/promptBuilder.ts:294-301`).
  - `planVideoContext` (`src/lib/ai/assistant/videoContextPlanner.ts:132`) uses the whole transcript only when it fits the source budget; otherwise it map-reduces only for summary-intent queries (`:147-152`) and does BM25 window selection for everything else. `synthesizeWholeVideo` (`src/lib/ai/assistant/videoMapReduce.ts:12`) already implements cached hierarchical composition over every window.
  - Transcript-grounded answers return `sourceDocuments: [docId]`, `documentCount: 1` (`workspaceGrounding.ts:149-160`), but retrieval-path answers report `documentCount` from validated citations only (`:44-51`); an answer produced with no accepted refs renders `Source documents: 0`.
- `AssistantTurnRequest` already carries `sourceCoverage`, `sourceChunkCount`, `timeRangeCovered`, `transcriptStatus`, `videoSegments`, and `playbackTimeSeconds` (`orchestrator.ts:55-64`), and `Message.evidence` (`src/stores/documentQAStore.ts:46-51`) has no coverage field today.

## Goals / Non-Goals

**Goals:**

- A Document Q&A turn whose eligible sources resolve to exactly one video document is grounded on that document's complete stored transcript — whole when it fits the model's source budget, hierarchical full-transcript composition otherwise — on both `Document` and `Library` scope labels.
- The planner evaluates the untruncated transcript, and transcript coverage (`full` / `hierarchical-full` / bounded) is disclosed to the user and to the model.
- Missing/empty stored transcripts are repaired via the existing canonical fetch before answering, or the turn discloses the transcript is unavailable.
- Answers grounded in a video transcript attribute that document, so "Source documents: 0" no longer appears when the transcript was the evidence.

**Non-Goals:**

- Changing broad `Library`-scope multi-source retrieval semantics: with zero or multiple eligible sources, `askLibrary` top-k behavior is unchanged.
- Replacing the tiered retrieval/chunking stack or the semantic index.
- Reliably detecting *partially* stored transcripts (shorter than the true caption track but non-empty). We repair absent/empty transcripts and verify import persistence; partial-track detection without a reliable signal is out of scope (see Risks).
- Building per-segment citation UI for map-reduce answers: timestamp anchors remain in the answer text; structured citations remain a retrieval-path feature (no fabricated citations).

## Decisions

### D1: Route single-video turns explicitly, independent of the scope label

`askQaKnowledge` detects the case: exactly one eligible source and its `fileType` is `youtube` or `video`. It then loads the canonical text through the existing `loadDocumentQaText` seam (`src/features/documentQa/sectionContextRequest.ts:6`, which already calls `get_youtube_transcript_by_id` and therefore fetches/backfills on cache miss) and passes it **untrimmed**, sets `sourceType: "video"`, and sets a new request flag (for example `completeTranscriptSource: true`) instead of relying on `scope !== "library"`.

- Alternatives considered: (a) silently switching the effective scope to `document` — rejected: the submitted-scope label and prompt scope policy would disagree with each other; (b) forcing list users into Document scope — rejected: violates "scope is explicit and enforced" and the scope-preference spec; (c) leaving the defect to be fixed only in `askLibrary` — rejected: library RAG is the wrong tool for a single whole-transcript question and spec `ai-library-rag` deliberately caps context.
- The flag only widens *grounding* for the turn; the submitted scope stays exactly what the user chose, and `runAssistantTurn` keeps its existing behavior for every other input.

### D2: Planner decides full vs. hierarchical over the untruncated transcript

`runAssistantTurn` runs the existing video branch when `sourceType === "video" && (scope !== "library" || completeTranscriptSource)`. `resolveVideoSourceContext` → `planVideoContext` already select `full` when it fits, and `map-reduce` → `synthesizeWholeVideo` when it does not; the planner change is small: over-budget single-video questions that do not target a bounded region (no referenced timestamp, no playback cue, not a selection) select `map-reduce` rather than `retrieval` windows. Explicitly bounded questions (timestamp reference, playback cue) keep the cheap targeted-window strategies, and `retrieval` remains the fallback when no summarizer is available.

- Alternatives considered: (a) map-reduce every over-budget video question *including* timestamp/playback questions — rejected: strictly more expensive and less precise than reading the targeted window; (b) raise `k` or the chunk budget in `askLibrary` — rejected: still bounded, still gap-ridden by the ordinal ±1 dedup (`src-tauri/src/ai_learning/retrieval.rs:264-280`), and does not disclose coverage; (c) always map-reduce on first ask and cache — partially adopted via the existing cache, but bounded-question optimization is kept.
- Hierarchical composition reuses `synthesizeWholeVideo`'s existing content-hash cache keyed by video id + window summaries, so follow-up questions do not recompute window summaries.
- The video branch computes `sourceCoverage` already; the workspace passes `sourceCoverage: undefined` and lets the branch set it, mapping `hierarchical-full` through unchanged. `promptBuilder` already withholds the coverage-limit instruction for `full`/`hierarchical-full` and prints `Source Coverage:` for the model — no prompt-layer change needed.

### D3: No head truncation before planning; retrieval grounding stands down

In `askQaKnowledge`, the `Document`-scope branch keeps `trimToTokenWindow` only for non-video documents. For the single-video turn the complete loaded text is passed through. `runAssistantTurn` then computes `needsRetrievalGrounding` as before but suppresses it when the video branch produced grounded content for a `completeTranscriptSource` turn; document-restricted retrieval remains the fallback when the planner yields no content (transcript unavailable), preserving the honest-unavailable behavior at `orchestrator.ts:227-252`.

- Alternative considered: removing `trimToTokenWindow` entirely — rejected: it protects small-context models for ordinary long documents; the fix is scoped to the video path where a complete-coverage strategy exists.

### D4: Repair before answer, disclose otherwise

Empty/absent stored transcripts flow through the existing `get_youtube_transcript_by_id` fetch path at `loadDocumentQaText`; the desktop command persists what it fetches (`youtube.rs:1300`), so a successful repair writes `youtube_transcripts` + `documents.content` before the answer. If the load still returns empty, the turn proceeds with no source content, and the orchestrator's existing `Document`-scope unavailable message (updated to name transcript repair failure) and `Library`-scope coverage disclosure state the limitation. No new fetch mechanism is introduced.

### D5: Attribute transcript-grounded answers

The workspace's non-retrieval return sets `sourceDocuments: [documentId]` and `evidence.documentCount: 1` (already present) and extends `Message.evidence` with optional `coverage` and `transcriptStatus` fields so the workspace can render the actual coverage (for example "Full transcript" / "Full-transcript synthesis") next to the evidence summary. `groundedQaMessage` gains the same optional fields for the retrieval path. Legacy saved messages without the fields render exactly as before.

- Alternative considered: synthesizing `RagHit` citations for map-reduce answers — rejected: no chunk maps to a synthesized summary; fabricated citations would violate the citation integrity requirements.

### D6: Import persistence regression check

Add a Rust test around `persist_canonical_youtube_transcript` with a synthetic multi-hour segment list (first, middle, last sentinel segments) asserting `segments_json` round-trips every segment and `transcript` contains the first and last sentinels — plus a length check against the input. This guards against future silent caps rather than adding new storage behavior.

### D7: Browser/desktop parity through the shared workspace layer

The routing logic lives in shared TypeScript (`workspaceGrounding`/`orchestrator`/planner), so the web build inherits complete-transcript grounding; only the storage/backfill differs (`src/lib/browser-backend.ts:3863` writes `documents.content` and caches segments in `localStorage`, with `get_youtube_transcript_by_id` cache-first reads). Tasks include verifying the browser path returns the full text and noting the `localStorage` quota risk below.

## Risks / Trade-offs

- [Hierarchical synthesis adds model calls and latency for over-budget videos] → window summaries are cached by content hash; targeted timestamp/playback questions bypass map-reduce; window summarization runs with bounded concurrency (existing behavior); the turn remains honest about coverage while expensive work is cached across follow-ups.
- [An over-budget map-reduce failure would surface where retrieval would have answered] → keep retrieval as a fallback when the planner returns no content or the summarizer throws, and label the resulting coverage honestly (`chunks`/`window`) so the model still discloses bounded coverage.
- [Partially stored transcripts are not detected] → out of scope by design; the regression check covers import parity, and empty/absent transcripts are repaired. A duration-vs-last-segment heuristic was considered and deferred as a false-positive risk (caption tracks legitimately omit trailing silence).
- [Attribution of full-transcript answers could be read as per-passage evidence] → evidence shows the document plus coverage label; timestamp anchors live in the answer text; no fabricated chunk citations.
- [Browser `localStorage` quota could reject large segment caches] → `documents.content` in IndexedDB still holds the full text; the load path falls back to document content, so grounding remains complete.

## Migration Plan

No schema migration and no breaking API change. Ship the frontend routing/planner change together with the Rust test; legacy conversations keep rendering; rollback is reverting the commit. `scripts/perf-baselines.json` / `scripts/bundle-budgets.json` are unaffected.

## Open Questions

- None blocking. The exact request-flag name (`completeTranscriptSource` vs. reusing `transcriptStatus`) is an implementation detail settled during coding.
