## Why

Plethora's Assistant currently traps users inside a brittle, document-only Q&A paradigm while simultaneously starving the model of most of a YouTube video's transcript. Hardcoded backend instructions (`"If the answer is not in the provided context, say so"` in `src-tauri/src/ai/prompt_budget.rs:243-247`), hard frontend empty-context exceptions (`src/components/assistant/AssistantPanel.tsx:1633-1640`), conflicting multi-system messages, stateless RAG turns (`src/components/tabs/DocumentQATab.tsx:1532-1538`), and fragile keyword regexes (`src/utils/assistantExpansion.ts:7-17`) prevent natural multi-turn learning conversations, while a 2,000-token (~10-minute) frontend head cut (`src/components/viewer/DocumentViewerWrapper.tsx:359-369`), bypassed SQLite transcript caching (`src-tauri/src/youtube.rs:1225-1240`), and unindexed transcript segments prevent the Assistant from understanding complete videos.

## What Changes

- **Introduce Three Explicit Conversational Scopes (`Chat | Document | Library`)**:
  - **Chat (default)**: Context-aware learning companion that uses the active document, selection, or video transcript as an asset while freely drawing on broader model knowledge, maintaining multi-turn continuity, executing MCP study tools (flashcards, clozes, extracts), and functioning even when no document is open or text extraction is unavailable.
  - **Document (strict grounding)**: Deterministic, source-restricted Q&A that answers strictly from supplied document/transcript evidence, surfaces missing or insufficient evidence honestly, and preserves verbatim citations and provenance.
  - **Library (cross-source research)**: Multi-turn, whole-library or collection-scoped hybrid retrieval that synthesizes across documents, resolves conversational follow-ups ("the second paper", "compare these"), and validates citations.
- **Unify Assistant Orchestration & Conversation Continuity Across Surfaces**:
  - Introduce a shared conversation orchestrator and context resolver (`src/lib/ai/assistant/orchestrator.ts` and `src/lib/ai/assistant/contextResolver.ts`) used consistently across `AssistantPanel`, `DocumentQATab`, `QueueScrollPage`, `AskSheet`, and `PwaAssistantButton`.
  - Pass relevant multi-turn conversation history across all three scopes (including grounded `Document` and `Library` RAG queries via conversational query rewriting + history-aware synthesis), with rolling summary compression for older turns and per-session scope persistence.
  - Remove the hard empty-context throw in `AssistantPanel.tsx:1633-1640` and `src/api/llm/index.ts:164-166` when operating in `Chat` scope.
  - Replace fragile phrase-triggered expansion (`src/utils/assistantExpansion.ts`, including the false-positive `/chapter/i` pattern) with scope-driven grounding and explicit/intent-aware Brave web search that queries the user's question rather than raw selected text.
- **Redesign Composable Prompt Assembly & Provider-Aware Context Budgeting**:
  - Replace scattered, conflicting multi-system prompts across TypeScript and Rust with a single composable prompt builder (`Identity -> Scope Policy -> Untrusted Source Containment -> Retrieved/Active Evidence -> Conversation Memory -> Tool Schema & Rules`).
  - Fix `src-tauri/src/commands/llm.rs:838-850, 1655-1667` so Anthropic requests include the assembled top-level `system` field instead of silently discarding all `role == "system"` messages.
  - Fix `src-tauri/src/commands/llm.rs:485` and `src-tauri/src/ai/prompt_budget.rs:91-101` so Ollama history trimming never evicts the system/tool prompt before old chat turns.
  - Eliminate duplicate document context injection into both the system prompt and user message (`createDocumentQaRequestContent`), fix image attachment prompt clobbering (`AssistantPanel.tsx:1735-1760`), and gate `MEMORY.md` injection on `settings.ai.memoryEnabled`.
  - Stop clamping `resolveRequestPolicy` to legacy `settings.ai.maxTokens` (`2000`) via `promptBudgetHint` in `AssistantPanel.tsx:1502`, and scale RAG context budgets dynamically with the active model's resolved context window.
