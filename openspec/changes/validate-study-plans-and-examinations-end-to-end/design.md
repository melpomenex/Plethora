## Context

C1–C7 define all behavior. This change adds no requirements and must not be used to land unfinished buttons/engines. Run A/Run B verification establishes that archived checkboxes and backend-only presence are not evidence of user-visible completion. Read program `07-GOLDEN-SCENARIO.md` as normative test oracle, `06-TRACEABILITY-MATRIX.md`, `08-RISK-REGISTER.md` go/no-go gates and `09-IMPLEMENTATION-HANDOFF.md`.

## Goals / Non-Goals

**Goals:**

- Reproducible offline/fake-provider end-to-end proof through actual UI+SQLite, not only function tests.
- Independent negative, recovery, migration, privacy/security, accessibility, performance and scheduler-isolation evidence.
- Explicit real-model quality/capability and physical-device qualification outcomes.
- Trace every acceptance claim to a durable artifact and reproducible command/device record.

**Non-Goals:**

- New user behavior/capabilities or changing data contracts to simplify tests.
- Live paid inference/network in normal CI/unit/E2E runs, claims of model calibration or unsupported universal provider quality.
- Cross-paper psychometric equivalence or treating snapshots without interaction as success.
- Modifying the misleading active flashcard-quality change or bypassing repository test/bench rules.

## Decisions

### Golden harness

Use one synthetic three-source course corpus exactly as golden doc: deterministic text PDF, EPUB/CFI range, local-video transcript/extracts, pre-existing confirmed concepts/links, fixed `FIX_CLOCK`, one unrelated FSRS/Queue sentinel, fake task responses keyed by task/request/step/attempt. Fresh native SQLite database per isolated run; track alias→actual app IDs; externally block network in ordinary harness. A second identical run must normalize to same hashes/points/order/evidence/manifest.

Six-question initial paper elicits every discriminant and deterministic/rubric outcomes. Timeout/retry scripts occur in isolated side fixtures or prescribed step so the golden number remains deterministic. Expected report/aggregate/evidence values come from golden doc, not screenshots alone. All steps have UI action+persisted assertions; no passing backend-only workflow.

### Test layers and evidence artifacts

- Pure unit: allocators, validators, topology, source lifecycle, grades, evidence/gaps and canonical JSON.
- Native integration: repositories/migrations/jobs/leases/transactions/correction/reconcile/deletion/no FSRS writes.
- Component/harness: keyboard/mobile/data/failure/provider/privacy/retry and reachable controls.
- Native Playwright/E2E: create→generate→edit→restart→paper→interruption→mixed grades→sources→remediation→reassess→restart.
- Manual real-model/device: named provider/model/build/data disclosure plus curriculum/question/rubric rubric-quality rubric, device lifecycle/navigation/timing/offline observations.

Each earlier change has a verification.md with actual evidence. C8 creates its own verification report and `evidence/` Markdown/JSON snapshots only, containing synthetic fixture data/no real personal corpus/secrets. A command or platform not run is `NOT RUN` with blocker; cannot become Pass by prose. Browser/PWA expected unsupported workflow gets explicit refusal test rather than silently empty tables.

### Provider capability matrix

Evaluate curriculum generation, question generation for each type, short-answer analytic grading and essay analytic grading separately. Fake-provider tests establish schema/control flow only. Real model rows capture provider id/model exact version class, device, actual fallback, latency/output token use, repeated samples and factual/pedagogical failures. Rating is QUALIFIED, NEEDS-REVIEW-ONLY or NOT-QUALIFIED per task; no providerKind implies quality. Explicit unsupported routes are gated/presented honestly. No silent alternate route in evaluation.

Full essay fallback cannot be marked automatically Final by product policy; matrix confirms that behavior. Source-only and source-plus-model-knowledge external-claim restrictions are both tested. Endpoint destinations cover device/loopback/LAN/remote/unknown, independent generation and embedding, AI/local-only exclusions, cloud disclosure and paid consent/fallback denial.

### Platform/mobile/accessibility evidence

Use active `validate-ai-learning-cross-platform-readiness` matrix conventions without changing it. Supported Linux/macOS/Windows desktop and Android/iOS native rows record build SHA/device/OS/provider. Exercise startup/resume, process kill, app suspension, timer expiration offline, input persistence, source focus/play and keyboard/touch/audio/large text as available. Physical media codec support is explicit. Unavailable device says NOT RUN/UNSUPPORTED and blocks any universal release claim.

Accessibility checks combine repository test patterns with manual keyboard/screen-reader smoke: focus order/return, semantic fieldsets, labels/errors, 200% zoom/reflow, contrast, 44px touch targets, reduced motion/no animation requirement and non-disruptive status announcements. Dense DAG visualizations are optional and never required to complete scenario.

### Performance and reliability gates

Benchmark strict 24-node/96-edge DAG, 40-slot quota/question validation, 40-item objective scoring and 1000-row evidence fold with stable seeded fixtures. Inputs use `seededRandom(seed)` from `src/test/bench-support.ts`; no Math.random/clock sizing/network/fs/Tauri runtime; consume module sink; bench body void. Run `npm run bench:check` and bundle check; intentional new baseline rows derive from measurements with rationale. Never loosen an existing budget to conceal regression. Record memory/progress/cancel workload on physical mobile separately.

No exactly-once provider billing claim: lease/checkpoint idempotency provides once-only domain records despite at-least-once model execution. Provider cost disclosure/resume and optional inference privacy remain observable in journal.

## Risks / Trade-offs

- **Fake provider cannot prove educational quality** → separate scripted vs real-model evidence and qualification restrictions.
- **Large E2E is flaky** → deterministic clock/providers/local fixtures, alias normalization and isolated negative clones; no sleeps based on arbitrary inference time.
- **Physical matrix unavailable** → explicitly unfinished qualification; do not certify unsupported mobile/global readiness.
- **Golden self-consistency can be wrong** → independent arithmetic/source/revision/score oracle and negative mutations ensure tests detect errors.
- **Qualification discovers feature gaps** → return to owning Cx task and rerun its gate; do not hide feature implementation inside C8.

## Migration Plan

Install no unnecessary dependencies; use existing Vitest/Rust/Playwright tools. Add fixtures, tests and evidence incrementally after C1–C7 gates. No production/user data migration is performed by C8 itself. Test migrations on copies/temp databases only. No branch/commit/push or release is implicit in validation; release authority remains separate.
