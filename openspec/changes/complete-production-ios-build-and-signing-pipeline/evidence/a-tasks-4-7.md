# Change A — Verification Evidence for §4–§7

Recorded: 2026-08-21. Same environment constraint as `a-tasks-1-3.md`:
**this machine has NO full Xcode** (`xcode-select -p` → Command Line Tools;
no iphoneos SDK, no `xcodebuild`) and no signing/ASC credentials. Every
signing/archive/validation/TestFlight EXECUTION level is therefore honestly
**unchecked**; the deliverables make those runs one-command ready and
CI-complete so an Xcode-equipped runner can verify.

Commits (§4–§7): gen/apple privacy integration `1baf06f7`; pipeline +
signing docs + CI + tests: see `git log --oneline` under this change.

## Integration duty — C/E override data → gen/apple

- [x] `node scripts/apply-ios-project-overrides.js` consumes BOTH landed data
      files:
      - C `scripts/ios-overrides/privacy-manifest.json`: purpose strings
        injected into Info.plist, `PrivacyInfo.xcprivacy` copied into the app
        target. Committed in `1baf06f7`.
      - E `scripts/ios-overrides/share-extension.target.json`: extension
        stanza + App Group entitlement were already applied and committed by
        E's run of A's script (commit `ac6723cb`); re-run confirmed fixpoint.
- [x] Idempotency re-runs: fixpoint ("nothing to do") after each change,
      including with `--build-number`.

## §4 Signing, archive, validation, upload

Commits: pipeline script `scripts/ios-release.mjs`, npm scripts
`tauri:ios:preflight|archive|export|validate|upload`,
`secrets/exportOptions.plist.example` (+ `.gitignore` exception),
`docs/release/ios-signing.md`, build-number scheme in `scripts/release.cjs`
+ overrides script, unit test `scripts/__tests__/iosBuildNumber.test.mjs`.

- [x] `node --test scripts/__tests__/iosBuildNumber.test.mjs` → 4/4 pass
      (counter parse/reject-corrupt, strict monotonicity, round-trip).
- [x] Full `npm run test:scripts` → 149 pass / 0 fail / 1 pre-existing skip.
- [x] Overrides-script regression suite still green after the build-number
      extension (`applyIosProjectOverrides.test.mjs`, 15/15 within the full
      run above).
- [x] `node scripts/release.cjs` import-safe after refactor (side effects now
      behind `require.main === module`; exports unit-tested directly).
- [x] `node scripts/ios-release.mjs preflight` executed on this machine:
      correctly reports xcodebuild MISSING + absent exportOptions plist +
      missing ASC env and exits 1 with actionable messages (fail-fast path
      proven; success paths need Xcode).
- [x] Upload CLI decision recorded (docs/report rationale): altool retained
      for standalone validate+upload of an exported .ipa with ASC API-key
      auth; notarytool is notarization-only and cannot upload to TestFlight;
      swap point isolated in `scripts/ios-release.mjs`.
- [ ] 4.5(a–e) physical iPhone/iPad install, Release-archive validation,
      TestFlight processing, clean-device install — **Xcode-gated, pending.**
      Runner instructions: `docs/release/ios-reproducible-build.md` §0–§5.

## §5 CI pipeline

Commit: `.github/workflows/mobile-build.yml` ios-build job rewrite.

- [x] YAML parses cleanly (js-yaml load; 24 steps enumerated). actionlint
      unavailable on this machine — flagged for first CI run.
- [x] Behavior matrix encoded: tag refs without signing secrets fail hard;
      simulator fallback only on non-release refs; TestFlight upload gated on
      ASC secrets AND (v* tag OR dispatch input `upload_testflight`), only
      after successful validation.
- [x] Artifact names defined (subject to G's final naming):
      **`ios-archive`** (.xcarchive + dSYM zips), **`ios-ipa`** (.ipa),
      **`ios-validation-logs`** (altool validate/upload logs + build log +
      outputs summary). Documented in workflow comments + ios-signing.md.
- [x] All iOS CI secrets documented in workflow comment block and
      `docs/release/ios-signing.md` (incl. optional
      `IOS_SHARE_PROFILE_BASE64` for manual-signing exports of the
      share-extension target); no secret values in repo.
- [ ] 5.5 green signed CI run + one CI TestFlight upload with run IDs —
      **pending** (requires secrets in repo settings + Xcode-equipped
      runner).

## §6 Production hygiene

- [x] 6.1 `node --test scripts/__tests__/iosRuntimeConfigAudit.test.mjs` →
      4/4 pass: merged iOS-effective config has no loopback hosts outside the
      structural allowlist (build.devUrl, CSP), no test/staging hostnames,
      updater endpoints https-only, store-profile guard wiring intact.
- [x] 6.2 `node --test scripts/__tests__/iosDesktopCommandSafety.test.mjs` →
      4/4 pass: `install_apk` errors typed on non-Android; `capture_rendered_dom`
      errors UNAVAILABLE on mobile; updater/process plugins cfg-excluded on
      iOS (commands do not exist); `download_update_apk` asserted installer-free
      (inert cache write if invoked — UX gating is Proposal D's).
      Note: task text mentions "install_apk … updater commands" — verified
      against actual command surface (`install_apk` lives in the
      folder-import plugin; there is no separate desktop `install_apk` in
      lib.rs).
- [x] 6.3 Stale tasks annotated (not rewritten) in
      `openspec/changes/prepare-plethora-for-apple-app-store-and-google-play-commercial-release/tasks.md`
      (1.2 iOS half + 5.2), pointing at this change.

## §7 Reproducible-build documentation

- [x] 7.1 `docs/release/ios-reproducible-build.md`: clean checkout →
      TestFlight, every command, every secret name, every manual Apple-side
      prerequisite, build-number scheme, evidence expectation.
- [x] 7.2 This file records the verification-ladder status:

| Level | Status |
|---|---|
| Implemented | ✅ §4–§7 deliverables landed |
| Automated tests pass | ✅ 149/150 scripts suite green (1 pre-existing skip); new suites: iosBuildNumber 4/4, iosRuntimeConfigAudit 4/4, iosDesktopCommandSafety 4/4 |
| Simulator build | ⬜ Xcode-gated |
| Physical-device install | ⬜ Xcode-gated |
| Signed Release archive | ⬜ requires certs/profiles + Xcode |
| altool validation passed | ⬜ requires ASC key + Xcode |
| TestFlight build processed | ⬜ requires ASC key + Xcode |

## Pending (requires other resources)

1. One Xcode-equipped machine run closing 4.5(a–e) per
   `docs/release/ios-reproducible-build.md`.
2. Repo-secret setup (IOS_CERT_*, IOS_PROFILE_*, ASC_*) + one signed CI run
   and one CI TestFlight upload with run IDs (closes 5.5).
