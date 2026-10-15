## Context

`add-android-ondevice-llm-bridge` introduced a Tauri Android plugin around ML Kit GenAI Summarization and Prompt, a TypeScript SDK that chunks text, and provider routing for summaries and flashcards. The shipped bridge deliberately kept a small contract: one combined status, one fixed summarizer, one free-form `String -> String` prompt call, and a user-initiated model download.

That contract now constrains both device reach and product usefulness. Summarization and Prompt can have different availability, yet the weaker status disables both. The Prompt client already exposes runtime token limits/counting, base-model identity, request configuration, warm-up, prefix caching, image input, streaming callbacks, and cancellable futures, while the bridge uses none of them. The frontend consequently guesses token counts, cannot stop an active inference, cannot render partial output, and cannot diagnose quality differences between Nano versions.

Several Incrementum surfaces are also still cloud-only even though they operate on short bounded inputs that fit Nano well: selected-passage Q&A, Extract Inbox key points/questions, RSS summaries, tag suggestions, and review hints. Image Registry and the image-occlusion composer already provide a natural destination for single-image Prompt input.

Constraints:

- The current `android-genai` change is a prerequisite; this change must be applied after it and must preserve its cloud fallback and non-Android stubs.
- AICore is device-, model-, language-, and feature-gated. No device-name allowlist is authoritative; runtime capability checks are.
- Inference is foreground-only, quota-limited, and expensive enough that work must remain user-visible and cancellable.
- Prompt context is small and differs by Nano version. Token limits must be queried from the actual client.
- The Android project currently pins Kotlin 2.2.20 and ML Kit Prompt beta2. Newer structured-output/system-instruction APIs may require a coordinated Kotlin/KSP upgrade.
- Image assets can be large data URLs. The bridge must bound decoded bytes and dimensions before constructing an ML Kit image part.
- Generated learning material is never authoritative. Existing review/approval semantics and cloud fallback must remain intact.

## Goals / Non-Goals

**Goals:**

- Represent on-device AI as a matrix of independently usable capabilities rather than one provider-wide boolean.
- Expose enough of the native Prompt runtime to budget accurately, stream output, cancel real work, diagnose model-specific quality, and support text-plus-image tasks.
- Route each UI action according to its required capability and input modality.
- Add high-value, bounded study workflows that continue to work offline and keep source material on the device.
- Produce grounded, reviewable cards/tags/occlusion proposals and make malformed or unsupported output fail closed.
- Add repeatable evaluation fixtures and device diagnostics before expanding automatic use.
- Preserve desktop/iOS builds and existing cloud behavior.

**Non-Goals:**

- On-device embeddings, whole-library RAG, or replacement of the existing retrieval pipeline.
- Sending complete large PDFs/books through Nano or promising cloud-equivalent long-context synthesis.
- Web-grounded answers, tool execution, or automatic database mutations from free-form Nano output.
- Background import indexing or unattended batch inference.
- Speech recognition, proofreading/rewriting product surfaces, or general-purpose translation in this change.
- Exposing raw chain-of-thought or enabling preview-only thinking mode in production.
- Requiring structured output, multi-image input, or system instructions on devices that do not advertise them.

## Decisions

### 1. Replace combined status with an action-oriented capability snapshot

The native status command returns a snapshot with independent feature states and runtime metadata:

```ts
interface OnDeviceCapabilitySnapshot {
  prompt: FeatureState;
  summarization: FeatureState;
  imagePrompt: FeatureState;
  structuredOutput: boolean;
  systemInstructions: boolean;
  streaming: boolean;
  prefixCaching: boolean;
  baseModelName?: string;
  tokenLimit?: number;
  checkedAt: number;
}
```

`FeatureState` retains `available | downloadable | downloading | unavailable` plus a machine-readable reason. Feature-specific checks are isolated: a failed summarizer check cannot hide an available Prompt client. The frontend caches snapshots with a short TTL, does not cache `downloading`, and invalidates after downloads or feature-related errors.

The provider resolver becomes `resolveAiPath(requirement)` where `requirement` identifies the operation (`prompt`, `summarization`, or `image-prompt`) and whether streaming/structured output is preferred. Optional features select an output strategy; they do not make the entire action unavailable.

*Alternative rejected*: retain the weakest combined status and let callers try commands. It creates false negatives on devices with asymmetric feature support and turns routine capability negotiation into exceptions.

### 2. Add one configurable Prompt request envelope, keeping task logic in TypeScript

The Kotlin/Rust boundary adds a general request/response envelope rather than a native command per product feature:

```ts
interface NativePromptRequest {
  requestId: string;
  text: string;
  promptPrefix?: string;
  image?: BoundedImagePayload;
  temperature?: number;
  seed?: number;
  maxOutputTokens?: number;
  candidateCount?: number;
  outputMode?: "text" | "flashcards" | "tags" | "occlusions";
  systemInstruction?: string;
  stream?: boolean;
}

interface NativePromptResponse {
  requestId: string;
  text: string;
  finishReason?: string;
  inputTokens?: number;
  baseModelName?: string;
  structured?: unknown;
}
```

