# Proposal: Prepare Plethora for Accountless Open-Source Release

## Why

Plethora is being prepared to become publicly open source again. The product model is free, local-first, and open source with no account or subscription required for normal use. In the future, Plethora Cloud will be an optional paid service primarily for encrypted multi-device synchronization. Because Plethora Cloud is not yet ready to sell and has no complete public payment flow, ordinary users must not encounter account, subscription, Pro, billing, or paywall UI, while preserving all underlying infrastructure for future activation.

## What Changes

- Introduce a single centralized product configuration switch (`PLETHORA_CLOUD_PUBLICLY_AVAILABLE = false` in `src/config/product.ts`) as the single source of truth for public cloud/account exposure.
- Hide all account surfaces when Plethora Cloud is unavailable:
  - Remove the Account tab (`SettingsTab.Account`) from Settings navigation and search keywords.
  - Gracefully redirect any stale persisted initial settings routes pointing to `account` to `general`.
  - Suppress account/profile dropdowns, login/signup buttons, and user profile panels in public builds.
  - Hide account-bound hosted API token and webhook management from Integration Settings while keeping local MCP, localhost REST, and browser extension integrations accessible.
- Hide all Pro, billing, and paywall surfaces:
  - Suppress Pro badges, upgrade buttons, pricing information, and trial UI.
  - Ensure `openPaywall()` is a no-op when cloud availability is false, and ensure `PaywallModal` renders null.
  - Retain all billing providers (StoreKit 2, Google Play, mock) and paywall stores internally for future re-enablement.
- Adapt Cloud Sync UI:
  - In `SyncSettingsPanel` (under Cloud Storage Settings), replace dead sign-in/upgrade prompts with a clean, non-intrusive informational notice: "Optional end-to-end encrypted synchronization between your devices is coming in a future release. Plethora works fully offline and does not require an account." with a disabled "Coming Soon" badge.
  - Leave user-configured third-party cloud storage (OneDrive, Google Drive, Dropbox) untouched.
- Clean up capability and entitlement semantics:
  - Clarify that local functionality (reading, FSRS-7 review, local AI, BYO keys, local TTS, local transcription, local knowledge graph, local RAG) is never a paid entitlement.
  - Ensure Free plan defaults enable all local capabilities so anonymous users are never locked out of local features.
  - Document the commercial boundary clearly in source files: local execution != subscription feature; only Plethora-hosted infrastructure is subscription-backed.
- Startup and background resilience:
  - Ensure application cold boot and PWA startup never emit noisy authentication errors or attempt unnecessary network fetches to `/v1/entitlements` or `/v1/auth/*` for anonymous users.
  - Preserve all existing user sessions, credentials, tokens, and encrypted sync state so existing users do not lose data upon upgrading.
- Documentation & README update:
  - Update README and docs to reflect the free, open-source, local-first model with no login required.
  - Fix outdated Incrementum repository URLs and FSRS version references.

## Capabilities

### New Capabilities
- `accountless-experience`: Ensures Plethora functions as a completely accountless, free, local-first application when Plethora Cloud public availability is false, hiding account, Pro, billing, and paywall UI while keeping local functionality ungated and preserving backend infrastructure.

### Modified Capabilities
<!-- No existing formal spec delta requirements are being invalidated; existing local data plane remains intact -->

## Current Behavior

Currently, Plethora displays an Account tab in Settings as the top tab, containing a UserProfilePanel with a "Guest User" label, "Demo Mode" badge, "Upgrade to Pro" button, "Sign In / Sign Up" button, trial badge, device list, and capability catalog. Sync settings warn users to sign in or upgrade to Pro to enable sync. Hosted API token and webhook settings prompt for login. Startup in PWA mode attempts to query `/v1/entitlements`. All capability descriptors default to `defaultPlan: 'pro'` with `requiresAccount: true`.

## Desired Behavior

