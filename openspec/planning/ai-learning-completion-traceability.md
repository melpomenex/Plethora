# AI Learning completion: requirements and validation

This matrix is an implementation/test plan, not a passing feature report. Requirement titles match the delta specs exactly. Task numbers resolve within the named change. **Proposed** test filenames below are implementation destinations; existing test evidence is listed separately. Test data is synthetic and entry tests begin at actual UI/orchestration boundaries.

Change aliases:

- **A**: `complete-ai-learning-agent-integration`, `specs/ai-learning-agent/spec.md`
- **W**: `complete-reader-extract-worthiness-integration`, `specs/ai-knowledge-relationships/spec.md`
- **K**: `complete-knowledge-relationships-and-coverage`, `specs/ai-knowledge-relationships/spec.md`
- **F**: `harden-ai-learning-feature-initialization`, `specs/ai-learning-feature-readiness/spec.md`
- **D**: `implement-ai-feature-operational-diagnostics`, `specs/ai-task-architecture/spec.md`
- **V**: `validate-ai-learning-cross-platform-readiness`, `specs/ai-learning-release-readiness/spec.md`

## Requirements-to-tests matrix

| Delta requirement / test group | Tasks | Unit / component | Integration / backend / E2E | Privacy, regression and platform evidence |
|---|---|---|---|---|
| A: Learning Agent in the existing Assistant | A1.1, A2.2–2.5, A4.1 | Proposed `AssistantPanel.agent.test.tsx`: explicit mode, absent model/flag, both presentations; palette availability tests | Actual Assistant/palette → adapter → fake provider; reopen conversation never resumes; E2E chapter and six intent families | Existing chat/tool artifacts remain; mobile/desktop qualified through V3 |
| A: Agent source scope and provenance | A1.1–1.3, A3.1, A3.3, A4.2 | Proposed `learningAgent.test.ts`: immutable scope, three-paper evidence map, invalid handle, ephemeral ID and stale revision | Production retrieval/source navigation plus saved-item source readback; backend valid IDs/locators | Injection eval extension; attachment removal and doc-switch regression; native/local/external source integrity |
| A: Incremental progress and complete cancellation | A2.1–2.2, A4.2 | Extend bounds/injection tests: slow tool, hard deadline/final turn, same-prefix runs; component Stop/switch | Delayed retrieval/native response, app background, flag-off/unmount; count zero later writes | Cancel never falls back remotely; real native abort/late suppression through V3 and V4.1 |
| A: Agent proposals use validated individual approval | A3.1–3.3, A3.6–3.7, A4.1 | Static preview grounding/duplicate/edit/subset tests; unavailable link adapter | Assistant → existing preview → exactly selected saves; extract/tag/occlusion approvals | Zero unapproved domain writes or scheduler submissions; malicious source cannot expand authority |
| A: Retry-safe agent acceptance | A2.5, A3.3–3.5 | Numbered cloze/hint/range and accepted-state tests | Existing-writer backend idempotency/concurrency/migration; lost-response, partial batch and provenance repair E2E | Save cancellation reconciles commits; restart readback per platform |
| A: Destination-aware agent authorization | A1.4, A4.2 | Local vs remote endpoint and dual generation/embedding preflight tests | Denied/revoked/change-destination zero-network assertions at production submit | Redaction canaries; Ollama internal cloud-kind regression; external cost consent on each qualified profile |
| W: Passage extract-worthiness — eligibility and budgets | W2.1–2.4, W5.1–5.2 | Proposed `passageScoring/controller.test.ts`: dwell/idle/queue/concurrency/visit-hour quotas, strict 0.75, role exclusions | Actual reader mount/scroll burst → bounded calls, no full-document scan; disabled/background/cancel zero work | No automatic remote work; native model contention and paired resource capture V4.1 |
| W: Passage extract-worthiness — cache, revisions and dismissal | W1.1–1.4, W4.1, W5.1 | Hash/model/normalization revision, identical-prefix, geometry-vs-identity and source-specific dismissal tests | Rust cache metadata/invalid-input/legacy-row/LRU/cascade; reopen cache hit and edit invalidation | No raw source in cache/log; unchanged passage never re-infers; ephemeral source stays session-local |
| W: Passage extract-worthiness — formats, actions and accessibility | W3.1–3.4, W4.1–4.3, W5.1 | Per-adapter mounted geometry/focus/44px touch/selection tests; unsupported scan/frame case | PDF page/range, EPUB CFI, HTML/Markdown offsets, RSS saved/ephemeral → explicit existing action/source readback | No layout shift/selection loss; no automatic OCR/import; device font/rotation/e-ink and assistive-tech tests V3 |
| K: Evidence-based coverage with hedged language | K1.1–1.4, K2.1–2.2, K4.2 | Proposed `concepts/coverage.test.ts`: exact deterministic predicates, four states, name parity, activity orthogonality, non-English limits | Fixed current/stale/unindexed/card/history records through real coverage orchestrator; selection UI links | Model cannot supply evidence IDs/mastery; remote-query denial; lexical/semantic/provider variations |
| K: Typed concept links with confidence and provenance | K3.1–3.4, K4.3, K5.1 | Task schema/threshold/caps, flag independence, draft lifecycle UI tests | `concept_repository` tests extended for endpoint authority, directional uniqueness, caps, concurrent edit/save, origin migration; explicit Save/Accept/Dismiss/restart | No background or unapproved link persistence; preserved AI origin; injected endpoint rejected at IPC |
| K: Related-content discovery | K2.3, K4.1–4.2, K5.1 | Selection registry and graph projection/backlink component tests | Two-document E2E → source navigation → stale/reanalyze/remove; reuse shared retrieval | No second index; cancelled/denied query zero work; per-platform actual locator navigation |
| F: Per-feature dependency readiness | F1.1–1.3 | Proposed `features/registry.test.ts`: ten feature descriptors, state precedence/substatus, lexical degradation, pending probes | Real registry with injected platform/model/index snapshots; UI displays exact blockers | No inference from compile/platform alone; unsupported native + permitted configured path works |
| F: Capability-aware Enable All | F2.1–2.2, F4.1 | AIProviderSettings activation tests: partial readiness, unrelated preferences and independent link flags | Actual Settings action updates main preferences once; fresh/upgrade E2E | Active-recall mode/freeform/provider/cost/disclosure preferences preserved; no fabricated full-ready state |
| F: Setup is independently authorized | F1.2, F2.3–2.4, F3.3 | Explicit recovery controls vs passive mount/search/Enable All, consent denial | Existing model/index setup handlers and backend gate regressions | Zero downloads/enqueue/inference on flags/hydration; actual authorized setup per platform |
| F: Restart and upgrade reconciliation | F3.1–3.2, F4.1 | Missing vs false flags, legacy partial/corrupt settings fixtures | Interrupted setup model/index re-probe and prior-stable fixture upgrade | No overwriting intentional off values, no repeated expensive job from hydration |
| F: Readiness reacts to policy changes | F1.3, F3.3, F4.2 | Provider removed mid-probe, consent/model revision invalidation | Settings target/reveal/navigation/coverage gates; no side effects from search | Endpoint/permission revocation tested before actual execution; narrow/mobile accessibility |
| D: Feature operational evidence in AI Diagnostics | D1.1–1.3, D2.1, D5.1 | Extend `diagnostics.test.ts`; proposed modal tests: all features, static/dependency/operational/stale/unknown | Generation success followed by preview/save/navigation failure; reset/restart history | No stale green/compiled-equals-working assertion; current route and stage visible on all OS families |
| D: Explicit bounded fixture smoke tests | D3.1–3.5, D5.2 | Proposed `featureSmoke.test.ts`: finite run, Stop, absent adapter, per-case authorization | Actual feature orchestration with synthetic sources; backend storage only in isolated fixture profile | No personal query/write/backfill; mocked retrieval explicitly labeled; actual selected native model qualified separately |
| D: Privacy-safe feature observation and redacted reports | D1.1, D4.1–4.2 | Recursive canary/property tests for text/credentials/URLs/paths/IDs/raw model/error strings and size cap | Actual modal export/clear; local-only report, no network upload or inference | Allowlisted values, no private completions/prompts even in error branches; fixture/device report review |
| D: Actionable diagnostic recovery | D2.2–2.3, D5.2 | Recovery map and Settings search component tests | Missing embedding model → existing setup explanation; keyboard/touch reveal | Navigation never authorizes setup/paid operation; localized labels and no private search values |
| V: Platform feature qualification matrix | V1.1–1.3, V3.1–3.6 | Manifest completeness/revision/layer validation | All design profile cells, plus missing/downloadable/unsupported routes | Pending device evidence blocks advertising; simulator cannot satisfy native pass; each model/schema capability independent |
| V: Reproducible privacy-safe qualification protocol | V1.2, V2.1–2.4, V3.1–3.6 | Synthetic locator/canary fixtures and upgrade regression | Real entry/readback/restart, consent/failure/cancel/duplicate/source-edit protocol | Actual network destinations and redacted reports; no authoritative grade mutation |
| V: Measured resource and responsiveness gates | V2.3, V4.1–4.2 | Counter/clock/leak tests and seeded pure benchmarks | Paired device reading/scoring/agent/index runs, process-tree memory/CPU, local bench/bundle/memory gates | Proposed targets remain targets until measured; device classes not inferred from Linux/interim memory baseline |
| V: Release blockers have explicit resolution | V1.3, V4.3–4.4 | Evidence manifest rejects missing/stale passing stages | Final release-commit matrix, blocker reproducer/closure reruns and implementation-status update | Disabled unsupported scope needs its own passing degradation tests; no mock-only claim of production readiness |

