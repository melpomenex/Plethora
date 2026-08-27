# Tauri modernization architecture decision record

Date: 2026-08-27

## Summary

Plethora modernizes its Tauri integration by upgrading to **2.11.5**, retaining the **Wry 0.55.1 patch**, scoping **localhost IPC via remote capabilities**, adding **desktop single-instance + file associations**, and wiring **WebView recovery + lifecycle checkpoints** on Apple platforms.

## Tauri / IPC security

| Decision | Rationale |
|----------|-----------|
| Upgrade `=2.11.0` → `=2.11.5` (Rust) | Latest 2.11.x includes GHSA-7gmj-67g7-phm9 fixes and web-content-process recovery APIs |
| `@tauri-apps/api` at `^2.11.1` | Latest npm release; pairs with Rust `=2.11.5` (no 2.11.5 JS package published) |
| App `permissions/default.toml` via `build.rs` | Tauri 2.11.1+ ACL-enforces localhost IPC; `remote.urls` alone is insufficient without explicit app command grants |
| Keep `tauri-plugin-localhost` on desktop | YouTube iframe embeds require http://localhost; custom `tauri://` blocks iframes |
| Keep `capabilities/default.json` `remote.urls` scoped to ports 9527 + 15173 | 2.11.1+ treats localhost as remote; explicit remote capability is the supported mitigation |
| Do not grant blanket remote IPC | No `https://*` remote capability; embedded content stays CSP-gated |

## Wry patch

**RETAINED** — `vendor/wry-0.55.1` patches [wry#1775](https://github.com/tauri-apps/wry/issues/1775) (WKURLSchemeTask deadlock on iOS simulator). Upstream fix not re-verified on Plethora's module-waterfall boot path in this run.

## Single instance & external open

- `tauri-plugin-single-instance` registered first on desktop
- `external_open.rs` normalizes argv / macOS `RunEvent::Opened` → `external-open` events
- Frontend `useExternalOpen` drains `take_pending_external_opens` + listens for warm activations
- Import logic centralized in `importRouting.ts` (shared with `useShareTarget`)

## Mobile share / intents

Already implemented via `plethora-folder-import` (Android ACTION_VIEW/SEND/SEND_MULTIPLE, iOS share extension). No duplicate import path added.

## WebView recovery

- Rust: `on_web_content_process_terminate` emits `webview-content-process-terminated`, then reloads
- Frontend: `useWebviewRecovery` reloads tabs snapshot; safe mode after 3 recoveries / 30s

## Deferred

| Capability | Reason |
|------------|--------|
| `data-tauri-drag-region="deep"` | Linux Wayland compositor inconsistency; existing `windowDrag.ts` is canonical |
| macOS simple fullscreen / focus reader | UI architecture scope |
| Mobile multi-window | Requires window-scoped state, TTS ownership — future OpenSpec |
| `tauri-plugin-haptics` | `navigator.vibrate` + feedback orchestrator already sufficient |
| Remove localhost plugin | Would break YouTube embeds without alternate origin architecture |

## Release tooling

Custom iOS (`scripts/ios-release.mjs`) and Android build scripts retained; Tauri 2.11.x bundle `fileAssociations` adopted for desktop Open With.