A new user downloads and opens Plethora and immediately reaches their library and study tools. There are no sign-in prompts, no Account tab in Settings, no Pro badges, no upgrade buttons, no pricing or subscription UI, and no paywalls. All local reading, review, FSRS-7, local/on-device AI, BYO AI, local TTS, local transcription, knowledge graph, and local integrations work out of the box with zero configuration or login. Cloud sync in settings displays a calm "Coming Soon" note explaining that Plethora works fully offline without an account and that encrypted sync is planned for a future release.

## Scope

- In scope:
  - Central configuration switch `PLETHORA_CLOUD_PUBLICLY_AVAILABLE`.
  - Conditional rendering / filtering of Settings navigation, UserProfilePanel, LoginModal, PaywallModal, TrialBadge, hosted API tokens panel, and SyncSettingsPanel status banner.
  - Safe routing fallback for `plethora_settings_initial_tab`.
  - Entitlement defaults ensuring local features are never gated.
  - Startup audit ensuring clean offline anonymous startup.
  - Automated tests covering anonymous boot, navigation, settings, paywall no-op, local AI/TTS/transcription ungated, and backward compatibility.
  - Documentation and README audit.
- Non-goals:
  - Deleting server code, authentication endpoints, StoreKit/Google Play billing integrations, or encrypted sync engine.
  - Modifying SQLite schemas or removing sync tables/logic.
  - Implementing full payment processing or hosted server infrastructure.
  - Changing third-party cloud storage providers (Dropbox, Google Drive, OneDrive).

## Architecture

1. **Central Feature Switch**: `src/config/product.ts` exports `PLETHORA_CLOUD_PUBLICLY_AVAILABLE = false` and helper `isPlethoraCloudAvailable()`.
2. **Settings Architecture**: `SETTINGS_TABS` dynamically excludes `SettingsTab.Account` when `!isPlethoraCloudAvailable()`. Deep-link recovery ensures an `initialTab` of `account` gracefully resolves to `general`.
3. **Integration Settings Architecture**: The `api-tokens` tab (hosted API tokens & webhooks) is excluded when `!isPlethoraCloudAvailable()`.
4. **Monetization Architecture**: `usePaywallStore.openPaywall` immediately exits when `!isPlethoraCloudAvailable()`. `PaywallModal` renders `null`.
5. **Sync Architecture**: `SyncSettingsPanel` displays an informational "Coming Soon" card when `!isPlethoraCloudAvailable()`. Manual or automatic sync requests do not trigger auth errors.
6. **Entitlement Architecture**: Clearly differentiates local functionality from Plethora-hosted services. Local capabilities default to enabled on Free tier; hosted capabilities are preserved for future Cloud tiers.

## Migration & Compatibility Implications

- Existing sessions, tokens, and sync keys stored in `localStorage` or native keystores remain untouched.
- When `PLETHORA_CLOUD_PUBLICLY_AVAILABLE` is toggled to `true` in a future release, existing accounts and sessions re-emerge without schema or data loss.

## Future Plethora Cloud Re-Enablement Strategy

To re-enable Plethora Cloud when ready:
1. Switch `PLETHORA_CLOUD_PUBLICLY_AVAILABLE = true` in `src/config/product.ts`.
2. All UI surfaces (Account tab, UserProfilePanel, LoginModal, Pro badges, PaywallModal, hosted API tokens, active Cloud Sync) automatically unhide and resume normal operation.

## Impact

- `src/config/product.ts`: Expose `PLETHORA_CLOUD_PUBLICLY_AVAILABLE` and `isPlethoraCloudAvailable()`.
- `src/components/settings/SettingsPage.tsx`: Filter `SETTINGS_TABS` and sanitize `initialTab`.
- `src/components/settings/SyncSettingsPanel.tsx`: Show "Coming Soon" informational UI when cloud is unavailable.
- `src/components/settings/IntegrationSettings.tsx`: Hide `api-tokens` tab when cloud is unavailable.
- `src/stores/paywallStore.ts` & `src/components/monetization/PaywallModal.tsx`: Guard paywall activation.
- `src/types/entitlements.ts` & `src/stores/entitlementStore.ts`: Clarify local vs hosted capability defaults.
- `README.md`: Update product description, repository links, and feature documentation.
