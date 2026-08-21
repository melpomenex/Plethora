## Context

### Current share architecture (verified)

- **Android (working):** `FolderImportPlugin.kt` handles `ACTION_SEND`/`ACTION_SEND_MULTIPLE`/`ACTION_VIEW` via `handleIncomingIntent` (line 115): extracts stream/text/subject, regex-extracts URLs, stages `content://` URIs into `<filesDir>/imports/` (`stageFileByUri`), builds `{timestamp, items[]}` batches; queues to `pendingBatches` when WebView isn't ready, else dispatches via `evaluateJavascript`. Wired in `gen/android/.../MainActivity.kt:194-204`; manifest intent filters at `AndroidManifest.xml:45-72`.
- **Rust plugin:** `register_share_listener` (Android real; **non-Android returns empty result silently**), `get_pending_shares` (same; **zero frontend callers**), plus mobile-only `pick_files`, cross-platform `pick_folder_documents`, Android-only `install_apk`/`backup_db_to_downloads`/`capture_rendered_dom`.
- **Frontend:** `src/lib/shareTarget.ts` — `normalizeSharedBatch` + `registerShareListener` (invokes `plugin:plethora-folder-import|register_share_listener`; listens `plethora-native-share` + legacy `android-shared-url`). `src/hooks/useShareTarget.ts` — routes URLs → `importFromUrl`/`openTwitterThread`, files → `importFromFiles(paths)`, text → `createDocument` note; PWA hash params handled inline; success toast with "Open". Tests exist for both.
- **Verified defects:** (1) Kotlin emits `'incrementum-native-share'` (Kotlin line 243) vs frontend `'plethora-native-share'` (`shareTarget.ts:132`) — warm-start batches dropped; URL-only warm starts survive via legacy event. (2) `get_pending_shares` uncalled — cold start works on Android only because Kotlin's `registerShareListener` also returns-and-clears pending batches.
- **iOS:** nothing. No extension, no App Group, no consumption path.
- **Import pipeline hook points (verified):** `import_document(path)` (Rust, dedups via content hash), `import_document_from_bytes` staging to `<app_data_dir>/imports/`, `documentStore.importFromUrl` (in-flight URL dedupe via `normalizeArticleUrl`), smart-tagging enqueue (`smartTaggingQueueStore.enqueue` called from documentStore at 5+ sites), provenance fields on `DocumentMetadata` (`url`, `originalUrl`, `siteName`, `fetchedAt`, `captureProvenance`…), remote-inbox precedent (`inboxStore.ts` pending/accepted lifecycle) for exactly-once semantics.

## Goals / Non-Goals

**Goals:**

- "Plethora" appears in the iOS Share Sheet from Safari, Files, Photos, PDF viewers, etc., accepting URL/text/PDF/EPUB/image/audio payloads.
- Staged handoff via App Group container; extension stays lightweight (file copies only); main app completes extraction/indexing.
- Exactly-once consumption; offline-tolerant; dedupe via existing content-hash and URL-dedupe machinery; provenance preserved; smart tagging applied; lands in Documents with a success toast.
- One normalized payload contract shared by Android and iOS; Android warm-start bug fixed; cold-start consumption wired on both.

**Non-Goals:**

- In-extension previews/editing UI beyond a minimal confirmation (keep the extension fast and simple).
- Changing the import pipeline's internals (dedupe/tagging/normalizers) — reuse as-is.
- Android share UX redesign (only the event-name fix + cold-start wiring).
- Widget/Action extensions.

## Decisions

### 1. Extension design
`ShareViewController` (subclass of `UIActivityViewController`-hosted `SLComposeServiceViewController`-equivalent — implementation detail: a plain `UIViewController` presented by an app-extension target with `NSExtensionActivationRule` covering URL, text, and file types with content-size limits). On accept: write each item into App Group container `group.com.plethora.app` under `imports/<uuid>/` with a manifest JSON (`{id, kind: url|text|file, filename?, urlString?, text?, receivedAt, sourceApp?}`), then atomic rename to `.ready/`. No network calls, no heavy validation in-extension. Optional minimal UI: label + "Saved to Plethora" state; auto-dismiss.

