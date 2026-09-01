## 1. OpenSpec artifacts

- [x] 1.1 Create proposal.md
- [x] 1.2 Create design.md
- [x] 1.3 Create spec deltas

## 2. Selection — double-tap authority (BUG A)

- [x] 2.1 Change `touchstart` listeners to `passive: false` in adapters.ts (top doc + iframe)
- [x] 2.2 Pass paragraph element from adapter `onDoubleTap` to hook
- [x] 2.3 Implement `commitReadySelectionFromParagraph` in useSelectionInteraction
- [x] 2.4 Add double-tap demotion guard for native selectionchange fallout
- [x] 2.5 Add tests: double-tap commit, native word fallout, sequential actions, iframe, manual selection

## 3. YouTube extension (BUG B)

- [x] 3.1 Extract YouTube helpers to testable module
- [x] 3.2 Implement `ensureYouTubeSaveButton` with metadata scoping
- [x] 3.3 Replace URL-only observer with rAF-debounced ensure
- [x] 3.4 Add `browser_extension/tests/youtube-save-button.test.cjs`

## 4. Auth refresh ownership (BUG C)

- [x] 4.1 Delegate Tauri `accountStore.refresh()` to `account_refresh` command
- [x] 4.2 Add PWA single-flight `refreshInFlight` mutex
- [x] 4.3 Add stale refresh token guard before signOut
- [x] 4.4 Update Rust `account_refresh` to check newer token before sign-out
- [x] 4.5 Add accountStore tests for concurrent/stale refresh

## 5. Server capability resolution

- [x] 5.1 Create `server/src/capabilities/resolve.ts`
- [x] 5.2 Refactor `requireCloudSync` and entitlements route to use resolver
- [x] 5.3 Add capability parity tests

## 6. Native sync error mapping

- [x] 6.1 Map sync 403 error codes in `api_error.rs`
- [x] 6.2 Add Rust unit tests for error mapping

## 7. TTS generated audio epoch (BUG D)

- [x] 7.1 Add epoch guards to audio.onplay/onpause/onended/onerror
- [x] 7.2 Detach handlers in cancelAudio before pause
- [x] 7.3 Bump epoch in startFrom before cancel
- [x] 7.4 Add ReaderTTSControls.race.test.tsx stale callback tests

## 8. Language Learning verification

- [x] 8.1 Verified correct on main — no code changes required

## 9. Validation

- [x] 9.1 Run selection interaction tests
- [x] 9.2 Run browser extension tests
- [x] 9.3 Run accountStore / entitlementStore tests
- [x] 9.4 Run server auth/sync tests (capability resolver)
- [x] 9.5 Run TTS race tests
- [ ] 9.6 Run targeted Rust tests for plethora_auth and sync (blocked: pre-existing Swift plugin build failure)

## 10. Adversarial review

- [x] 10.1 Independent review of implementation
- [x] 10.2 Fix any defects found (double-click revalidate guard, duplicate onReady, TTS resume UI, YouTube observer scope)
