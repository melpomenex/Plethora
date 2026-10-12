# Android startup measurements

`node scripts/android-startup.mjs build --output /tmp/startup-baseline` freezes
the project sources, builds a release APK with the `startup-bench` feature and
the Gradle `plethoraStartupBench` property, and saves the APK, its SHA-256, a
source manifest, and build identity. Set `ANDROID_HOME`, `NDK_HOME`, and
`JAVA_HOME` for your host as described in `.agents/skills/android-build/SKILL.md`.
Frozen sources and compiler logs are kept for diagnosis; build caches are shared.
The Tauri CLI compiles the native library; Gradle uses the project's existing
`plethoraSkipRustBuild` option to package that library without compiling twice.
`--variant baseline` retains the HEAD console forwarder while adding independent
phase markers. `bounded-logging`, `no-logging`, and `no-haptics` isolate suspected
optional work in the frozen build, without changing production startup policy.
Each snapshot manifest describes the actual variant sources. Use
`build --source /tmp/startup-baseline/identity.json --variant no-logging --output /tmp/startup-no-logging`
to copy the frozen baseline and change only the specified boundary, even while
other chats edit the workspace. Compare the manifests to confirm the remaining
files match. `bounded-logging` takes the new forwarder from the workspace; the
other variants retain the frozen baseline's forwarder.
On a memory-constrained diagnosis host, `CARGO_PROFILE_RELEASE_LTO=off`,
`CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16`, and
`PLETHORA_STARTUP_NATIVE_OPT_LEVEL=0` reduce native compilation pressure. The
last option overrides only the application crate in the frozen Cargo manifest.
These settings are recorded in `identity.json` and inherited by `--source`
variants. Use matched settings for diagnosis; the final reference performance
gate uses the repository's standard profile.
Cargo's `false` setting still permits local ThinLTO; `off` disables it entirely.
The disposable build explicitly selects the existing Native Back diagnostic
rollback (`plethoraNativeBackEnabled=false`) unless overridden, and records
that choice without changing the production release acceptance gate.

`node scripts/android-startup.mjs run --serial DEVICE --output /tmp/startup-baseline`
installs **com.plethora.app.startupbench**, warms up database migrations and a
deterministic 1,000-document / 5,000-item fixture, then records 20 process-cold
launches. The harness has no data-reset or uninstall path. A native path guard
prevents even a mistakenly packaged benchmark binary from seeding production.
Do not launch a benchmark-feature binary under the production package.
The disposable activity keeps its own screen awake during measurement. Locked
screen endpoints are rejected; no global phone timeout setting is changed.

Every sample, including timeouts, is saved to `report.json` immediately. A
partial run or any failed launch cannot pass. Median and nearest-rank p95 are
reported, alongside readiness/snapshot request counts, Android/WebView identity,
phase markers, and explicit frontend-emission/activity-receipt clock pairs.
`report --report PATH` recomputes the summary. CLI output uses simple TOON
key/value records; the complete portable measurement artifact is JSON.

The endpoint requires successful hydration, a committed confirmed-data surface
(including empty data), removal of the startup overlay, another painted frame,
and an event-loop turn. Activity launch and loading placeholders never qualify.
Activity elapsed time is sampled when the independent WebView console channel
receives the endpoint, so console delivery latency is conservatively included.
Rust markers also carry their own elapsed clock and logcat's monotonic timestamp;
do not subtract Rust and JS elapsed values as if they shared an epoch.

The benchmark package starts an independent JVM stack watchdog at two and ten
seconds. If no usable endpoint has arrived, it records up to eight
UI/JavaBridge/worker threads with at most sixteen bounded stack frames each.
It never posts to the UI or uses Tauri IPC; an observed usable endpoint skips
remaining captures. Native stack capture through ADB may require root on
production phones, so JVM frames identify the JNI boundary but cannot by
themselves identify a Rust mutex owner.

For a hang specific to existing production data, the Mobile Build Plethora
workflow's opt-in `startup_trace` input enables the same bounded watchdog in a
regular signed APK. It defaults to false. Leave `release_tag` empty and
`upload_testflight` false to produce workflow artifacts without updating a
published release. This build does not enable `startup-bench` or seed data.
Its activity keeps the screen awake while the diagnostic app is foregrounded.
The trace baseline restores the v3.2.0 console forwarder from its verified
release commit before compiling, so the bounded forwarder change cannot mask
the suspected wait. The workflow prints that file's SHA-256; retain it with
the workflow commit and APK identity.
Verify the APK's package, version and signing certificate before installing an
in-place update; a different certificate must never be worked around by
uninstalling the user's app. Capture `PlethoraStartup` logcat records alongside
the workflow commit and APK SHA-256. The local `run` command deliberately
accepts only the disposable benchmark package.

Remote WebView debugging stays off in release. Timing measurements must be
paired with physical input verification; the endpoint alone cannot prove touch
delivery through Android. Record offline/optional-service availability and
animation configurations in the change's evidence report. The harness does not
alter the phone's global networking, animation, or logging settings.
