## Why

Mobile WebKit can terminate the content process under memory pressure, leaving a blank webview. Plethora already persists tabs (`restoreSession`) and reader positions in SQLite, but has no explicit lifecycle policy for suspend/resume or WebView recovery coordination.

## What Changes

- Emit `webview-content-process-terminated` from the Rust shell (via Tauri 2.11.5 hook) with label and recovery generation counter.
- Frontend `webviewRecovery` module: on termination event, wait for reload, then re-read last stable session snapshot (tabs store) — no heavy document auto-reopen loop; show diagnostic toast after repeated terminations in a sliding window.
- Mobile lifecycle: listen for Tauri `RunEvent::Resumed` / `Suspended` where available; on suspend, trigger debounced `tabsStore.saveSession()` flush; on resume, avoid duplicate plugin initialization (idempotent).
- Document deferred: full TTS/AI model unload policy (existing Android plugins own their lifecycle).

## Capabilities

### New Capabilities

- `webview-recovery`: Detect content-process termination, reload, restore session snapshot, loop prevention.
- `mobile-lifecycle-checkpoint`: Suspend/resume session flush policy.

### Modified Capabilities

<!-- session-restore OpenSpec is complementary; no requirement delta here -->

## Impact

- `src-tauri/src/lib.rs`, `src/lib/webviewRecovery.ts`, `src/hooks/useWebviewRecovery.ts`
- `src/lib/lifecycleCheckpoint.ts`, `src/hooks/useLifecycleCheckpoint.ts`
- `src/components/layout/MainLayout.tsx`
