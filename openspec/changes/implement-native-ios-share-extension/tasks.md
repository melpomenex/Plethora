## 1. Android Share Fixes (independent, land first)

- [ ] 1.1 Fix the event-name mismatch: Kotlin `FolderImportPlugin.kt` emits `'plethora-native-share'` (matching `shareTarget.ts:132`); keep the legacy `'android-shared-url'` URL path intact.
- [ ] 1.2 Wire cold-start consumption of `get_pending_shares` in the frontend startup path so pending batches are consumed even when no listener registration precedes them; unify with `registerShareListener`'s return-and-clear behavior.
- [ ] 1.3 Add a warm-start batch-delivery test (the currently-dropped case) to `useShareTarget`/`shareTarget` test suites; verify existing tests still pass.
- [ ] 1.4 **Documentation correction:** annotate `eink-mode-and-native-share/tasks.md` sections 5 and 6 as Android-only implementations with the iOS Share Extension requirement superseded by this change.

## 2. Payload Contract and Provenance

- [ ] 2.1 Define the staged-manifest schema (`{id, kind, filename?, urlString?, text?, receivedAt, sourceApp?}`) shared by extension writer and Rust reader; document it alongside `normalizeSharedBatch`.
- [ ] 2.2 Map manifest fields into `DocumentMetadata` provenance (`url`, `siteName`, `fetchedAt`, capture-provenance field); additive type change coordinated with document-store owners.

## 3. iOS Consumption Path

- [ ] 3.1 Extend `plethora-folder-import` Rust: iOS branch for `get_pending_shares` scanning App Group container `.ready/` manifests with claim-marker exactly-once semantics (`.claiming/` rename, reclaim-after-timeout, delete after handoff).
- [ ] 3.2 Move/copy claimed files into the app's staging area compatible with `import_document(path)`; route results through the normalized batch contract.
- [ ] 3.3 Frontend: call `get_pending_shares` at app startup on iOS before/alongside listener registration; ensure offline URL/text shares retry on subsequent launches with bounded retries and a visible "pending shares" notice.
- [ ] 3.4 Unit tests: manifest mapping, claim/reclaim logic, retry bounds. Integration test: re-share dedupe via content hash / URL dedupe.

## 4. Share Extension Target

- [ ] 4.1 Implement the extension Swift sources (activation rules covering URL, text, PDF, EPUB if offered, images, audio; size limits per design), staging writer with atomic `.ready` renames, minimal save-confirmation UI.
- [ ] 4.2 Define the target as data for Proposal A's overrides hook: target name "Plethora" (display), bundle id `com.plethora.app.ShareExtension` (or team-conventional suffix agreed with A), App Group `group.com.plethora.app`, `NSExtension` plist keys, entitlements.
- [ ] 4.3 Add the App Group entitlement to the main target through the same overrides contract; coordinate with C so privacy documentation covers the shared container.
- [ ] 4.4 Verify the extension builds as part of the standard archive pipeline once integrated (coordinate CI artifact naming with G).

## 5. Verification

- [ ] 5.1 Simulator verification: share URL from Safari, text selection share, PDF from Files → Plethora appears in Documents with provenance, smart-tagging enqueued, toast shown; re-share same URL dedupes.
- [ ] 5.2 Physical-device verification: real share sheet flows including a large PDF and an offline URL share (staged, imported after reconnect); evidence recorded per G's format.
- [ ] 5.3 Android regression: warm-start file/text share now delivers (previously dropped); record before/after evidence.
- [ ] 5.4 Performance check: extension cold-launch to dismissal well under system limits; main-app import happens asynchronously without blocking foreground launch.