Kotlin owns ML Kit objects, capability negotiation, image decoding, native token counting, and structured DTOs. TypeScript owns Incrementum task prompts, chunk selection, hierarchical reduction, output validation, and mapping into app models. This keeps product behavior testable without an emulator while avoiding duplicated ML Kit plumbing.

The existing summarize/prompt commands remain as compatibility wrappers during migration and are removed only after all call sites move.

*Alternative rejected*: add native `generateTags`, `answerPassage`, `generateCards`, and similar commands. That would embed product prompt policy in Kotlin and require device tests for every wording change.

### 3. Query the real token budget and verify every request natively

The SDK uses the client's `getTokenLimit()` and `countTokens(request)` rather than treating four characters as a token. Chunking can still use the existing estimator to propose boundaries cheaply, but every final native request is counted with its prompt prefix, system instruction, image overhead where reported, and requested output allowance. Oversized requests return a typed `context_too_large` result with the measured counts; the TypeScript task adapter subdivides or reduces them.

The model identity and token limit are included in diagnostics and evaluation records, never source text.

*Alternative rejected*: replace the heuristic with a JavaScript tokenizer. Nano tokenization and limits can change by model version, and shipping a second tokenizer can still disagree with AICore.

### 4. Stream through plugin listener events and cancel the actual future

For a streaming request, Kotlin invokes ML Kit with `StreamingCallback` and calls the Tauri mobile plugin's listener trigger with events keyed by `requestId`:

- `ondevice-genai://text` — appended response text
- `ondevice-genai://complete` — final metadata and finish reason
- `ondevice-genai://error` — typed terminal failure

The frontend subscribes with Tauri's plugin-listener API before starting the request and always removes listeners after a terminal event. Kotlin keeps an in-flight registry from `requestId` to the returned future. `cancelRequest(requestId)` calls `future.cancel(true)`, removes queued work, and guarantees that later callbacks for the request are ignored. Non-streaming callers continue to await one response.

Only one inference executes at a time. A bounded FIFO queue prevents competing model sessions; cancellation removes queued entries as well as active work.

*Alternative rejected*: retain `AbortSignal` checks only between chunks. It leaves multi-second work and battery use running after the UI says it was cancelled.

### 5. Treat structured output and newer Prompt features as progressive enhancement

The first implementation task is a build spike against the newest compatible ML Kit Prompt/Kotlin/KSP combination. The upgrade is accepted only if the signed release build, existing Android plugins, desktop build, and R8 checks pass. If the latest Prompt artifact cannot be adopted safely, beta2 still provides single-image input, runtime token APIs, generation configuration, prefix caching, streaming, and cancellation, so most of this change proceeds.

When `isStructuredOutputFeatureAvailable()` is true, native Kotlin schemas are used for cards, tags, and occlusion regions. Otherwise task adapters request a terse delimited format and pass it through strict tolerant parsers. System instructions and multi-image requests are used only when their runtime feature checks succeed. Thinking mode remains disabled.

*Alternative rejected*: make the entire change depend on the newest alpha structured-output stack. That would couple high-value beta2 features to a larger generated-code/toolchain migration and reduce device reach.

### 6. Use focused task adapters, not a general on-device chat provider

The frontend adds adapters with narrow contracts:

- `answerPassage(question, context)` and `explainPassage(context, instruction)`
- `extractKeyPoints(context)` and `generateStudyQuestions(context)`
- `summarizeArticle(context, options)`
- `suggestTags(context, title)`
- `generateReviewHint(card)` and `explainCard(card)`
- `describeImage(image)`, `generateImageCards(image, context)`, and `suggestOcclusions(image, hint)`

Prompts use short instructions, explicit delimiters, low temperature for extraction, and few-shot examples only where evaluation proves they help. Repeated passage context is supplied as a prompt prefix when caching is available. Conversation history is intentionally shallow and included as text; this is not presented as unconstrained multi-turn chat.

Document Q&A uses Nano only when the question is bound to selected text, selected sections, or a context that fits after chunk selection. Whole-library, web-enabled, and tool-creating requests retain the existing cloud/RAG flow.

*Alternative rejected*: add Nano to the existing general `LLMProviderType`. That interface assumes cloud-sized context, unconstrained chat, and tool behavior that the on-device runtime does not provide reliably.

### 7. Make generated study artifacts grounded and review-first

Card-generation output carries an evidence quote and source chunk index internally. The validator checks required fields, verifies that evidence is present in the source after normalization, rejects empty cloze deletions, and deduplicates normalized question/answer pairs across chunks. Cards then map into the existing draft shape with provenance; automatic flows respect `requireApproval`, and output without a reliable validation score cannot bypass approval merely because the global threshold is configured.

Tag suggestions validate the enum/category and normalize tag text. Occlusion suggestions validate finite normalized coordinates, bounds, minimum area, and duplicates, and always land in the existing suggestions layer. No image-generated artifact is saved or committed without an explicit user action.

Flashcard Studio passes the user's requested card type, difficulty/focus, and custom instruction into the adapter instead of using only the requested count.

