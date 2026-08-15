## 1. Adaptive Context Windowing & Warmup in Viewer

- [x] 1.1 Update `passageAroundSelection` in `src/components/viewer/SelectionActionsSheet.tsx` to dynamically scale context (no extra padding when selection is $\ge 150$ characters; bounded $\le 300$ characters when selection is $< 150$ characters).
- [x] 1.2 Trigger speculative background warmup via `warmUpOnDevicePrompt()` upon opening `SelectionActionsSheet` when on-device Prompt AI is available.
- [x] 1.3 Update tests in `src/components/viewer/__tests__/SelectionActionsSheet.test.tsx` to verify adaptive context sizing and proactive warmup.

## 2. Streaming Summarization & Concise Prompt Templates

- [x] 2.1 Update `summarizePassage` in `src/lib/ai/passageAI.ts` to stream tokens incrementally using `onDevicePrompt` with a concise summarization prompt.
- [x] 2.2 Refine prompt templates for `explainPassage`, `simplifyPassage`, `keyTermsPassage`, and `answerPassage` in `src/lib/ai/passageAI.ts` to prioritize concise, high-density outputs.
- [x] 2.3 Set `MAX_OUTPUT_TOKENS = 192` for standard passage actions to prevent runaway generation latency on mobile.
- [x] 2.4 Update unit tests in `src/lib/ai/__tests__/passageAI.test.ts` to verify streaming summarization, token ceilings, and grounding checks.

## 3. Native Android Bridge Optimizations

- [x] 3.1 Cache model `tokenLimit` in `AndroidGenAiPlugin.kt` so subsequent prompts do not incur synchronous IPC calls.
- [x] 3.2 Add fast-path prompt preparation in `preparePrompt` to bypass synchronous `countTokens()` IPC for input texts under 500 characters.
- [x] 3.3 Wire `systemInstruction` directly into native prompt requests to enable AICore prefix/KV caching.
- [x] 3.4 Verify Kotlin unit tests in `src-tauri/plugins/android-genai/android/src/test/` for prompt preparation and token limit caching.

## 4. Verification & Quality Gates

- [x] 4.1 Run all TypeScript unit and integration tests (`npm test`).
- [x] 4.2 Verify performance benchmarks and bundle budgets via `npm run bench:check`.
- [x] 4.3 Verify Android plugin build and compile checks.
