# External Dependencies, Approvals & Release Readiness Checklist

**Program:** `wearable-health-sleep-program`  
**Verification Date:** 2026-11-20

This document records release checks that require vendor access, a signed build, hardware, or store review. Local engineering verification is recorded separately below.

---

## 1. Apple iOS & HealthKit

- [ ] **Apple Developer HealthKit Capability**: Enable `HealthKit` capability on App ID `com.plethora.app` in Apple Developer Portal and regenerate manual iOS distribution provisioning profiles referenced by `src-tauri/gen/apple/secrets/exportOptions.plist`.
- [ ] **Enable Entitlement Gate**: Once provisioning profiles & legal review are ready, set `"enabled": true` in `scripts/ios-overrides/healthkit.entitlements.json` and run `node scripts/apply-ios-project-overrides.js` + `npm run tauri:ios:build:device`.
- [ ] **App Store Review Guideline 5.1.3 Compliance Check**: Confirm App Review acceptance that local sleep/learning correlation insights qualify as user-directed wellness/learning insights (and verify no HealthKit data touches iCloud or third-party SDKs).
- [ ] **App Store Connect Privacy Nutrition Label Review**: Check the data flows in the submission build. The on-device vault is listed in the privacy inventory. Review the collection mapping again before enabling cloud wearable sign-in. [Privacy label mapping](../../../docs/release/ios-privacy-labels.md)
- [ ] **Physical iPhone + Apple Watch QA**: Build and run on macOS/Xcode against a real iPhone paired with Apple Watch (HealthKit `HKHealthStore` returns empty/unavailable on headless Linux and requires real Health app permissions UI on physical iOS or Xcode Simulator).

---

## 2. Google Android & Health Connect

- [ ] **Android NDK + Physical Device / Emulator Build**: Current Linux workspace has `/home/ubuntu/Android/Sdk` (`platforms/android-36`, `build-tools/35.0.0`), but lacks Android NDK (`ndk/27.2.12479018`). Full APK bundling (`npm run tauri:android:build`) and Health Connect permission testing require NDK + physical Android 14+ phone (e.g., Pixel) or Android Emulator with Health Connect APK installed.
- [ ] **Google Play Console Health Apps Declaration**: Complete Play Console → Policy → App content → Health Apps form, declaring `READ_SLEEP`, `READ_HEART_RATE`, `READ_RESTING_HEART_RATE`, `READ_HEART_RATE_VARIABILITY`, `READ_STEPS`, `READ_ACTIVE_CALORIES_BURNED`, `READ_HEALTH_DATA_HISTORY`, and `READ_HEALTH_DATA_IN_BACKGROUND`.
- [ ] **Health Connect Allowlist Review**: Submit Google Play Health Connect access form with screenshots of Plethora's in-app permission rationale screen and Data Safety alignment.

---

## 3. Cloud Provider Developer Registrations & Secrets

| Provider | Required External Actions | Required Server Env Vars (`server/`) | Redirect URI to Register |
|---|---|---|---|
| **Oura Ring (v2)** | Register OAuth app in Oura Developer Portal; submit app review to lift 10-user sandbox limit | `OURA_CLIENT_ID`, `OURA_CLIENT_SECRET`, `OURA_WEBHOOK_VERIFICATION_TOKEN` | `http://127.0.0.1:<port>/health/oauth/callback` (or broker web redirect → `plethora://health/oauth/callback`) |
| **WHOOP (v2)** | Register OAuth app in WHOOP Developer Dashboard; request promotion past 10-member sandbox limit; configure webhook URL | `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET` (also signs `X-WHOOP-Signature`) | Broker callback / `plethora://health/oauth/callback` |
| **Google Health API v4** | Create GCP project, enable `health.googleapis.com`, register OAuth consent screen (`googlehealth.sleep.readonly`, etc.), pass Google Trust & Safety OAuth verification (>100 users), and complete **annual CASA Tier 2 assessment** | `GOOGLE_HEALTH_CLIENT_ID`, `GOOGLE_HEALTH_CLIENT_SECRET` | Broker callback / `plethora://health/oauth/callback` |
| **Garmin Health API** | Apply to **Garmin Connect Developer Program** (Starter or Enterprise commercial tier — Personal API is forbidden); sign commercial API agreement; configure Push/Ping-Pull endpoint | `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET` | Broker callback / `plethora://health/oauth/callback` |
| **Desktop / Mobile Client Config** | Point deployed Plethora build to production OAuth broker endpoint | `PLETHORA_HEALTH_OAUTH_BROKER_URL` (client-side non-secret URL) | N/A |

---

## 4. Legal & Privacy Policy Updates

- [ ] Publish updated Privacy Policy covering GDPR Article 9 explicit consent, Washington MHMDA consumer health rights (collection, non-sharing, non-sale, deletion), and Apple HealthKit / Google Health Connect / vendor-specific disclaimers.
- [x] Add the local Health Vault and the OAuth broker to the privacy registry and iOS privacy label mapping.

## 5. Local verification

Verification used the Linux workspace on 2026-11-20. The Chromium workflows mount the dashboard with a deterministic IPC fixture. Store and vendor qualification requires the external checks above.

- All seven changes passed strict OpenSpec validation. The 77 canonical product documents passed validation and the Help index regenerated.
- The last performance run passed all 77 benchmark comparisons and the bundle budget. Earlier runs under concurrent test load exceeded several thresholds. The TypeScript and production build passed the bundle budget. Wearable frontend lint passed. The workspace-wide lint run reported 1,733 errors in other areas.
- The Android integration script, Kotlin plugin compilation, and all 16 iOS project override tests passed. The Linux build does not exercise signed iOS permissions.
- The local private broker passed all 128 server tests. No broker deployment or live provider credential validation was performed.
- The three passing wearable Playwright workflows cover explicit sample opt-in, manual entry and editing, source conflict and provenance, Study Plan evidence, offline and denied access, disconnect, wipe, and a 360px dark layout. The repository-wide run recorded 146 passes and stopped at its configured limit of eight unrelated failures, leaving 120 tests unrun.
- Focused frontend checks passed 43 tests. The workspace-wide Vitest run reported failures in unrelated suites as well as capability and broker disclosure assertions that were corrected and rerun individually.
- Workspace Rust formatting still reports differences in existing files. Wearable-specific Rust formatting passed.
- Linux cargo check passed. The focused Rust run passed 55 unit and 2 integration tests. The three-year fixture loaded 1,095 nights, 200 naps, and 100,000 observations in 6.0 seconds and analyzed 20,000 reviews in 7.7 seconds. The broad Rust unit run terminated with SIGBUS after failures in scheduling and database tests.
- C-T05 remains open for the approved Garmin biometric feeds. G-T06 remains open for the repository-wide gate failures.