Every new functional requirement has tasks and observable tests above. Detailed failure/edge scenarios in each delta spec are additional test cases within its row, not optional prose. No main-spec requirement is removed. W and K own disjoint existing requirement headings so their archive order cannot overwrite each other's full blocks.

## Existing proof and its limits

| Existing suite / source | What it currently proves | What it does not prove |
|---|---|---|
| Agent `agentTurn.test.ts`, `bounds.test.ts`, `injection.eval.test.ts` | Structured parsing, local bounds and fake-provider injection contract | Actual Assistant entry, native model adherence, approval/save/source lifecycle |
| `runTask.test.ts`, `schemas.test.ts`, `diagnostics.test.ts` | Task path/validation and diagnostic allowlist behavior | Every feature is integrated or every arbitrary export value is safe |
| `LearnThisProposalSheet.test.tsx` | Working existing preview/subset behavior under mocks | Multi-source agent provenance, cross-writer atomicity/idempotent retries |
| `AiIndexPanel.billing.test.tsx` | Existing paid-index UI gate under mocks | Feature-wide initialization or current native embedding execution |
| `SelectionActionsSheet.test.tsx` | Current selection action/result behavior | Evidence coverage/links or missing reader score integration |
| `answerAssessmentIntegration.test.ts` | Post-grade assessment recording/error isolation | Native inference and resource cancellation; it must not be weakened |
| Rust `concept_repository.rs`, `passage_scores.rs`, `ai_learning/*` tests | Existing repository/cache/retrieval helper coverage (inspected) | Frontend integration, advertised platform execution or newly planned hardened invariants |
| Native provider/OCR/occlusion/tutor tests (inspected) | Reusable capability/fixture/orchestration test seams | Physical-device feature qualification |

