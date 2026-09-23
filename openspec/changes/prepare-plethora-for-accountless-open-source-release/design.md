## Context

Plethora includes comprehensive multi-platform authentication, encrypted synchronization, StoreKit/Google Play billing, entitlement resolution, and recovery-key management built for the upcoming Plethora Cloud service. Because Plethora Cloud is not yet ready to sell publicly and has no public billing flow, public open-source releases must behave as completely free and local-first with no accounts or paywalls, while preserving all underlying infrastructure for future activation.

## Goals / Non-Goals

**Goals:**
- Provide a single, centralized product-level feature flag `PLETHORA_CLOUD_PUBLICLY_AVAILABLE` in `src/config/product.ts` that governs all public commercial and account exposure.
- Completely hide account tabs, user profile panels, sign-in/up modals, device management, Pro badges, and paywall dialogs from public UI.
- Ensure `openPaywall()` is an inert no-op when cloud availability is disabled.
- Display a clean, non-intrusive "Coming Soon" notice in Cloud Sync settings, without dead login flows or recovery-key setup prompts.
- Ensure all local capabilities (reading, review, FSRS-7, local/on-device AI, BYO AI, local TTS, local transcription, knowledge graph, local browser capture) are 100% free and ungated.
- Ensure application cold boot and PWA startup operate in absolute silence without attempting unauthenticated network requests to cloud auth or entitlement endpoints.
- Preserve all existing sessions, tokens, sync keys, database schemas, and server routes in source for future activation.

**Non-Goals:**
- Removing or refactoring backend server routes (`server/src/routes/v1/*`).
- Removing native billing providers (StoreKit 2, Google Play) or Rust encrypted sync commands.
- Modifying SQLite schemas or removing local database tables.
- Modifying third-party cloud storage providers (Google Drive, OneDrive, Dropbox).

## Decisions

### 1. Central Feature Switch in `src/config/product.ts`
We export:
```ts
export const PLETHORA_CLOUD_PUBLICLY_AVAILABLE =
  typeof import.meta !== 'undefined' && import.meta.env?.VITE_PLETHORA_CLOUD_AVAILABLE === 'true'
    ? true
    : false;

export const isPlethoraCloudAvailable = (): boolean => PLETHORA_CLOUD_PUBLICLY_AVAILABLE;
```
*Rationale*: Provides a single source of truth across the entire codebase. Toggling cloud activation in the future or in internal test environments requires changing one boolean value or setting `VITE_PLETHORA_CLOUD_AVAILABLE=true`.

### 2. Settings Tab Filtering and Deep Link Redirection
In `src/components/settings/SettingsPage.tsx`:
- Filter `SETTINGS_TABS` using `isPlethoraCloudAvailable()` so that `SettingsTab.Account` is completely omitted from the navigation sidebar and search keywords when cloud availability is false.
- In `useEffect` for `initialTabKey` (`plethora_settings_initial_tab`), sanitize the requested tab: if `SettingsTab.Account` is requested while cloud availability is disabled, safely redirect to `SettingsTab.General`.
- Mobile settings navigation derives directly from the filtered tab list, ensuring seamless layout on both desktop and mobile.

### 3. Hosted API Tokens Suppression in Integration Settings
In `src/components/settings/IntegrationSettings.tsx`:
- Exclude the `api-tokens` tab when `!isPlethoraCloudAvailable()`.
- If the current tab is `api-tokens`, default to `obsidian`.
- Local MCP servers, localhost REST API, and local browser-extension capture remain fully accessible.

### 4. Paywall and Monetization Deactivation
In `src/stores/paywallStore.ts` and `src/components/monetization/PaywallModal.tsx`:
- `usePaywallStore.openPaywall` inspects `isPlethoraCloudAvailable()`. If false, it immediately exits without changing state or opening any modal.
- `PaywallModal` returns `null` immediately when `!isPlethoraCloudAvailable()`.
- Pro badges, upgrade prompts, and trial UI are hidden across the application.

### 5. Informational Cloud Sync Surface
In `src/components/settings/SyncSettingsPanel.tsx`:
- When `!isPlethoraCloudAvailable()`, render a streamlined card with:
  - Title: **Plethora Cloud**
  - Description: *Optional end-to-end encrypted synchronization between your devices is coming in a future release. Plethora works fully offline and does not require an account.*
  - Status badge: **Coming Soon**
  - Sync buttons, sign-in warnings, recovery key generation modals, and device lists are omitted.
- Third-party cloud storage providers (Google Drive, Dropbox, OneDrive) remain fully active and unaffected.

### 6. Capability Entitlement Semantics & Free Defaults
In `src/types/entitlements.ts`:
- Clearly document the commercial boundary: local functionality is never a paid entitlement; only Plethora-hosted infrastructure is subscription-backed.
- Ensure that Free plan defaults grant full enabled access to all local capabilities, ensuring anonymous users never hit capability gate restrictions.

### 7. Silent Startup & Error Suppression
In `src/main.tsx` and `src/stores/entitlementStore.ts`:
- Anonymous users do not trigger remote network requests to `/v1/entitlements` or `/v1/auth/token/refresh` at startup.
- Offline and unauthenticated operation is treated as the normal, first-class operating mode rather than a degraded state.

## Risks / Trade-offs

- **[Risk]** Existing unit tests asserting `SETTINGS_TABS.length` or testing `UserProfilePanel` directly may fail if `SettingsTab.Account` is absent.
  - **Mitigation**: Update tests to verify that `SettingsTab.Account` is hidden when cloud is unavailable, and provide test helpers or environment configuration to verify cloud-enabled behavior when testing the cloud-specific components.
- **[Risk]** Existing signed-in users upgrading to this version might have persisted account tokens wiped.
  - **Mitigation**: Persisted localStorage keys (`plethora-account`, `plethora-sync`, etc.) and Zustand storage definitions are left completely intact. Deserialization continues normally.
- **[Risk]** Future contributors may confuse local features with hosted capabilities.
  - **Mitigation**: Explicit documentation added at the top of `src/types/entitlements.ts` and `src/config/product.ts`.
