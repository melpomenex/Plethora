# Investigation record

Baseline: repository state at `7a53b069146730ba8116544a2e1d1da72dfc3525` (2026-10-31). All "verified" findings below are code observations at that revision; flow conclusions cross-checked across the production call chain, not isolated functions. What remains a hypothesis is listed separately with the instrumentation required to confirm it.

## Verified findings (with anchors)

### F1 — turn contract is example prose (proposal §3.3 / design §4)

- `src/lib/ai/schemas/agentTurn.ts` — `AGENT_TURN_SCHEMA.json` is `JSON.stringify({ toolCalls: [{ tool: "tool_name", input: {} }], finalAnswer: "string (omit while still calling tools)", proposalsEmitted: 0 })`. For every non-native-structured provider (`capabilitiesFromCloudConfig` hardcodes `structuredGeneration: false`, so that is all cloud/local-host rows, including Ollama/OpenRouter/Gemini), runTask's `generateWithFallbacks` embeds it verbatim into the system instruction as `${STRICT_JSON_PREAMBLE} ${schema.json}`.
- Consequence: weak models copy the example. Because `validateAgentTurn` treats any non-empty `finalAnswer` string as the answer (only bounded at 4,000 chars), the run can literally terminate with `{"toolCalls":[...],"finalAnswer":"string (omit while still calling tools)"}` as an honest-looking "final-answer" ending whose text is the schema placeholder. `tool_name` as a call means an unregistered-tool no-progress event. Old Apple FM bridge never had `agentTurn` in `APPLE_FM_NATIVE_SCHEMAS` (`src/lib/ai/apple/nativeSchemas.ts`), so no pathway uses a compiled schema for turns at all.
- Tests that lock it in: `agent.test.ts`/`agentTurn.test.ts` assert descriptor acceptance only for shape; nothing asserts placeholder non-echo.

### F2 — empty turn accepted by design, harmless in tests, harmful in the field (§3.2 / design §4)

- `validateAgentTurn`: `rawCalls === undefined → []`; `{}` or `{"toolCalls":[]}` → `valid({ toolCalls: [] })`. Header comment: "A turn with NEITHER tool calls nor a final answer still validates (the loop treats it as a no-progress turn…)".
- `agentTurn.test.ts` line 37: "accepts a no-progress turn as shape-valid (the loop guards progress)".
- Loop (`loop.ts` 656–667): two consecutive turns with `executedThisTurn === 0` → `finish("turn-budget", …,"Stopped: repeated turns made no usable tool calls.")`. There is no corrective system note; the model sees only its own transcript.
- Net: two silent no-ops → Failure A, with an explanation worded as "no usable tool calls" (true of attempts, silent about why: the contract failure class is never named).

### F3 — progress semantics (§3.1 / design §9)

- `loop.ts`: `executedThisTurn` increments only AFTER `bounds.consume` succeeded AND `getAgentTool` resolved the tool AND validation executed (valid or invalid input or typed not-found/not-available outcome). Unregistered names (`continue` at the registry branch) and bounds-rejected calls do not count. So "no usable tool calls" is specifically "no allowlisted executed attempts", which the message does not convey.
- Repeated-identical-call detection (`bounds.consume` → `loop-detected`) counts observations even when rejected; loop-detection still works.
- No distinction is recorded between "model made attempts that failed for tool-contract reasons" and "model produced nothing" in the run explanation.

### F4 — immediate stop on invalid output; repair lacks the failed response (§3.5 / design §8)

- `loop.ts` 492–498: `AIError("InvalidStructuredOutput")` → immediate finish `invalid-turn` with "The model could not produce a valid turn after repair; stopping safely." ( Failure B). No loop-level retry, no category naming (empty vs truncated vs refusal).
- `runTask.ts` `repairOnce` (514–566): repair `AIRequest.text` = original `ctx.built.text` + `REPAIR_PREAMBLE` + ≤8 errors + optional truncation hint + `REPAIR_INSTRUCTION`. **The malformed model response itself is absent.** For a stateless chat request, the model cannot see what it produced — the strongest cause of unchanged repeat failures.
- The repair reuses `ctx.maxOutputTokens` — for the agent task that is `AGENT_MAX_OUTPUT_TOKENS = 1400` — so a truncated turn very likely truncates again (the hint asks to shorten, but there is no `finishReason` signal; cloud transports discard it: see F6).
- The repair is also the ONLY task-layer retry; the loop adds none.

### F5 — output-token budget and per-call shape (V12 / design §14)

