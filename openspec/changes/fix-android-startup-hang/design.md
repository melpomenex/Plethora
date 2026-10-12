## Context

See `proposal.md` for the reported Android behavior. This is a follow-up to the implemented portions of `fix-android-cold-start-data-loading` and `improve-startup-database-loading`, whose bounded snapshot and collection-safe hydration remain in place. The former still has unchecked device-verification tasks; older design documents also name sync modules that no longer exist, so current source is the implementation reference.

Evidence collected while proposing this change:

| Boundary | Current evidence | Consequence |
| --- | --- | --- |
| First native round trip | `src/lib/tauri.ts` records earlier logcat measurements of 30,068 / 30,074 / 30,067 ms versus roughly 1.5 s native setup, plus a dropped callback. | Treat bridge dispatch/response as the leading suspect; these are historical source annotations, not measurements reproduced in this proposal. |
| Retry ownership | Five readiness probes have 5 s watchdogs and 1 + 2 + 4 + 8 s backoff. `runAndroidStartup` can repeat the exhausted readiness cycle three times with another 1 + 3 s backoff. | A permanently hung readiness request can keep the coordinator loading for approximately 124 s. Its 8 s snapshot watchdog does not cover the preceding readiness wait. |
| Bootstrap | `main-bootstrap.ts` paints a placeholder, starts an unbounded main-module import, and offers tap-to-reload only after 60 s. | A stall before the startup store mounts escapes the snapshot watchdog entirely. |
| Optional work | `main.tsx` installs console forwarding and starts haptics before the full application render; account, billing, provider synchronization, and other integrations are deferred only to first paint. | First paint does not guarantee local readiness or an available bridge. Trace both direct plugin invokes and gated repository invokes. |
| Diagnostic transport | `consoleLogcatBridge.ts` replaces console methods with plugin-log invokes and retains original methods without calling them. | Startup messages can themselves wait on the suspected bridge; absence of logcat messages does not locate the stall. |
| Native gate | `BackendReadyState` protects database open/recovery, migrations, and required managed services; setup marks it ready late in `src-tauri/src/lib.rs`. | Preserve the safety boundary while measuring each awaited phase and any synchronous work on its path. |
| Connected device | Read-only ADB inspection found a Pixel 9 Pro XL running package `com.plethora.app`, version 3.2.0, with missing-callback warnings. The available buffer had no matching startup phase durations. | Callback loss warrants investigation but does not prove the 30 s stall or identify its cause; reloads can also produce these warnings. |

The build already uses split chunks and disables native module preloading; `openspec/project.md` contains an older single-bundle description. Wry 0.55.1 is vendored through the Cargo patch and carries an iOS workaround. Its Android IPC calls the handler under a shared mutex, and custom-protocol requests have a synchronous timeout wait. Neither fact alone demonstrates the responsible blocker.

## Goals / Non-Goals

**Goals:**

- Localize the first long wait to a named operation and thread, then remove that wait with the smallest supported change.
- Make bootstrap, readiness, snapshot loading, recovery presentation, and deferred integrations obey one Android startup lifecycle.
- Retain database safety, bounded payloads, current collection semantics, and existing successful data.

**Non-Goals:**

- Broad library, database, sync, animation, or frontend redesign.
- Changing desktop, iOS, or PWA startup policy, updating dependencies speculatively, or disabling native platform features to improve timings.
- Treating activity-start time or assignment of `data-plethora-ready` after `render()` as proof that local data is visible and interactive.

## Decisions

### 1. Measure each boundary independently and reproduce the blocking path

Use one launch epoch to correlate native activity/setup and frontend bootstrap, main import, committed shell frame, first command dispatch, native handler entry, readiness completion, response delivery, snapshot hydration, first visible local data, and overlay removal. Use monotonic elapsed time within each runtime; calibrate cross-runtime timestamps explicitly rather than subtracting unrelated clocks. Include command allowlist labels, attempt counts, outcomes, payload counts/bytes, build identity, Android/WebView version, and thread names. Exclude titles, content, document identifiers, tokens, and command arguments.

