## Context

See `proposal.md` — Why and What Changes.

### Root Cause Verification

The following table records the verified defects across the current checked-out revision (HEAD):

| Component | File & Line References | Current Behavior | Verified Defect | Proposed Correction |
| :--- | :--- | :--- | :--- | :--- |
| **Context Action Execution** | `src/features/assistant/contextActions/execution.ts:26-28` | Computes policy without `globalContextTokens`, then calls `trimToTokenWindow(content, promptBudget * 0.55)` and freezes `target.resolved = true`, `coverage = 'window'`. | Irreversibly discards >90% of transcript; treats full canonical transcript as a small 2,252-token head slice; sets coverage to `window`. | Remove premature truncation and `0.55` multiplier. Preserve canonical transcript in `target.content`, keep `coverage = 'full'`, and defer context budgeting to planner/orchestrator. |
| **Video Planner Guard** | `src/lib/ai/assistant/orchestrator.ts:225-229` & `src/components/assistant/AssistantPanel.tsx:1574, 2569` | `AssistantPanel` assigns `sourceContentOverride = action.target.content`, setting `explicitSourceContent: true`. `orchestrator.ts` only runs `resolveVideoSourceContext` when `!request.explicitSourceContent`. | Pre-trimmed context action bypasses `resolveVideoSourceContext` and hierarchical map-reduce completely. | Distinguish genuine user selections (`kind === 'selection'`) from whole-source targets (`kind === 'document'`). Whole-source targets must NOT set `explicitSourceContent: true` or bypass video planning. |
| **Global Settings Propagation** | `src/components/assistant/AssistantPanel.tsx:2295` & `execution.ts:26` | `AssistantPanel.tsx` explicitly passes `globalContextTokens: undefined` to `resolveRequestPolicy`. `execution.ts` does not pass `globalContextTokens`. | User-configured context window under AI Settings (`settings.ai.maxTokens = 50000`) is completely ignored. | Pass `globalContextTokens: useSettingsStore.getState().settings.ai.maxTokens` in all policy resolution call sites. |
| **Cloud Provider Context Persistence** | `src/components/settings/LLMProviderSettings.tsx:214-220, 790` | `persistContextFields` returns `{}` for non-Ollama providers; context controls are hidden in the UI if `newProviderType !== 'ollama'`. | OpenRouter, Anthropic, OpenAI, Gemini, and DeepSeek cannot save context window tokens, silently falling back to `8192` tokens. | Expose context window presets and numeric input for all providers; persist `contextWindowTokens` and `contextWindowPreset` across all providers. |
| **AI Settings UI Clamping** | `src/components/settings/AISettings.tsx:512` & `AIProviderSettings.tsx:668` | `NumericInput` has `max={32000}`. `UI.tsx:229-231` clamps any typed number exceeding `max` on blur. | User typing `50000` is silently clamped to `32000` on input blur. | Raise `NumericInput` max to `1000000` (or model-supported max) with step intervals of `1024` or `500`. |
| **Video Context Planner Complete Coverage** | `src/lib/ai/assistant/videoContextPlanner.ts:156-177` | Map-reduce is only selected if `query` matches a narrow regex or `requireCompleteCoverage` is true. `completeTranscriptSource` was only set in `workspaceGrounding.ts`. | Assistant sidebar turns for "Key points", "Outline document", "Quiz me", "Explain", etc., fall through to BM25 retrieval windows if over budget. | Set `completeTranscriptSource: true` in `AssistantPanel` for video sources. Broaden whole-source action detection in planner to route all whole-source intents to complete coverage. |
| **Long-Transcript Map-Reduce Allocation** | `src/lib/ai/assistant/videoMapReduce.ts:31, 48` | Calculates per-window summary tokens as `sourceBudgetTokens / windows.length`, clamped to `Math.max(64, ...)`, and reduction to `Math.max(32, ...)`. | Multi-hour transcripts (50+ windows) receive 32–64 token output budgets, degrading summaries into vacuous fragments. | Implement recursive staged reduction with a guaranteed per-window output floor (150–250 tokens), chunking windows into batches of 4–8. |
| **Coverage Limitation Prompt Injection** | `src/lib/ai/assistant/promptBuilder.ts:296-302` | Injects `SOURCE COVERAGE LIMIT: The supplied source content is only a bounded window...` whenever `sourceCoverage === 'window'`. | Directly causes the assistant to reply "Based on the supplied window...", confusing users who requested full-source actions. | When whole-source actions achieve direct fit or hierarchical full coverage, report `sourceCoverage: "full"` or `"hierarchical-full"`, suppressing the limitation prompt. |

