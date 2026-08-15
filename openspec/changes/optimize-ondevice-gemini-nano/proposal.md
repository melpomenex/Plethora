## Why

On-device Gemini Nano inference for passage actions (explaining, summarizing, simplifying, key terms, and Q&A) currently suffers from severe latency (15–25 seconds) and poor perceived responsiveness. This is caused by excessive context expansion (adding 3,000 characters around every selection), blocking non-streaming summarization, unconstrained output token budgets (up to 512 tokens at ~15-20 tok/sec), missing speculative warmup, and redundant synchronous IPC calls in the native Android bridge. Optimizing these layers will drop perceived latency to under 1-2 seconds with immediate token streaming.

## What Changes

- **Adaptive Context Window**: Scale surrounding context dynamically based on selection length (avoid adding 3,000 chars when the user already highlighted a full paragraph or multi-sentence passage).
- **Streaming Summarization**: Migrate `summarizePassage` from blocking batch inference to the streaming Prompt API so summary tokens stream immediately into the UI.
- **Concise Prompts & Output Budgets**: Refine prompt templates for high-density, concise responses (1–2 punchy sentences or tight bullet points) and adjust default token caps (`maxOutputTokens`) to avoid runaway mobile generation.
- **Speculative & Predictive Warm-Up**: Trigger background `warmUpOnDevicePrompt()` proactively when text is selected or when the selection sheet opens, eliminating AICore cold-start delays.
- **Native Android Bridge Optimization**: Cache static model token limits and streamline pre-inference checks to remove redundant synchronous IPC round-trips to AICore.
- **System Instruction & Prefix Caching**: Separate static system instructions and prefixes so AICore can leverage KV cache reuse across sequential passage queries.

## Capabilities

### New Capabilities
- `ondevice-passage-ai-optimization`: Optimized on-device passage processing featuring adaptive context windows, streaming summarization, concise prompt presets, proactive warmup, and low-overhead native IPC.

### Modified Capabilities
<!-- No existing spec requirements modified -->

## Impact

- **TypeScript / UI**: `src/lib/ai/passageAI.ts`, `src/lib/ai/onDeviceAI.ts`, `src/components/viewer/SelectionActionsSheet.tsx`.
- **Android / Native**: `src-tauri/plugins/android-genai/android/src/main/java/com/incrementum/androidgenai/AndroidGenAiPlugin.kt`.
- **User Experience**: Sub-second Time-to-First-Token (TTFT) for all passage AI operations on mobile, with complete responses finishing in 3–5 seconds rather than 20+ seconds.
