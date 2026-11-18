## 1. Reproduce and Attribute the AppImage Delay

- [x] 1.1 Build the Linux launch timing adapter and add bounded phase observation around launcher/native entry, Linux runtime detection, WebView startup, frontend shell, and visible data. Verify a launch with an injected pre-entry delay reports that time and a visible input probe rejects an obscured shell.
- [x] 1.2 Capture a matched baseline for the reported release artifact and the same artifact's extracted `AppRun` using isolated profiles. Record artifact and launcher identity, mount or extraction mode, cache state, phase durations, and input checks. Quantify the reported delay or document which conditions could be reproduced.
- [x] 1.3 Isolate the dominant AppImage wait with a controlled comparison. Record the responsible phase or operation, the change it warrants, and evidence for the conclusion before changing the corresponding launch path.

## 2. Establish the Cross-Platform Launch Check

- [ ] 2.1 Reuse the Android harness, fixture parameters, and visible-data markers in the common report. Add launch adapters for installed Linux, macOS, Windows, iOS, and the installed PWA. Verify each adapter starts timing at platform launch and checks paint and actual input against its ready markers.
- [ ] 2.2 Add a local check for the spec budgets and document how to run it on each reference environment. Test median and nearest-rank p95, configuration identity, rejection of missing or invalid endpoints, insufficient samples, and preservation of failed samples. Verify traces remain bounded and observable during stalled IPC.
- [ ] 2.3 Capture before-change release timings on the remaining references and document available phase evidence. Use working input and current visible content as common baseline endpoints when the old build lacks markers.

## 3. Shorten the Measured Critical Path

- [x] 3.1 Fix the measured AppImage bottleneck at the responsible launcher, runtime, or app boundary. Verify a matched before/after trace on the original packaged path shows the measured wait shrink. For Linux runtime changes, verify fresh and reused caches, supported graphics modes, media playback, and installed package launch.
- [x] 3.2 Make the shared shell visible and navigable while required native or browser storage initializes. Verify an injected delay leaves the app navigable and collection-scoped startup data hydrates once for the active surface, with no queries against a partially migrated store.
- [x] 3.3 Make startup presentation yield on the shell's ready frame and reconcile the pending animation lifecycle requirement. Verify keyboard, pointer, or touch input as applicable with animation enabled, disabled, and reduced motion, plus cold reopen and running-instance resume.
- [x] 3.4 Apply one recovery deadline across main module load, readiness, and initial data, building on the Android recovery work. Verify stalled stages expose retry or reload, retries supersede late results, and required migrations or quarantine handling finish safely.
- [ ] 3.5 Defer automatic optional integrations until local readiness and bound their idle fallback. Verify local startup succeeds offline, optional initializers run once after successful startup, and supported file opens, deep links, and shares are handled when their required state is ready.
- [ ] 3.6 Use the release traces to reduce additional measured waits that threaten the shared budgets. Verify the relevant phase improvement with matched traces and exercise fresh, empty, populated, migrating, and recovered profiles through normal entry points.

## 4. Verify the Release Path

- [ ] 4.1 Run at least 20 process-cold launches per reference configuration on the Linux AppImage and installed Linux, macOS, and Windows release builds. Record p50 and p95 for both endpoints, all failures, and matched before/after AppImage phase and cache evidence.
- [ ] 4.2 Run the same check on physical Android and iOS reference devices and the installed production PWA. Record the offline and animation variants, Android hardware input, existing Boox first-data check, and a controlled fresh-asset PWA comparison. Record any unavailable hardware or incomplete configuration as pending evidence.
- [x] 4.3 Run the startup-data checks, focused runtime tests, `npm run test:scripts`, and `npm run bench:check`. Record local packaged check results alongside these checks and justify any intentional benchmark baseline updates under the repository's performance policy.
