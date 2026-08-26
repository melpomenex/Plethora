# Design: Tauri build target parity

## Runtime target contract

```ts
type FrontendRuntimeTarget = "tauri" | "pwa" | "web";
```

| Input | Target |
|-------|--------|
| Any Tauri env signal (`PLETHORA_TAURI`, `TAURI_DEV_HOST`, `TAURI_ENV_*`, legacy `TAURI_PLATFORM`…) | `tauri` |
| Vite `mode === "pwa"` (and not Tauri) | `pwa` |
| Vite `mode === "production"` without Tauri | `pwa` (existing `npm run build` policy) |
| Vite `mode === "development"` without Tauri | `web` |

`PLETHORA_RUNTIME_TARGET` may override when set to a valid target (tests/CI only).

## Failure invariants

- Tauri environment + `isPWA === true` → throw at config evaluation.
- Explicit `mode === "pwa"` + Tauri environment → throw.

## Build metadata

`dist/plethora-build-metadata.json`:

```json
{
  "target": "tauri",
  "profile": "development",
  "version": "2.7.0",
  "gitSha": "…",
  "buildId": "…"
}
```

## Feature parity audit (affected Vite branches)

| Branch | Tauri misclassified as PWA impact |
|--------|-----------------------------------|
| Rollup `external` Tauri plugins | Native FS/dialog/path APIs excluded from bundle — broken imports |
| `modulePreload: true` | iOS dynamic import preload failures |
| PWA API proxy | Dev-server proxy semantics in production webview |
| `react({ fastRefresh: false })` | Minor; dev-only |

Runtime `isTauri()` is unaffected; the bug is compile-time bundling.

## Stale artifact protection

Vite rebuilds `dist/` on production build. The metadata JSON is rewritten every build with the current git SHA and build ID so packaged apps can be fingerprinted.
