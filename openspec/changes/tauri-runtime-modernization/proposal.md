## Why

Plethora pins Tauri at `=2.11.0` to avoid a localhost/IPC regression introduced in 2.11.1 (GHSA-7gmj-67g7-phm9 follow-up), leaving security fixes in 2.11.2–2.11.5 unapplied. The app already scopes `remote` capabilities to explicit localhost dev/release ports; upgrading should restore security posture without breaking YouTube iframe embeds or custom IPC.

## What Changes

- Upgrade `tauri` and in-repo plugin crate pins from `=2.11.0` to `=2.11.5` (latest 2.11.x stable).
- Retain the local Wry patch (`vendor/wry-0.55.1`) until upstream iOS deadlock fix is proven on Plethora's simulator boot path.
- Keep `tauri-plugin-localhost` on desktop; verify `capabilities/default.json` `remote.urls` remain the minimum scope for localhost IPC.
- Add global `on_web_content_process_terminate` handler (macOS/iOS) that logs, emits a frontend recovery event, and relies on Tauri's rate-limited default reload when no per-webview override exists.
- Document the security migration and retained pins in design.md.

## Capabilities

### New Capabilities

- `tauri-core-security`: Safe Tauri 2.11.5 adoption with localhost IPC, remote capability scoping, and Wry patch retention policy.

### Modified Capabilities

<!-- None -->

## Impact

- `src-tauri/Cargo.toml`, all in-repo plugin `Cargo.toml` files pinning `tauri`
- `src-tauri/capabilities/default.json` (verify only; tighten if possible)
- `src-tauri/src/lib.rs` — web content process termination hook
- `package.json` — align `@tauri-apps/api` to `^2.11.1` (latest npm; Rust crate at `=2.11.5`)
- `Cargo.lock`