- **Fix Canonical YouTube Transcript Persistence, Indexing & Full-Video Comprehension**:
  - Fix `get_youtube_transcript_by_id` (`src-tauri/src/youtube.rs:1225-1251`) to read from `youtube_transcripts` before network fetching, persist successful on-device InnerTube results (`upsert_youtube_transcript`), and synchronize `documents.content` so FTS5 (`document_search`), `DocumentQATab`, and backend fallbacks always have the full transcript.
  - Automatically chunk and index transcripts into `semantic_chunks` (`source_type = "transcript"`) with `location.timestamp_ms` and chapter/time-window boundaries (`src-tauri/src/ai_learning/chunker.rs` and `indexer.rs`).
  - Remove the destructive 2,000-token (`tokens.slice(0, maxTokens)`) frontend head truncation in `DocumentViewerWrapper.tsx:359-369`, stop re-tokenizing on every `currentTime` playback tick, and preserve line breaks in transcript context (`src/utils/assistantContext.ts`).
  - Implement a query-aware video retrieval planner (`src/lib/ai/assistant/videoContextPlanner.ts`) supporting: (1) full-transcript injection when within model budget, (2) playback-head windowing ("what did they just say?"), (3) timestamp-targeted retrieval ("around 42:00"), (4) semantic/lexical chunk retrieval for topical questions, and (5) hierarchical map-reduce chapter/window synthesis for whole-video questions on long recordings.
  - Replace misleading `"Transcript attached"` badges (`DocumentViewerWrapper.tsx:361-375`, `AssistantPanel.tsx:3276-3280`) with honest transcript availability states (`loading`, `ready-full`, `ready-indexed`, `partial`, `unavailable`, `failed`) and connect `QueueScrollPage.tsx` and `VideoFeatures.tsx` to canonical YouTube transcripts and playback timestamps.

## Capabilities

### New Capabilities
- `assistant-conversation-scopes`: Explicit `Chat`, `Document`, and `Library` conversational scopes, unified conversation orchestration, multi-turn history continuity across scope transitions, and non-blocking general conversation when source context is absent.
- `assistant-composable-prompt-budget`: Composable prompt architecture with strict untrusted-data boundaries, single system-prompt assembly, Anthropic system-field support, protected system instructions under Ollama trimming, and provider-aware dynamic token budgeting.
- `youtube-canonical-transcript-intelligence`: Canonical YouTube transcript caching and `documents.content` synchronization, timestamp-preserving semantic chunking, query-aware video retrieval, hierarchical full-video synthesis, and accurate transcript status indicators across all viewers.

### Modified Capabilities
- `assistant-external-lookup`: Replace keyword-regex expansion (`assistantExpansion.ts`) with scope-governed knowledge policy (`Chat` scope vs. `Document` scope) and accurate Brave web search query formulation.
- `selection-aware-assistant`: Maintain pinned selection precedence across all three scopes, validate `selection-context` citations in grounded responses, and wire selection-to-Ask and reader context callbacks in `QueueScrollPage`.
- `document-qa-workspace`: Add multi-turn conversational continuity to grounded `Document` and `Library` Q&A, unify 4-stage tool-call parsing and privacy/cloud-disclosure checks across Assistant surfaces, and resolve canonical YouTube transcripts in Document Q&A.
- `ai-library-rag`: Fix `filters.document_ids` leak in `src-tauri/src/ai_learning/retrieval.rs` where FTS prefilter results were unioned instead of intersected, scale RAG chunk token budgets to the active provider's context window, and prevent false `"none"` evidence downgrades on minor quote normalization differences.
- `transcript-search-integration`: Index YouTube and media transcript segments into `semantic_chunks` with `source_type = "transcript"` and `location.timestamp_ms`, and enable clickable inline `[MM:SS]` / `[HH:MM:SS]` timestamp links in Assistant responses.

## Impact

- **Frontend Assistant & Q&A Surfaces**: `src/components/assistant/AssistantPanel.tsx`, `src/components/tabs/DocumentQATab.tsx`, `src/components/assistant/AskSheet.tsx`, `src/components/assistant/PwaAssistantButton.tsx`, `src/components/common/AssistantResponseContent.tsx`, `src/features/documentQa/workspaceGrounding.ts`, `src/features/documentQa/sectionContextRequest.ts`.
- **Frontend Context, LLM & Task Modules**: `src/api/llm/index.ts`, `src/api/llm/policy.ts`, `src/utils/assistantContext.ts`, `src/utils/assistantExpansion.ts`, `src/utils/tokenizer.ts`, `src/lib/ai/tasks/definitions/libraryTask.ts`, `src/lib/ai/schemas/libraryAnswer.ts`, `src/utils/resolveCitationLocation.ts`.
- **Frontend Viewers & Transcript Modules**: `src/components/viewer/YouTubeViewer.tsx`, `src/components/viewer/DocumentViewer.tsx`, `src/components/viewer/DocumentViewerWrapper.tsx`, `src/pages/QueueScrollPage.tsx`, `src/components/video/VideoFeatures.tsx`, `src/lib/transcript/sourceChain.ts`, `src/utils/youtubeTranscriptBrowser.ts`.
- **Rust Tauri Backend**: `src-tauri/src/commands/llm.rs`, `src-tauri/src/ai/prompt_budget.rs`, `src-tauri/src/ai/llm_policy.rs`, `src-tauri/src/commands/ai.rs`, `src-tauri/src/youtube.rs`, `src-tauri/src/youtube/innertube.rs`, `src-tauri/src/ai_learning/chunker.rs`, `src-tauri/src/ai_learning/indexer.rs`, `src-tauri/src/ai_learning/retrieval.rs`, `src-tauri/src/database/repository.rs`, `src-tauri/src/database/migrations.rs`.