Preserve original WebView console output for the small allowlisted startup trace and store a bounded local diagnostic ring. Native setup writes its own markers without waiting on frontend IPC. Native forwarding must not recursively forward transport warnings, grow an unbounded queue, or issue one extra IPC request for every startup marker. Flush any buffered forwarding only once local startup succeeds.

Capture thread stacks or a bounded system trace during an observed stall, distinguishing the UI, JavaBridge, WebView resource, and Rust worker threads. Compare a baseline build with diagnostic-only variants that defer suspected optional work individually. A blocker is identified only when the trace names its wait and a controlled change removes it. Alternative rejected: inferring a database problem from the readiness label, or assuming that all missing-callback warnings have the same cause.


### Current diagnosis evidence (2026-10-12; task 1.4 remains open)

The current GitHub release asset (same official signing certificate) was
installed as an in-place update. The user still reports a cold-launch hang,
and its existing frontend diagnostics record a 40,035 ms failed readiness
cycle. The user reports local data only, without an account or saved
integrations. Its native setup/thread timeline is unavailable: existing
native startup labels are written to an app-private file, not logcat.

The separate release benchmark package is usable with the 1,000-document /
5,000-item fixture. Three instrumented launches take 15,874–16,764 ms, with
105–119 ms readiness responses. Its application crate uses diagnostic
optimization level 0; these are not final reference performance results.
The independent Wry probe shows version queries return in 2–3 ms, after the
approximately ten-second pre-query interval. A Native Back-enabled repack
with byte-identical native library, manifest and Tauri config also completes
all three launches. These controls do not reproduce the production wait.

A faster diagnostic native compiler profile is being compared because the
extra pre-WebView time could hide an early-startup race. This is a hypothesis,
not a confirmed cause. The console-forwarding control uses the same frozen
baseline sources; no owning-boundary fix or startup-policy change is selected
until the original wait is localized. See `evidence/README.md` and the
source/APK identities embedded in its reports.

An opt-in signed production trace is prepared for measurement against the
existing local data. It preserves the verified v3.2.0 console forwarder,
records native context construction separately, and captures bounded JVM
stacks at two and ten seconds. It does not enable fixture seeding. The
production trace option and native markers compile, but an official-key APK
has not been produced or measured; the host lacks that signing key. This is
additional diagnosis instrumentation, not evidence of a selected fix.

### 2. Fix the measured blocker at its owning boundary

Follow the demonstrated call chain rather than prescribing a vendor patch now:

- If a startup plugin or synchronous application handler waits on work scheduled to its own blocked thread, dispatch the work asynchronously or offload blocking I/O while preserving completion and failure behavior.
- If native readiness contains nonessential awaited work, register required state promptly and defer that work after readiness; do not move database recovery, migrations, or command-required state outside the gate.
- If Wry IPC locking, resource handling, or response delivery is responsible, make a focused Android-only patch with a reproducer and guard against reentrancy, lost callbacks, and response-order changes. Preserve the existing iOS patch.
- If module loading/evaluation accounts for the delay, remove the measured optional import from the critical graph and verify emitted chunks rather than relying on source-level dynamic import syntax.

Update this design with the confirmed operation, stack evidence, and chosen fix before marking implementation diagnosis complete. Alternative rejected: increasing existing probe timeouts, bypassing readiness, or changing WebView dependencies without a reproducer.

### 3. Share one absolute deadline across Android automatic startup

Create the launch epoch and a 15 s monotonic deadline in the tiny bootstrap, before importing the main graph. The startup coordinator, shared native-readiness gate, per-attempt watchdogs, and retry delays consume its remaining budget. Keep readiness and data retries bounded, but a nested retry must not start a fresh full deadline. Ordinary commands continue to share the readiness promise; a caller cannot extend the startup budget or create a probe storm.

On deadline expiry, stop scheduling automatic work, settle coordinator callers with a recoverable failure, release relevant in-flight entries, and expose recovery controls on the currently available surface. The bootstrap must render recovery if the main graph never settles; the app must reveal its recovery state if it has mounted. End a blocking overlay by the shared deadline, not another deadline starting at overlay mount. Native migrations continue safely; timeout does not mean native cancellation or permission to query early.

