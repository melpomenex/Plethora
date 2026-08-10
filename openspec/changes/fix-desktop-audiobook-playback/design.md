## Context

Current desktop playback path, traced end to end:

1. `AudiobookViewer` prepares a source (`src/components/viewer/AudiobookViewer.tsx:562-575`). On desktop `resolvePlaybackUrl()` calls `convertFileSrc(path)`; only `isNativeMobile()` uses `get_media_stream_url`.
2. `convertFileSrc` yields `asset://localhost/<encoded path>` (macOS/Linux) or `http://asset.localhost/...` (Windows).
3. `src-tauri/tauri.conf.json` has no `app.security.assetProtocol` block. In Tauri 2 `enable` defaults to `false` and the scope defaults to empty, so the protocol handler is not registered and the URL resolves to nothing.
4. The `<audio>` element errors (`MEDIA_ERR_SRC_NOT_SUPPORTED`), `play()` never advances, and the fallback ladder in `localMediaSource.ts` retries the same dead `tauri-asset` strategy before falling back to `backend-blob` — a whole-file `read_document_file` over IPC plus an 8s `probeMediaSource` timeout, which stalls for a large `.m4b`.

The CSP is not the cause: both `csp` and `devCsp` already list `asset:`, `http://asset.localhost`, `blob:` and `http://127.0.0.1:*` under `media-src`.

Constraints that shape the fix:

- Desktop `import_document` (`src-tauri/src/commands/document.rs:180-206`) canonicalizes the user's path and stores it **as-is**; imported audiobooks live wherever the user picked them, not under an app directory.
- `media_server::allowed_media_roots()` returns only `app_data_dir` and `app_cache_dir`, so imported-in-place files are 403 today.
- `prepare_audiobook_playback` writes transcoded `.m4b` output into `app_cache_dir/audiobook_playback` (already an allowed root) and returns the original path unchanged when no transcode is needed.
- `media_server.rs` already implements Range handling, canonicalization, symlink resolution, and has unit tests. It is not `cfg`-gated to mobile.

## Goals / Non-Goals

**Goals:**

- Imported audiobooks play on desktop, including files that live outside app-managed directories.
- One local-media resolution path across desktop and mobile.
- Failures are visible rather than silent.
- Streaming (Range) rather than whole-file buffering on desktop.

**Non-Goals:**

- Changing where imports are stored (no copy-on-import).
- Enabling or scoping the Tauri asset protocol.
- Reworking multi-part audiobooks, podcasts, transcripts, or the karaoke sync view beyond keeping them working.
- Video-specific playback changes beyond sharing the same resolver.

## Decisions

### Use the existing media server on desktop; drop `tauri-asset` for local paths

Rationale: the server already exists, is tested, is Range-correct, and is the mobile path. The alternative — adding an `assetProtocol` block with a scope wide enough for arbitrary user paths (`"**"`) — grants the webview blanket read access to the filesystem via a URL any page-level bug can construct, and WKWebView's asset handling buffers rather than streams. Reuse beats a new grant.

`convertFileSrc` remains available in `src/lib/tauri.ts` for other callers; only media resolution stops using it. `LocalMediaSourceStrategy` keeps `"tauri-asset"` as the marker for a direct remote/`data:` URL (its existing second meaning at `localMediaSource.ts:155`) — renaming that is churn for no behaviour change.

### Authorize by document registration, granted at URL-mint time

`get_media_stream_url` authorizes a canonical path when it is under an app root **or** matches the `file_path` of a document in the repository. On success it inserts the canonical path into a grant set held in `MediaServerState`; `stream_handler` accepts a path that is under a root **or** in the grant set.

Rationale: the handler stays free of database access and stays synchronous on the hot streaming path, while the authorization decision happens once, in the command that already has `AppHandle` and can take `State<Repository>`. Alternatives considered:

- *Widen `allowed_media_roots` to the user's home directory* — turns the loopback server into a general file-read endpoint for anything on the machine that can reach `127.0.0.1`. Rejected.
- *Signed one-time tokens in the URL* — correct but more machinery than the threat model needs for a loopback server whose URLs never leave the app. The grant set is the smaller diff; a token scheme is the upgrade path if URLs ever become shareable.

The grant set is process-lifetime and unbounded in principle, but bounded in practice by the number of distinct media files opened in one session. Marked with a `ponytail:` comment naming the ceiling.

### Failure surfacing

`AudiobookViewer`'s catch already logs a diagnostic and clears `preparedPlaybackSrc`; it additionally sets `playbackError` so the existing error UI and retry control render instead of an idle player. `fallbackAttemptedRef` semantics are unchanged.

### Fallback ladder after the change

1. Remote/`data:` URL → used directly.
2. Non-Tauri `browser-file://` → object URL.
3. Tauri (desktop or mobile) → `get_media_stream_url`.
4. `backend-blob` → last resort, still guarded by `probeMediaSource`.

Step 3 subsumes the old desktop `tauri-asset` branch, including the Linux/WebKitGTK special case at `localMediaSource.ts:239-266` — the loopback server serves ordinary HTTP with Range support, which is exactly what WebKitGTK's GStreamer pipeline wants, so that branch is deleted rather than ported.

## Risks / Trade-offs

- **A file the user later moves or deletes now fails at stream time instead of at element load.** → The stream handler already returns 404 for a missing path; the viewer's error surfacing turns that into a visible message rather than a silent stall.
- **Media server startup failure would break all local playback, where before some paths might have worked.** → In practice none worked on desktop; the `backend-blob` fallback remains for the small-file case, and startup failure produces a visible error.
- **Loopback port is reachable by other local processes.** → Pre-existing (mobile already relies on it); the grant set keeps exposure to files the user has actually opened plus app-managed roots, which is narrower than today's root-only rule combined with a filesystem-wide asset scope.
- **`isNativeMobile()` branches in `AudiobookViewer` collapse into one path.** → Mobile behaviour must be re-verified: the `.m4b` transcode is still skipped on mobile (no ffmpeg sidecar), which the shared path must preserve.
- **Windows path encoding.** → `get_media_stream_url` URL-encodes the canonical path already and the handler decodes it; covered by a unit test for a path containing spaces and non-ASCII characters.

## Migration Plan

No data migration. Behaviour change only, shipped in one commit. Rollback is a revert; no persisted state changes shape.

## Open Questions

- Should the repository lookup match on exact `file_path` only, or also accept the transcoded cache path derived from a registered document? The cache path is already under an app root, so exact match is expected to suffice — confirm during implementation with a real `.m4b`.
- Multi-part audiobooks store `partFiles` in `localStorage` (`AudiobookViewer.tsx:502`) as already-resolved sources. Verify whether those entries hold raw paths or stale `asset://` URLs from a previous session; stale entries may need to be re-resolved on load.