## Goals / Non-Goals

**Goals:**
- Provide full-transcript grounding by default for whole-source actions ("Key points", "Summarize", "Outline document", "Explain", "Examine argument", "Quiz me", "Make flashcards") and general non-time-specific queries across all Assistant surfaces (Document Viewer, Queue Scroll, Assistant sidebar, and Document Q&A workspace).
- Eliminate premature head-truncation (`trimToTokenWindow`) and arbitrary multipliers (`0.55`) in `resolveActionEnvelope`.
- Unify request policy resolution across all frontend and backend entry points, ensuring user-configured context windows (e.g. 50,000 tokens) are faithfully propagated and respected.
- Allow configuring and persisting context window tokens and presets across all provider types (OpenRouter, Anthropic, OpenAI, Gemini, DeepSeek, Ollama) in settings.
- Implement robust multi-stage hierarchical map-reduce in `videoMapReduce.ts` that preserves timestamp anchors and critical late-video takeaways without degrading to 32-token fragments on long transcripts.
- Preserve fast, focused retrieval for explicitly localized queries (timestamp references like "around 18:20", playback cues like "what did he just say", or active text selections).
- Add transparent per-turn source coverage diagnostics and honest UI indicators.

**Non-Goals:**
- Arbitrary whole-library retrieval expansion: Document scope remains strictly bounded to the active document; if transcript processing fails, it must not silently search unrelated documents.
- Changing broad Library-scope multi-source RAG ranking semantics for general library queries.
- Replacing existing vector embedding, sqlite persistence, or InnerTube transcript fetching mechanisms (the persisted canonical transcript in SQLite is verified complete).
- Redesigning the document reader layout or video player chrome.

## Execution Path Architecture

### Current Execution Flow (Defective)

```
[User clicks "Key points" on 2-hour Video]
               │
               ▼
   resolveActionEnvelope()
   ├── loads full canonical transcript (35,000 tokens) via loadDocumentQaText()
   ├── resolves policy with globalContextTokens: undefined -> falls back to 8,192
   ├── computes budget = 8,192 * 0.55 = 2,252 tokens
   └── trimToTokenWindow(content, 2,252) -> HEAD SLICE ONLY (00:06–00:45)
       └── target.resolved = true, target.content = trimmed, coverage = 'window'
               │
               ▼
   AssistantPanel.tsx: callLLM()
   ├── sourceContentOverride = action.target.content (the 2,252-token head slice)
   └── explicitSourceContent: true
               │
               ▼
   orchestrator.ts: runAssistantTurn()
   ├── if (sourceType === 'video' && !explicitSourceContent)
   │   └── SKIPPED! (because explicitSourceContent === true)
   │       └── videoContextPlanner & synthesizeWholeVideo NEVER RUN!
   ├── promptBuilder.ts: assembleAssistantPrompt()
   │   └── detects sourceCoverage === 'window'
   │       └── injects "SOURCE COVERAGE LIMIT: The supplied source content is only a bounded window..."
   └── Provider Call (OpenRouter)
       └── Model answers: "Based on the supplied window (00:06–00:45)..."
```

### Proposed Execution Flow (Unified & Full-Coverage)