*Alternative rejected*: trust model-provided confidence. A self-reported number is not calibrated across Nano versions and is not a defensible quality gate.

### 8. Bound images before crossing into inference

Image Registry remains the source of image assets. The frontend rejects unsupported MIME types and obviously oversized payloads before invoking native code. Kotlin decodes into a bounded bitmap, applies orientation, downscales to a configured maximum dimension while preserving aspect ratio, and releases the bitmap after inference. Raw image bytes, prompt text, and completions are excluded from logs and diagnostics.

Image descriptions and cards may use the feature-specific Image Description API later, but this change uses Prompt image input so the same task contract can request explanations, study cards, metadata, and region proposals. If image Prompt is unavailable, the action uses a configured cloud vision provider or reports that no compatible path exists.

*Alternative rejected*: send original unbounded data URLs to every request. That duplicates large buffers across the webview/native boundary and raises avoidable memory/crash risk.

### 9. Map native failures into retry and fallback policy

Kotlin maps ML Kit error codes into stable app codes including `busy`, `battery_quota_exceeded`, `background_use_blocked`, `safety_blocked`, `context_too_large`, `cancelled`, `model_unavailable`, and `inference_failed`. Only `busy` receives bounded exponential backoff with jitter; cancellation and background/battery/safety failures are not retried. The action-aware router falls back to cloud when configured and otherwise presents a specific recoverable message.

Finish reasons such as maximum tokens are returned even when partial text exists. Task adapters decide whether a partial result is usable; structured artifacts fail closed if incomplete.

### 10. Evaluate by task and Nano version before widening automatic use

A deterministic fixture corpus covers articles, extracts, cards, diagrams, noisy OCR, multiple languages, adversarial formatting, and over-budget inputs. Evaluation records parse rate, grounding/validation pass rate, duplicate rate, latency to first token, total latency, cancellation latency, and base model name. Expected source inputs live in test fixtures; production diagnostics store only timing, capability, error, count, and model metadata.

Manual device verification includes the connected Pixel 9 Pro XL and at least one unsupported or partially supported configuration when available. New automatic-save behavior remains disabled until the relevant task meets its recorded acceptance threshold.

## Risks / Trade-offs

- **Kotlin/KSP upgrade destabilizes Android plugins or generated Gradle files** → isolate it as the first spike, pin exact build-verified versions, run a signed release build, and retain a beta2 fallback plan.
- **Feature states differ across devices and can change after downloads** → expose independent states, use TTL caching, and invalidate on download/error.
- **Streaming events race with cancellation or component teardown** → key every event by request ID, require one terminal state, ignore late callbacks, and clean listeners in `finally`/unmount paths.
- **Native token counting adds round trips** → estimate to form candidate chunks, count only final requests, and reuse counts/prefix caches within a run.
- **Prefix caches retain document text in app-private storage** → scope caches to active sessions/documents, expose cache clearing, and clear them on sign-out/data reset or user request.
- **Image inference increases transient memory** → bound encoded bytes/dimensions, downscale natively, serialize inference, and release bitmaps promptly.
- **Nano outputs vary by model version** → record `baseModelName`, use strict validators, keep review-first semantics, and evaluate per version.
- **AICore quota or foreground restrictions interrupt workflows** → keep actions user-initiated, map specific errors, use bounded retry only for busy, and retain cloud fallback.
- **Image-occlusion coordinates may be imprecise** → mark them experimental, clamp/validate proposals, land only as suggestions, and require visual acceptance.
- **Scope spans many UI surfaces** → implement behind task adapters and capability flags in phases; each surface can roll back independently to its current cloud path.

## Migration Plan

1. Finish and retain `add-android-ondevice-llm-bridge`; record its live Pixel verification as the baseline.
2. Run the Prompt/Kotlin/KSP compatibility spike and lock the supported feature set for this change.
3. Add the expanded native request/status contracts alongside compatibility commands, plus non-Android stubs.
4. Add the capability-aware TypeScript SDK, streaming/cancellation, token accounting, validators, and evaluation fixtures.
5. Migrate existing on-device summary/card call sites, then add text study adapters one surface at a time.
6. Add bounded single-image input and the image study surfaces behind runtime capability checks.
7. Verify supported-device, partial-capability, unsupported-device, desktop, release/R8, test, and performance gates.
8. Remove compatibility wrappers only after all call sites and tests use the new envelope.

Rollback is per surface: disable the new capability flag or restore that action's existing cloud-only route. The old summarize/prompt wrappers remain until the final migration task, so a native rollback does not require data migration.

## Open Questions

- Which exact ML Kit Prompt/Kotlin/KSP versions pass the signed release build and all existing Android plugin checks?
- Does the Pixel 9 Pro XL advertise structured output and system instructions with the selected stable model, and what base model name/token limit does it report?
- What maximum decoded image dimension gives acceptable diagram understanding without memory pressure on the Pixel 9 Pro XL?
- What measured thresholds should gate automatic card acceptance for parse/grounding success and duplicate rate?
- Should explicit prefix caches be retained for the lifetime of a Document Q&A session or use implicit caching only for the first release?
