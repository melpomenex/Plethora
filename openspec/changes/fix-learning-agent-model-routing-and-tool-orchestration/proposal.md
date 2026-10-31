# Fix Learning Agent model routing and tool orchestration

Change name: `fix-learning-agent-model-routing-and-tool-orchestration`
Baseline revision investigated: `7a53b069146730ba8116544a2e1d1da72dfc3525` (built on the completed-but-unarchived `complete-ai-learning-agent-integration` change; all findings were revalidated against this exact checkout).

## Problem statement

A user selects an attached document, picks a section (for example *Chapter 1: A Paradox*, ≈1,012 tokens of resolved content), switches the Assistant to Learning Agent mode, clicks **"Cards from this section"**, and the run fails with:

- **Failure A** — `Stopped: repeated turns made no usable tool calls.`
- **Failure B** — `The model could not produce a valid turn after repair; stopping safely.`

The user repeated the attempt under Ollama, OpenRouter and Google Gemini configurations. Instrumentation cannot yet prove three different model backends actually served those runs; the Learning Agent's provider resolution ignores the Assistant's selected provider entirely (§3.6 below), so the same backend may have served every attempt. The same class of failure affects the other Learning Agent action families (cloze from a document, missing prerequisite concepts, related material, multi-paper cards).

## User-visible failures

1. Explicit generation actions end without proposals and with a generic loop error that does not explain what went wrong or what to change.
2. A failure inside the JSON-transport layer is reported with the same wording regardless of whether the cause was malformed JSON, a truncated envelope, an empty refusal body from the provider, or a provider returning a valid but unusable final answer.
3. Diagnostics record `outcome: success` for runs that hit `turn-budget`, `tool-budget`, `loop-detected`, `retrieval-hops` and `proposal-budget` endings (src/lib/ai/assistant/learningAgent.ts, runLearningAgent() outcome mapping), so operational evidence misreports incomplete runs as successes.
4. The serving provider/model cannot be seen anywhere in diagnostics for agent runs: the review artifact always shows the preflight's route id, never the model that actually executed, and `AIResponse.baseModelName` is recorded only in task diagnostics and never surfaced on the run result the UI renders (src/lib/ai/agent/loop.ts finish(); AssistantPanel.tsx view construction).
5. The Learning Agent does not run on the model the user explicitly picked in the Assistant model picker: `submitLearningAgentRequest` never reads `effectiveProvider` (src/components/assistant/AssistantPanel.tsx lines ~1907–1911), and `preflightLearningAgent` resolves a route from `resolveAiPath("prompt")` + `resolveTaskRoute(agentRunnerTask, { kind })` (src/lib/ai/assistant/learningAgent.ts lines 537–596), which returns the first routing provider of that kind; the single `CloudProvider` instance then serves from `getActiveCloudConfig()`, which returns the **first enabled** provider config with usable credentials (src/lib/ai/providers/cloudProvider.ts lines 54–63). A user selecting Gemini in the picker silently gets whatever the provider array has first.

## Verified root causes (code observations at the baseline revision)

The detailed findings, with exact file/function anchors, live in `investigation.md`. Summary of the verified defects:

