## Why

Asking about the main themes in an indexed library can fail with `Task ask-library produced structured output that failed validation: empty response (provider body had no content)`. An empty generation response is being presented as an undifferentiated structured-output failure, leaving the user unable to tell whether retrieval worked or why answer generation failed.

## What Changes

- Preserve normalized completion metadata across native and browser LLM transports so the task runner can distinguish empty final content, output-limit exhaustion, provider refusal, and malformed JSON.
- Make Ask Library's output budget use the selected generator's resolved configuration and available context rather than always overriding it with 1,200 tokens. Keep source assembly and repair within the same request budget.
- Use the existing single repair attempt for bounded, cause-aware recovery. Preserve both attempts' safe failure details, stop on cancellation or explicit refusal, and prevent hidden transport retries from multiplying requests or overriding configured limits.
- Distinguish “sources were found, but the model failed to answer” from missing embeddings or missing evidence in the Q&A failure state, with actionable existing settings/retry paths.
- Add native/browser boundary fixtures and an end-to-end task regression for “What are the main themes in my library?” with indexed evidence from multiple documents, including recovery from an initially empty final response.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ai-task-architecture`: Define response metadata normalization and bounded recovery for empty or truncated structured responses, with content-free diagnostics and preserved terminal error causes.
- `library-qa`: Distinguish answer-generation failure from unavailable evidence and require theme-question regression coverage with retrieved, validated citations.

## Impact

- Task execution and diagnostics: `src/lib/ai/tasks/runTask.ts`, task/provider types, `src/lib/ai/diagnostics.ts`, and their tests. Shared behavior must retain existing agent and native structured-output contracts.
- Library orchestration: `src/lib/ai/tasks/definitions/libraryTask.ts`, request-policy resolution, and library task tests.
- Response boundary: `src/api/llm/index.ts`, `src/lib/ai/providers/cloudProvider.ts`, `src/lib/browser-backend.ts`, and `src-tauri/src/commands/llm.rs`, including native serialization and OpenAI-compatible response fixtures.
- Q&A presentation: assistant result/error adapters, `src/components/tabs/DocumentQATab.tsx`, and localized error copy as needed. Reuse existing controls; no new Settings controls or dependencies are planned.
- No embedding rebuild, index migration, or change to the library citation schema is required. This change does not introduce a new library-wide topic-clustering or representative-sampling algorithm; theme answers remain explicitly grounded in retrieved evidence.

The supplied error and source inspection identify defects in metadata, budgeting, and failure reporting. The user's active provider, model, and live response are not yet known, so the proposal does not claim a confirmed provider-specific root cause.
