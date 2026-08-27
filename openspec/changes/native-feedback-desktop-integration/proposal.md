## Why

Linux custom chrome dragging was modernized via `src/lib/windowDrag.ts` (OpenSpec `fix-desktop-window-dragging`). Haptics already flow through `src/lib/feedback/orchestrator.ts` using `navigator.vibrate`. Native Tauri haptics plugin adds little over the existing abstraction on mobile and is not available on desktop.

## What Changes

- **Drag regions**: Retain the existing `startDragging()` + exact-target Linux implementation; evaluate `data-tauri-drag-region="deep"` as deferred — Tauri 2.11.x deep drag regions are not uniformly reliable across Wayland compositors per prior OpenSpec research.
- **Haptics**: Keep orchestrator → `supportsHaptics()` → `vibrate()` path; map review rating events through existing `FEEDBACK_POLICY_REGISTRY` (no scattered native calls).
- **macOS simple fullscreen / focus reader**: Document as deferred — requires UI architecture for immersive mode; out of scope for this rollout.
- **Mobile multi-window**: Document as deferred future capability.

## Capabilities

### New Capabilities

- `native-feedback-policy`: Documented haptic mappings for review interactions via feedback orchestrator.

### Modified Capabilities

- `desktop-window-chrome`: Confirm Linux drag implementation is canonical; deep drag-region migration is explicitly deferred.

## Impact

- Documentation only for drag/fullscreen/multi-window deferrals
- Minor policy tweaks in `src/lib/feedback/policy.ts` if review haptic roles need tuning
- No new Tauri plugins required for haptics in this rollout