```
[User clicks "Key points" or asks Whole-Source Question]
               │
               ▼
   resolveActionEnvelope()
   ├── Identifies target kind === 'document', sourceType === 'video'
   ├── Resolves canonical transcript untruncated (35,000 tokens)
   ├── Resolves policy with globalContextTokens from settingsStore (50,000 tokens)
   └── Returns ActionEnvelope with FULL content, target.coverage = 'full', resolved = true
               │
               ▼
   AssistantPanel.tsx: callLLM()
   ├── Differentiates selection vs whole-source target:
   │   └── target.kind === 'document' -> explicitSourceContent: false, completeTranscriptSource: true
   └── Passes complete canonical transcript & full configuredContextTokens to orchestrator
               │
               ▼
   orchestrator.ts: runAssistantTurn()
   ├── policy = resolveRequestPolicy({ globalContextTokens: 50,000, ... })
   │   └── configuredContextTokens = 50,000; promptBudgetTokens = ~46,000
   ├── runs resolveVideoSourceContext()
   │   │
   │   ├── Case A: Transcript tokens (e.g. 25,000) <= promptBudgetTokens (46,000)
   │   │   └── mode: "full", coverage: "full" -> DIRECT FULL TRANSCRIPT INCLUSION
   │   │
   │   └── Case B: Transcript tokens (e.g. 60,000) > promptBudgetTokens (46,000)
   │       └── mode: "map-reduce", coverage: "hierarchical-full"
   │           └── synthesizeWholeVideo():
   │               ├── Chronological windowing with sentence & anchor boundaries
   │               ├── Window summaries with guaranteed minimum tokens (150–250 tokens)
   │               └── Recursive reduction batches -> complete duration representation
               │
               ▼
   promptBuilder.ts: assembleAssistantPrompt()
   ├── sourceCoverage === "full" or "hierarchical-full"
   │   └── NO coverage limit warning injected!
   └── outgoing prompt contains untrusted-source block of complete or synthesized transcript
               │
               ▼
   Provider Call (OpenRouter / Ollama / Gemini / Anthropic)
   ├── Response covers beginning, middle, and ending with timestamps [MM:SS]
   └── UI displays accurate coverage badge: "Full transcript · 2h 02m · Direct context" (or "Analyzed in sections")
```

## Decisions

### D1: Unify Request Policy Precedence and Include Global Fallback
Establish a single authoritative policy resolution function across TypeScript (`src/api/llm/policy.ts`) matching Rust (`src-tauri/src/ai/llm_policy.rs`):
```
Precedence:
1. Per-model override (providerConfig.modelContextWindows[modelId])
2. Per-provider configured context (providerConfig.contextWindowTokens)
3. Global context window (settings.ai.maxTokens)
4. Discovered runtime context (Ollama /api/show num_ctx)
5. Conservative fallback (CONSERVATIVE_CONTEXT_FALLBACK = 8,192)
```
- In `AssistantPanel.tsx:2295`, replace `globalContextTokens: undefined` with `globalContextTokens: useSettingsStore.getState().settings.ai.maxTokens`.
- In `execution.ts:26`, pass `globalContextTokens: useSettingsStore.getState().settings.ai.maxTokens`.
- In `PwaAssistantButton.tsx:344`, pass `globalContextTokens: settings.ai.maxTokens`.
- In `LLMProviderSettings.tsx`, expose context window controls for all provider types and persist `contextWindowTokens` and `contextWindowPreset` on save.
- In `AISettings.tsx` and `AIProviderSettings.tsx`, remove the artificial `max={32000}` clamp on `NumericInput` so users can configure up to 1,000,000 tokens for modern large-context models.

*Alternatives considered:*
- (a) Defaulting every provider to theoretical model maximum context (e.g. 1M for Gemini, 200k for Claude) automatically: rejected because giant contexts can incur massive latency and cost; user configuration and explicit presets must govern.
- (b) Separate policy logic for desktop vs mobile vs web: rejected because policy resolution is pure mathematical budgeting that must be identical across all platforms.

