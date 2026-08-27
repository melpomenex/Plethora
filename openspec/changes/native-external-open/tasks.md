## 1. Single instance

- [x] 1.1 Add `tauri-plugin-single-instance` (desktop, first plugin)
- [x] 1.2 Focus main window on second-instance activation

## 2. External open router

- [x] 2.1 Rust `external_open` module + `take_pending_external_opens` command
- [x] 2.2 Frontend `externalOpen.ts` + `useExternalOpen` hook
- [x] 2.3 Extract `importRouting.ts` shared with `useShareTarget`

## 3. File associations

- [x] 3.1 Register `bundle.fileAssociations` for supported import formats
- [x] 3.2 macOS `RunEvent::Opened` integration

## 4. Tests

- [x] 4.1 Rust unit tests for argv parsing
- [x] 4.2 Vitest for `externalOpenToSharedBatch`
- [ ] 4.3 Manual: Open With PDF while app running (desktop)
