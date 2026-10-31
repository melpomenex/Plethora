# Design — fix-learning-agent-model-routing-and-tool-orchestration

All anchors refer to `7a53b069146730ba8116544a2e1d1da72dfc3525`.

## 1. Current execution sequence (verified walkthrough)

```
AssistantPanel "Cards from this section"   (submitLearningAgentRequest)
  → buildAgentSection()  resolves condensed section text + bodies (canonical loader)
  → resolveLearningAgentScope(input) → FrozenLearningAgentRun (sources, section, sourceRevision)
      generation: { providerId: "unresolved" } at this point
  → preflightLearningAgent({documents, forceKind?, explicitRetry?})
      kind  = forceKind ?? resolveAiPath("prompt")
      route = resolveTaskRoute(agentRunnerTask, { kind })        ← first textGeneration-capable
                                                              provider of that kind
      provider = route.provider; providerId = provider.id
      cloud?: classify against getActiveCloudConfig()          ← FIRST enabled config,
                                                              NOT the picker selection
      privacy/billing gate (enforceAssistantPrivacyAndConsent)
  → bindLearningAgentPlan(run, preflight)   → generation pinned to route provider
  → runLearningAgent(run, {provider})
      [if run.section && options.provider] budgetScopedBodies(...)  ← may throw
  → createFrozenAgentEnvironment(run)
  → runAgentLoop({intent, env, provider, deadline, guard, bounds})
      loop: maxTurns = bounds.maxToolCalls(8) + 2
        turn: runTask(agentRunnerTask, {intent, transcript, remaining…})
          route via runTask (provider pinned → no router)
          generation: cloud → strict-JSON text mode
            system = containment + core instruction + agentToolCatalogText()
                     + STRICT_JSON_PREAMBLE + AGENT_TURN_SCHEMA.json (example prose)
        validate AgentTurn (shape only; empty turn VALIDATES)
        execute toolCalls under bounds (registry allowlist, per-tool validate/execute)
        progress = executedThisTurn (≥1 registered + bounds-accepted call)
        2 consecutive no-progress turns → finish("turn-budget", "Stopped: repeated turns made no usable tool calls.")
        runTask InvalidStructuredOutput → finish("invalid-turn", "…could not produce a valid turn after repair…")
        finalAnswer → finish("final-answer", answer)
      proposals recorded into session (AgentEvidenceMap handles)
  → AssistantPanel renders LearningAgentRunView (+ proposals) and acceptance board
```

Observed failure chains:

- **Failure A**: model turn contains no calls/answer (or only unregistered names) ×2 → `turn-budget` stop, no corrective feedback beyond raw transcript.
- **Failure B**: provider returns non-JSON/empty/truncated text → parse fails → `repairOnce` (original input + errors only, same 1400-token cap) → still invalid → `InvalidStructuredOutput` → immediate run stop.
- Both messages are also reachable in ways the wording misdescribes (e.g. an empty refusal body from Gemini is Failure B; placeholder echo `finalAnswer:"string (omit…)"` ends the run "successfully").

## 2. Corrected execution sequence

For **scoped generation actions** (`scope ∈ {section}`, and section-bearing scenes of other families where the frozen run resolved a section/selection):

```
preflight (now selection-driven, see §3)
  → runLearningAgent
      ① deterministic seat:
         evidence = env.getSectionContext() (or getSelection)  [existing env, frozen]
         handle   = evidence.register({kind:"selection", recordId:"section:<locator>",
                                       text, documentId, locator, sourceRevision})
         seed     = wrapUntrustedBlock("frozen-section-<handle>",
                                       budgeted section text)      [existing budget path]
         transcript₀ = [seed]
      ② runAgentLoop unchanged mechanically from here (same bounds/guard/deadline)
  → first turn can directly emit propose_* calls citing the seeded handle
```

For **library-scope and exploratory actions** (related material, missing prerequisites, papers planning) the loop starts with `transcript₀ = []` exactly as today; search remains the model's job. That preserves honest scope boundaries: nothing outside the frozen set is ever claimed as read.

The session's evidence map is the single authority for handles; the seed registers through the same `AgentEvidenceMap.register` a read tool uses — no new persistence, no new schema, no path bypassing `resolveProposalSources`.

