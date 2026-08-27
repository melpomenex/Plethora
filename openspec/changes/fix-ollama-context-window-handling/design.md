## Context

### The bug

A user running `LFM2.5-8B-A1B` (Q4_K_M) on Ollama with an intended 16K–32K practical context sent an ~8,581-token prompt. Ollama returned HTTP 400:

```text
request (8581 tokens) exceeds the available context size (4096 tokens), try increasing it
```

The model supports a much larger window, but Plethora never configured Ollama's runtime context (`num_ctx`). Ollama loaded the model with its default (often 4096 on ≤24 GiB VRAM hosts).

### Current architecture (verified)

Plethora has **two independent Ollama chat stacks**:

| Stack | Entry | Endpoint | Response shape |
|-------|-------|----------|----------------|
| **A — Tauri commands** | `llm_chat`, `llm_chat_with_context`, `llm_stream_chat` | `{base}/chat/completions` (default base `http://localhost:11434/v1`) | OpenAI-compatible JSON / SSE |
| **B — Internal AI provider** | `OllamaProvider::chat_completion` (QA, summarizer, flashcards) | `{base}/api/chat` (default base `http://localhost:11434`) | Native Ollama JSON |

Both stacks serialize only:

```rust
options: { temperature, num_predict: max_tokens }
```

`num_ctx` is **never set anywhere** in the repository.

### Semantic conflation (root cause)

Three different concepts share one or two fields today:

| Concept | Intended meaning | Current field(s) | Actual behavior |
|---------|------------------|------------------|-----------------|
| Document excerpt budget | How much source text to include in system prompt | `context_window_tokens` | Used in `select_relevant_excerpt` (`tokens × 4` chars) |
| Generation limit | Max new tokens model may emit | `max_tokens` / `provider.maxTokens` | Passed to cloud APIs correctly |
| Runtime context window | Total KV cache / prompt+output capacity | *(missing)* | Ollama default (~4096) |

In `llm_chat_with_context` (`llm.rs:420–451`):

```rust
let requested_max_tokens = context.context_window_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
// ...
llm_chat(..., requested_max_tokens, ...)  // → Ollama num_predict
```

Frontend `chatWithContext` (`api/llm/index.ts:139–153`) makes this worse:

```typescript
const effectiveMaxTokens = maxTokens ?? context.contextWindowTokens ?? 4096;
// ...
contextWindowTokens: effectiveMaxTokens,  // overwrites caller's context window
```

Callers such as `AssistantPanel` pass `provider.maxTokens` as `maxTokens`, so **per-provider output limit replaces the global document context window** in the payload sent to Rust.

### Token budgeting today

Budgeting is **fragmented and incomplete**:

- Frontend: `trimToTokenWindow` (tiktoken), `sectionIndex` (70% of maxTokens), char/4 heuristics
- Rust `build_context_prompt`: excerpt trim only; no history/memory/system budget
- Task RAG (`libraryTask.ts`): fixed 2400-token chunk budget with 1200 reserve — isolated from contextual chat
- No invariant: `system + history + memory + document + user + output_reserve ≤ context_window`

### Ollama API semantics (authoritative)

