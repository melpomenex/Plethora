## 1. Scenario Suite (authorable immediately)

- [ ] 1.1 Write `docs/release/ios-golden-path.md`: the ordered golden-path scenario list with per-step expected outcomes and per-format (PDF/large PDF/scanned-if-supported/EPUB/article) × device (iPhone/iPad) variation matrix.
- [ ] 1.2 Write the lifecycle/stress scenario section: foreground/background, lock/unlock, rotation, memory pressure, denied permissions, connectivity loss, offline launch, large library/files, keyboard, Dynamic Type, VoiceOver smoke, Reduce Motion, light/dark, safe areas, long TTS where supported.
- [ ] 1.3 Mark each scenario with owning-proposal dependencies and required verification level (ladder position) for launch-blocking classification.

## 2. Evidence System

- [ ] 2.1 Define the run-record JSON schema (runId, date, ciRunId, buildNumber, testFlightBuildNumber, deviceModel, iosVersion, per-scenario status/notes/artifactRefs, tester, redacted flag) with a template file.
- [ ] 2.2 Create `evidence/ios/` with tracked schema/templates and the gitignore policy for raw media; write the sanitization rules (no emails, account ids, serials; obfuscated sandbox transaction references only).
- [ ] 2.3 Implement the record-validation script (schema + personal-data pattern checks); wire into `test:scripts` or a CI check.
- [ ] 2.4 Define CI artifact naming (archive, ipa, validation log, upload log) and hand the names to Proposal A for application in `mobile-build.yml`.

## 3. Release Gate

- [ ] 3.1 Write `docs/release/ios-release-gate.md`: the P0 submission checklist aggregating every proposal's launch-critical items, each line requiring an evidence reference or explicit accepted disposition with rationale.
- [ ] 3.2 Add the checklist linter (every line links evidence or disposition; no bare `[x]`).
- [ ] 3.3 Document the TestFlight process: internal round mandatory, external round recommended, exact-RC-build rule for screenshots/reviewer validation.

## 4. Execution (blocked until A+B+F reach executable state)

- [ ] 4.1 Execute the golden path on a physical iPhone against the first TestFlight build; record evidence per schema.
- [ ] 4.2 Execute the golden path on a physical iPad (if iPad supported) with format variations; record evidence.
- [ ] 4.3 Execute lifecycle/stress scenarios; record evidence including denied-permission and offline-launch paths.
- [ ] 4.4 Execute B's sandbox billing scenarios and F's account/deletion scenarios as part of the run; record obfuscated transaction references.
- [ ] 4.5 Execute C's privacy validation checks (manifest in archive, no launch-time prompts) and D's surface walkthrough; record evidence.
- [ ] 4.6 Compile findings; file each defect against its owning proposal's task list; re-run failed scenarios after fixes.
- [ ] 4.7 Produce the final gate report: every checklist line green or dispositioned; attach CI run ids and TestFlight build number; declare "App Store submission candidate" status or enumerate open blockers.
