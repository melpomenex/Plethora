# iOS Privacy Manifest & Permissions Audit

> Change C (`complete-ios-apple-privacy-compliance`) §2 + §5.
>
> **Status: SOURCE-STAGE COMPLETE / ARCHIVE VALIDATION PENDING.** The manifest source file and
> purpose strings are authored and delivered as data to Proposal A's overrides pipeline
> (`scripts/ios-overrides/privacy-manifest.json`, consumed by
> `scripts/apply-ios-project-overrides.js`). Archive-level verification (tasks 2.4 / 6.2) is
> **blocked on Change A §4** producing the first signed/exported production archive. Every claim
> below that depends on the compiled binary is marked ⏳ and must be re-verified against the real
> archive before submission.

## 1. Methodology (per design §1 — evidence, not source grep)

1. Build the production iOS archive via Change A's signed pipeline.
2. Inspect linked libraries and runtime API usage:
   - `otool -L` on the app binary and every embedded framework/dynamic library.
   - Symbol/nm sweep for Required Reason API selectors
     (`NSUserDefaults`, `fileModificationDate`, `stat`/`fstat`/`getattrlist`,
     `mach_absolute_time`/`systemUptime`, `volumeAvailableCapacityKey`, …).
   - Cross-check Tauri/wry/wtao/plugin sources for the same APIs.
3. Enumerate Required Reason API categories actually used; assign approved reason codes verified
   against Apple's current catalog
   (<https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api>,
   re-checked 2026-08-21). Apple updates this catalog periodically — re-verify at archive time.
4. Declare **only evidenced categories** in `PrivacyInfo.xcprivacy`; over-declaring is itself a
   review risk.
5. Rebuild the archive and confirm Xcode/`altool` validation passes with no privacy-manifest
   warnings; record evidence per Proposal G's schema.

## 2. Manifest source of truth

| Artifact | Path | Consumer |
|---|---|---|
| Privacy manifest source | `src-tauri/ios-assets/PrivacyInfo.xcprivacy` | Copied into the app target by A's overrides script |
| Overrides contract data | `scripts/ios-overrides/privacy-manifest.json` | `scripts/apply-ios-project-overrides.js` (manifest copy + Info.plist purpose-string injection) |

The manifest declares:

- `NSPrivacyTracking = false`, empty tracking domains (Plethora does not track).
- Empty `NSPrivacyCollectedDataTypes` — all data collection is disclosed through the App Store
  Connect nutrition labels generated from `src/lib/privacy/disclosureRegistry.ts`
  (see `docs/release/ios-privacy-labels.md`); nothing in the native build collects data outside
  those user-directed flows.
- Accessed API types below.

## 3. Required Reason API evidence table

| Category | Declared? | Reason code(s) | Evidence (source-stage) | Archive re-check |
|---|---|---|---|---|
| `NSPrivacyAccessedAPICategoryUserDefaults` | Yes | `CA92.1` (access user defaults to read/write info accessible only to this app) | WKWebView/Tauri runtime state and plugin preference storage are confined to the app's own defaults domain. No shared/app-group defaults are used. | ⏳ verify symbols in linked binary |
| `NSPrivacyAccessedAPICategoryFileTimestamp` | Yes | `C617.1` (timestamps of files inside the app container), `3B52.1` (timestamps of user-provided files on import/export) | Rust std filesystem metadata (`std::fs`) used by the Tauri asset protocol, fs layers, and Plethora document import/export/caches. Imported documents keep original timestamps. | ⏳ verify scope matches container + user-provided files only |
| `NSPrivacyAccessedAPICategoryDiskSpace` | **No — not declared** | n/a | No evidenced disk-space API usage found at source stage (no `volumeAvailableCapacity` callers in app or documented Tauri deps). Deliberately omitted to avoid over-declaration. | ⏳ if archive symbol sweep contradicts, add reason `E174.1` (write/delete) and update manifest |
| `NSPrivacyAccessedAPICategorySystemBootTime` | **No — not declared** | n/a | No evidenced boot-time usage at source stage. | ⏳ if archive shows `systemUptime`/`mach_absolute_time` reachability, add reason `35F9.1` |

