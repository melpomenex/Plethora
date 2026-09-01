## Context

Prior changes established V2 selection interaction (`overhaul-reader-selection-ux`), immutable `CapturedSelection` at action time (`fix-reader-extract-and-view-state`), entitlement persistence (`fix-multipart-audiobook-language-gating-and-entitlement-persistence`), and TTS playback epoch model (`improve-reader-tts` D12). Forensic inspection confirms four gaps remain in production code.

**Selection:** `adapters.ts` registers `touchstart` with `{ capture: true, passive: true }` while calling `preventDefault()` on double-tap. `onDoubleTap` arms settle timer but does not `commitReadySelection` from the paragraph element; settle reads live DOM which native word selection can overwrite.

**YouTube:** `createYouTubeSaveButton()` uses global `#actions` selectors and always removes existing button. MutationObserver only reinjects on URL change.

**Auth:** `accountStore.refresh()` independently POSTs `/v1/auth/token/refresh` on Tauri while Rust `AuthManager.refresh_lock` protects native sync/entitlement paths. Server family-wide revocation on reuse is correct security behavior.

**TTS:** System speech and Android native handlers check `playbackIdRef`; HTML audio handlers do not. `cancelAudio` detaches utterance handlers but not audio element handlers.

**Language Learning:** Verified correct — `settings.languageLearning.enabled` defaults false, v11 migration, `DocumentViewerWrapper` master gate.

## Goals / Non-Goals

**Goals:**
- Double-tap paragraph selection remains authoritative through sequential actions despite native DOM mutation
- YouTube save button survives same-URL watch-metadata replacement
- One refresh owner per runtime; no token-family revocation from app-internal races
- Shared server capability resolver; diagnosable sync errors
- Generated-audio callbacks cannot affect playback after retarget

**Non-Goals:**
- Redesign selection state machine, TTS architecture, or entitlement persistence
- Weaken server refresh reuse detection
- Change language-learning gating (verified correct)
- Live YouTube E2E tests

## Decisions

### D1 — Selection: commit snapshot + passive:false (not either alone)

**Chosen:** On double-tap, adapter sets `passive: false` on `touchstart`, calls `preventDefault`, selects paragraph, passes element to hook which immediately `commitReadySelection` built from paragraph range/text. Optional short grace: ignore `selectionChanged` demotion when `gestureOrigin === "double-tap"` and live text is strict subset of committed paragraph within 300ms.

**Alternatives rejected:**
- `passive: false` only — settle still races live DOM
- Snapshot only — native highlight may still show one word; demotion without guard still possible
- Broad `selectionchange` suppression — breaks handle drag and manual adjustment

### D2 — YouTube: scoped idempotent ensure

**Chosen:** `ensureYouTubeSaveButton()` scopes to `ytd-watch-metadata`, validates existing button placement, removes only stale/disconnected instances, schedules via rAF. Observer watches metadata subtree (fallback body until metadata exists). Keep `yt-navigate-finish` as supplementary signal.

**Alternatives rejected:**
- Timer retry loop only — races hydration
- URL-only observer — root cause of BUG B
- Global page traversal on every mutation — expensive

### D3 — Auth: Rust owns native refresh

**Chosen:** Tauri `accountStore.refresh()` invokes `account_refresh` command. PWA uses module-level `refreshInFlight` promise coalescing. Stale response guard: compare refresh token sent vs current before `signOut()`. Rust `handle_refresh_failure` checks if store already has newer refresh token before signing out.

**Alternatives rejected:**
- TS-only mutex on Tauri — does not cover Rust sync scheduler
- Weakening reuse detection — security regression

### D4 — Server: shared resolveCapability

**Chosen:** `server/src/capabilities/resolve.ts` with `resolveCapability(userId, capability)` and batch variant for entitlements route. `requireCloudSync` becomes thin wrapper.

### D5 — TTS: epoch guards + handler detachment

**Chosen:** All four HTML audio handlers check `playbackIdRef.current === playId`. `cancelAudio` nulls handlers before pause. Bump epoch in `stopAudio`/`startFrom` before cancel for immediate invalidation.

**Alternatives rejected:**
- Stop old audio only — orphaned element callbacks still fire
- Epoch only without detachment — pause-triggered events may still race

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| `passive: false` scroll jank | Only on touchstart capture path; keep touchend passive |
| YouTube DOM layout changes | Prefer `#actions-inner` with metadata scoping; fallback selectors |
| Stale refresh sign-out edge cases | Token-generation comparison before destructive actions |
| Over-broad double-tap demotion guard | Time-boxed; only when committed fingerprint matches paragraph |
| Test fidelity for native selection | Simulate word-level selectionchange after double-tap in unit tests |

## Migration Plan

No data migrations. Deploy extension + app together for auth changes. Rollback: revert to prior refresh path (accept race risk).

## Open Questions

None blocking — forensic agents verified root causes.
