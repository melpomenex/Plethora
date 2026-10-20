# AI Learning device & provider qualification protocol

Source baseline for the protocol: `615570ff`; program:
`openspec/planning/ai-learning-completion-program.md`. Actual platform APIs,
installed models and configured providers remain authoritative. Nothing in this
document asserts a current pass.

## Intended matrix

`P` = intended candidate path; `L` = retrieval must disclose lexical/partial
evidence; `O` = OCR-backed occlusion only with an independently detected OCR
backend; `—` = unavailable through this profile and must pass graceful
degradation instead.

| Profile | Learn | RAG | Tutor | Occlusion | Index | Assessment | Relationships | Worthiness | Agent | Recall |
|---|---|---|---|---|---|---|---|---|---|---|
| Android Nano + LiteRT embeddings + ML Kit OCR | P | P | P | P/O | P | P | P | P | P | P |
| Android Nano, missing embeddings | P | P/L | P/L | P/O | — | P | P/L | P | P/L | P/L |
| Android embeddings only, no generation | — | — | — | — | P | — | P/L read-only existing links | — | — | — |
| Android incompatible native, authorized external + OCR | P | P | P | P/O | P | P | P | P | P | P |
| Linux Ollama generation + embeddings + local OCR | P | P | P | P/O | P | P | P | P | P | P |
| Linux Ollama generation, no embeddings | P | P/L | P/L | P/O | — | P | P/L | P | P/L | P/L |
| Windows system AI + authorized embeddings + detected OCR | P | P | P | P/O | P | P | P | P | P | P |
| Windows unavailable system AI + Foundry + embeddings/OCR | P | P | P | P/O | P | P | P | P | P | P |
| macOS Apple generation + authorized embeddings + OCR | P | P | P | P/O | P | P | P | P | P | P |
| iOS Apple generation + NaturalLanguage embeddings + Vision OCR | P | P | P | P/O | P | P | P | P | P | P |
| Any OS, authorized external generation + embeddings + OCR | P | P | P | P | P | P | P | P | P | P |
| Any OS, no permitted route | — | — | — | manual | lexical/manual | review | P/L read-only links | — | — | — |

Expand each native row into missing/downloading/download-failed/unsupported-
language/model-too-small states, Windows package/LAF/hardware/OS denial, Apple
disabled/unavailable model and Android AICore incompatible/busy. Generation,
embedding and OCR readiness are independent.

## Ten-step protocol

1. **Record identity.** Release commit, build hash/signature, OS/device/SoC/RAM,
   WebView/runtime and native plugin versions, installed model/version,
   language/locale, screen scale, power/thermal state and network mode. Keep
   detailed inventory local; export only redacted diagnostics.
2. **Disposable profile.** Create a fresh profile containing only manifest
   fixtures. Record fresh defaults. Then import the previous stable version's
   settings and fixture library for the upgrade run; verify explicit false
   preferences, existing cards and link origins survive.
3. **Readiness before setup.** Capture capability/readiness rows. Missing model
   must offer explicit setup; Enable All must produce zero downloads, index
   jobs or inference requests. Authorize only the selected setup and destination.
4. **Real entry points.** Learn-this preview/edit/subset save; Ask Library
   citations; tutor hint/explain and card promotion; composer OCR/assist
   approval; index enqueue/status/retrieve; assessment beside a user-selected
   grade; prerequisites/coverage/link lifecycle; worthiness indicator and
   action; Assistant agent intents; recall promotion. Read back persisted
   objects and source links, restart, and navigate again.
5. **Structured failure.** Inject malformed/oversized/untrusted output through
   the deterministic fault seams; confirm bounded validation/repair. Run valid
   real-model cases on hardware. Compare structural/source assertions, never
   generated prose. Record which native schema/fallback path actually ran.
6. **Failure and lifecycle.** Test offline-with-models, provider
   timeout/denial/quota, embeddings absent, text-only/vision mismatch, cancel
   during retrieval/generation/validation/save, tab/source/conversation switch,
   background/resume, download completion race, deleted/edited source and
   duplicate approvals from two views. A commit during cancellation is
   reconciled, never blindly retried.
