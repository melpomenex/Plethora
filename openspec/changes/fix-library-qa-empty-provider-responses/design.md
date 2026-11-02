## Context

See `proposal.md` for the reported failure and scope. Source inspection establishes the following:

| Evidence | Current behavior | Consequence |
| --- | --- | --- |
| `src/lib/ai/tasks/runTask.ts:439-589` | Empty final text enters strict-JSON repair; repair uses the same output cap. Non-cancellation repair errors and failed validation return `undefined`. | The final error repeats the initial failure, hiding the repair's outcome. |
| `src/lib/ai/tasks/definitions/libraryTask.ts:55-60,311-337` | Ask Library declares a 1,200-token output cap; context policy reads the first enabled configuration even when a provider is explicitly supplied. | Source allocation and output allowance can differ from the selected generator's configuration. |
| `src-tauri/src/commands/llm.rs:2707-2714,2764-2773` and `src/api/llm/index.ts:71-85,114-126` | Native serialization emits `finish_reason` and snake-case usage fields; TypeScript expects camel case and returns the IPC value directly. | Native stop reason and usage are lost to consumers reading the declared TypeScript shape. |
| `src/lib/tauri.ts:35-38,405-428` | Native invocation returns the response unchanged. | There is no general casing conversion that repairs this mismatch. |
| `src/lib/browser-backend.ts:4883-4928` | Browser chat maps usage but omits stop reasons; missing content becomes an empty string. | Browser generation loses the information needed to identify truncation or explicit refusal. |
| `src-tauri/src/commands/llm.rs:1613-1720,1844-1923` | The OpenAI helper silently retries empty content at 8,192 tokens; the separate OpenRouter helper returns empty content directly. | Recovery differs by transport and may happen below the task runner without respecting its allowance. |
| `src/lib/ai/tasks/definitions/libraryTask.ts:337-411` | When no eligible chunks survive and no grounding passage exists, generation is skipped. | The reported generation error alone does not diagnose an embedding failure. |

These are verified code defects and constraints, not proof of the user's specific upstream response. No live provider call or inspection of the user's index has occurred.

## Goals / Non-Goals

**Goals:**

- Make response metadata reliable enough to drive recovery and explain failures.
- Resolve Ask Library's provider and budget consistently, retaining validated citation grounding and existing scope/privacy boundaries.
- Recover from an empty or truncated response within the existing single repair allowance, and expose an honest terminal outcome when recovery cannot succeed.
- Cover the reported themes question through the real task pipeline, plus the native/browser boundary shapes that idealized provider fakes miss.

**Non-Goals:**

- Rebuilding embeddings, changing embedding models, migrating the index, or modifying semantic ranking based only on a generation error.
- Exhaustive topic analysis, topic clustering, or representative sampling of the whole corpus. A retrieved subset cannot prove which topics dominate every library document.
- Relaxing `libraryAnswer` validation, rendering reasoning text as an answer, synthesizing success from a refusal, or automatically switching provider/model.
- New Settings controls, paid live evaluation infrastructure, or a repository-wide provider refactor.

## Decisions

### 1. Normalize at the LLM API boundary and keep old native payloads compatible

Add an explicit raw response shape and normalizer in `src/api/llm/index.ts`. Accept existing native snake-case fields and browser camel-case fields, returning the canonical TypeScript `LLMResponse` shape. Normalize usage as well as stop reason because safe budget diagnostics depend on both. Keep missing metadata optional for old runtimes and transports; normalize equivalent token-limit reasons to `length` and treat unknown values conservatively.

Update browser response parsing to preserve stop reason and extract final answer text from supported text content shapes. Add only bounded indicators for explicit refusal, tool-only output, and reasoning-without-final-text where those are actually present in the response. Carry these indicators through `CloudProvider` into `AIResponse`; never copy tool arguments or reasoning text into answer content or diagnostics. Native paths need the same safe indicators, with serde defaults for compatibility.

Alternative considered: change all native serialization to camel case. Boundary normalization avoids breaking existing native consumers and gives browser/native parity in one place. A TypeScript-only test returning a hand-written camel-case object is insufficient; tests must use serialized native fixtures.

### 2. Freeze the answering provider and resolve one budget before source assembly

Resolve the actual generator once using the existing routing/pinned-provider facilities. Obtain its request policy from its frozen configuration or provider capability snapshot through a small shared policy accessor. Do not infer the generator's budget from an unrelated first-enabled store entry. Preserve retrieval-only behavior without resolving a generator.

For Ask Library, use the configured provider/model output allowance bounded by its context capacity; remove the unconditional 1,200-token override as the effective ceiling. Keep a conservative task default for providers without an output-policy value. Compute the source budget after reserving output, system instruction, schema, question, bounded history, wrappers, optional selection, and bounded repair overhead. The same resolved provider and allowance must reach `runTask` and its repair request. Never silently increase the user's configured ceiling or rebuild evidence with a different provider halfway through the request.

Recovery can raise an initially smaller task allowance only when the already-resolved policy leaves room. If it does not, request a compact answer within the ceiling and report output exhaustion if unsuccessful. Do not introduce a magic 8k minimum for small on-device contexts.

Alternative considered: raise `ASK_LIBRARY_MAX_OUTPUT_TOKENS` globally to 8,192. This can overflow small contexts and ignore configured limits while leaving lost metadata and hidden retries untouched.

### 3. Own task recovery in one layer

