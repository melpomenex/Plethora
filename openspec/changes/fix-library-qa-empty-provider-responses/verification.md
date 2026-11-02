# Implementation verification

Date: 2026-11-01 UTC. Changes remain in the working tree; no release, commit, or archive was requested.

## Requirement evidence

| Requirement | Implementation and regression evidence |
| --- | --- |
| Native/browser completion metadata survives | `src/api/llm/response.ts` normalizes casing, usage and output-limit reasons. Native serialization and HTTP parsing share `src/api/llm/__tests__/fixtures/completions.json`. API, browser HTTP, provider and native tests cover final text, null/whitespace, text parts, refusal, reasoning-only and tool-only responses. Reasoning/tool payloads never become answer text. |
| Selected-generator budgets | `CloudProvider.getRequestPolicy()` and `pin()` expose the frozen answering configuration. Library source preparation reserves the complete instruction, JSON schema, question, history, selection, output and bounded corrective suffix. Tests cover two enabled configurations, 4,096-token configured output, 256-token ceilings, small on-device contexts and retrieval-only execution without capability resolution. |
| One corrective allowance | `runTask` validates native structured output or strict JSON, preserves bounded truncation salvage, and uses one shared correction for empty/invalid output. `taskManagedRecovery` is enabled for structured tasks and crosses the API/IPC boundary and disables native OpenAI empty-content recovery. Actual browser/native HTTP tests check request counts. Omitted flags retain legacy direct-chat recovery. |
| Terminal causes and consent | Refusal/cancellation stop recovery and fallback. Corrective provider errors and timeout retain typed terminal causes. A route frozen during preparation retains existing consent-controlled fallback, reusing evidence within the intersection of prepared and serving policies. Existing fallback, agent protocol and recovery tests cover these paths. |
| Content-free diagnostics | The ring and redacted export share `sanitizeCompletionRecovery`. Only bounded attempt counts, enumerated failure/stop categories, finite usage and an output-limit flag survive. Existing code/recovery allowlists reject arbitrary strings. Privacy tests cover prompts, completions, reasoning, tool payloads, endpoints and credentials. Accepted correction metadata describes the accepted response. |
| Sources-found failure presentation | `AIError.generation` carries stage, eligible evidence count and retrieval mode. The hook and assistant/Q&A message adapters preserve safe context. Six locales distinguish empty content, output exhaustion, refusal, provider failure and unusable output. Document Q&A, sidebar assistant and AskSheet retain retry/composer and AI Settings actions. Existing no-evidence and scope behavior remains covered. |
| Evidence-bounded themes and navigation | The production Ask Library regression asks the reported themes question, recovers from an empty native response and validates quotes/ordinals/locators for two documents. The prompt limits themes to retrieved evidence. Citation/navigation and AskSheet tests retain navigation and incomplete-index disclosure. Restricted, excluded, local-only, unresolved and invented sources remain filtered or downgraded by existing grounding rules. |

## Checks

- Focused Vitest coverage includes LLM API/policy, provider and pinned-provider boundaries, task recovery/truncation/fallback, library budgeting/citations, diagnostics/export/privacy, agent protocol, assistant adapters, AskSheet, Document Q&A and source navigation. Final acceptance: **693 passed, 3 intentionally skipped, 68 suites passed** (plus the opt-in live check passed separately).
- `cargo test --lib commands::llm::tests`: **9 passed on the final native implementation**, including shared native serialization fixtures and actual HTTP retry counts. Existing vendor/deprecation warnings were non-fatal.
- TypeScript checking and the final production build passed. A final compatibility check after retaining legacy text-task transport behavior passed 49 task/recovery/agent-protocol tests. Fresh bundle budget: 5 KB entry, one PDF worker, 27.2 MB total.
- ESLint comparison against unchanged `main` found 16 existing findings and zero introduced findings. The final comparison also introduced zero findings.
- `npm run bench:check` passed: all 67 baselined benchmarks plus the bundle budget. The first run, concurrent with heavy checks, flagged two ambient renderers; the isolated rerun passed. No performance or bundle baseline was changed.
- `openspec validate fix-library-qa-empty-provider-responses --strict` passed; both delta specs and the final checklist were reviewed against the evidence above.
- Ripwire checked caller compatibility and the source quality delta. The library API has no incompatible callers; added complexity was reduced by extracting budget and terminal-error handling. Generic object-wrapper clone findings and small adapter growth remain review signals; no quality acknowledgements were added.
- The UI detector reported incumbent styling and stale design-sidecar warnings. New failure actions reuse existing controls and styling.

## Pre-existing failures verified on unchanged main

A detached checkout of `4ee2cb448` reproduced both unrelated failures from the broader validation run:

1. `AssistantPanelLearningAgent.integration.test.tsx`: cannot find “Learning Agent proposals” within its existing deadline.
2. `i18n-completeness.test.ts`: four existing English keys are missing: `review.inlineEditor.title`, `review.invalidOcclusionGeometry`, `review.imageLoadFailed`, `review.clozeRepairRequired`.

These failures were not suppressed or changed. New generation-failure translation keys exist in all six supported locales.

## Live runtime evidence and limitation

No connected Plethora UI, original selected-provider configuration, or original library index was available. A local OpenAI-compatible runtime was available and was exercised through the production Ask Library/task/provider pipeline with two sanitized retrieved-source fixtures. This is a live model check, not reproduction against the user's original library.

| Field | Observed |
| --- | --- |
| Runtime/model | Local OpenAI-compatible / `lfm3-x86:latest` |
| Eligible retrieved sources | 2 sanitized fixtures from 2 documents |
| Resolved context / output allowance | 16,384 / 4,096 tokens |
| First check | 2 attempts; terminal `length`; first/terminal failure kind `output-limit`; no fabricated answer |
| Second check | 1 attempt; `stop`; validated `supported` answer with verified citations to both fixture documents |

The original provider/model/index failure remains unverified. Empty final content alone is not evidence of broken embeddings. The opt-in live check is `PLETHORA_QA_LIVE=1 npx vitest run src/lib/ai/__tests__/libraryQa.live.test.ts`; ordinary test runs skip it and send no live requests.
