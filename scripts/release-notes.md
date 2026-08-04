### Fixed & Improved

- **QR scan-to-join silently failed on Android** — `scanner.start()` was rejected with a `play()`-interrupted `AbortError` that surfaced as a permanent scan failure; the camera start is now retried so joining a room by QR works on Android.
- **QR scan failures were invisible** — errors from the scanner were swallowed silently; they now surface to the user instead of leaving the scan modal hanging.
- **Auto-download never triggered on Android** — `isOnWifi` returned false inside the Android WebView (the Network Information API isn't available there), so file auto-download was blocked; Wi-Fi detection now works on Android.
- **EPUB files failed to download from sync** — the `encryptedMetadata` field used Rust serde casing the TS side didn't send, and metadata wasn't included in the file summary; both fixed so EPUBs transfer correctly.
- **Duplicate documents on re-download** — the document `fileId` dedup check re-read the whole library on every candidate; now cached, eliminating repeated full scans during sync download.
- **Per-device room key could desync from the shareable secret** — older builds replicated the derived room key, which could leave the cached key and secret out of sync; a non-secret binding digest now lets `roomCrypto` detect that state on every boot and deterministically repair the key from the shareable secret.
- **Native secure-storage calls starved the async worker pool** — `keyring` calls are blocking OS/Keystore IPC; running them inline in `async fn`s starved the Tokio worker pool and stalled the boot chain on Android. They now run via `spawn_blocking`.
- **Old document rows were rejected by Rust on sync** — several Rust `Document` fields were added after sync first shipped while the TS interface kept them optional; passing a stale compacted row through made Tauri reject the command. Synced documents are now normalized to the full DTO before invoke.
- **Device-local file paths leaked into replicated payloads** — `filePath` portability is now a single shared check (`isPortableFilePath`) used by both publish and seed paths, so only URL-backed content replicates.
- **fileManifest rows never left the outbox** — its domain lacked a registered delta-log publisher, so `drainSyncOutboxBatch` left every row "pending" forever and peers never discovered files to download. A publisher is now registered for it.
- **Pending delta-log inbox wasn't replayed** — messages received before the router was ready were dropped; the inbox is now replayed on boot so cold-start converges.
- **Delta-log router and progressive scheduler hardening** — additional replay/queue robustness, checkpoint settle improvements, and bounded progressive-pull scheduling to keep cold-start memory bounded.
