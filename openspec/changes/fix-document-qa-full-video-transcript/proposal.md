## Why

Document Q&A answers questions about an imported YouTube video from a handful of retrieved ~900-character fragments instead of the full stored transcript, so the assistant tells users it "only has access to the specific chunks provided" and reports `Source documents: 0`. Users reasonably expect that the entire transcript saved at import is queryable end to end. Investigation shows the transcript *is* fully persisted (`youtube_transcripts.segments_json` and `documents.content` — `src-tauri/src/youtube.rs:1164`, `:1534`); the defect is in the Q&A read path, which fragments, head-truncates, or bypasses that stored transcript.

## What Changes

- **Whole-transcript grounding for a single video source**: When a Document Q&A turn targets exactly one video document (YouTube or local video), the answer is grounded on that document's complete stored transcript — used whole when it fits the model's source budget, otherwise composed through hierarchical full-transcript synthesis over *every* window — instead of top-k retrieved chunks.
- **No silent head truncation**: the Q&A path stops pre-trimming a video document's text to the front of the transcript (`trimToTokenWindow` head-only) before the assistant context planner sees it; the planner receives the complete transcript and decides full vs. hierarchical coverage.
- **Hierarchical coverage beyond summary questions**: over-budget single-video questions of any kind (not just "summarize the video") use hierarchical synthesis with `[MM:SS]` anchors preserved, so late-video content is answerable on a two-hour video.
- **Complete-or-repair acquisition**: when the stored transcript for the targeted video is missing or incomplete, the workspace attempts the existing canonical fetch/backfill and persists it before answering; if it still cannot obtain the complete transcript, the turn discloses the limitation instead of silently answering from fragments or claiming the library lacks material.
- **Honest attribution**: answers grounded in a video document cite that document with timestamp locations, so "Source documents: 0" only appears when no valid source supports the answer.
- **Storage verification**: import already saves the complete transcript; a regression check asserts complete persistence at import (segment count and content parity) so future changes cannot silently truncate it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `document-qa-workspace`: The grounding requirement for ordinary knowledge answers gains a single-video-source rule — the complete stored transcript (full or hierarchically composed) is the primary evidence for a video document, retrieval is never a substitute while that transcript is available, and evidence/citation attribution must identify the video document.
- `youtube-canonical-transcript-intelligence`: The query-aware planning requirement is tightened for Document Q&A — no head truncation before planning, hierarchical full-video comprehension applies to any over-budget single-video question (not only explicit summary/outline intents), the persisted canonical transcript is the completeness source of truth with an on-demand repair path, and transcript-grounded answers carry document and timestamp provenance.

## Impact

- **Frontend Q&A**: `src/features/documentQa/workspaceGrounding.ts`, `src/components/tabs/DocumentQATab.tsx`, `src/lib/ai/assistant/orchestrator.ts`, `src/lib/ai/assistant/videoContextPlanner.ts`, `src/lib/ai/assistant/videoMapReduce.ts`, `src/lib/ai/assistant/contextResolver.ts`, `src/features/documentQa/sectionContextRequest.ts`.
- **Backend/persistence**: verification only for `src-tauri/src/youtube.rs` (`persist_canonical_youtube_transcript`, `import_youtube_video_internal`) and `src-tauri/src/database/repository.rs` transcript reads; browser parity in `src/lib/browser-backend.ts`.
- **Cost/latency**: hierarchical synthesis issues multiple summarization calls for over-budget long videos; bounded by the existing windowed map-reduce with caching. No new network providers, no schema migration, no breaking API change.
- **Tests**: workspace grounding, video planner, map-reduce, and import persistence tests.