- One proposal per call (no `count` parameter; unknown params rejected): `tools/proposals.ts` `propose_flashcard` etc.
- Budgets: `MAX_AGENT_TOOL_CALLS = 8`, `MAX_TOOL_CALLS_PER_TURN = 4`, proposal cap 20, wall clock 60 s (`agent/bounds.ts`).
- For "cards from this section", the plausible legitimate path is: ≥1 retrieval/seat + N propose calls ≤ 8 total; anything above 4 calls in a turn splits across turns; per-call JSON with question ≤ 600 chars + answer ≤ 2000 chars + handle/evidence ~ 300–700 tokens. Four such calls plus envelope ~ 1,400+ tokens → truncation risk against the 1400 cap (F4 chain). This is consistent with Failure B appearing even for models that eventually coordinate correct JSON.
- The system instruction also says "Propose at most a few (typically ≤ 3) high-value items per run — never mass-create", which fights the user's actual request for a usable card count and conflicts with the session proposal cap of 20.

### F6 — finishReason discarded; empty-content fallback to "" (V6, V7 / design §8, §13)

- Wire: `src-tauri/src/commands/llm.rs` — `OpenAIResponseMessageContent.text()` returns `String::new()` when `content` is `None` (OpenRouter/Gemini reasoning-only or refusal turns); `OpenAIStreamDelta { content: Option<String> }` contributes nothing for null chunks; `finish_reason` is parsed in `OpenAIChoice`/`OpenAIStreamChoice` but `LLMResponse` (`src/api/llm/index.ts`) carries only `{content, usage}` — the field never reaches TS (`AIResponse.finishReason` stays undefined for cloud), so the task layer cannot distinguish truncation (`length`) from empty-body/refusal.
- Downstream: cloudProvider builds `AIResponse.text` as "" → `parseStrictJson("")` → "empty response" → repair → likely identical → Failure B mislabeled as a model-protocol total failure.
- Non-streaming `ai/providers.rs` legacy path (`choices[0].message.content .as_str().unwrap_or("")`) has the same empty fallback, though it serves other tasks (not the agent runner).

### F7 — provider selection ignores the Assistant picker (V8 / design §3)

- `AssistantPanel.tsx`: `submitLearningAgentRequest` → `preflightLearningAgent({ documents, forceKind, explicitDestinationRetry })` — the picker state `effectiveProvider` (localStorage `assistant-llm-provider` via `utils/assistantProvider.ts`) is never passed.
- `learningAgent.ts` `preflightLearningAgent`: `path = await resolveAiPath("prompt")` → `kind = forceKind ?? path…`; `route = await resolveTaskRoute(agentRunnerTask, { kind })`; the route picks the first provider of that kind whose capabilities say `textGeneration` (`tasks/router.ts` 106–115) among `getRoutingProviders()` (`providers/index.ts` — ordered nano/apple/windows/foundry/cloud or reverse by `preferOnDevice`).
- `cloudProvider.ts` `getActiveCloudConfig()` (54–63): first enabled row with key or keyless access. One shared singleton `CloudProvider` re-reads this per request (`activeConfig()`).
- The regular chat path *does* honor the picker: AssistantPanel 2505+ resolves `effectiveProvider` → matching `LLMProviderConfig` and sends `{provider, model, apiKey}` explicitly. So the chat works "on Gemini" while the agent silently serves Ollama/another row.
- Also: `enforceAssistantPrivacyAndConsent`/`classifyCloudDestination` inside preflight use `getActiveCloudConfig()` — with a selection nothing guarantees these describe the same destination the run would use (today they coincide only by accident of list order).

### F8 — outcomes misreported (V9 / design §9)

- `learningAgent.ts` 1180–1198: `outcome = endReason ∈ {cancelled, blocked} ? cancelled : endReason ∈ {error, invalid-turn} ? failed : success`. `AgentRunEndReason` includes `turn-budget`, `tool-budget`, `proposal-budget`, `retrieval-hops`, `loop-detected`, `timeout` — all land in `success` for the D0 observation (and would land in UI `partial` only because `endReason !== "final-answer"`, but the operational diagnostics call them successes).

### F9 — section never deterministically delivered (V10 / design §6)