| # | Defect | Anchor | Verified? |
|---|--------|--------|-----------|
| V1 | Turn contract is example-shaped prose, not a data contract; models can echo placeholders (`tool_name`, `finalAnswer: "string (omit while still calling tools)"` → accepted as the final answer) | src/lib/ai/schemas/agentTurn.ts `AGENT_TURN_SCHEMA`, `validateAgentTurn` | Code-verified |
| V2 | Empty turn (`{"toolCalls":[]}`, `{}`) validates and counts as a "no-progress" turn; two consecutive empty turns end the run with Failure A even though the loop never attempted a self-contained corrective response | src/lib/ai/schemas/agentTurn.ts bendable validator (no-op-return), src/lib/ai/agent/loop.ts 447–466/656–667 | Code-verified; intended by header docs, harmful in practice for weak models |
| V3 | Progress is defined by *executed tool calls on registered tools only*; unregistered-name calls, bounds rejections, and turn-level output failures produce no progress and no corrective feedback besides the raw transcript | src/lib/ai/agent/loop.ts for-loop; `executedThisTurn` increments only after registry resolve + bounds accept | Code-verified |
| V4 | `InvalidStructuredOutput` ends the run immediately with Failure B — one repair attempt in `runTask`, no loop-level recovery, no diagnostic distinction between empty text / bad JSON / truncated JSON / refusal | src/lib/ai/agent/loop.ts 492–498; src/lib/ai/tasks/runTask.ts `validateOutput`/`repairOnce` | Code-verified |
| V5 | Repair requests resend the original task input and validation errors but never the malformed model response that failed — a stateless model is asked to fix output it cannot see | src/lib/ai/tasks/runTask.ts `repairOnce` 514–566 (text: `${ctx.built.text}\n\n.REPAIR_PREAMBLE...`) | Code-verified |
| V6 | Truncation-shape repair reuses the same `maxOutputTokens` (1400) and has no truncation signal: cloud platforms discard `finish_reason` before it reaches the task layer, so `length` endings are invisible | src/lib/ai/agent/loop.ts `AGENT_MAX_OUTPUT_TOKENS`; src/api/llm/index.ts `LLMResponse` (content+usage only); src-tauri/src/commands/llm.rs parse + response mapping | Code-verified |
| V7 | OpenAI-compatible transports (incl. Gemini/OpenRouter) fall back to an **empty string** when `choices[0].message.content` is null/missing (reasoning-only or refusal turns); empty text is then routed into the parse→repair→`InvalidStructuredOutput` chain | src-tauri/src/commands/llm.rs `OpenAIResponseMessageContent.text()` / `OpenAIStreamDelta`; src/lib/ai/providers/cloudProvider.ts streaming `text = ""` | Code-verified (fallback path); which provider served any specific user run still needs live instrumentation |
| V8 | Provider selection ignores the Assistant-selected model (see Problem statement item 5); one shared `CloudProvider` re-reads global config per request | cloudProvider.ts `getActiveCloudConfig`/`activeConfig()`; providers/index.ts `getRoutingProviders`; learningAgent.ts `preflightLearningAgent` | Code-verified |
| V9 | Outcome misclassification: only `cancelled/blocked/error/invalid-turn` map away from `success` in the generation-stage feature observation | src/lib/ai/assistant/learningAgent.ts 1180–1198 | Code-verified |
| V10 | The frozen section never enters the prompt deterministically: `AgentRunnerInput.transcript` starts empty; the section text reaches the model only if the model itself decides to call `get_section_context` — the one behavior repeatedly failing to happen | src/lib/ai/agent/loop.ts `agentRunnerTask.buildInput`; src/lib/ai/assistant/learningAgent.ts `createFrozenAgentEnvironment.getSectionContext`; readonly.ts `getSectionContextTool` | Code-verified |
| V11 | The model-facing tool catalog carries zero parameter contracts: `agentToolCatalogText()` emits `- name (category): description`, while runtime validators reject unknown parameters (`rejectUnknownParams`) and require exact names (`question`/`answer`, `sourceHandle`, enum `cardType`, handle shape `s1…`) the model was never told | src/lib/ai/agent/registry.ts; src/lib/ai/agent/tools/proposals.ts validators | Code-verified |
| V12 | One proposal per call, ≤8 tool calls total, ≤4 calls/turn, 1400 output tokens: a 5-card request needs ≥6 sequential calls inside a tight envelope, easily truncating the turn (→ V4/V6) | src/lib/ai/agent/bounds.ts; proposals.ts; loop.ts | Code-verified |
| V13 | Diagnostics cannot answer "did the model receive the intended section context / which output mode / how many candidates were rejected at which stage": trace records digests only; task diagnostics are per-`runTask` not per-run; nothing joins turn → tool → proposal outcomes | src/lib/ai/agent/trace.ts; src/lib/ai/diagnostics.ts; recordLearningAgentStage() | Code-verified |
| V14 | `runLearningAgent`'s section budget step can throw (small `contextTokens`) outside the loop's try, producing a generic error unrelated to the model | src/lib/ai/assistant/learningAgent.ts 1102–1107; src/utils/scopedContextBudget.ts throw paths | Code-verified |

## Hypotheses still requiring live reproduction

