## 1. WebView recovery

- [x] 1.1 Rust termination event + reload
- [x] 1.2 Frontend `useWebviewRecovery` with safe-mode threshold

## 2. Lifecycle checkpoint

- [x] 2.1 Emit `app-lifecycle` on mobile `RunEvent::Resumed`/`Suspended`
- [x] 2.2 `useLifecycleCheckpoint` debounced `saveTabs` on suspend

## 3. Verification

- [ ] 3.1 iOS simulator: background/kill WebContent process
- [x] 3.2 `cargo check` + frontend tests pass
