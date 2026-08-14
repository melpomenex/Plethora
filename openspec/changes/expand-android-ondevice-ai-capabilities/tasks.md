## 1. Prerequisite and Android toolchain spike

- [x] 1.1 Confirm the implemented `add-android-ondevice-llm-bridge` plugin, TypeScript SDK, settings, and live Pixel verification are present before starting this change
- [x] 1.2 Inspect the newest ML Kit Prompt, schema/compiler, Kotlin Gradle plugin, and KSP metadata requirements and record a candidate compatible version matrix in `docs/android-build-notes.md`
- [x] 1.3 Attempt the coordinated Prompt/Kotlin/KSP upgrade without changing generated Android files beyond the documented project-level toolchain pin
- [x] 1.4 Compile the existing `android-genai`, `android-tts`, and `folder-import` Kotlin plugins with the candidate toolchain and fix only compatibility issues required by the upgrade
- [x] 1.5 Build a signed universal release APK and verify R8 retains Tauri commands, ML Kit public APIs, and any structured-output DTOs
- [x] 1.6 If the upgrade is unsafe, restore the build-verified beta2 dependency, document which optional features remain unavailable, and continue with the beta2-supported scope — not required: the beta4/Kotlin 2.2.21/KSP 2.3.11 release build and R8 verification passed
- [x] 1.7 Add a build-time/runtime feature constant that distinguishes the structured-output-capable implementation from the delimited-output fallback without device-name checks

## 2. Native capability and runtime metadata contract

- [x] 2.1 Define Rust and Kotlin DTOs for independent Prompt, Summarization, and image-Prompt feature states plus optional runtime feature flags
- [x] 2.2 Replace the native weakest-status calculation with isolated feature checks whose failures affect only their own capability
- [x] 2.3 Expose Prompt base model name, total token limit, structured-output support, system-instruction support, prefix-cache support, image support, and streaming support when the selected SDK provides them
- [x] 2.4 Add feature-scoped model download requests so callers can download only the adapters required by the requested action
- [x] 2.5 Preserve no-side-effect status checks and make download completion invalidate the affected feature state
- [x] 2.6 Add a typed `ondevice_ai_capabilities` Rust command and non-Android stub returning `platform_unsupported` for every feature
- [x] 2.7 Update plugin permissions, generated permission references, and frontend capability types for the new command
- [x] 2.8 Add Rust tests for capability serialization, non-Android results, and partial-capability snapshots
- [x] 2.9 Add Kotlin tests or extracted pure mapping tests for independent `FeatureStatus` conversion and optional-feature negotiation

## 3. Configurable Prompt request, token accounting, and warm-up

- [x] 3.1 Define the Rust/Kotlin native Prompt request envelope with request ID, text, optional prefix/image, generation settings, output mode, optional system instruction, and streaming flag
- [x] 3.2 Define the native response envelope with text, finish reason, measured input tokens, model identity, and optional structured payload
- [x] 3.3 Build ML Kit `GenerateContentRequest` objects from supported temperature, seed, candidate-count, maximum-output-token, prefix, and system-instruction options
- [x] 3.4 Expose native `countTokens` for the complete configured request and return measured count plus runtime limit
- [x] 3.5 Reject over-limit requests before inference with `context_too_large` and measured count/limit metadata
- [x] 3.6 Expose an explicit foreground Prompt warm-up call that performs no generation
- [x] 3.7 Return candidate finish reasons and fail closed when a structured result terminates incomplete
- [x] 3.8 Retain the existing summarize/prompt commands as compatibility wrappers over the expanded implementation during call-site migration
- [x] 3.9 Add Kotlin/Rust tests for request serialization, option bounds, exact-token result forwarding, over-limit rejection, and finish reasons

## 4. Native streaming, cancellation, queueing, and errors

- [x] 4.1 Implement request-scoped Kotlin streaming callbacks that trigger ordered text, complete, and error plugin-listener events keyed by request ID
- [x] 4.2 Register each active or queued native inference in a bounded single-consumer FIFO registry
- [x] 4.3 Add `ondevice_ai_cancel` and cancel the actual ML Kit future with `cancel(true)` for an active request
- [x] 4.4 Remove a cancelled queued request before inference and suppress all late callbacks after any terminal state
- [x] 4.5 Guarantee one terminal event per streaming request and release registry entries after complete, error, cancellation, or plugin teardown
- [x] 4.6 Map ML Kit errors into stable codes for busy, battery quota, background use, safety, invalid image/context, cancellation, model availability, and generic inference failure
- [x] 4.7 Implement bounded exponential backoff with jitter only for `busy`, with cancellation checked before every retry
- [x] 4.8 Add plugin permissions and Rust forwarding for start/cancel/warm-up/token-count commands
- [x] 4.9 Add deterministic tests for event ordering, queue capacity, queued cancellation, active cancellation, late-callback suppression, retry bounds, and teardown cleanup