## 3. Provider-routing architecture

### 3.1 Selection contract

```ts
// assistant/learningAgent.ts
export interface LearningAgentRouteSelection {
  /** Assistant model/picker id: AssistantProviderId | "ondevice-*" map resolved first. */
  providerId: string;              // e.g. "gemini" | "ollama" | "openrouter" | APPLE_FM constant
  /** Resolved live config for that provider type, frozen at submit (deep-copied). */
  config: LLMProviderConfig;       // provider, model, apiKey, baseUrl, contextWindow*, maxTokens…
  kind: "ondevice" | "cloud";      // "cloud" even for Ollama/localhost (status quo preflight)
}
```

`submitLearningAgentRequest` passes `effectiveProvider` + the matching `LLMProviderConfig` (the **same lookup the chat path already does** at lines ~2505+ of AssistantPanel.tsx). Missing/disabled/keyless-missing config fails preflight typed:

```
code: "no-model" | "no-provider" (existing blocker shapes)
message: "The selected {provider} model is not configured for this run…" + recovery
```

`preflightLearningAgent` changes signature to accept `{ selection?: LearningAgentRouteSelection }`. With a selection present it MUST NOT consult `getActiveCloudConfig()`/`getRoutingProviders()` for generation; it classifies the **selection's** config (`classifyCloudDestination` unchanged) and runs the existing privacy/billing gates on that destination. On-device native ids (`ondevice-apple-foundation`, Windows, nano) keep resolving through `resolveTaskRoute` for a native provider *instance* — the id still pins the destination class, and the pinned-model question does not arise for managed native models.

### 3.2 Pinned provider instance

```ts
// providers/cloudProvider.ts — additive factory, no behavior change to the singleton
export class PinnedCloudProvider implements AIProvider {
  readonly id = `${CLOUD_PROVIDER_ID}:${config.id}`;   // diagnostics-visible
  readonly kind = "cloud" as const;                    // unchanged legacy semantics
  constructor(private readonly config: LLMProviderConfig) {}   // snapshot, never re-read store
  getCapabilities(): capabilitiesFromCloudConfig(this.config)
  generateStream(request): identical wire path to CloudProvider, from this.config
}
```

`runLearningAgent` pinning stays as-is (`options.provider`), but it now receives the pinned instance. Two effects:

1. **No mid-run drift**: `getActiveCloudConfig()` re-reading per request (the verified drift surface for concurrent chat/agent traffic) cannot alter a pinned run.
2. **Diagnostics honesty**: every `runTask` response now carries the pinned id `"cloud-llm:<configId>"` and `baseModelName = config.model`; the run result exposes both; the guard keeps comparing the *frozen* values (it already reads that snapshot) against the **same** config object rather than re-reading global state — a settings edit mid-run is a `destination-changed` stop exactly as today.

Escape hatch: an explicit user Retry on cloud keeps `forceKind` but selection comes from the same submit context — implementers must never invent a (provider, model) pair the user did not have active.

### 3.3 Routing rule (normative)

`resolveTaskRoute` remains unchanged for unpinned callers; only Learning Agent preflight opts into selection-pinning. All other AI features keep today's behavior (protected by the "don't change unrelated provider behavior" constraint); a follow-up may generalize the pinning helper if other features adopt it.

## 4. Agent-turn output contract

The `servedModelClass` does not define usable output; the contract does.

```ts
// schemas/agentTurn.ts
export interface AgentTurn {
  kind: "tools" | "final-answer";        // classified by the validator, not emitted by the model
  toolCalls: AgentToolCall[];
  finalAnswer?: string;
  proposalsEmitted?: number;
}
```

The model still emits its two forms; classification is derived:

```ts
export function validateAgentTurn(output: unknown): ValidationOutcome<AgentTurn> {
  // 1. isRecord; 2. toolCalls array ≤ 4; each {tool: string ≤64, input: object | undefined}
  // 3. finalAnswer: optional non-empty string ≤ 4000
  // 4. proposalsEmitted optional 0..100
  // 5. NEW: unknown keys are tolerated (forward compat) but errored keys fail as today
  // 6. NEW: shape-valid but NEITHER calls NOR answer → ok:false error "turn: empty protocol turn"
  //         (an explicit, typed failure — runTask repair path below)
  // 7. unknown tool names remain ACCEPTED (in-contract rejection at the registry, per header doc;
  //    do not burn repair retries on hallucinated names)
}
```

