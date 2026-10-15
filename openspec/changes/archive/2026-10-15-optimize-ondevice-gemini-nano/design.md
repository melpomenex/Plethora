## Context

Incrementum provides on-device AI capabilities on Android powered by Gemini Nano through Android's AICore service and ML Kit GenAI. Users can highlight passages in documents, books, and transcripts to explain, summarize, simplify, extract key terms, or ask grounded questions.

Currently, passage actions on Android take 15–25 seconds to complete. Profiling the execution path identified five compounding bottlenecks:
1. **Context Expansion Bloat**: `passageAroundSelection` adds 1,500 characters before and 1,500 characters after every selection unconditionally (~1,000 tokens of prefill compute).
2. **Blocking Summarization**: `summarizePassage` invokes ML Kit's non-streaming batch API, showing a spinner with zero token progress for 8–15 seconds.
3. **Unconstrained Generation Length**: Prompts request "2-3 short paragraphs" with `MAX_OUTPUT_TOKENS = 512`. On mobile NPUs generating at ~15-20 tok/sec, 300 tokens takes 15-20 seconds.
4. **Cold Start Latency**: The native model is loaded lazily on first user interaction without proactive warmup (1.5–2.5s delay).
5. **Native Synchronous IPC Overhead**: `AndroidGenAiPlugin.kt` runs two blocking synchronous IPC calls (`countTokens` and `getTokenLimit`) before every inference request.

## Goals / Non-Goals

**Goals:**
- Sub-second Time-to-First-Token (< 1.0s) for all passage AI operations.
- Total generation completion within 3–5 seconds for standard explanations and summaries.
- Immediate live streaming output for summaries, explanations, simplifications, key terms, and Q&A.
- Zero cold-start latency when users tap an AI action in the selection sheet.
- Minimal prefill token overhead and reduction in native bridge IPC overhead.

**Non-Goals:**
- Replacing Gemini Nano or AICore with third-party on-device runtimes (e.g. llama.cpp / onnxruntime) in this change.
- Changes to cloud AI provider endpoints or cloud response formats.
- Global document-level re-indexing or whole-book batch summarization.

## Decisions

### 1. Adaptive Context Windowing in Selection Sheet
- **Current**: Appends 1,500 chars before and 1,500 chars after every selection regardless of length.
- **Decision**: In `passageAroundSelection`:
  - If selected text is $\ge 150$ characters (a sentence or full paragraph), use the selection directly without adding surrounding padding.
  - If selected text is $< 150$ characters (a term, clause, or short phrase), add at most 250–300 characters of surrounding context.
- **Rationale**: Significantly reduces prompt prefill token counts by 60–80%, cutting prefill latency and keeping Gemini Nano's attention focused on the highlighted text.

### 2. Streaming Summarization via Prompt API
- **Current**: `summarizePassage` calls `summarize(text)` which uses the non-streaming `Summarization.getClient()` or non-streaming prompt.
- **Decision**: Update `summarizePassage` in `passageAI.ts` to use `onDevicePrompt` (`generateStreamingPrompt`) with a dedicated concise summary prompt template. Reserve multi-chunk hierarchical summarization only for multi-page documents.
- **Rationale**: Gives users immediate visual feedback as tokens arrive (< 600ms TTFT) instead of an unresponsive spinner.

### 3. Concise Prompt Templates & Budget Ceilings
- **Current**: Prompts ask for "2-3 short paragraphs" and permit up to 512 output tokens.
- **Decision**:
  - Set `MAX_OUTPUT_TOKENS = 192` for standard passage actions.
  - Revise prompt instructions to request high-density, punchy answers (e.g., "Explain in 1-2 clear, direct sentences for a mobile study card" / "List 3 key takeaways").
- **Rationale**: Generating 60–90 tokens at 18 tok/sec finishes in ~3.5–5 seconds rather than 18–20 seconds.

### 4. Speculative Foreground Warmup on Selection
- **Current**: `warmUpOnDevicePrompt()` exists in `onDeviceAI.ts` but is never called.
- **Decision**: When `SelectionActionsSheet` mounts or opens, trigger `warmUpOnDevicePrompt()` in a non-blocking `void` call in the background.
- **Rationale**: Warms up AICore service connection and loads model weights into memory while the user is glancing at the menu, eliminating the 1.5–2.5s cold start when an action is selected.

### 5. Native Bridge Caching & Fast-Path Inference
- **Current**: `preparePrompt` in `AndroidGenAiPlugin.kt` runs synchronous `prompt().countTokens().get()` and `prompt().getTokenLimit().get()` on every prompt call.
- **Decision**:
  - Cache `tokenLimit` atomically after first lookup for the lifetime of the plugin instance.
  - For inputs under 500 characters, skip synchronous `countTokens()` IPC on the inference thread before starting the stream since they are guaranteed to be within the 4,096 limit.
  - Pass static system instructions into `systemInstruction` / `promptPrefix` to allow AICore prefix caching where supported.
- **Rationale**: Saves 150–300ms of synchronous IPC latency per request.

## Risks / Trade-offs

- **[Risk: Extremely concise explanations may miss nuanced details]**
  → *Mitigation*: The "detailed" preset option remains available with an explicit 256–384 token ceiling for users who request in-depth analysis.
- **[Risk: Background warm-up battery drain]**
  → *Mitigation*: Warmup is strictly gated to active user selection sheet opens, debounced, and does not run idle background timers.
- **[Risk: Insufficient context for ambiguous short terms]**
  → *Mitigation*: Short selections (< 150 chars) retain 250–300 characters of local sentence boundary context.