Reason codes verified against Apple's "Describing use of required reason API" catalog on
2026-08-21 (`CA92.1`, `C617.1`, `3B52.1`, `E174.1`, `35F9.1` are current approved values).

## 4. Third-party dependency manifest aggregation (task 2.3)

- Tauri first-party plugins distributed via SwiftPM ship their own `PrivacyInfo.xcprivacy` where
  they use Required Reason APIs; Xcode aggregates app + resource-bundle manifests at archive time.
- ⏳ At archive time: run `find <archive>/Products --name PrivacyInfo.xcprivacy -print` and confirm
  (a) every embedded framework that needs one has one, (b) no category/reason contradictions
  between the app manifest and any shipped SDK manifest, (c) no duplicate declarations that Apple's
  aggregator would flag.
- Known third-party surface today: Tauri runtime (tao/wry), folder-import plugin (Change E),
  notification plugin. None ship analytics/ad SDKs.

## 5. iOS permission inventory (task 5.1)

Purpose strings are delivered as data in `scripts/ios-overrides/privacy-manifest.json`
(`purposeStrings` map) and injected into Info.plist by A's script. **No permission without a
shipped feature; no feature-triggered permission without a string.**

| Permission / capability | Triggering feature | Request context | Purpose string key | Status |
|---|---|---|---|---|
| Camera | QR sync scanning (gated at runtime in webview layer, Android precedent `RustWebChromeClient`) | First use of scan action | `NSCameraUsageDescription` | ✅ string delivered |
| Microphone | Voice dictation / pronunciation practice recording (getUserMedia in webview) | First use of dictation/recording feature | `NSMicrophoneUsageDescription` | ✅ string delivered |
| Local notifications | Review reminders, import feedback (notification plugin wired with check/request commands, `src-tauri/src/lib.rs`) | First scheduling action — never at launch | *(none required — iOS notifications have no purpose-string key)* | ✅ contextual request enforced by plugin call sites |
| Photo library read | Image import | Uses `PHPickerViewController` (out-of-process picker) → **no permission string needed** | — | ✅ no declaration needed |
| Background audio (`UIBackgroundModes: audio`) | Audio editions / TTS playback with screen locked | n/a | n/a | ⏳ **Do NOT declare** unless background playback is verified as a shipped iOS behavior (task 5.4). Absent from purpose-string contract until then. |
| Local network | None known | n/a | `NSLocalNetworkUsageDescription` | Not declared — no evidenced local-network discovery. ⏳ re-check at archive time. |

## 6. Contextual-request checklist (task 5.3)

Manual verification on device/simulator (recorded evidence per Proposal G format) — **pending,
blocked on A's installable build**:

- [ ] Cold launch produces **zero** permission dialogs.
- [ ] Notifications permission requested only on first reminder-scheduling action.
- [ ] Microphone permission requested only on first dictation/recording use.
- [ ] Camera permission requested only on first QR-scan action.
- [ ] Denying each prompt degrades the feature gracefully (feature disabled, no crash/loop).

## 7. Declared-but-unused capability review (task 5.4)

Reviewed in this document only — entitlement/plist changes are applied by Change A:

- **Background audio**: do not declare unless audio editions/TTS genuinely play while backgrounded
  on iOS; declaring it unused invites rejection. ⏳ verify with D's capability matrix.
- **Location, contacts, Bluetooth, HealthKit**: not declared anywhere; none used.
- **Push (remote notifications)**: ASNS flows are server→server (Apple→Plethora); the client does
  not register for remote notifications today. Do not declare the entitlement.

## 8. Verification steps blocked on Change A (tasks 2.4 / 6.2)

1. Exported `.ipa` contains `PrivacyInfo.xcprivacy` in the app bundle (and correct manifests in
   embedded frameworks).
2. `altool --validate-app` (or Xcode Organizer validation) passes with **no** privacy-manifest
   warnings or ITMS errors.
3. App Store Connect upload accepts the build without the "required reason API" rejection email.
4. Record evidence in G's evidence location (`docs/release/evidence/` schema).

These remain **UNCHECKED** in `openspec/changes/complete-ios-apple-privacy-compliance/tasks.md`
until A's pipeline yields an archive; see tasks 2.4 and 6.2 annotations.