Executed baseline: 10 files / 145 tests passed; exact command and warnings are in the audit. Rust and native suites in this table were **inspected, not run** in this planning task.

## Specification and document validation record

Executed on 2026-10-20 with installed `openspec`, after all proposal/design/spec/task artifacts existed:

| Change | `openspec validate <change> --strict` | Artifact status | Unchecked implementation tasks |
|---|---|---|---|
| `complete-ai-learning-agent-integration` | Pass, exit 0 | proposal/specs/design/tasks done | 19 |
| `complete-reader-extract-worthiness-integration` | Pass, exit 0 | proposal/specs/design/tasks done | 17 |
| `complete-knowledge-relationships-and-coverage` | Pass, exit 0 | proposal/specs/design/tasks done | 16 |
| `harden-ai-learning-feature-initialization` | Pass, exit 0 | proposal/specs/design/tasks done | 12 |
| `implement-ai-feature-operational-diagnostics` | Pass, exit 0 | proposal/specs/design/tasks done | 16 |
| `validate-ai-learning-cross-platform-readiness` | Pass, exit 0 | proposal/specs/design/tasks done | 17 |

“Artifacts done” is OpenSpec planning status, not implementation completion. All **97** implementation checkboxes remain unchecked. A local document check found no broken relative Markdown file links across the 27 authored Markdown files; `.openspec.yaml` scaffolds were created by the CLI. The two knowledge deltas modify disjoint requirement titles. Source review corrected the tutor component path and caught additional source-reference/destination/model-identity seams before finalization.

Application build/typecheck/lint, full tests, Rust/native compilation, benchmarks and device qualification are future implementation/release work, not implicit results of proposal validation. The focused unchanged-baseline host suite's 145 passing tests do not establish the new production workflows.

## Implementation progress (2026-10-20, after execution)

The six changes have been implemented in the working tree. Task accounting is
maintained in each `tasks.md`; this section records the remaining gaps rather
than duplicating the plan.

| Change | Checked / total | Remaining |
|---|---|---|
| A `complete-ai-learning-agent-integration` | 19 / 19 | — |
| W `complete-reader-extract-worthiness-integration` | 17 / 17 | — |
| K `complete-knowledge-relationships-and-coverage` | 16 / 16 | — |
| F `harden-ai-learning-feature-initialization` | 11 / 12 | full fresh/upgrade E2E through native setup (4.1); partial/upgrade/restart coverage added |
| D `implement-ai-feature-operational-diagnostics` | 15 / 16 | OCR/occlusion smoke adapter (3.3) |
| V `validate-ai-learning-cross-platform-readiness` | 11 / 17 | all native/device execution (3.2–3.6), measured device budgets (4.1) |

Local verification (typecheck, scoped and full Vitest, build, bundle,
`bench:check`, Playwright diagnostics E2E, OpenSpec, evidence validation, Rust
check and library tests) is recorded in
`docs/ai-learning-readiness/verification-results.md`. The twelve frontend and
one Rust failures that remain also reproduce at the audited baseline; see
`docs/ai-learning-readiness/release-blockers.md §4`.

No native, physical-device or real-provider evidence has been recorded. The
machine-checked manifest has zero records and every advertised matrix cell
remains pending.