From [Ollama API docs](https://github.com/ollama/ollama/blob/main/docs/api.md):

- **`options.num_ctx`**: Sets the context window used to generate the next token. Default in Modelfile reference: 2048; server may pick higher defaults based on VRAM. **Per-request `num_ctx` overrides** Modelfile/server default; if it differs from the loaded model, Ollama reloads the model (visible in `load_duration`).
- **`options.num_predict`**: Maximum tokens to predict (output). Not a "make response shorter" knob — a hard cap. Ollama may clamp `num_predict` relative to `num_ctx`.
- **Native `/api/chat`**: Accepts `options` object directly — **reliable** for `num_ctx`.
- **OpenAI-compatible `/v1/chat/completions`**: Does **not** expose Ollama `options` in standard OpenAI fields. Community reports and Plethora's own hybrid body (`OllamaRequest` with nested `options` on `/chat/completions`) show **unreliable or ignored `num_ctx`** on this path. Plethora must not depend on OpenAI-shim behavior for context sizing.

**Decision implication:** Stack A must migrate to native `/api/chat` (matching Stack B), not add `num_ctx` to the hybrid OpenAI body.

### Existing retry logic (broken for this bug)

```rust
fn should_retry_ollama_with_smaller_context(error: &str) -> bool {
    lowered.contains("unexpected eof")
        || (lowered.contains("ollama api error (500") && lowered.contains("api_error"))
}
```

- Triggers on **EOF / HTTP 500**, not on `exceed_context_size` 400.
- Retry clamps both excerpt budget and `num_predict` to **256–512** — makes overflow **worse**, not better.
- Only in `llm_chat_with_context`; streaming has no retry.

### Settings surface today

| Setting | Scope | UI label | Used for |
|---------|-------|----------|----------|
| `settings.ai.maxTokens` | Global | "Context Window (Document Content)" | Frontend trimming; intended prompt budget |
| `LLMProviderConfig.maxTokens` | Per-provider | "Max Tokens" | Output limit; **overrides** context in `chatWithContext` |
| `ModelInfo.context_length` | Discovery metadata | Display only | Not used for runtime; Ollama always `None` |
| `AIModelCapabilities.contextTokens` | Hardcoded | N/A | Ollama fixed at 8192 in `cloudProvider.ts` |

No per-model **configured runtime context** exists for Ollama.

---

## Goals / Non-Goals

**Goals:**

1. Separate **runtime context window**, **prompt budget**, and **max output tokens** in the request model.
2. Ollama receives **`num_ctx`** and **`num_predict`** independently on every chat call.
3. Streaming and non-streaming Ollama paths share **identical** policy → serialization.
4. Both Rust Ollama stacks (`llm.rs` and `providers.rs`) share one adapter/helper.
5. Pre-request budgeting enforces `assembled_prompt + output_reserve ≤ configured_context`.
6. Deterministic trimming before avoidable provider 400s.
7. Cloud providers preserve current **output** token behavior.
8. Ollama settings expose configured context with model maximum (informational) and resource warning.
9. Privacy-safe diagnostics (no prompt/document content in logs).
10. Tests lock in all eight acceptance/regression cases from the bug report.

**Non-Goals:**

- Hardware-specific auto-sizing (no GPU VRAM detection layer in v1).
- Auto-setting context to a model's theoretical maximum (e.g. 131072).
- Unifying whole-library RAG (`askLibrary`) and tutor context in one pass (only shared types/policy hooks).
- Browser/PWA Ollama support.
- Fixing unrelated base-URL bugs (`test_ollama_connection` `/tags` vs `/api/tags`) unless required for context discovery — track as follow-up if out of scope for a task group.

---

## Decisions

### 1. Introduce `LlmRequestPolicy` (provider-independent intent)

New struct (Rust + TypeScript mirror) carried through contextual and plain chat:

```rust
pub struct LlmRequestPolicy {
    /// Runtime context window for providers that allocate KV cache (Ollama num_ctx).
    pub configured_context_tokens: usize,
    /// Maximum tokens allowed for assembled prompt content (excerpt + system + history + memory + user).
    pub prompt_budget_tokens: usize,
    /// Tokens reserved for model output inside configured_context_tokens.
    pub output_reserve_tokens: usize,
    /// Hard cap on generated tokens (Ollama num_predict; cloud max_tokens).
    pub max_output_tokens: usize,
}
```

**Invariants (enforced at assembly time):**

```text
prompt_budget_tokens ≤ configured_context_tokens - output_reserve_tokens
max_output_tokens ≤ output_reserve_tokens   (clamp with warning if user config violates)
assembled_prompt_estimate + output_reserve_tokens ≤ configured_context_tokens
```

**Rationale:** One policy object prevents re-conflation at call sites. Cloud adapters ignore `configured_context_tokens` for HTTP serialization (they don't send `num_ctx`).

**v1 scope gate:** Prompt budgeting assembly (history/memory trim) in Workstream C applies to **Ollama and local providers only** in the first implementation. Cloud contextual chat continues existing excerpt-only Rust behavior until a follow-up explicitly extends budgeting — prevents accidental cloud regression.

**Alternatives considered:**
- *Rename `context_window_tokens` only* — insufficient; field is already overloaded in frontend and Rust.
- *Hardcode `num_ctx: 16384`* — rejected; breaks other hardware and models.

### 2. Resolve policy from layered configuration

Resolution order for **`configured_context_tokens`** (Ollama / local OpenAI-compatible treated as local when base URL is local):

1. **Per-model override** on `LLMProviderConfig` (new field `contextWindowTokens?: number`, keyed by model id in `modelContextWindows?: Record<string, number>`)
2. **Per-provider default** `contextWindowTokens` on Ollama provider config (new field)
3. **Global** `settings.ai.maxTokens` (existing "document context window" — reinterpreted as default **configured runtime context** for local models)
4. **Discovered default** from Ollama `POST /api/show` → Modelfile `PARAMETER num_ctx` (if fetch succeeds)
5. **Conservative fallback:** `8192` (not 4096 — too small for modern local workflows; not 128K — OOM risk)

**`max_output_tokens` resolution:**

1. `LLMProviderConfig.maxTokens` (existing per-provider output setting)
2. `settings.ai.aiControls.maxTokensPerRequest` if wired (currently unused — optionally activate)
3. Default `2048` (matches `DEFAULT_MAX_TOKENS` intent)

**`output_reserve_tokens`:**

- Default `min(max_output_tokens, configured_context_tokens.saturating_sub(MIN_PROMPT_HEADROOM))`
- Where `MIN_PROMPT_HEADROOM = 1024` (minimum tokens always available for prompt content)
- Ensures generation headroom without zeroing prompt budget

**`prompt_budget_tokens`:**

- `configured_context_tokens.saturating_sub(output_reserve_tokens)`
- **Hard invariant:** `prompt_budget_tokens ≥ MIN_PROMPT_HEADROOM` after resolution; if user config violates `max_output + MIN_PROMPT_HEADROOM > configured_context`, clamp `max_output_tokens` downward and surface a settings validation warning (fail fast in settings UI when saving invalid combos)

**Default-settings guard (critical):** Typical installs have `settings.ai.maxTokens = 4096` and `provider.maxTokens = 4096`. Resolution MUST NOT produce `prompt_budget = 0`. Implementation MUST enforce:

```text
configured_context_tokens ≥ max_output_tokens + MIN_PROMPT_HEADROOM
```

If global context is 4096 and provider max output is 4096, auto-raise configured context to `8192` for Ollama **or** clamp max output to `3072` — prefer raising configured context to 8192 on first migration for Ollama providers only.

**"Auto" preset (settings UX):** When user selects **Auto**, resolve configured context as:

```text
min(
  global settings.ai.maxTokens (if > MIN_PROMPT_HEADROOM),
  show_metadata.num_ctx (if available),
  16384  // practical ceiling for Auto — never model theoretical max
)
.clamp(4096, 16384)
```

Display resolved value inline ("Auto → 8192"). Auto MUST NOT mean "use model maximum."

**Model maximum (metadata only):**

- Populate `ModelInfo.context_length` for Ollama via `/api/show` and model card when available
- Display as "Model supports up to N" — **never auto-apply** as configured context

### 3. Migrate Ollama chat in `llm.rs` to native `/api/chat`

Replace `POST {base}/chat/completions` with `POST {normalized_base}/api/chat` for Ollama in:

- `call_ollama_with_url` (non-streaming)
- `stream_ollama` (streaming — parse native NDJSON `message.content` + `done`)

Shared URL helper:

```text
normalize_ollama_base("http://host:11434/v1") → "http://host:11434"
normalize_ollama_base("http://host:11434")   → "http://host:11434"
```

Extract shared serialization to e.g. `src-tauri/src/ai/ollama_chat.rs`:

```rust
pub fn build_ollama_chat_body(
    model: &str,
    messages: &[OpenAIMessage],
    stream: bool,
    policy: &LlmRequestPolicy,
    temperature: f64,
) -> serde_json::Value
```

Body:

```json
{
  "model": "...",
  "messages": [...],
  "stream": true|false,
  "options": {
    "temperature": 0.7,
    "num_ctx": 16384,
    "num_predict": 2048
  }
}
```

**Rationale:** Only native API reliably honors `num_ctx`. Stack B already works this way.

**Alternatives considered:**
- *Keep `/v1/chat/completions` + hybrid body* — rejected; root cause of 4K default persisting.
- *OpenAI `extra_body.options`* — not verified across Ollama versions; native API is authoritative.

### 4. Refactor `llm_chat_with_context` to use policy, not conflated fields

**Before:**

```rust
let requested_max_tokens = context.context_window_tokens.unwrap_or(DEFAULT_MAX_TOKENS);
llm_chat(..., requested_max_tokens, ...)
```

**After:**

```rust
let policy = resolve_request_policy(&provider, &model, &context, provider_max_output, ...);
let budget = assemble_context_with_budget(&context, &messages, &policy, ...)?;
let initial_messages = budget.messages;
llm_chat(..., policy.max_output_tokens, Some(policy), ...)
```

Extend `LLMContextRequest`:

```rust
pub struct LLMContextRequest {
    // existing fields...
    pub context_window_tokens: Option<usize>,  // DEPRECATED: migration shim → prompt_budget hint only
    pub prompt_budget_tokens: Option<usize>,     // NEW
    pub configured_context_tokens: Option<usize>, // NEW (optional override from caller)
    pub max_output_tokens: Option<usize>,         // NEW
}
```

Migration shim (one release):

- If only `context_window_tokens` present: treat as **`prompt_budget_tokens`**, not `max_output_tokens`.
- Log debug warning when shim path used.

**Frontend `chatWithContext` fix:**

```typescript
// STOP overwriting contextWindowTokens with maxTokens
context: {
  promptBudgetTokens: context.contextWindowTokens ?? settings.ai.maxTokens,
  maxOutputTokens: maxTokens ?? provider.maxTokens,
  configuredContextTokens: resolveConfiguredContext(provider, model),
}
```

### 5. Central prompt assembler with deterministic trimming

New Rust module `src-tauri/src/ai/prompt_budget.rs` (name illustrative):

**Assembly order (fixed priority — trim from bottom up):**

| Priority | Component | Trimmable? |
|----------|-----------|------------|
| 1 (keep) | Current user message | No |
| 2 (keep) | User selection / pinned context | No |
| 3 (keep) | Base system instructions | No (may truncate tail with warning if alone exceeds budget — fail instead) |
| 4 | Long-term memory (`MEMORY.md`) | Yes — keep most recent paragraphs first |
| 5 | Retrieved document excerpt | Yes — `select_relevant_excerpt` with **remaining** budget |
| 6 | Conversation history | Yes — drop oldest turns first |
| 7 (reserve) | Output reserve | Never consumed by prompt |

Use **char/4 estimates** in Rust (consistent with existing `estimate_context_chars`) for v1; optionally upgrade to shared tokenizer later.

**On failure:** If components 1–3 alone exceed `prompt_budget_tokens`, return structured error:

```text
This request needs approximately {n} tokens but your configured context allows {budget} for prompts (context {ctx}, output reserve {reserve}). Increase the model context window or reduce selected content.
```

Do **not** silently truncate user message or selection.

**Interaction with frontend pre-trimming:** Frontend may still pre-trim document content; Rust assembler treats incoming `content` as input and applies **final** budget pass. Document in tasks: reduce double-trim aggressiveness in a follow-up task within this change (Assistant 70% + Rust 100% → align frontend to pass raw content or pass `preTrimmed: true` flag).

### 6. Replace Ollama retry logic

**Remove** `should_retry_ollama_with_smaller_context` shrink-to-512 behavior entirely.

**New error classification:**

| Error pattern | Action |
|---------------|--------|
| `exceed_context_size`, `exceeds the available context size` | **No retry.** Surface user-facing message with configured vs required tokens. Suggest increasing context in settings. |
| `unexpected eof`, transient network | Optional **single** retry with identical policy (not smaller context) |
| HTTP 500 Ollama OOM / OOM | User message: lower configured context or use smaller model — **do not** auto-shrink silently |

### 7. Cloud provider mapping (no regression)

| Provider | `configured_context_tokens` | `max_output_tokens` |
|----------|----------------------------|---------------------|
| OpenAI / OpenRouter / DeepSeek / custom OpenAI-compatible | Ignored for HTTP body | Maps to `max_tokens` (unchanged) |
| Anthropic | Ignored | Maps to `max_tokens` (unchanged) |
| Gemini | Ignored | Maps to generation config max output (unchanged) |
| Ollama | **`options.num_ctx`** | **`options.num_predict`** |

Plain `llm_chat` without context: still passes `max_output_tokens` only; for Ollama also pass `configured_context_tokens` from provider settings.

### 8. Settings UX

**LLMProviderSettings** — when provider type is `ollama`:

- **Context window** numeric input + presets: Auto | 4K | 8K | 16K | 32K | 64K | Custom
- **Read-only line:** "Model maximum: {N} tokens" when `/api/show` or discovery provides it
- **Helper text:** "Higher context uses more GPU/RAM. Start with 8K–16K for 8 GB GPUs."
- Keep existing **Max tokens** field labeled clearly as **"Max response tokens"**

**AIProviderSettings** global context window:

- Relabel to clarify it is the **default for local model context**, not cloud output length.

Do **not** add RTX-specific defaults.

### 9. Diagnostics (debug level only)

Structured log fields:

```text
provider, model, configured_context, prompt_budget, output_reserve, max_output,
estimated_prompt_tokens, ollama_num_ctx, ollama_num_predict
```

Never log: message bodies, document excerpts, memory file content, RAG chunks.

On Ollama 400 context errors, log provider raw error at **debug level only**; user-facing and stream error events receive sanitized messages built from assembler estimates (never regex-parsed provider bodies that may echo input). Streaming (`LLM_STREAM_ERROR`) MUST NOT forward full Ollama JSON to the frontend.

### 10. Unify `OllamaProvider` (Stack B) with shared adapter

Refactor `ai/providers.rs::OllamaProvider::chat_completion` to call the same `build_ollama_chat_body` + `/api/chat` parser. Pass `LlmRequestPolicy` resolved from synced native config.

**Stack B config sync:** Extend `LocalSettings` / `set_ai_config` with `ollama_context_tokens` (and optional per-model map). `syncPrimaryProviderToNativeAI` MUST sync configured context alongside base URL and model name. Stack B default `num_ctx` when unset: use Ollama show metadata or **4096** (conservative — do not blindly inherit global 8192 migration bump; avoids OOM on GPUs where 4K worked).

**Stack B vs Stack A defaults:** Stack A (user-facing assistant) may migrate Ollama providers to 8192 configured context. Stack B (background QA/summarizer) uses synced provider config when present, otherwise conservative 4096 until user configures.

---

## Proposed request flow

```text
User / settings
  settings.ai.maxTokens (global default)
  LLMProviderConfig.contextWindowTokens (per Ollama provider)
  LLMProviderConfig.modelContextWindows[modelId] (optional)
  LLMProviderConfig.maxTokens (output)
        │
        ▼
Model metadata (informational)
  Ollama POST /api/show → Modelfile num_ctx, model card context_length
        │
        ▼
resolve_request_policy()
  configured_context_tokens
  prompt_budget_tokens
  output_reserve_tokens
  max_output_tokens
        │
        ▼
assemble_context_with_budget()  ← llm_chat_with_context
  trim: memory → excerpt → history
  preserve: user msg, selection, core system
        │
        ▼
llm_chat / llm_stream_chat
        │
        ├─ Ollama ──► POST /api/chat
        │              options.num_ctx  = configured_context_tokens
        │              options.num_predict = max_output_tokens
        │
        └─ Cloud ──► existing adapters
                       max_tokens = max_output_tokens
                       (no num_ctx)
```

---

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Larger default context causes GPU OOM | Conservative defaults (8K); explicit user configuration; warning in UI; do not auto-use model max |
| Model reload latency when `num_ctx` changes | Document in UI; optionally cache last-used `num_ctx` per model session |
| `/api/chat` streaming parse differs from OpenAI SSE | Dedicated parser; parity tests; remove dead `OllamaStreamChunk` OpenAI types or repurpose |
| Migration breaks callers using `context_window_tokens` as output limit | Shim + deprecation warning; grep all call sites in tasks |
| Double trimming (frontend + Rust) over-strips context | **Blocking** task 3.9: Rust assembler is authoritative; frontend passes raw/scoped content or `preTrimmed` flag; remove parallel `effectiveContextWindow` heuristics for Ollama |
| Zero prompt budget at 4096/4096 defaults | MIN_PROMPT_HEADROOM + migration bump Ollama to 8192 or clamp max output |
| Stack B OOM from silent 4K→8K | Stack B uses synced config or conservative 4096 default |
| Browser backend drift | Explicit task to align `browser-backend.ts` shim semantics (Tauri-only Ollama; browser rejects Ollama but context fields should not conflate) |
| Char/4 estimate drift vs Ollama tokenizer | Accept for v1; use provider error as backstop; future: Ollama tokenize API if needed |
| Cloud regression on max_tokens | Explicit Test 6; no change to cloud serialization path except threading policy struct |

---

## Migration Plan

1. **Phase 1 — Types & policy resolver** (TS + Rust), shim old fields, no behavior change yet — verify tests.
2. **Phase 2 — Ollama adapter** (`num_ctx`, `/api/chat`), behind no flag (direct fix).
3. **Phase 3 — `llm_chat_with_context` decoupling** + prompt assembler.
4. **Phase 4 — Settings UI** + Ollama `/api/show` discovery.
5. **Phase 5 — Remove retry shrink logic** + improved errors.
6. **Phase 6 — Delete deprecated shim** after all call sites updated (may remain one release with warnings).

**Rollback:** Revert to previous `llm.rs` Ollama path (restores bug but safe for cloud-only users).

---

## Open Questions

1. **Should `configured_context_tokens` live on every provider or Ollama-only?** Recommendation: store on all providers for unified policy, but only serialize to Ollama. Others ignore at HTTP layer.
2. **Wire `maxTokensPerRequest` global fallback?** Low cost if already in UI — decide during implementation.
3. **Consolidate base URL normalization** (`/v1` stripping, broken connection test) in same change or follow-up? Recommendation: fix normalization helper shared by chat + show + tags in Workstream B to avoid `/api/show` on wrong URL.

---

## Adversarial review (pre-implementation)

Findings incorporated above:

| Finding | Resolution |
|---------|------------|
| Hybrid `/chat/completions` may ignore `num_ctx` | Decision 3: migrate to `/api/chat` |
| `chatWithContext` overwrites context with output limit | Decision 4: separate fields |
| Retry shrink makes 400 worse | Decision 6: remove shrink retry |
| Cloud `max_tokens` could break if policy passes context to all providers | Decision 7: explicit adapter table |
| Hardcoded 8192 capability misleads task layer | Decision 2 + update `cloudProvider.ts` |
| Theoretical model max → OOM | Decision 2: metadata only, never auto-apply |
| Privacy in diagnostics | Decision 9: field whitelist only |
| Streaming/non-streaming divergence | Decision 3 + shared `build_ollama_chat_body` |
| Frontend/Rust double trim | Risk table + **blocking** task 3.9 |
| Zero prompt budget at 4096/4096 defaults | MIN_PROMPT_HEADROOM + Ollama migration bump (Decision 2) |
| Undefined "Auto" preset | Auto resolution formula in Decision 2 |
| Cloud history trimming regression | v1 gate: Ollama-only assembler (Decision 1) |
| Stack B missing config sync | Decision 10 + tasks 2.5–2.6 |
| Streaming error privacy leak | Decision 9 + task 4.5 |
| Browser backend drift | Task 6.7 |
| `llm_chat_with_context` ignores temperature | Out of scope note — do not fix opportunistically unless trivial |

---

## Alternatives considered (summary)

| Alternative | Why rejected |
|-------------|--------------|
| Hardcode `num_ctx: 16384` | Fixes one machine; leaves abstraction broken |
| Set `num_ctx` on OpenAI-compatible endpoint only | Unreliable per Ollama community + Plethora hybrid body |
| Use only frontend trimming, no Rust budget | History/memory bypass frontend; Rust is authoritative boundary |
| Remove global `settings.ai.maxTokens` | Too disruptive; reinterpret as default configured context |
| Auto-scale context from GPU VRAM | No robust cross-platform capability layer exists |