## 5. Capability-aware TypeScript SDK and provider routing

- [x] 5.1 Add the typed capability snapshot, short TTL cache, transient-state bypass, and invalidation after download or feature errors
- [x] 5.2 Replace provider-wide routing with `resolveAiPath(requirement)` for Prompt, Summarization, and image Prompt while preserving `ai.preferOnDevice`
- [x] 5.3 Add a generic Prompt client that subscribes before start, filters plugin events by request ID, assembles streamed text, and always removes listeners
- [x] 5.4 Wire `AbortSignal` to the native cancel command and distinguish user cancellation from fallback-worthy failure
- [x] 5.5 Add token-budget helpers that estimate candidate boundaries but use native full-request counts and reserve requested output tokens before inference
- [x] 5.6 Add prefix-cache and warm-up helpers with capability checks and explicit cache clearing on session/data reset
- [x] 5.7 Expand the on-device run store from chunk-only progress to queued, warming, generating, retrying, and cancelling phases without regressing existing UI
- [x] 5.8 Preserve action-specific cloud fallback messages and avoid generic API-key errors when an on-device capability is downloadable or temporarily unavailable
- [x] 5.9 Add Vitest coverage for partial-capability routing, TTL behavior, event isolation, listener cleanup, native cancellation, retry/fallback policy, and measured re-chunking

## 6. Structured output, validation, and card quality

- [x] 6.1 Define native structured-output DTOs for grounded flashcards, tag suggestions, and occlusion proposals when the accepted toolchain supports them
- [x] 6.2 Implement runtime negotiation that uses structured output only when both build and device support are present
- [x] 6.3 Extend delimited fallback formats and parsers with source evidence/provenance while retaining compatibility with valid output from the first change
- [x] 6.4 Add an internal on-device card shape carrying evidence quote, source chunk index, validation results, and model provenance before mapping to `GeneratedFlashcard`
- [x] 6.5 Validate required card fields, non-empty cloze deletions, normalized evidence occurrence in source, allowed card type, and requested instruction constraints
- [x] 6.6 Deduplicate normalized Q&A and cloze cards across chunks before enforcing the requested count
- [x] 6.7 Replace missing/self-reported confidence handling with a deterministic acceptance result so unvalidated on-device cards cannot silently pass a configured quality threshold
- [x] 6.8 Preserve `requireApproval`, pending-card, draft-card, and explicit-save behavior for every on-device generation surface
- [x] 6.9 Add parser/validator tests for structured and fallback output, evidence normalization, malformed/incomplete results, instruction fidelity, and cross-chunk duplicates

## 7. Passage Q&A and explanation

- [x] 7.1 Add focused `answerPassage` and `explainPassage` task adapters with bounded context, concise prompts, streaming, and source provenance
- [x] 7.2 Use resolved selection and section context from Document Q&A as the source for eligible on-device questions
- [x] 7.3 Change the Document Q&A provider gate so bounded passage questions can run with Prompt and no cloud credentials
- [x] 7.4 Preserve existing whole-library RAG when no bounded source is selected and preserve cloud/tool routing for web search or database mutations
- [x] 7.5 Reuse unchanged bounded document context as a Prompt prefix when prefix caching is supported and clear it when the session/source changes
- [x] 7.6 Render partial answers and cancellation state without persisting incomplete assistant messages or leaking results into a later session
- [x] 7.7 Preserve selection/section citations and source-location navigation on on-device answers
- [x] 7.8 Add tests for passage eligibility, section provenance, over-budget narrowing, whole-library/web/tool exclusions, streaming completion, and cancellation cleanup

## 8. Extract, article, and tag workflows

- [x] 8.1 Add bounded `extractKeyPoints` and `generateStudyQuestions` Prompt adapters with structured and validated fallback results
- [x] 8.2 Route Extract Inbox summary, key points, and questions independently so one failed subtask does not hide successful results
- [x] 8.3 Add an article-summary adapter that preserves key-points/actionable/background focus and chooses Summarization versus Prompt according to requested shape
- [x] 8.4 Route RSS scroll summaries through capability-aware AI while preserving existing summary cache, favorites persistence, and cloud fallback
- [x] 8.5 Add a `suggestTags` Prompt adapter with allowed categories, normalization, bounded output, and deterministic basic-tag fallback
- [x] 8.6 Route import-time AI tag suggestions on-device when Prompt is available and keep all suggestions opt-in
- [x] 8.7 Label cached summaries and analysis results with on-device/model provenance without persisting prompts or source copies
- [x] 8.8 Add tests for independent extract subtasks, summary focus/length negotiation, cache behavior, tag validation, no-provider behavior, and fallback

## 9. Flashcard Studio and review assistance

