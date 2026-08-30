## Context

Plethora Pro E2E cloud sync lives in `SyncSettingsPanel`, embedded at the top of Settings → Cloud Storage (`CloudStorageSettings`). The intended multi-device flow is:

1. **First device**: sign in, generate a recovery key, save it, acknowledge it, sync.
2. **Additional devices**: sign in, **import** the same recovery key, sync.

A recent commit added Import Key UI alongside Generate Key, but users on fresh installs still report no import button in Cloud Storage. Investigation points to three likely causes:

- **State gating bug**: UI hides both actions when `recoveryKeyAcknowledged` is true, but that flag can be set independently of whether `sync_has_master_key` is true (stale keychain entry, localStorage persist drift, or macOS keychain surviving reinstall).
- **Layout bug**: the recovery-key header uses `flex justify-between` without wrap; on narrow viewports the action buttons can be pushed off-screen.
- **Store init gap**: `syncStore.init()` silently swallows errors and only updates `recoveryKeyAcknowledged` from Tauri when init succeeds; persisted localStorage can disagree with keychain.

Authoritative key presence is already exposed as `sync_has_master_key` in Rust but is unused in the frontend.

## Goals / Non-Goals

**Goals:**
- Every fresh device (no master key) always shows Generate Key and Import Key.
- Import path stores the key and marks acknowledgement, matching the desktop-generated key on other devices.
- UI configured state requires an actual master key, not acknowledgement alone.
- Responsive layout keeps actions visible on mobile/tablet.
- Component tests lock in fresh-device and import flows.

**Non-Goals:**
- Recovery key rotation or re-export after configuration.
- QR/pairing-based key transfer (pairing commands exist in Rust but are out of scope).
- Web/PWA sync without Tauri (sync already requires desktop app for engine operations).

## Decisions

### 1. Gate UI on `hasMasterKey`, not `recoveryKeyAcknowledged` alone

**Decision**: Add `hasMasterKey: boolean` to `syncStore`, populated from `sync_has_master_key` during `init()`. `SyncSettingsPanel` shows Generate/Import when `!hasMasterKey`; shows "Recovery Key Configured" only when `hasMasterKey && recoveryKeyAcknowledged`.

**Rationale**: Master key presence is the real precondition for sync. Acknowledgement is a UX guard for the generate flow, not a substitute for key existence.

**Alternative considered**: Only fix layout — rejected because it doesn't address stale-ack dead-ends.

### 2. Reconcile stale acknowledgement on init

**Decision**: During `syncStore.init()`, if `recoveryKeyAcknowledged` is true but `hasMasterKey` is false, call a new Tauri command `sync_clear_recovery_ack` (or clear inline in init path) and reset local persist state.

**Rationale**: macOS keychain entries can survive reinstall; localStorage persist can also drift. Auto-repair on init is safer than leaving users stuck.

**Alternative considered**: Rust-only fix — insufficient because zustand persist also holds `recoveryKeyAcknowledged`.

### 3. Responsive header layout

**Decision**: Change the recovery-key section header to `flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3` so title and actions stack on narrow screens.

**Rationale**: Minimal CSS change; matches patterns used elsewhere in settings.

### 4. Tests at component level

**Decision**: Add `SyncSettingsPanel.test.tsx` with mocked `useSyncStore` covering: (a) no key → both buttons visible, (b) import form validation, (c) configured state when hasMasterKey + acknowledged.

**Rationale**: No existing tests for this panel; store already has unit tests for key generation.

## Risks / Trade-offs

- **[Risk] Auto-clearing acknowledgement could surprise users who acknowledged but key write failed** → Mitigation: only clear when `hasMasterKey` is false; surface a toast if reconciliation runs.
- **[Risk] Generate on second device still possible if user ignores guidance** → Mitigation: keep helper copy; consider disabling Generate when signed-in account already has cloud data (future enhancement, not this change).
- **[Risk] `sync_has_master_key` invoke fails offline** → Mitigation: fall back to last known `hasMasterKey` from persist; default to showing import/generate (fail-open for setup).

## Migration Plan

1. Ship frontend + optional Rust ack-clear command in one release.
2. No server migration; keys are device-local.
3. Rollback: revert UI gating change; no data loss.

## Open Questions

- Should Generate Key be hidden (not just warned against) when the signed-in account already has synced cloud blobs? Deferred — needs server signal not currently in scope.