- `loop.ts` `agentRunnerTask.buildInput`: text = remaining budgets + transcript (+ forcedFinalNote) + intent. `transcript` starts empty. The frozen section lives in `FrozenLearningAgentRun.section` and `createFrozenAgentEnvironment().getSectionContext()`; the ONLY path that ships it to the model is `get_section_context`'s tool result (`tools/readonly.ts`, full text, not snippet).
- So a model that should generate cards must FIRST decide, unprompted, to make one metadata round-trip. Weak/small models may instead call `get_current_document` (not-found), `search_library` with odd queries, or produce tool-less turns → A/B failures above. The screenshot's "≈1,012 tokens resolved" state is consistent with the UI having the text and the model never receiving it.
- Adjacent verified bug: `runLearningAgent` (1102–1107) computes the section budget via `scopedBodyTokenBudget(...)`/`budgetScopedBodies(...)` OUTSIDE the guarded run region — either can throw ("The selected scope cannot fit…"), surfacing as a generic error unrelated to the model (V14). Budget math: `promptBudgetTokens = min(contextTokens − 1400 − 256, (12000−2000)/4 = 2500)`; for `contextTokens` defaults that leave < ~2,900 usable tokens the seat throws (verified arithmetic; the grouped early return is the loop's job instead).
- `budgetScopedBodies` also throws when any body cannot retain 96 chars — same failure class.
- Note: with `options.provider` unset (only tests) the trimming step is skipped entirely — intentional-looking but inconsistent.

### F10 — tool catalog vs validators drift (V11 / design §5)

- `registry.agentToolCatalogText()` = `- name (category): description` lines only. Descriptions mention SOME parameter concepts in prose ("cardType is one of [...]"; the "citation" flow) but: `question`/`answer` parameter names never appear for flashcards; `sourceHandle` format (`s1`, `s2`…, returned by tools) is described only inside search results; `evidenceQuote`, `supportingSourceHandles`, `concept`, `tags` are unlisted; `propose_cloze` deletion syntax is in the description — good; `imageRef` wording is vague.
- Runtime: `rejectUnknownParams` + per-key validators reject exact-name violations. A model calling `{front, back}` or `{summary}` → invalid-input events the model may not connect to its naming, burning the tool budget (8 calls) → tool-budget ending with partial/no proposals.

### F11 — diagnostics cannot answer the acceptance questions (V13 / design §12)

- `trace.ts`: entries are `{tool, argsDigest(fnv1a), durationMs, outcome}` + counts; no turn-level output mode, no repair counts, no provider/model beyond `providerId` ("cloud-llm"), no validation outcome categories; `keepAgentTrace` ring of 5.
- `recordTaskDiagnostic` per-runTask call carries provider/model classes (`baseModelName` only in diagnostics) but nothing joins a run's turns into an outcome ledger; `recordFeatureObservation` has the stage outcomes (F8's misclassification).
- The UI falsifies nothing about proposals (review artifact + acceptance flows are validated separately in `learningAgentAcceptance.ts`), but "which model served" and "which stage failed" are unanswerable.

### F12 — Apple FM capability seam (V7-adjacent)

- `apple/nativeSchemas.ts` `APPLE_FM_NATIVE_SCHEMAS` = {smartTagging, libraryAnswer, generatedFlashcards, learningMaterialProposal}. `agentTurn` absent → even the one provider with a genuine native structured bridge runs the agent strictly through text JSON. Recent commit `7a53b069` ("make Apple FM card creation reliable") fixed the chat/tool-call path, not the agent loop.

## Hypotheses requiring live evidence (and how to confirm)

- **H1 — which backend actually served the user's three attempts.** Confirmed fix: selection pinning + route disclosure (2.x). Confirmation: route assertions in W1/W2 tests + the live-provider suites asserting `servedModel`; until then, no claim is made about Ollama/OpenRouter/Gemini having actually served the reported runs.
- **H2 — truncation share of Failure B.** Confirm with the propagated `finishReason === "length"` counters over deliberately truncated fixture transcripts and optionally the live suites (opt-in, user-configured).
- **H3 — per-provider empty/refusal shares.** Confirm with empty-body/refusal classification counters (5.3) in the live suites.
- **H4 — Ollama/Gemini-Nano `num_ctx` overflow on agent prompts.** Confirm via the loop-level token fit check logging estimate vs limit (6.3); the check converts silent overflow into a typed error either way.
- **H5 — placeholder echo frequency.** Confirm by classification counters (3.3) in live data; fixtures assert the mechanism deterministically.

## Existing infra deliberately NOT to be duplicated

- `AgentEvidenceMap` / `resolveProposalSources` (handle authority + verbatim grounding) — keep as the only source-binding implementation.
- `learningAgentAcceptance.ts` validation/grouping/retry-safe saving; `LearningAgentProposals.tsx` review UI.
- `createAgentDeadline`, `createLearningAgentGuard`, bounds tracker (loop detection), untrusted containment (`tasks/containment.ts`).
- `runTask` routing/coalescing/cancel semantics; unified `AIError` taxonomy; `repairTruncatedJson` salvage.
- Feature-readiness/privacy/billing preflight and the conversation artifact persistence.
