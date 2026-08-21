## 1. Audit and Registry

- [ ] 1.1 Perform the full iOS surface audit (nav destinations, overflow items, toolbar actions, command palette + command center entries, every settings section, import sources, reader actions) and record the classification per design §2 in a working doc within the change directory.
- [ ] 1.2 Implement `src/lib/platformCapabilities.ts` + `usePlatformCapability` with the `{ available, reason }` shape mirroring the entitlements registry; unknown ids fail closed with a dev warning.
- [ ] 1.3 Populate the registry from the audit; every user-visible surface gets an entry or an explicit ungated-with-rationale listing.
- [ ] 1.4 Add the lint-style test: nav/tab/palette definitions must either carry a capability id or appear on the reviewed exception list.
- [ ] 1.5 Add regression snapshots proving desktop and Android rendering is unchanged after registry introduction.

## 2. Verified iOS Leak Fixes

- [ ] 2.1 `TTSSettings.tsx`: narrow the `android` TTS adapter to `nativePlatform() === 'android'` via the registry; verify cloud TTS providers remain available on iOS.
- [ ] 2.2 `SettingsPage.tsx`: gate the updater/check-for-updates row to real desktop platforms (replace `isDesktop = isTauri()`); align with `storeReleaseReadiness` policy.
- [ ] 2.3 `EnhancedFilePicker.tsx`: hide the screenshot import source on mobile via the registry.
- [ ] 2.4 `IntegrationSettings.tsx`: hide browser-extension connection controls on iOS (desktop-only).
- [ ] 2.5 NotebookLM surfaces (settings workspace, Toolbar button, tab): gate to desktop; ensure the mobile tab registry omits it on iOS.
- [ ] 2.6 Audit remaining `isNativeMobile()` call sites from the audit list for the same class of bug (android-only bridges shown on iOS); fix via registry.
- [ ] 2.7 Ensure native-layer errors for off-platform plugin commands (`install_apk`, `capture_rendered_dom`) are never user-facing on iOS because the UI never invokes them; add a test asserting no iOS-reachable code path invokes them.

## 3. Navigation and Command Surfaces

- [ ] 3.1 Extend `NavItem` with platform availability; filter `primaryNavItems`/`allNavItems` through the registry in `MobileNavigation.tsx`.
- [ ] 3.2 Filter `TabRegistry` resolution so hidden tabs cannot be deep-linked into broken states on iOS (nearest-surface fallback).
- [ ] 3.3 Add platform gating to `CommandPalette.tsx` and `CommandCenter.tsx` command definitions.
- [ ] 3.4 Implement the marked-unavailable presentation (disabled state + reason string, i18n keys) and apply it to surfaces where discoverability matters.

## 4. Protected Core Workflow

- [ ] 4.1 Define the five protected capability ids (import, read, extract, remember/flashcards, review) and add the protected-surface test asserting availability on iOS phone + tablet.
- [ ] 4.2 Walk each protected surface on an iOS simulator; fix any gating that would hide core workflow pieces; record the walkthrough as evidence.

## 5. Store-Profile Assertions

- [ ] 5.1 Consume A's build profile: under `store`, `apk_install`-class capabilities are unavailable on every platform; add the invariant test (coordinate the profile constant signature with A/B).

## 6. Matrix and Documentation

- [ ] 6.1 Generate `docs/product/features/platform/ios-capabilities.md` from the registry (mirroring `android-capabilities.md` structure); add the registry↔doc consistency test.
- [ ] 6.2 **Documentation correction:** update any mobile/iOS docs claiming features work on iOS when the audit classifies them desktop/android-only; annotate `eink-mode-and-native-share` iOS-related claims as superseded by Proposal E where applicable.
- [ ] 6.3 **Verification:** full iOS simulator walkthrough of every primary + overflow destination with zero broken controls, recorded with screenshots as evidence for Proposal G.