- **H1 — which backend served each reported attempt.** Instrumentation must record `selectedProvider/selectedModel` vs `servedProviderId/servedModel` per run before any live claim about Ollama/OpenRouter/Gemini behavior is made (resolved by this change's route-pinning + diagnostics; no new live claim in CI).
- **H2 — truncation share of Failure B.** The `finishReason:"length"` signal must be observed before any output-budget retuning (the change adds the signal and a budget stepper; it does not assume the share).
- **H3 — refusal/garbage share per provider.** Empty-body and prose-body turns must be classified per provider with counters (V7/V13) before the compatibility smoke gate is tuned.
- **H4 — Ollama `num_ctx` overflow on the agent prompt.** Pre-estimated tokens (system ≈ including catalog; turn ≤ 12,000-char transcript + section) may exceed small configured contexts; the loop-level budget check will observe and fail honestly if so.

## Why current tests did not catch the failures

- `learningAgent.integration.test.ts` drives the real loop with `FakeAIProvider`, whose scripted responses are always protocol-perfect (searched, tool-called, final-answer). No test covers: empty body → repair chain, placeholder echo, unknown-tool-only turns, second consecutive no-progress turn, or provider misrouting (`preflightLearningAgent` is never tested against a user-selected provider; there is no test that the route honors a selection).
- `agentTurn.test.ts` asserts the empty-turn acceptance *as intended behavior* ("the loop guards progress"), locking in V2.
- Provider tests use idealized fixture responses and do not exercise `OpenAIResponseMessageContent.text()` fallback, streaming `delta.content` nullability, or `finish_reason` loss.
- Nothing asserts the model-facing catalog ↔ validator consistency, so the drift in V11 has no gate.

## Proposed architecture

1. **Selected-provider fidelity + route pinning** — the Assistant hands its explicit selection (`providerId` + config snapshot) to the Learning Agent submit path; `preflightLearningAgent` gains a required selection parameter; a pinned provider instance (config frozen for the run) serves every turn; the guard compares against the pinned snapshot; diagnostics record selected vs actually serving provider/model (`AIResponse.baseModelName`). No silent substitution to any other provider, model, or privacy destination; incompatible selections fail typed with an explicit recovery hint.
2. **Deterministic grounding seat for scoped actions** — before the first model turn, `runLearningAgent` reads the frozen section/selection through the existing environment, registers its evidence handle, and seeds the run transcript with the trimmed, untrusted-wrapped section text plus a scoped instruction. The model no longer has to discover `get_section_context`; the tool remains available for honesty and re-resolution. Library-scope actions and multi-paper planning remain fully agentic (they genuinely require search).
3. **Agent-turn contract upgrade** — `AGENT_TURN_SCHEMA` becomes a compact machine-enforceable descriptor (tool-name enum, per-tool argument shape summary, optional-field semantics, compact single-line-JSON instruction, valid example with realistic values). The validator classifies turns: `tools` / `final-answer` / `empty` / `invalid`; an empty turn is a protocol failure with bounded loop-level recovery (one corrective retry, then a forced final instruction, then honest stop) instead of silent acceptance.
4. **Tool registry single source of truth** — each `AgentToolDefinition` gains a typed `parameters` descriptor; the model-facing catalog text and (future) native tool schemas are generated from it; a consistency test proves descriptor ↔ validator alignment (generated invalid inputs must be rejected).
5. **Repair overhaul in the shared task runner** — `repairOnce` includes the bounded malformed response, the exact parse/validation errors, the expected contract, a truncation-aware verb (using a newly propagated `finishReason`), and unchanged one-retry bound. Provider response normalization gains: `finish_reason` propagation (Rust → `LLMResponse` → `AIResponse`), empty-body classification, and unchanged fail-closed validation.
6. **Proposal efficiency** — a batch proposal tool (`propose_flashcard_batch`, ≤6 typed items per call, one evidence handle per item, proposal cap still authoritative) plus `MAX_AGENT_TOOL_CALLS` 8→12 and `AGENT_MAX_OUTPUT_TOKENS` 1400→2048 reduce round trips and truncation pressure; card-quantity policy: default 5 cards when unspecified, honor explicit user counts, partial results always land in the existing review artifact.
7. **Progress + honest outcomes** — progress becomes semantic (executed in-contract tool calls, including typed not-found/invalid inputs the model can correct), recovery notes are injected deterministically, end reasons gain `no-progress` and stay bounded, and the generation-stage observation classifies every bound ending as incomplete rather than success. User-facing explanation strings move to i18n keyed by end reason.
8. **Diagnostics** — a per-run `AgentRunDiagnostics` object joins route (selected/served provider+model, output mode), turn outcomes, empty/invalid turn counts, repairs attempted/succeeded, tool outcomes by category (attempted/validated/executed/✓/✗ not-found/not-available/invalid-input/rejected), proposals added/rejected, evidence handle count, section-context reuse (digest only), and final outcome classification. Exportable via the existing developer trace view; still no user content by construction, with the existing gated debug facility as the only raw-payload path.

## What changes (scope)

- `src/lib/ai/agent/{loop,bounds,registry,trace}.ts`, `src/lib/ai/schemas/agentTurn.ts` (new contract + validator classification), `src/lib/ai/agent/tools/*` (descriptors + new batch tool), agent tests.
- `src/lib/ai/tasks/runTask.ts` (repair payload + finishReason-aware hint), `src/api/llm/*` + `src-tauri/src/commands/llm.rs` (propagate `finish_reason`; bounded empty-body classification), `src/lib/ai/providers/cloudProvider.ts` + a pinned-provider variant for explicit selections, `src/lib/ai/assistant/learningAgent.ts` (selected-provider preflight, run diagnostics container, outcome classification, deterministic seat).
- `src/components/assistant/AssistantPanel.tsx` (pass the selection; map end reasons to localized explanations), Learning Agent progress/error surfaces, `LearningAgentProposals.tsx` (unchanged approval flow).
- Tests: loop/validator/bounds unit matrices, pinned-route integration, transport normalization fixtures, opt-in live-provider suite (Ollama/OpenRouter/Gemini, explicitly gated), E2E acceptance for "Cards from this section".

## Expected benefits

- The priority scenario works: a user selects a section, requests cards through their explicitly chosen provider, and receives source-grounded proposals or a truthful, actionable failure.
- Every agent failure is explainable from diagnostics: provider/model mismatch, protocol failure stage, tool outcome counts, incomplete endings.
- Three-provider reliability claims become verifiable (instrumented, opt-in live suite) instead of assumed.
- Security, approval, grounding, and privacy behavior are preserved end to end (no writes without approval; evidence-map authority unchanged).

## Non-goals

- No new agent framework/second task runner; no reimplementation of the Assistant.
- No relaxation of validation, grounding, duplicate checks, approval, allowlist, or injection containment.
- No silent provider/destination substitutions; no automatic restarts of failed runs.
- No native tool-calling or native schema enforcement for Ollama/OpenRouter/Gemini in this change (no verified provider capability evidence yet); Apple FM's existing native-schema seam gains the already-supported `agentTurn` envelope only when it can be wire-verified — otherwise strict-JSON remains.
- No scheduling, RSS, TTS, reader, or unrelated provider behavior changes.
- No live-provider compatibility claims without live-provider evidence (§ Testing).

## Dependencies and risks

- Depends on existing, untouched infrastructure: `AgentEnvironment`/evidence map/acceptance pipeline (stable), `runTask` (narrow, additive edits), privacy/billing gates (unchanged calls).
- Risk: descriptor-driven catalog growth raises prompt size for small local contexts — mitigated by the loop-level token budget check and compact catalogue formatting.
- Risk: batch tool could inflate candidate volume — proposal cap + per-turn caps + preview caps (8/source) unchanged; batch call counts as one tool call and six proposal slots.
- Risk: `finish_reason` propagation touches the Rust command surface — additive, non-breaking field with default.
- Archived-change interaction: this change adds new requirement headings only, plus one MODIFIED heading that already exists in the published `ai-task-architecture` spec; it avoids colliding with the pending `complete-ai-learning-agent-integration` delta blocks.

## Relevant existing specifications

- `openspec/specs/ai-learning-agent/spec.md` (published: constrained tool layer; writes require approval; bounded execution; prompt-injection resistance; execution tracing)
- `openspec/changes/complete-ai-learning-agent-integration/` (unarchived deltas adding assistant integration, source scope, progress/cancellation, validated approval, retry-safe acceptance, destination-aware authorization — this change builds on, and does not duplicate, those requirement blocks)
- `openspec/specs/ai-task-architecture/spec.md` (structured output fail-closed + repair retry; untrusted containment)
- `openspec/specs/native-ai-routing/spec.md` (provider precedence preserves explicit choice), `assistant-tool-reliability` (published from fix-issue-6)
- `openspec/planning/ai-learning-completion-traceability.md` (reuse of its requirement→test matrix conventions)
