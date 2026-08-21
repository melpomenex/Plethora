## Why

Plethora has no iOS Share Extension. Verified: zero `NSExtension`/`SLComposeServiceViewController` matches repo-wide; `src-tauri/gen/apple` does not exist; the only iOS Swift is the folder-pick plugin. The OpenSpec change `eink-mode-and-native-share` contains a normative requirement — "On iOS, the application SHALL provide a Share Extension contract supporting text, URL, and document payloads staged into a shared App Group container… consumed exactly once when foregrounded" (`specs/native-mobile-share-target/spec.md:59-65`) — and its tasks 5.1–5.3 are marked `[x]`, but the implementation is **Android-only**: `register_share_listener`/`get_pending_shares` return silent-empty stubs on every non-Android platform. Those checkboxes are misleading and must be annotated.

Two additional verified defects in the existing share pipeline that this proposal must fix as prerequisites:

1. **Event-name mismatch:** Kotlin dispatches `'incrementum-native-share'` (`FolderImportPlugin.kt:243`) but the frontend listens for `'plethora-native-share'` (`src/lib/shareTarget.ts:132`) — warm-start file/text batches from Android are silently dropped today.
2. **Dead command:** `get_pending_shares` has no frontend caller anywhere.

A document picker (`pick_files`/UIDocumentPicker) already exists on iOS; it is not a Share Extension. "Share to Plethora" from Safari/Files/Photos is a core capture path for a read-and-remember product.

## What Changes

- Implement a native iOS Share Extension target ("Plethora") accepting URLs, plain text, PDFs, EPUBs, images, audio, and other supported document types, staging payloads into an App Group shared container.
- Extend the folder-import plugin (or add a sibling reader path) to consume staged payloads on iOS with exactly-once semantics, feeding the existing import pipeline (`useShareTarget` → `documentStore.importFromUrl/importFromFiles/createDocument`, dedupe, smart tagging).
- Fix the Android event-name mismatch and wire cold-start consumption of pending shares so both platforms share one normalized payload contract.
- Support offline capture: staged content imports when storage allows; URL-only shares queue for fetch when online/app runs.
- Preserve provenance (source app, URL, received-at) through to document metadata.

## Capabilities

### New Capabilities

- `ios-share-extension`: Native iOS share-sheet ingestion with App Group staging, exactly-once foreground consumption, and pipeline handoff.

### Modified Capabilities

None directly (the existing `native-mobile-share-target` capability's iOS requirement is implemented by this change; annotation handled in tasks).

## Impact

- New: Share Extension Swift target + files, App Group entitlement, staged-payload schema.
- `src-tauri/plugins/plethora-folder-import/**`: iOS consumption commands (extending the currently-stubbed paths), Android event-name fix.
- `src/lib/shareTarget.ts` / `src/hooks/useShareTarget.ts`: consume pending shares at startup (currently only warm-start listener registration), unified payload handling.
- Generated Xcode project changes via Proposal A's documented extension-target procedure (E does not edit `gen/apple` or CI YAML directly).

**Owns:** everything above.
**Must NOT change:** import/document pipeline internals beyond the entry points named (documentStore functions are consumed, not modified, except where a provenance field addition is required — coordinate small additive change), capability registry semantics (D registers the new capability slot), build pipeline mechanics (A owns; E supplies target definitions via the agreed hook).

## Dependencies

- **Hard:** A must land §2 (generated project + overrides script) before extension-target integration; development can proceed against a locally generated project in parallel using the same procedure.
- **Soft:** D reserves the share capability slot; C adds the App Group to the privacy/entitlements picture; G records device verification evidence.

## Parallelization Notes

E's Swift/extension work, payload schema, frontend consumption, and Android fixes are independent of B/C/D/F and can run fully parallel in Wave 1. The single serialization point is applying the extension target to the committed project — defined as a data-driven step in A's overrides script so neither agent blocks the other's file set.

## Migration / Backward Compatibility

No storage schema change (staged payloads are transient queue files). Android share behavior strictly improves (warm-start bug fix); no removals. PWA hash-param sharing untouched.

## Risks

- Extension memory limits (~120MB) forbid heavy work — staging must be pure file copies; extraction/indexing stays in the main app (design constraint, tested).
- App Group container requires a real provisioning profile with the group on physical devices; simulator testing works without distribution but TestFlight verification needs the entitlement end-to-end.
- Exactly-once consumption across crashes needs careful marker discipline (write-ahead markers, atomic renames).