### 2. Consumption path
Extend `plethora-folder-import` Rust plugin with iOS branches: `get_pending_shares` scans the App Group container for `.ready` manifests and returns them (marking in-progress via rename to `.claiming/`, delete after successful handoff to the app's storage — exactly-once via claim markers). Files are moved/copied into the app's `imports/` staging area, then routed through the existing `useShareTarget.handleBatch` logic (URLs → `importFromUrl`, files → `importFromFiles`, text → `createDocument`). Frontend calls `get_pending_shares` at app startup (fixing the dead-command gap) in addition to the warm-start listener.

### 3. Unified payload contract
`SharedPayload`/batch schema already normalized in `shareTarget.ts` is the contract; iOS manifests map into it. Android event rename: emit `'plethora-native-share'` from Kotlin (keep the legacy `'android-shared-url'` path untouched). Both platforms then behave identically for warm and cold starts.

### 4. Provenance
Manifest `sourceApp`/`receivedAt`/`urlString` map to `DocumentMetadata` (`url`, `siteName`, `fetchedAt`, `captureProvenance`-style field). Additive metadata only; coordinate the small type addition with the document-store owners (this change makes it, others read).

### 5. Project integration via A's hook
The extension target (its files, App Group entitlement, Info.plist `NSExtension` keys) is defined as data consumed by A's overrides script; CI builds the extension automatically once the target exists in the project. App Group id `group.com.plethora.app` shared with the main target's entitlements.

### 6. Offline behavior
Files: staged and imported immediately (local). URLs/text: staged; URL fetch requires network — on failure, retain the manifest and retry on next launch/foreground (bounded retries, then surface in a "pending shares" notice). No silent loss: anything unconsumed remains in the container until consumed or explicitly discarded.

## Failure Behavior

- Extension OOM/safety: only file copies; large payloads above activation limits are rejected by the activation rule (iOS handles).
- Claim crash: `.claiming/` items older than a threshold are reclaimed on next scan (at-least-once with content-hash dedupe making redelivery harmless).
- Unsupported payload type: extension declines gracefully (activation rule prevents most; remaining cases show a brief "unsupported" state).

## UX States

Extension: brief "Saving to Plethora…" → "Saved" → dismiss. In-app: existing toast with "Open" action; pending-shares retry notice when offline URL shares remain.

## Testing Strategy

- Unit: manifest↔payload mapping, claim/exactly-once marker logic, retry/backoff.
- Integration (simulator): share URL/text/PDF from Safari/Files into the app; verify dedupe on re-share; verify smart-tagging enqueue fires.
- Android regression: warm-start batch delivery now works (event-name fix) — add the missing test.
- Device (physical iPhone): real share-sheet flow, offline URL share, large PDF; recorded as evidence (G).

## Rollout

Android fixes can land immediately (independent). iOS extension lands after A's project generation exists; feature-complete behind nothing (it simply doesn't exist today on iOS).

## Alternatives Considered

- **Open-in-place via UIDocumentPicker only** (status quo): rejected as the sole mechanism — not a Share Extension; misses Safari/Photos capture.
- **Clipboard polling / keyboard extension**: rejected — privacy-invasive and review-risky.
- **App-links/deep-links only**: rejected — requires source-app cooperation; share sheet is universal.
- **Cloud inbox as the only capture path**: retained as a complementary flow (existing `cloud_web_capture`), but offline/local capture requires the extension.

## Rejected Alternatives / Notes

- Using `WKAppBoundDomains`/universal-links handoff for URL shares: complementary, not sufficient; share sheet remains primary.

## Ownership & Collision Boundaries

| File/area | Owner | Notes |
|---|---|---|
| Extension Swift sources, App Group entitlement, `NSExtension` plist keys | **E** | applied via A's overrides hook; E supplies definitions, never edits xcodeproj/CI YAML directly |
| `plugins/plethora-folder-import` iOS consumption + Android event fix | **E** | A owns the plugin's link-symbol naming (already fixed there; E builds on it) |
| `src/lib/shareTarget.ts`, `useShareTarget.ts` | **E** | D consumes capability slot; F/H consume UX outcomes |
| `DocumentMetadata` provenance addition | **E** (additive) | coordinate with document-store owners; B/C/D read-only |
| `gen/apple`, `mobile-build.yml` | A owns | E's target lands through the hook contract |

**Sequencing with A:** A lands project generation + hook first (Wave 1 start); E's extension definition integrates as soon as the hook exists. If E finishes first, its Swift sources live in a plugin-relative directory ready for the hook.