- [x] 9.1 Extend the flashcard task adapter to accept the Studio's custom prompt, requested card type, count, topic focus, and difficulty separately from source context
- [x] 9.2 Update the on-device Studio branch to pass those instructions rather than deriving only a count
- [x] 9.3 Show validation/provenance state on generated drafts without presenting model self-confidence as calibrated quality
- [x] 9.4 Add `generateReviewHint` with a no-direct-answer constraint and a bounded validation rule for Q&A and cloze cards
- [x] 9.5 Add `explainCard` using the revealed card answer and available bounded source context
- [x] 9.6 Add review UI actions, loading/streaming state, and cancellation when the user advances, closes review, or starts another assistance action
- [x] 9.7 Ensure review assistance never mutates card content, rating, schedule, history, or due state
- [x] 9.8 Add tests for Studio instruction fidelity, approval gating, hint answer leakage checks, alternate explanations, review-state immutability, and stale-response prevention

## 10. Native image Prompt support

- [x] 10.1 Add bounded image payload fields and typed `invalid_image`/`image_too_large` errors to the Kotlin/Rust Prompt envelope
- [x] 10.2 Validate supported MIME types and encoded-size bounds before crossing the frontend/native boundary
- [x] 10.3 Decode image payloads natively, apply orientation, downscale to a configurable maximum dimension, and preserve aspect ratio
- [x] 10.4 Construct ML Kit single-image Prompt requests and expose image capability independently from text Prompt
- [x] 10.5 Support bounded multi-image requests only when the accepted SDK and runtime advertise them; otherwise require separate runs
- [x] 10.6 Release bitmaps on complete, error, cancellation, queue rejection, and plugin teardown
- [x] 10.7 Exclude image bytes/data URLs and related prompt/completion content from native logs and diagnostics
- [x] 10.8 Add native and TypeScript tests for MIME/size checks, decode failure, dimension bounding, single/multi-image negotiation, cancellation cleanup, and serialization

## 11. Image study surfaces

- [x] 11.1 Add `describeImage` and searchable-metadata adapters that return reviewable text/labels without overwriting user-authored Image Registry fields
- [x] 11.2 Add explicit Image Registry actions to preview and accept generated description/title/tag suggestions
- [x] 11.3 Add `generateImageCards` and route selected Image Registry assets through the existing Flashcard Studio draft/approval flow with asset provenance
- [x] 11.4 Add `suggestOcclusions` with typed or validated normalized rectangles and optional labels/rationales
- [x] 11.5 Route the image-occlusion composer to on-device image Prompt when available and a configured cloud vision provider otherwise
- [x] 11.6 Pass every proposal through the existing bounds, minimum-area, and duplicate normalizer and land results only in the suggestion layer
- [x] 11.7 Require explicit acceptance before image metadata, card drafts, or occlusion suggestions become committed data
- [x] 11.8 Disclose cloud image fallback before upload when the action was explicitly selected as private/on-device only
- [x] 11.9 Add tests for metadata non-overwrite, card asset provenance, separate-run behavior, occlusion normalization/history preservation, explicit acceptance, and fallback disclosure

## 12. Evaluation, diagnostics, and verification

- [x] 12.1 Add deterministic evaluation fixtures for articles, extracts, Q&A/cloze cards, diagrams, noisy OCR, supported languages, adversarial formatting, and over-budget inputs
- [x] 12.2 Add a device evaluation runner that records task, base model, feature flags, parse/grounding/duplicate results, first-token latency, total latency, and cancellation latency
- [x] 12.3 Add privacy-preserving production diagnostics containing only task/model/capability metadata, counts, timing, finish reason, and error code
- [x] 12.4 Add tests proving diagnostics and logs exclude source text, prompts, completions, image bytes, and data URLs
- [x] 12.5 Run the full frontend test suite, TypeScript compile, Rust app tests, plugin crate tests, and script tests
- [x] 12.6 Run `npm run bench:check` and update performance baselines only if an intentional measured change is justified
- [x] 12.7 Run desktop `cargo check`/Tauri build to verify Android dependencies remain fully gated
- [x] 12.8 Build and sign the universal Android release APK and verify R8, merged manifest, package size, and all existing Android plugins
- [x] 12.9 On the Pixel 9 Pro XL, record capability snapshot, base model/token limit, text streaming, real cancellation, passage Q&A, extract/article/tag/review tasks, and single-image tasks
- [x] 12.10 Verify cloud fallback and no-crash behavior on an unsupported or partially supported Android configuration when hardware/device lab access exists
- [x] 12.11 Record per-task quality/latency acceptance thresholds and keep automatic acceptance disabled for tasks that do not meet them
- [x] 12.12 Remove compatibility summarize/prompt wrappers only after every call site and test uses the expanded contract
- [x] 12.13 Update Android build notes, AI settings/help text, privacy disclosures, and the design's open questions with measured results and accepted dependency versions
- [x] 12.14 Run `openspec validate expand-android-ondevice-ai-capabilities --strict` and resolve every schema or delta-spec error
