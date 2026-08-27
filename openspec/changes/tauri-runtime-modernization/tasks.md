## 1. Tauri security upgrade

- [x] 1.1 Upgrade `tauri` pin to `=2.11.5` in main and plugin crates
- [x] 1.2 Retain Wry vendor patch; document in ADR
- [x] 1.3 Verify `capabilities/default.json` remote localhost scope
- [x] 1.4 Add `on_web_content_process_terminate` handler (macOS/iOS)

## 2. Verification

- [x] 2.1 `cargo check` passes on macOS
- [ ] 2.2 Manual: localhost IPC + YouTube iframe smoke on desktop release build
- [ ] 2.3 Manual: iOS simulator boot with patched Wry