### D2: Eliminate Eager Pre-Truncation in Context Actions
In `src/features/assistant/contextActions/execution.ts`:
- When `target.kind === 'document'` and the source is a document or video transcript, `loadDocumentQaText` loads the full canonical text.
- Do NOT call `trimToTokenWindow` or multiply by `0.55` in `resolveActionEnvelope`.
- The resolved `ActionEnvelope` holds the complete canonical transcript with `coverage = 'full'`.
- Defer token budgeting and coverage strategy entirely to `orchestrator.ts` and `videoContextPlanner.ts`.
- `trimToTokenWindow` is retained ONLY for explicit passage operations or small-context non-video fallbacks where no hierarchical strategy exists.

*Alternatives considered:*
- (a) Raising the `0.55` multiplier to `0.9` in `execution.ts`: rejected because any fixed head-slice still drops late-video content on long videos.
- (b) Performing map-reduce inside `execution.ts`: rejected because hierarchical synthesis belongs in the orchestrator/planner layer to avoid duplicate logic and ensure cache sharing.

### D3: Distinguish Whole-Source Targets from Bounded Selections in the Orchestrator
In `src/components/assistant/AssistantPanel.tsx` and `src/lib/ai/assistant/orchestrator.ts`:
- Define `explicitSourceContent` strictly as: true ONLY when the turn is grounded in an explicitly bounded user selection (`target.kind === 'selection'`, pinned selection excerpt, or manual section chip).
- When `target.kind === 'document'`, `explicitSourceContent` is `false`.
- When the active source is a video and the user invokes a whole-source action or asks a Document-scope question, set `completeTranscriptSource: true`.
- In `orchestrator.ts:225`, ensure `resolveVideoSourceContext` runs whenever `sourceType === 'video' && !isBoundedSelection && (scope !== 'library' || completeTranscriptSource)`.

*Alternatives considered:*
- (a) Removing `explicitSourceContent` entirely: rejected because when a user specifically highlights a 20-word sentence and asks "Explain this", the system must honor the bounded selection and not load the entire video.

### D4: Intent-Aware Video Planning (Whole-Source vs Factual vs Localized)
Update `planVideoContext` in `src/lib/ai/assistant/videoContextPlanner.ts` to implement deterministic, intent-driven routing:
1. **Explicitly Localized**:
   - Query contains timestamp references (e.g., `parseTimestampReferences(query).length > 0`) -> `mode: "timestamp"`, `coverage: "window"`.
   - Query references current playback (e.g., "what did he just say", "this part", "right now") -> `mode: "playback"`, `coverage: "window"`.
   - Explicit user text selection -> `mode: "selection"`, `coverage: "window"`.
2. **Whole-Source Analytical Actions**:
   - Query or action is a whole-source operation (Key points, Summarize, Outline document, Examine argument, Quiz me, Flashcards, or matches expanded whole-source intent regex) OR `requireCompleteCoverage === true`:
     - If `transcriptTokens <= promptBudgetTokens`: `mode: "full"`, `coverage: "full"` (direct full transcript).
     - If `transcriptTokens > promptBudgetTokens`: `mode: "map-reduce"`, `coverage: "hierarchical-full"` (hierarchical map-reduce).
3. **Specific Factual Questions across Long Videos**:
   - Queries asking about specific topics or claims without timestamps (e.g. "What did he say about plants?"):
     - If `transcriptTokens <= promptBudgetTokens`: `mode: "full"`, `coverage: "full"`.
     - If `transcriptTokens > promptBudgetTokens`: `mode: "retrieval"`, `coverage: "chunks"`, using high-recall semantic and lexical retrieval across the *entire* transcript index.

*Alternatives considered:*
- (a) Map-reducing every factual question on an over-budget video: rejected because summarizing every chapter is lossy for narrow factual queries and incurs unnecessary latency/cost. High-recall chunk retrieval over the whole indexed transcript is superior for specific needle-in-a-haystack facts.

