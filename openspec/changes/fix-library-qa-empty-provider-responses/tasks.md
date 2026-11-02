## 1. Capture response-boundary regressions

- [x] 1.1 Add sanitized native and browser response fixtures covering empty/null/whitespace final content, text parts, output-limit stop reasons, usage, explicit refusal, reasoning-only and tool-only responses; verify native serialization tests and API normalization tests exercise real wire shapes rather than only camel-case provider mocks.
- [x] 1.2 Add an Ask Library regression for “What are the main themes in my library?” with eligible indexed evidence from at least two documents and an initially empty response followed by valid cited JSON; verify the test exercises production task execution, schema validation, and citation mapping, and exposes the current metadata/budget defect before the fix.

## 2. Normalize completion metadata

- [x] 2.1 Normalize existing snake-case native and camel-case browser LLM responses at `src/api/llm/index.ts`, including usage and optional stop reason; verify fixtures for both formats, absent optional fields, and equivalent output-limit reasons produce the canonical response contract.
- [x] 2.2 Preserve final-text extraction and bounded response-kind indicators in native/browser parsing and `CloudProvider` without copying reasoning or tool payloads into text; verify provider boundary tests cover text parts, refusal, reasoning-only, tool-only, and unknown empty content.

## 3. Resolve the selected generator's budget

- [x] 3.1 Reuse the existing router/pinned-provider facilities to resolve the actual generator and expose its frozen request policy to Ask Library; verify tests with two enabled providers having different settings use the selected provider and retrieval-only mode resolves no generator.
- [x] 3.2 Replace the effective fixed 1,200-token Ask Library ceiling with the resolved allowance, reserving complete prompt, output, and bounded correction overhead before fitting sources; verify larger configured cloud allowances, small on-device contexts, history/selection overhead, and configured ceilings for both initial and corrective requests.

## 4. Make recovery bounded and diagnosable

- [x] 4.1 Add a compatible task-managed-recovery flag through provider request types, LLM API, IPC, and native helpers to disable the hidden native empty-content retry for task-managed requests; verify mocked HTTP request counts prove no more than one initial plus one corrective generation per provider execution and omitted flags retain legacy direct-chat behavior.
- [x] 4.2 Return typed success/failure details from structured-output correction, share the single corrective allowance across empty-content and JSON repair, and tailor correction to observed output exhaustion within the resolved budget; verify empty-then-valid, empty-twice, malformed JSON, native structured output, truncated output, and tool-only fixtures with exact call counts.
- [x] 4.3 Preserve explicit refusal, cancellation, timeout, and corrective provider errors with their mapped terminal categories; verify no correction or cloud fallback follows cancellation/refusal and a corrective provider failure is not replaced with the first parse error.
- [x] 4.4 Extend whitelisted diagnostics with attempt count, first/terminal failure kinds, and accepted/terminal completion metadata; verify diagnostic privacy tests exclude raw content, reasoning, tools, credentials, endpoints, and arbitrary error strings while retaining retrieval counts and safe numeric/category fields.

## 5. Surface accurate Library Q&A failures

- [x] 5.1 Carry generation-stage failure context and eligible evidence count through Ask Library, its hook, and assistant/Q&A adapters; verify generation failure retains sources-found status while empty-evidence, Passage, Document, and retrieval-only behavior remain accurate.
- [x] 5.2 Add localized generation-failure copy and reuse the existing retry/AI Settings actions in the affected Q&A surfaces; verify UI tests distinguish unknown empty content, known output exhaustion, explicit refusal, provider failure, and no evidence without recommending an embedding rebuild for a generation failure.
- [x] 5.3 Complete the themes-query integration regression with validated citations to both supporting documents, source navigation, and evidence-bounded wording; verify unsupported citations, excluded/local-only documents, restricted source sets, and incomplete-index disclosure remain governed by existing grounding/privacy rules.

## 6. Validate the integrated change

- [x] 6.1 Run focused Vitest suites for LLM API normalization, `providers.test.ts`, `pinnedCloudProvider.test.ts`, `runTask.test.ts`, `runTaskTruncationSalvage.test.ts`, `runTaskCloudFallback.test.ts`, `libraryTask.test.ts`, `diagnostics.test.ts`, agent protocol/privacy tests, and the affected assistant/Document Q&A tests; verify all pass and document any pre-existing failure separately.
- [x] 6.2 Run native LLM serialization/parsing/retry tests (`cargo test --lib commands::llm::tests` from `src-tauri`) and TypeScript/lint checks appropriate to the changed files; verify native fixtures match frontend normalization, or record the exact environmental blocker without claiming native validation passed.
- [x] 6.3 Run the required local `npm run bench:check` after implementation; verify performance and bundle budgets pass, updating baselines only for an intentional measured change with its rationale documented.
- [x] 6.4 Reproduce the themes question through an available configured provider/runtime and record sanitized provider/model, retrieval count, effective budget, attempts, stop reason, and result; verify a cited answer or specific terminal diagnosis, and explicitly record unavailable live-provider evidence instead of declaring the reported live failure reproduced or fixed without it.
- [x] 6.5 Run `openspec validate fix-library-qa-empty-provider-responses --strict` and review the implementation against both delta specs; verify every requirement has corresponding evidence and the implementation checklist reflects completed work accurately.