7. **Consent and privacy.** Deny then grant each disclosure/paid/background
   scoring consent; revoke mid-queue; replace the endpoint. Observe actual
   network destinations/request counts. Fixtures carry canaries; verify none
   reach logs or exported reports. Never capture credentials or payloads.
8. **Resource capture.** 30s idle baseline; 5min scripted reading with scoring
   off/on; one bounded agent run; index+reading contention; then 10
   open/run/cancel/close cycles. Capture frame/input timing, process-tree
   CPU/RSS and model residency separately from retained app leaks.
9. **Repeat.** Run core success and denial/cancel cases at least three times per
   profile. Any nondeterministic functional failure blocks the cell until
   explained and fixed. Record every run, raw artifact location, units and
   conditions; never average failures away.
10. **Cleanup and record.** Export the redacted report, remove the disposable
    profile/fixtures, record cleanup. Unavailable native features get
    `unsupported` plus negative-path evidence, never `pass`.

## Proposed budgets (targets until measured)

| Metric | Target |
|---|---|
| Reader responsiveness | p95 main-thread frame work ≤16.7ms at 60Hz; p95 input-to-visible ≤100ms; e-ink input-to-DOM ≤100ms |
| Scheduling slices | ≤4ms per passage capture/queue/hash slice; no scoring-attributable task >50ms |
| Layout stability | zero source-content layout shift from scoring indicators |
| Bounded workload | concurrency 1, queue ≤8, ≤12 scores/visit, ≤60/hour, remote automatic 0; agent ≤8 tools/20 proposals/60s |
| Cancellation | new work stops immediately; UI stops progress within 250ms; late output never saves |
| Idle CPU | scoring-on adds ≤5 percentage points over scoring-off in the same 5min scenario |
| Retained memory | ≤32MiB mobile / ≤64MiB desktop above warm baseline after 10 cycles; ≤1MiB/cycle slope |
| Storage | score cache ≤128 in memory / ≤10,000 rows; task diagnostics ≤50; feature summaries ≤10 |
| Model/task latency | passage 45s, prerequisites 60s, agent turns 30s inside 60s total; record cold/warm p50/p95 |

These are proposed acceptance targets. A device class without measurements is
not qualified; repository microbenchmarks do not prove native inference
performance.

## Required device classes

Compatible Android phone (Nano/LiteRT) plus an Android device without native
generation and, where advertised, an e-ink/low-power reader; supported iPhone
and iPad; supported Apple Silicon Mac; Windows API-ready hardware plus a
Windows native-unavailable/Foundry case; Linux desktop with Ollama. Record the
actual inventory and RAM. Test wide/narrow desktop, portrait/landscape touch,
font scaling and keyboard/screen-reader paths.

## Commands

Use the repository commands documented in the program:

```sh
npx tsc --noEmit
npm run lint
npm run test:run
npm run test:scripts
npm run build
npm run build:check
npm run bench:check
npm run check:bundle
npm run bench:memory:check
npm run test:visual
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
npm run ai:evidence:validate
```

Native builds (run on their supported hosts, recording the exact host):

```sh
npm run tauri:android:build
npm run tauri:ios:build:sim
npm run tauri:ios:build:device
npm run test:ios:setup && npm run test:ios:smoke && npm run test:ios:e2e
```

iOS simulator evidence remains simulator evidence. Inspect the generated
Gradle/Xcode schemes before selecting native test commands.

## Release blockers

| Blocker | Closure evidence |
|---|---|
| Unapproved private/cloud/paid operation or diagnostic leak | Denial/revocation/network-canary regressions plus device reproduction; exported report has zero canaries |
| Silent object creation, duplicate retry, wrong source linkage or scheduler mutation | Entry-to-readback tests, backend concurrent-save tests, real profile reproduction |
| Missing/failed advertised profile evidence | Required layers pass at the release commit, or the profile is explicitly disabled with tested limitation |
| Native unsupported state misreported ready | API-authoritative dependency/negative-path test and device UI |
| Cancellation/timeout leak or unbounded work | Counter/clock tests plus native cancel/background trace |
| Responsiveness/memory/CPU/bundle/benchmark regression | Local gates and reproducible device runs within reviewed budgets |
| Upgrade loses preference/content/link origin | Previous-stable fixture upgrade with readback |
| Missing schema/citation/persistence proof | Structured validation, source navigation, storage/readback on the required route |
