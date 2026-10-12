# Startup diagnosis evidence

`installed-observation.json` records the installed 3.2.0 app's 40,036 ms failed
readiness cycle followed by a 35,119 ms successful cycle. Its APK digest is
known, but its activity epoch, source revision, and native handler timeline are
unavailable. It is an observation, not an end-to-end benchmark.

`diagnostic-opt0-report.json` is the first instrumented, non-debuggable release
APK run on the Pixel 9 Pro XL (Android 17, Vanadium WebView 155.0.8059.39.0).
The separate `com.plethora.app.startupbench` package verifies its disposable
1,000-document / 5,000-item fixture. Source/build/APK identities, emission/receipt
clock pairs, native setup and handler markers, hydration, presentation, and
request counts are included. Every sample is retained: two usable endpoints
at 16,256 / 16,303 ms, and a third incomplete launch behind the locked screen.
The harness rejects the locked result and the run does not pass.

The application crate uses diagnostic optimization level 0, with LTO false and
16 codegen units. These results cannot satisfy the final standard-profile
performance gate. The first two samples show about 10.4 s before setup, then
readiness responses under 100 ms. They have **not** reproduced the installed
app's long readiness wait or demonstrated its cause. Native ADB stack capture
was denied because root is required; the report includes the independent JVM
watchdog's bounded stacks.

Native fixture tests pass for production-path rejection, idempotence, counts,
and populated startup queries. Eight harness unit tests cover source freezing,
variant isolation, report math, endpoint rejection, and compiler-profile gating.
The diagnostic-channel tests cover a hung forwarder and repeated warnings.
Tasks 1.1–1.3 are complete; diagnosis task 1.4 remains open. No root-cause fix,
shared deadline, or optional-initialization deferral is claimed complete.

Later baselines add bounded Wry version-query markers and keep only the
disposable activity awake. Controlled variants use the same frozen baseline.
The production app has not been reset or uninstalled.

`release-comparison.json` compares the original installed APK with the current
GitHub v3.2.0 asset. Both have the official release certificate, but their
native library, DEX, Tauri config and DEX profiles differ. Embedded version
strings agree; source equivalence remains unknown because Tauri embeds the
frontend in the differing native library. The current asset was built from
7981e1ae (release-tag code plus CI-only changes) and is now installed using a
data-preserving in-place update. The user confirms its cold launch still hangs; `current-release-observation.json`
records another 40,035 ms failed readiness cycle before retry.

`diagnostic-version-query-report.json` contains three complete diagnostic
launches at 16,195 / 15,874 / 16,764 ms (median 16,195 ms), each with one readiness
request and two snapshots. Readiness responses take 105–119 ms; Wry version
queries take 2–3 ms and cannot account for the preceding approximately ten
seconds in this diagnostic compiler profile. The user confirms this separate
benchmark package feels responsive and usable. This is physical-input feedback,
not completion of the standard-profile five-second cold-launch gate. The
production readiness stall still has not been localized to a native operation.

`diagnostic-native-back-report.json` isolates Native Back enabled by repackaging
the exact baseline native library, manifest and Tauri config (byte equality
verified), changing only the Gradle Native Back property. All three launches
are usable at 16,016 / 15,990 / 15,892 ms; readiness remains prompt. This rules
out that property as a sufficient reproducer under the diagnostic fixture and
compiler settings; it does not establish production-profile equivalence.

`diagnostic-no-logging-report.json` disables only automatic console-forwarder
installation in the frozen baseline. All three launches are usable at 15,908 / 16,224 / 15,985 ms. Readiness remains prompt; this fixture/profile
already had no production-like readiness stall, so the control does not
establish console forwarding as its cause.

The user reports local data only in the regular app, without an account or
saved AI/sync integrations. Both installed packages have the Android INTERNET
permission granted. The opt-in production stack watchdog compiles for release;
an official-key signed diagnostic APK has not yet been built or measured.

Diagnostic-stage validation: frontend type checking, the six diagnostic-channel
tests, eight harness tests, native fixture/readiness tests, a native library
check, strict OpenSpec validation, and release Kotlin compilation with the
production trace flag pass. The full script suite has three unrelated failures
(Linux `plutil` availability, marketing capture freshness, and a Darwin memory
expectation). The performance gate remains unresolved: quiet runs have small
overruns in different unchanged benchmarks. The latest run fails
`ankiImport/convert-2000-notes` (2.231 vs 2.189 limit) and
`article-import-static-large-260p` (770.6 vs 759.1 limit); the previous
speech-index overrun is absent. Bundle budgets pass separately. No performance
baseline has been raised, and task 5.2 remains unchecked.
