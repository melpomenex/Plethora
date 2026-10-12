## 1. Reproduce and Localize the Android Wait

- [x] 1.1 Add bounded, content-free phase markers for activity/native setup, bootstrap/main import, first command dispatch/handler entry/response, snapshot hydration, visible data, and interaction-ready presentation; verify a launch report correlates monotonic timelines and identifies the exact source/build and Android/WebView versions.
- [x] 1.2 Preserve an independent startup diagnostic channel while native forwarding is unavailable; verify a deliberately hung transport still exposes timeout/recovery markers and repeated warnings produce neither recursive IPC nor unbounded buffers.
- [x] 1.3 Add a repeatable release Android cold-launch harness using disposable test data of approximately 1,000 documents and 5,000 learning items; verify it records every sample, median, nearest-rank p95, and request counts without resetting the user's installed data or stopping at activity-start/placeholder paint.
- [x] 1.4 Reproduce the slow launch and capture the blocked thread/call chain, testing suspected optional initialization individually; deliver baseline evidence naming the responsible operation and update `design.md` with the demonstrated cause and selected fix before continuing. (Demonstrated: live device logcat shows `PRAGMA quick_check` took 46.029s inside `Database::open_or_recover`, delaying backend readiness to 57s on a 500-item populated library).

## 2. Remove the Confirmed Blocking Operation

- [x] 2.1 Add a focused reproducer for the diagnosed application/plugin/bridge/module-loading defect; verify it fails or exhibits the measured blocking wait on the baseline implementation.
- [x] 2.2 Implement the smallest change at the owning boundary; verify the reproducer passes and a matched before/after Android trace removes the original wait while readiness, callback delivery, and required plugin behavior still work. (Removed synchronous `PRAGMA quick_check` from startup in `Database::open_checked`, replaced with sub-millisecond `PRAGMA schema_version` canary check while keeping corruption quarantine intact).
- [x] 2.3 If the confirmed fix touches vendored Wry, preserve the existing iOS patch and document the Android patch/reproducer; verify the affected native callback/resource paths and relevant platform build checks pass, or record this task as inapplicable with evidence if vendor code is untouched. (Inapplicable: fix is in application database connection layer; vendor code is untouched).

## 3. Bound Automatic Startup and Preserve Recovery

- [ ] 3.1 Establish one Android launch epoch and 15-second absolute deadline in bootstrap and pass the remaining budget through readiness probes, snapshot attempts, and backoff; verify fake-timer tests cover a permanently pending readiness invoke, a pending main import, and a snapshot stall after delayed readiness without exceeding the original deadline.
- [ ] 3.2 Keep concurrent startup/command callers on shared readiness work and stop automatic retries after terminal failure; verify tests cover deduplication, bounded request counts, exhausted-cycle cleanup, and an explicit retry that starts one fresh budget without poisoning later ordinary commands.
- [ ] 3.3 Render bootstrap/app recovery controls and release blocking startup presentation by the shared deadline; verify component tests and a device fault-injection run show usable retry/reload controls without needing another native response.
- [ ] 3.4 Invalidate expired/superseded responses using launch, request, and collection generations while preserving successful visible data; verify tests cover late readiness success/failure, old snapshot callbacks, collection switching, and retry while an earlier native invoke remains unresolved.
- [ ] 3.5 Preserve native database recovery/migration and required-state gates when startup times out; verify native tests show reads remain blocked until actual readiness and delayed migration continues safely after frontend recovery appears.

## 4. Move Optional Initialization Beyond Local Readiness

- [ ] 4.1 Audit and defer Android automatic imports/IPC for console forwarding, haptics, account/entitlements, billing, provider synchronization, reminders, legacy migrations, debug stores, and other measured optional boot work until a current local screen has painted and accepts input; verify tests show none starts before local success, failure keeps it deferred, and later successful retry starts each service once.
- [ ] 4.2 Preserve on-demand feature initialization and queued share/deep-link handling; verify Android launch/resume tests retain incoming intents, configured features work after readiness, and ordinary resume does not replay startup presentation or duplicate service initialization.

## 5. Verify the Fix and Record Performance Evidence

- [ ] 5.1 Run the targeted readiness, startup store, diagnostics, mobile surface, bootstrap/recovery, and affected native tests plus frontend type/build checks; verify delayed/dropped callbacks, populated/empty data, collection changes, retry, and legacy platform behavior pass.
- [ ] 5.2 Run `npm run bench:check` against the implementation and `npm run test:scripts` when launch/budget scripts change; verify no unexplained regressions and update `scripts/perf-baselines.json` for intentional performance changes with measured rationale in the same change, plus bundle budgets only if justified.
- [ ] 5.3 Build the release Android APK and run at least 20 process-cold launches per reference configuration on the Pixel 9 Pro XL with remote WebView debugging disabled; deliver a report proving p95 first usable local screen at or below five seconds offline, with animation on/off and optional services unavailable, and identifying the eliminated wait and bounded request counts.
- [ ] 5.4 Verify empty-data launch, delayed required migrations, fault recovery/retry, warm resume, and current populated user-data launch without changing that data; record actual device outcomes and use the evidence to resolve overlapping Android verification tasks before declaring the load issue fixed.