Renaming/keeping the `AgentTurn` interface keeps call sites compiling; classification replaces the implicit empty semantics.

**Prompt descriptor replacement (`AGENT_TURN_SCHEMA.json`)**: generated, not hand-written:

```
"AgentTurn — respond with ONE JSON object, one line, no prose or fences.
Rules: EITHER toolCalls OR finalAnswer; never both placeholder text and calls;
tool must be one of the registered names above; input parameters are documented
above; omit unknown BEHAVIOR fields; compact JSON only.

Valid example (from a seeded flashcard run — values are REALISTIC, never copied):
{"toolCalls":[{"tool":"propose_flashcard","input":{"question":"What is the gravitational entropy of a system?","answer":"Entropy is a measure of disorder in a closed system.","cardType":"qa","sourceHandle":"s1"}}]}

Final-answer example: {"toolCalls":[],"finalAnswer":"Proposed 5 cards from Chapter 1."}
No valid example includes the strings \"tool_name\" or \"omit while still calling tools\"."
```

Rules for the descriptor (test-enforced): no placeholder literal strings; the example is a **real, validator-passing payload** produced in the test suite itself (never drifts); enum of tool names in the catalog text; per-tool parameter lines from descriptors (§5); mandatory "compact, one line" and "EITHER/OR" semantics; explicit "if you cannot act, finish with a short finalAnswer".

Placeholder-echo hardening (defense in depth): the catalog example must not contain `tool_name`; the validator ALSO flags `tool === "tool_name"` (exact literal) as a validation error — a model literally copying the old example fails fast with a precise message instead of fed-through `rejected` no-progress cycles.

## 5. Tool schema representation (single source of truth)

```ts
// tools/types.ts — additive
export interface AgentToolArgDescriptor {
  name: string;
  type: "string" | "number" | "boolean" | "enum" | "string[]" | "object";
  required: boolean;
  /** Model-facing one-liner; ≤ 90 chars. */
  description: string;
  enum?: readonly string[];
  maxLength?: number;       // mirrors requireString bounds
  example?: string;         // simple literal, no content from user sources
}
export interface AgentToolDefinition<I> { /* existing fields + */ parameters?: readonly AgentToolArgDescriptor[] }
```

Producers:

```ts
// registry.ts
export function buildAgentToolCatalogText(): string {
  //  "-  toolName (category): description
  //     args: query: string (required, ≤400); sourceHandle: handle (optional)"
}
export function buildAgentToolSchemas(): unknown  // future native tool schema map — declared, unused until a
                                                  // provider capability is wire-verified (§13)
```

Consistency gate (test, § tasks): for every registered tool, generate a small state-machine of invalid inputs (unknown key, wrong type, over-limit, missing required, wrong enum) from **`parameters` only**, and assert `tool.validate` rejects each — proving descriptor ↔ validator agreement without weakening the runtime validators (they stay enforceable; descriptors describe the same reality).

This replaces hand-writing drift-prose parameter lists; unknown-parameter rejection (`rejectUnknownParams`) and caps are untouched.

## 6. Source-context preparation and deterministic seating

