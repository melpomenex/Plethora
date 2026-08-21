## Why

The principle for iOS v1 is: **if an iOS user can see a feature, it should work on iOS.** Today that fails in both directions. Platform detection exists (`src/lib/tauri.ts`: `isTauri`, `nativePlatform()`, `isNativeMobile()`, `getFormFactor()`) and the mobile shell is close to the right launch surface (`MobileNavigation` with Dashboard/Queue/Review/Documents/Settings + overflow), but gating is ~180 scattered boolean checks with known iOS leaks verified in code:

- `TTSSettings.tsx` shows the Android on-device TTS adapter whenever `isNativeMobile()` — **true on iOS**, where the plugin cannot exist.
- `SettingsPage.tsx` gates its updater row with `isDesktop = isTauri()` — true inside the iOS webview, exposing a self-update surface App Review will flag (partially mitigated by `storeReleaseReadiness.ts` policy helpers, which are advisory, not enforced).
- `EnhancedFilePicker.tsx` offers screenshot capture ungated; `IntegrationSettings.tsx` renders browser-extension server controls inside the iOS Tauri webview; `NotebookLMWorkspace.tsx`/Toolbar expose a CLI-dependent integration that cannot run on iOS.
- The folder-import plugin ships `install_apk` (Android-only) and desktop-capture commands that error obscurely off-platform.
- There is no `isIOS()` helper; no platform-capability registry (the `{ enabled, reason }` shape exists only for billing entitlements); nav/tab arrays carry no platform field; neither command palette filters by platform.

No desktop or Android functionality may be removed. This is purely about correct availability on iOS.

## What Changes

- Add an explicit platform-capability registry (new, modeled on `src/types/entitlements.ts`'s `{ enabled, reason }` shape) classifying every user-visible destination/command per platform, with iOS as the first fully-populated column.
- Migrate high-risk scattered checks to the registry; fix the verified iOS leaks (TTS android card, updater row, screenshot import source, integration/extension settings, NotebookLM surfaces).
- Extend mobile navigation/tab definitions with platform availability so unsupported destinations are hidden or clearly marked unavailable.
- Generate/maintain an iOS capability matrix document used by tests and docs (precedent: `docs/product/features/platform/android-capabilities.md`).
- Preserve the core launch workflow — Import → Read → Extract → Remember → Review — as explicitly protected, tested surface.

## Capabilities

### New Capabilities

- `ios-feature-availability`: Centralized platform capability model governing which destinations, commands, and settings render on iOS, with hidden-vs-marked-unavailable semantics and matrix-enforced consistency.

### Modified Capabilities

None.

## Impact

- New: `src/lib/platformCapabilities.ts` (+ types), capability matrix doc + generator/test.
- `src/components/mobile/MobileNavigation.tsx` (add availability field), `src/components/tabs/TabRegistry.tsx` (filtering).
- Settings panels with verified leaks: `TTSSettings.tsx`, `SettingsPage.tsx` (general/update section only — coordinate with C's privacy-tab edits), `EnhancedFilePicker.tsx`, `IntegrationSettings.tsx`, `NotebookLMWorkspace.tsx` wiring points, `OnDeviceAiPanel.tsx` (already correct — keep as pattern), `CommandPalette.tsx` / `CommandCenter.tsx`.
- Read-only consumption of A's `buildProfile.ts`; read-only consumption of B's billing state for the paywall entry point.

**Owns:** everything above.
**Must NOT change:** billing components' internals (B owns), privacy tab content (C owns), share-extension UX (E owns), account flows (F owns), any desktop or Android feature behavior (gating must be additive conditions, never deletions).

## Dependencies

- **Hard:** none blocking start; consumes `nativePlatform()` today. Adopts A's build profile constant when it lands for store-profile assertions.
- **Soft:** B/C/E register their surfaces as externally-owned capabilities in D's matrix (D defines the slots; they fill them).

## Parallelization Notes

D touches many UI files but shallow ones; collisions managed by file-level rules: D does not edit `PaywallModal.tsx`, `PrivacyCenter.tsx`, share-target files, or settings sections owned by others except the specific lines named in tasks. `MobileNavigation.tsx`/`TabRegistry.tsx` are D-owned exclusively. Merge order with C on `SettingsPage.tsx`: different sections; rebase conflicts expected but trivially separable.

## Migration / Backward Compatibility

Purely presentational gating; no storage/API changes. Registry defaults MUST preserve current behavior on desktop and Android exactly (snapshot tests enforce).

## Risks

- Over-hiding: hiding something discoverable-but-useful (e.g., cloud TTS works fine on iOS via network) would degrade the product; classification requires per-feature verification, not assumption — hence the audit task and matrix review.
- Under-hiding: leaving broken surfaces is the current bug class; tests must assert absence, not just presence elsewhere.