### D5: Robust Multi-Stage Hierarchical Map-Reduce
Redesign `synthesizeWholeVideo` in `src/lib/ai/assistant/videoMapReduce.ts`:
- **Window Sizing**: Segment canonical transcript into timestamped windows of 1,500–3,000 tokens (aligned to sentence / chapter boundaries).
- **Per-Window Token Allocation**: Allocate a guaranteed floor of 150–250 tokens per window summary (never dividing budget by total window count to produce 32-token summaries).
- **Task-Aware Directives**:
  - Global Summary: Extract main narrative arc and key arguments with `[MM:SS]` anchors.
  - Key Points / Outline: Extract distinct theses, evidence items, and conclusions per section.
  - Flashcards / Quiz: Extract high-value conceptual facts and testing targets per section.
- **Hierarchical Reduction Tree**:
  - If the concatenated first-level window summaries exceed `sourceBudgetTokens`, group them in batches of 4 to 6 and summarize recursively.
  - Each reduction step preserves timestamp anchors `[MM:SS]` and attributes late-video conclusions.
- **Resilient Caching**:
  - Cache intermediate window summaries by `hash(windowText) + model + taskType`.
  - Re-use window summaries across turns (e.g. user asks "Key points", then "Summarize", then "Quiz me").
- **Failure Containment**:
  - If an individual child model call fails or times out, retry up to 2 times with exponential backoff.
  - If a child call permanently fails, record the missing window range and return the synthesized result with `coverage: "partial"`, honestly disclosing which time range was missed.

*Alternatives considered:*
- (a) Single-pass truncation to fit budget: rejected because it violates the core requirement of complete source coverage.
- (b) Calling external embedding cluster API: rejected to maintain Plethora's offline/local privacy architecture.

### D6: Honest Coverage Reporting and Per-Turn Diagnostics
Extend response metadata and UI feedback:
- `Message.sourceContext`:
  - `coverage`: `"full"` | `"hierarchical-full"` | `"window"` | `"chunks"` | `"none"`
  - `acquisitionStatus`: `"ready-full"` | `"ready-indexed"` | `"partial"` | `"unavailable"` | `"failed"`
  - `diagnostics`: Structured object containing `{ configuredContextTokens, effectiveContextTokens, promptBudgetTokens, reservedOutputTokens, estimatedSourceTokens, sourceTokensIncluded, windowCount, processingMode }`.
- **UI Presentation**:
  - Direct full context: `Full transcript · [duration] · Direct context`
  - Hierarchical synthesis: `Full transcript · [duration] · Analyzed in sections`
  - Bounded range: `Transcript excerpt · [start]–[end]`
  - Retrieval chunks: `Retrieved passages · [count] sections`
  - Partial / Failed: `Partial transcript · [limitation]` with retry action.
- Suppress misleading `"SOURCE COVERAGE LIMIT: The supplied source content is only a bounded window..."` prompt instructions when `sourceCoverage` is `"full"` or `"hierarchical-full"`.

## Risks / Trade-offs

- [Hierarchical synthesis increases latency and model token consumption on over-budget videos] → Mitigated by caching intermediate window summaries by content hash and model id; follow-up questions hit the cache; targeted questions bypass map-reduce and use localized windows; direct full inclusion is used whenever the transcript fits within the user's configured budget.
- [Cloud providers may rate-limit concurrent window summarization calls] → Bounded concurrency (e.g., maximum 2–3 parallel requests) with staggered backoff.
- [Model context window may be configured larger than the provider model actually supports] → Enforce provider/model metadata limits (e.g. `selectedModelInfo.context_length`) as an upper ceiling during policy resolution, preventing provider HTTP 400 rejection errors.
- [Prompt injection embedded in untrusted transcript text] → All transcript text remains strictly wrapped in `<untrusted_source>` tags with escaped closing delimiters; system prompt explicitly forbids treating source content as executable instructions.

## Migration Plan

1. Frontend and backend logic changes are strictly additive and backward compatible.
2. Existing conversation histories and stored transcripts remain fully valid.
3. No database schema migration required (SQLite tables `youtube_transcripts`, `documents`, and `semantic_chunks` already store full transcripts and segments).
4. Rollback strategy: Clean git revert of the commits; no data repair required.