Use epoch and collection/request generations to prevent late completions from replacing a newer explicit retry, producing stale data, or hiding recovery. Explicit retry starts one new shared epoch/budget; bootstrap reload remains available for a failed module load. End the startup deadline on success so subsequent ordinary commands are unaffected. Alternative rejected: independent readiness, snapshot, overlay, and bootstrap timers with cumulative multi-minute waits.

### 4. Admit optional work after the first usable local screen

For Android, define local success as a current-collection snapshot (including a confirmed empty result), a committed visible surface, and removal of any interaction-blocking startup presentation. Hold optional imports and IPC until that success, then start them once in bounded batches that yield to input. On failure, hold them until an explicit retry succeeds. Keep original console diagnostics active throughout.

Audit haptics setup, native log forwarding, provider synchronization, account/entitlement refresh, billing, reminder scheduling, legacy migrations, debug store exposure, restored hidden viewers, and native optional services against this boundary. Defer only automatic initialization; a feature explicitly invoked by the user keeps a supported on-demand path. Incoming share/deep-link intents remain queued and are dispatched after their required state is ready. Alternative rejected: first-paint-only deferral, which currently allows optional work to race the first usable data and bridge response.

### 5. Validate release launch behavior using the correct endpoint

Use a repeatable launch harness on the reference Pixel 9 Pro XL with a disposable fixture/profile and approximately 1,000 documents / 5,000 learning items. Do not reset or overwrite the user's installed data. Record the exact source/build identity and WebView version; use a release APK with remote WebView debugging disabled. Measure at least 20 process-cold launches from activity creation to the first usable local screen, report all samples, median, and nearest-rank p95, and require p95 at or below 5 s. This end-to-end target is distinct from the earlier startup query/first-data fixture targets.

Repeat offline, with saved optional integrations enabled but their services unavailable, and with animation enabled/disabled. Cover empty data, existing schema/migration safety, artificial delayed/dropped callbacks, collection changes, explicit retry, and warm resume. Keep deterministic tests for deadline composition and response generations; device timing belongs in the harness, not a flaky unit test.

Run targeted frontend/native tests and the repository's `npm run bench:check` gate for implementation. Intentional measured performance changes update `scripts/perf-baselines.json` with rationale in the same implementation change; update bundle budgets only with measured justification. The proposal itself changes documentation only and needs OpenSpec validation.

## Risks / Trade-offs

- [Profiling or logging changes startup timing] → Use a minimal bounded diagnostic trace, compare the same release configuration before/after, and verify again without invasive tracing.
- [A real first-run migration exceeds 15 s] → Keep migration running safely, expose progress/recovery, and permit retry after readiness; the five-second performance fixture uses an already-migrated database.
- [Timed-out native invokes cannot be cancelled] → Invalidate their logical epochs, cap retries and queued work, and reject stale completions; do not claim timer expiry stopped the native operation.
- [A bridge-level patch affects platform stability] → Require a minimal reproducer before touching vendor code and test Android callbacks plus iOS compatibility if shared files change.
- [Deferred integrations change launch behavior] → Retain intent queues and on-demand feature initialization; verify configured features initialize exactly once after local readiness.
- [A deadline cannot execute while the JavaScript thread itself is blocked] → Diagnose and remove synchronous thread blockage; demonstrate timer/input responsiveness on device rather than treating watchdog tests as proof.

## Migration Plan

1. Add phase markers/harness and capture a baseline without changing database state.
2. Confirm the blocking operation and add the regression reproducer; record evidence here.
3. Apply the targeted fix, shared deadline, independent diagnostics, and Android optional-work admission.
4. Run deterministic checks, performance gates, and release device comparisons; store the measurement report beside the change artifacts.
5. Complete the overlapping Android verification obligations with actual evidence before declaring the startup problem fixed.

No database migration is planned. Rollback restores the previous startup control/bridge implementation while retaining the measurement harness; reverting a bridge patch must preserve the existing iOS workaround and user data.