Retain the shared contract: one initial generation and at most one corrective generation per provider execution. Extend the internal repair result to carry the validated response on success or a bounded typed failure summary on failure. Keep the original and corrective attempt metadata separately, so success diagnostics describe the answer actually accepted and terminal diagnostics do not lose the second failure.

Use a small optional task-managed-recovery request flag through `AIRequest`, `LLMRequest`, IPC, and native helpers. Task-managed calls disable the hidden native empty-content retry; omitted flags preserve legacy direct-chat behavior until separately migrated. Browser transports remain single-shot. Assert HTTP request counts in transport tests, not just calls to a fake provider.

| Observed response | Corrective behavior | Terminal behavior |
| --- | --- | --- |
| Valid structured object or valid strict JSON | None | Return only validated output. |
| Empty final text with `length` or explicit reasoning-only indicator | Use the one corrective attempt with a compact final-JSON instruction and the resolved allowance. | Preserve output-exhaustion or reasoning-only diagnosis; never render reasoning. |
| Empty final text without a known cause | Use the one corrective attempt requesting a nonempty JSON answer. | Preserve an empty-response code without guessing an embedding or token cause. |
| Nonempty malformed or schema-invalid output | Keep existing strict validation, bounded salvage where valid, and one JSON repair. | `InvalidStructuredOutput`, with safe first/last failure kinds. |
| Explicit refusal or safety block | No corrective call designed to bypass the refusal. | `SafetyBlocked`. |
| Cancellation | No further call. | `Cancelled`. |
| Timeout or provider error during correction | No additional task retry. | Preserve the mapped terminal category and safe code, rather than replacing it with the first parse error. |
| Tool-only response for a task without tools | Treat as an output-contract failure, using at most the existing correction. | No tool execution and no fabricated answer. |

The two-call bound applies per selected provider execution. Existing consent-controlled local/cloud fallback remains subject to its current policy; this change neither adds a new fallback nor reclassifies cancellation or refusal into a retryable output error.

Alternative considered: add an extra empty-response retry before normal JSON repair. That produces stacked paid requests and still permits the native helper to add another hidden request.

### 4. Carry failure stage and retrieval counts to the existing Q&A surfaces

When eligible budgeted chunks exist but generation fails, attach bounded typed context to the error: stage `generation`, evidence count, retrieval mode, provider identity/model where already allowed, attempt count, and failure kind. A hook or adapter may retain evidence for source display, but must not label it as a completed synthesized answer. Preserve the existing empty-evidence branch and its scope-specific copy.

Map this context into short localized copy in Document Q&A and the assistant's library flow. Example: “Found library sources, but the AI model returned no answer.” Add an output-limit explanation only when metadata supports it. Reuse the current retry and AI Settings navigation; do not suggest rebuilding embeddings for this error. Keep details available through existing diagnostics without exposing raw exception strings or source content.

Alternative considered: only rewrite the global validation message. That would hide the distinction between malformed JSON, no final content, no indexed evidence, and a corrective request failing for another reason.

### 5. Test boundaries as well as validators

- Serialize real native response structs and feed equivalent snake-case fixtures through `chatWithLLM` and `CloudProvider`; cover stop reason, usage, absent metadata, and browser parity.
- Exercise empty/null/whitespace final content, text-part arrays, explicit refusal, tool-only output, reasoning-only completion, truncation, and provider failure during correction with sanitized fixtures.
- Run Ask Library with a multi-document indexed fixture for the themes question. Include an initially empty, length-limited response followed by a valid compact JSON answer citing both documents. Validate source ids, quotes, ordinals, and deep links through production validation and adapters. Assert selected-provider budgets and exact corrective call count.
- Cover two empty responses, invalid citations, no evidence, restricted documents, local-only/excluded documents, cancellation during correction, and timeout. No failure may become an unsupported successful answer or expand source authorization.
- Keep a real selected-provider themes-query reproduction as an implementation acceptance check when that runtime is available. Record only provider/model, sanitized response category, counts, budget, and stop reason. Deterministic tests do not establish that an unknown live provider has recovered.

## Risks / Trade-offs

- [Shared task runner regression] → Keep defaults for unrelated tasks, preserve native structured output and existing agent protocol tests, and enable new budget behavior specifically for Ask Library.
- [Larger responses increase latency/cost] → Respect the selected configuration, context, timeout, and single corrective attempt; test actual transport request counts.
- [Repair prompt exceeds context] → Reserve bounded correction overhead before fitting sources and check both attempts against the same policy.
- [Provider omits metadata] → Preserve `unknown` as a valid diagnosis and never infer refusal, reasoning, or missing embeddings from empty text alone.
- [Diagnostic data leakage] → Whitelist enums and counters; exclude raw prompts, chunks, completions, reasoning, endpoints, credentials, and arbitrary error strings from persisted diagnostics.
- [Top-k evidence is not representative of the entire library] → Make theme claims conditional on the retrieved sources and retain incomplete-index disclosures; handle representative corpus analysis as separate work.

## Migration Plan

1. Add compatible metadata normalization and contract fixtures.
2. Integrate task-owned recovery, selected-provider budgeting, diagnostics, and failure presentation with regression coverage.
3. Run focused frontend/native checks and the repository benchmark gate; perform the themes-query runtime check when available and document any limitation.
4. No stored-data migration is required. Rollback is a code revert; existing embeddings and user settings remain usable.

## Open Questions

- Which provider/model and platform produced the reported response? Capture this during runtime verification if accessible; the fix and fixture matrix cover native and browser paths regardless.
- Did that response report output exhaustion, refusal, or reasoning-only output? Until observed, preserve it as unknown rather than declaring a provider-specific root cause.
