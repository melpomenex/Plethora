## Why

Four independent reliability bugs degrade core Plethora workflows: double-tap paragraph selection loses semantic authority before sequential AI actions, the browser extension's YouTube save button disappears on same-URL DOM replacement, concurrent refresh-token rotation between TypeScript and Rust can revoke entire session families while Pro entitlements remain cached, and stale HTMLAudioElement callbacks can jump TTS backward after navigation. Each has a verified root cause in the current tree and requires targeted hardening without regressing prior selection-UX, entitlement-persistence, or TTS architecture work.

## What Changes

- **Selection (BUG A):** Make double-tap paragraph selection authoritative via immediate `ReadySelection` commit from the paragraph element plus `passive: false` on double-tap `touchstart` so `preventDefault` blocks native word-selection fallout. Add regression tests simulating post-gesture native `selectionchange`.
- **YouTube extension (BUG B):** Replace remove-then-create injection with scoped, idempotent `ensureYouTubeSaveButton()` anchored to `ytd-watch-metadata`, with rAF-debounced MutationObserver reinjection when the button is missing/disconnected (not only on URL change).
- **Auth/sync (BUG C):** On Tauri, delegate all token refresh to Rust `AuthManager` via `account_refresh`; add PWA single-flight refresh mutex; guard stale refresh responses so losing in-flight requests cannot sign out a winning session. Extract shared server `resolveCapability()` used by entitlements and `requireCloudSync`. Map sync API error codes distinctly in native client.
- **TTS (BUG D):** Add `playbackIdRef` epoch guards to all generated-audio (`HTMLAudioElement`) lifecycle callbacks and detach handlers in `cancelAudio` before pause.
- **Language Learning (VERIFY):** Confirmed already correct on `main` — global opt-in defaults OFF, no bypass paths. No production code changes.

## Capabilities

### New Capabilities

- `double-tap-selection-authority`: Authoritative semantic paragraph selection that survives native browser word-selection fallout from the same gesture and supports sequential AI actions.
- `youtube-save-button-lifecycle`: Idempotent, scoped YouTube watch-page save-button injection resilient to SPA navigation and same-URL subtree replacement.
- `auth-refresh-ownership`: Single refresh-token rotation owner per runtime (Rust on native, coalesced TS on PWA) with stale-response guards.
- `cloud-sync-capability-resolution`: Shared server capability resolver and distinct sync auth error surfacing.
- `tts-generated-audio-epoch`: Epoch-guarded generated-audio event handlers consistent with System Web Speech and Android native paths.

### Modified Capabilities

(none — prior selection, entitlement, and TTS changes remain authoritative; this change extends them without contradicting requirements)

## Impact

- `src/components/viewer/selectionInteraction/` — adapters, hook, tests
- `browser_extension/content.js` — YouTube integration; new test harness
- `src/stores/accountStore.ts`, `src/stores/entitlementStore.ts` — refresh delegation and single-flight
- `src-tauri/src/plethora_auth/mod.rs` — refresh authority (existing mutex leveraged)
- `server/src/middleware/requireCloudSync.ts`, `server/src/routes/v1/entitlements.ts` — shared resolver
- `src-tauri/src/sync/api_error.rs` — distinct error code mapping
- `src/components/common/ReaderTTSControls.tsx` — generated-audio guards
- Tests across selection, extension, account, server auth/sync, and TTS race suites
