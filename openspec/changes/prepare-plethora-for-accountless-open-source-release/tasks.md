## 1. Central Product Configuration Switch

- [x] 1.1 Add `PLETHORA_CLOUD_PUBLICLY_AVAILABLE` and `isPlethoraCloudAvailable` in `src/config/product.ts` and verify unit tests.
- [x] 1.2 Document commercial vs local boundary in `src/config/product.ts` and `src/types/entitlements.ts`.

## 2. Settings Navigation and Route Recovery

- [x] 2.1 Dynamically filter `SETTINGS_TABS` in `src/components/settings/SettingsPage.tsx` using `isPlethoraCloudAvailable()`.
- [x] 2.2 Add deep-link sanitization for `initialTabKey` (`account` -> `general` fallback) in `SettingsPage.tsx`.
- [x] 2.3 Verify Settings navigation, keyword search, and deep-link recovery with automated unit tests.

## 3. Integration Settings & Remote Surfaces

- [x] 3.1 Conditionally hide `api-tokens` (hosted API & webhooks) tab in `src/components/settings/IntegrationSettings.tsx` when cloud is unavailable.
- [x] 3.2 Ensure local MCP, localhost REST, and browser extension remain available and test tab filtering.

## 4. Monetization & Paywall Deactivation

- [x] 4.1 Update `openPaywall` in `src/stores/paywallStore.ts` to be a silent no-op when `!isPlethoraCloudAvailable()`.
- [x] 4.2 Guard `PaywallModal.tsx` to immediately render `null` when `!isPlethoraCloudAvailable()`.
- [x] 4.3 Verify monetization and paywall tests pass with paywall opening prevented in public mode.

## 5. Cloud Sync UI & Informational Coming Soon

- [x] 5.1 Update `SyncSettingsPanel.tsx` to display non-intrusive "Coming Soon" card with offline reassurance and disable sync actions when cloud is unavailable.
- [x] 5.2 Verify third-party storage providers (Google Drive, OneDrive, Dropbox) remain functional in `CloudStorageSettings.tsx`.
- [x] 5.3 Update `SyncSettingsPanel.test.tsx` to test the coming soon state when cloud is unavailable and active state when cloud is enabled.

## 6. Capability & Entitlement Semantics

- [x] 6.1 Update `src/types/entitlements.ts` capability registry descriptions and `createFreeDefaultCapabilities` to guarantee all local features are enabled on Free tier.
- [x] 6.2 Ensure silent startup in `src/main.tsx` and `src/stores/entitlementStore.ts` without unneeded authenticated network requests for anonymous users.
- [x] 6.3 Verify entitlement persistence and architecture invariant tests pass.

## 7. Documentation and Open-Source Readiness

- [x] 7.1 Audit and update `README.md` to remove outdated repo URLs, update FSRS references, and document free local-first open-source model.
- [x] 7.2 Run comprehensive test suite (TypeScript check, ESLint, Vitest run) and verify no regressions.