- The trimmed section is produced exactly as today (`budgetScopedBodies` on frozen bodies) but **inside the loop's guarded region** (fixes the outside-try throw, V14): if the trimmed content cannot fit, the run ends with a typed `finish("prepared-failure"→ mapped to "error", category "SourceUnavailable")` — a source-specific user message — instead of an unhandled throw.
- Seeding registers the evidence entry; the untrusted block carries a stable id `frozen-section-s1` and the disclosure text the budget produced (including the `[Selected body truncated…]` marker when applicable — already used by the existing tool path).
- `get_section_context` and `get_current_selection` remain registered (nice for re-resolution and for runs seeded from selection only); their re-execution is idempotent and cheap.
- Digest accounting: the diagnostics record `sectionSeededChars` (a length, not text), `sectionTruncated: boolean`, and `seedPlaceCount` so "did the model receive the intended section context" (acceptance #13) is answerable without content.

## 7. Deterministic vs iterative execution (decision)

Action family map (from the real registry + example chips):

| Intent family | Mode | Notes |
|---|---|---|
| Cards from this section (section scope) | **seeded loop** | deterministic seat + propose tools; quantity policy §7.1 |
| Cloze quiz on this paper (document scope, no section) | agentic | retrieval/section tools remain the entry point; quantity policy applies to proposal budget exhaustion |
| Missing prerequisite concepts (library) | agentic | search-driven; cannot be seeded |
| Related material in my library (library) | agentic | search-driven |
| Cards from the attached papers (papers) | agentic (list disclaimer) | `list_attached_sources` + planning behavior unchanged |
| Quiz me on this section (family where section may exist) | agentic w/ seed | final-answer Q&A behavior unchanged from system instruction |
| generic free-form chat in agent mode | agentic | unchanged |

No second flashcard engine is introduced; the seeded loop is the same `runAgentLoop` + same proposal tools + same acceptance pipeline. Duplicating the validated learn-this pipeline (a second candidate-generation path) was rejected for maintainability (one canonical candidate flow, existing preview/caps, retry-safe acceptance).

### 7.1 Card quantity policy (decision)

- Unspecified → the system instruction descriptor for batch runs states a default target of **5 high-value cards** (agent instruction: "typically 3–6, never mass-create"); nothing hard-deletes the word "fewer" today except the run descriptor ("Propose at most a few") — this line is replaced with the count-aware instruction since the old line conflicted with the quantity policy.
- Explicit count in the user's intent ("make 10 cards") → target = min(10, proposal budget); batch tool + single-card fallback; never overrides the batch/cap limits.
- Caps: proposal budget stays 20 (hard), preview caps stay 8/source + 2/concept (post-generation, existing), tool budget 8→12 (headroom for retrieval + 6-batch + retries), per-turn ≤4 calls/turn unchanged (batch counts one call carrying ≤6 items).
- Batch tool `propose_flashcard_batch`:

```ts
parameters: [{ name: "cards", type: "object[]", required: true, description: "1..6 card drafts",
               ... each draft: question/answer/cardType/concept/tags/sourceHandle/evidenceQuote (per-item schema identical to propose_flashcard) }]
// execute: for each draft → same propose_flashcard validation + resolveProposalSources + addProposal,
//          with per-item result entries in the tool result (ok + proposalId or typed error) so
//          partial batches surface which items landed; proposal cap still authoritative (canAddProposal).
```

The tool result is bounded (≤6 entries, digests only) and re-enters the transcript untrusted (unchanged).
- Partial result behavior: proposals that validated are reviewable even if the run ended early; every existing acceptance flow applies unchanged (approved-only persistence).

## 8. Structured-output parsing and recovery

### 8.1 Shared task runner (runTask)

- **Repair request now contains the rejected response** (bounded):
  - `raw: response.text.slice(0, 2000)` + `…[truncated; N chars total]` marker when longer,
  - the exact parse/validation error list (≤8, as today),
  - the expected contract (`task.schema.json` — already sent in system preamble),
  - explicit correction instructions (existing `REPAIR_INSTRUCTION`),
  - truncation verb driven by signal: `response.finishReason === "length"` OR the parse error class (existing heuristic) → "Shorten so it completes within the output token limit; prefer compacting entries before dropping tasks".
- **finishReason propagation**: Rust commands add `finish_reason: Option<String>` to `LLMResponse` → `chatWithLLM` → `CloudProvider` maps it onto `AIResponse.finishReason` (already typed/streamed for diagnostics). Additive, default `undefined` for old paths.
- **Empty body classification**: `parseStrictJson` keeps failing closed; the empty-text case records validation error `"empty response (provider body had no content)"`. Cloud empty-content is NOT auto-relaxed — a null content with finishReason `"length"` still goes to repair; a refusal-looking body still fails closed. No silent retries beyond the existing single repair.
- `AGENT_MAX_OUTPUT_TOKENS` 1400 → 2048 (see §14) keeps the repair retry viable.

### 8.2 Agent-loop tiered recovery (bounded)

```
turn type pipeline: tools → execute tools → boundaries (same as today)
special cases:
 - empty turn / invalid-turn (InvalidStructuredOutput error):
     attempt one (1) recovery turn ONCE per run with corrective system note:
       "That turn was off-contract (<short category: empty | malformed JSON | truncated). Respond again per the contract;
        or finish with a short finalAnswer."
     if that turn is also off-contract → finish(endReason "agent-protocol")
 - unregistered-tool-only turn:
     execute as today (typed `rejected` results) AND append loop note:
       "Those tool names are not registered; use only the names in the tool list."
     counts as no-progress (as today), bounded by the same no-progress rule
 - no-progress turns: same 2-turn budget as today ONLY when the corrective note was
   already applied once for that failure mode; otherwise the FIRST no-progress turn
   injects the note and resets the counter once (bounded: counter resets at most twice run-wide).
```

Result: no infinite loop (all paths bounded: maxTurns, no-progress caps with at-most-two resets, one recovery turn per run, loop-repeat detection unchanged), no fabricated success (agent-protocol is a typed failure), and the model gets deterministic corrective text instead of only raw transcript.

End-reason taxonomy additions:

```ts
export type AgentRunEndReason =
  | "final-answer" | AgentBoundReason | "cancelled" | "blocked" | "error"
  | "agent-protocol"      // replaces ambiguous "invalid-turn": contract never satisfied
  | "no-progress"         // distinct from "turn-budget": run ended because of protocol emptiness
;
// AgentBoundReason stays: tool-budget | proposal-budget | timeout | retrieval-hops | loop-detected | turn-budget
```

`turn-budget` then means *literally the turn limit* (loop message becomes "Stopped: the run reached its turn limit." — today that exact message is unreachable because maxTurns always overshoots via no-progress), and `no-progress` carries the accurate history.

## 9. Progress-state semantics

Announced stage ledger (kept inside the loop, exposed in diagnostics):

```ts
interface AgentRunDiagnostics {
  route: { selectedProviderId: string; selectedModel: string;
           servedProviderId?: string; servedModel?: string;      // AIResponse.baseModelName
           outputMode: "strict-json" | "native-structured" };
  turns: { requested: number; executed: number; empty: number; offContract: number; recoveryNotes: number };
  repair: { attempted: number; succeeded: number };              // per runTask
  tools: { attempted: number; validated: number; executed: number;
           ok: number; notFound: number; notAvailable: number;
           invalidInput: number; rejected: number; errored: number };
  proposals: { added: number; capRejected: number; groundingRejected: number };
  evidence: { handleCount: number; seededSectionChars: number | null; seededTruncated: boolean };
  bounds: { endReason: AgentRunEndReason; explanationKey?: string };
  outcome: truthfulCompletionClassification();                   // §9/§16 table
}
```

Progress events stay as-is on the wire (`turn-start`, `tool-result`, `proposal-added`, `turn-end`), and turn-level progress is additionally computed from that ledger:

```
progressNo(th): tools.executedThisTurnTh > 0           // validated-only view counts notFound/invalidInput too
outcomes:
  final-answer ∧ proposals>0    → "completed"
  final-answer ∧ proposals=0    → "completed-without-items"  (intent-dependent: generation-family renders honest no-item narration, NOT success-only)
  bound-reasons + partial > 0   → "partial"
  bound-reasons + partial = 0   → "incomplete"  ← the envelope recorded by observations (today: "success")
  agent-protocol                → "failed-model-protocol"
  error / cancelled / blocked   → "failed-tool" / "cancelled" / "blocked" / "failed-provider" (by error.category)
```

`runLearningAgent` maps this classification into `recordFeatureObservation` (the existing D0 schema) — `turn-budget`/`tool-budget`/`loop-detected`/`retrieval-hops`/`proposal-budget`/`timeout`/`no-progress`/`agent-protocol` never record `success`. Cancellation stays `cancelled`. Diagnostics only; the conversation surface keeps showing partial drafts (never fabricated completion).

## 10. Cancellation and concurrency behavior (unchanged guarantees, pinpointed)

- Deadline/AbortSignal wiring, `session.close()` late-proposal clipping, guard phases, and cloud-fallback refusal on `Cancelled` are NOT modified.
- Concurrency: two overlapping agent runs no longer share mutable routing state (pinned providers per run). The preflight's blocker list per submission remains per-conversation; a second submit in the same conversation is blocked by `isLoading` as today.
- Configuration edits mid-run: the guard freezes provider/baseUrl/model — with the pinned provider, guard values and serving values share one source, so the existing `destination-changed` stop is now accurate by construction (previously the served provider could differ from the guard-frozen config silently).

## 11. Privacy and authorization boundaries (unchanged invariants, restated)

- Frozen scope, removal/revision guards, and evidence-map handle authority untouched: handles are only minted by `AgentEvidenceMap.register` from tool-returned records; `resolveProposalSources` still rejects unregistered handles and verbatim-less citations in frozen scope.
- `preflightLearningAgent` continues to run `enforceAssistantPrivacyAndConsent` and the paid-consent surface **for the selected destination**; selection-driven destination classification uses the same `classifyCloudDestination`, and Ollama stays "cloud-kind but local" so strict-local-only decisions are unchanged.
- Containment: the seeded section block is a `wrapUntrustedBlock` product; no new trusted channel appears.
- No diagnostics content expansion: `AgentRunDiagnostics` adds counters/enum/length facts only; raw payloads remain exclusively behind the existing gated debug extension (no new raw persistence; verify by extending the diagnostics canary tests).

## 12. Diagnostics architecture

- `loop.ts finish()` finalizes `AgentRunDiagnostics` from the ledger; `runLearningAgent` attaches it to `LearningAgentRunResult` and (a) feeds `recordTaskDiagnostic` additive fields (endpoint allowlist update in `diagnostics.ts`), (b) serializes into the existing developer trace ring (`keepAgentTrace` shape extended with the counters; `exportAgentTrace` output extended, still content-free), (c) `recordLearningAgentStage` unchanged signature but the stage owner now records with `AgentRunDiagnostics`-derived metadata.
- Bounded memory: one ledger per run, no unbounded arrays; upper bounds on stored entries (≤ maxTurns).
- File/function ownership: `agent/diagnostics.ts` (new small module) owns the ledger type + aggregation; `loop.ts` writes entries; `learningAgent.ts` maps to stages; `trace.ts` persists.

## 13. Provider compatibility strategy

Support matrix per transport truth:

| Provider family | Output mode | Structured enforcement | Notes |
|---|---|---|---|
| Cloud strict-JSON (all configured cloud/local-host rows) | strict-JSON text mode | none — parsed text, fail-closed | unchanged baseline; descriptor + repair overhaul applies |
| Apple FM | native schema-compiled IF envelope registered | yes via Swift bridge | `APPLE_FM_NATIVE_SCHEMAS` gains `"agentTurn"` **only after** a fixture wire test proves envelope round-trip; else stays strict-JSON |
| On-device (Android Gemini Nano) | native structured when snapshot says so (existing `structuredGeneration`) | native envelope | unchanged seam |
| Ollama / OpenRouter / Gemini commercial | strict-JSON text mode | documented out-of-scope for this change | native `format`/`response_format`/tool-calling would need per-provider evidence + fixtures; tabs kept in `buildAgentToolSchemas()` unused |

**Capability smoke protocol** (no silent network calls): before the FIRST agent run against a (providerId, model) pair, and never on settings-screen render, the run MAY execute a ≤256-token deterministic protocol probe ("respond with one agent-turn JSON object; then a finalAnswer 'smoke ok'") — 2 extra messages ceiling, content-free motivation, billed as ordinary tokens of that provider, and dulled to once per (provider, model, agent-contract revision) persisted in diagnostics. Results: pass → capability recorded; persistent failures → typed user message "This model may not reliably support the learning-agent turn format" + retries remain available. Never blocks the run silently in pilot: probes are triggered by explicit run submission (existing preflight consent already covers the destination) and never by UI display. Disabled entirely when `smoke` capability not implemented — no behavior change.

Provider-compatibility suites (opt-in; not in CI):
- Ollama: locally installed model; asserts served model, agentTurn JSON compliance over 6 prompts, ≤1 repair share tracked.
- OpenRouter: explicitly configured model; empty-body/refusal behaviors verified.
- Gemini: explicit model id; verifies placeholder-replacement behavior, JSON-after-fence parsing.
Each asserts `servedModel` outcome, not just `200 OK` transport sanity, honoring "compatibility is not inferred from plain chat".

## 14. Token-budget strategy

- Request budget: unchanged `AGENT_TRANSCRIPT_CHAR_BUDGET = 12_000`; section/selection text trimmed by the existing `budgetScopedBodies` (unchanged trim; the scopedBodyTokenBudget call sits inline in runLearningAgent today — moved under the loop's try with the failure taxonomy above).
- Response budget: `AGENT_MAX_OUTPUT_TOKENS` 1400 → **2048** with rationale: per-item proposal costs (question ≤600 + answer ≤2000 + handle/evidence) reasoned per card; measured truncation share must inform the next adjustment (baseline bench in test § tasks; no blind increases).
- Loop-level fit check (fixes the unguarded throw, and answers H4 honestly):

```ts
// inside runLearningAgent, before the loop:
const caps = await provider.getCapabilities();
const turnInputEst = estimateTokens(systemInstruction + seed + intent) ;
const fit = caps.contextTokens === 0 ? "unknown" : turnInputEst + AGENT_MAX_OUTPUT_TOKENS <= caps.contextTokens ? "fits" : "too-large";
if (fit === "too-large") → finish("error", { category:"InputTooLarge", explanation: "The selected model's context is too small for the chosen section; shorten the scope or select a smaller section." })
```

- Per-request `maxOutputTokens` continues to win over provider defaults (policy resolution unchanged); `config.maxTokens` cannot be exceeded silently (CloudProvider unchanged).

## 15. User-facing error taxonomy (Assistant panel)

Loop explanations become end-reason keys + parameterized technical detail; UI localizes:

| Scenario | Key / behavior |
|---|---|
| section unavailable (post-freeze) | `assistant.agent.noSource` (typed, source-specific) |
| empty/off-contract after recovery | `assistant.agent.protocolFailure` (honest "this model could not…") |
| loop-detected / bounds | map per-key (turn‑budget, no-progress, tool-budget, proposal-budget, retrieval-hops, loop-detected, timeout) each with its OWN key — separating "model protocol" from "ran out" and from "Plethora routing" |
| provider errors | already typed category → per-category copy (existing taxonomy keys reused) |
| serving model ≠ requested | disclosure string, not an error |
| cancelled/blocked | unchanged text |
| pinned selection invalid | preflight blocker message + recovery target |

The acceptance artifact surface in `LearningAgentProposals.tsx` is untouched except for the new keys.

## 16. Rejected alternatives (and why not)

1. **Discriminated turn union emitted by the model** (`{type:"tools"|"answer", ...}`) — one more field that every provider/model must emit correctly; the two-shape envelope is minimal and already tested; we preserve the existing on-the-wire shape to minimize regression pressure on weak models and migrate only the type surface (derived classifier). Deferred until real live data shows value.
2. **Native tool calling / native JSON Schema enforcement for Ollama/OpenRouter/Gemini** — no provider-verified fixtures in-repo today; a provider that supports text generation should not automatically be considered capable of native tool calling — deferred behind `buildAgentToolSchemas()` seam + live-suite prerequisite.
3. **Raising turn limits instead of fixing semantics** (non-goal) — more identical failures.
4. **Prompt-length-only fixes (more instruction words)** — worsens the small-context overflow (H4) while the real problem is contract and routing; the corrected descriptor is bounded, not a wall of text.
5. **Separate flashcard synchronous engine bypassing the loop** — duplicates the validated pipeline, bypasses injection containment pattern (unless re-implemented), and forks the acceptance path. The seeded loop achieves the determinism with one orchestrator.
6. **Auto-restarting failed runs / auto-switching providers on protocol failure** (non-goal) — changes the user's chosen destination behind consent; recovery stays in-run and bounded.
7. **Truncation tolerance by raising all budgets** — does not address routing or empty-body failures; only AGENT_MAX_OUTPUT_TOKENS + finishReasonVerb are justified, with measured-data confirmation.
8. **Accepting the empty-turn validation (status quo)** — silences Failure A momentarily but produces repeated silent no-ops; fails the "meanwhile bounded recovery" requirement.

## Validation strategy pointer

See `tasks.md` 10.x/11.x and `traceability.md` — full matrix maps every symptom → fix → tests → acceptance.
