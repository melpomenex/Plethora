## Context

In the desktop app on macOS (which uses WebKit/Safari as the webview engine), the "Save to Image Registry" button on image hover fails because images inside documents or epubs use local custom protocols (like `asset://` or `https://asset.localhost/`). WebKit security policies block the frontend `fetch()` API from fetching these custom protocols, resulting in silent failures or TypeError exceptions.

## Goals / Non-Goals

**Goals:**
- Enable saving hovered images using local file protocols (`asset://`, `https://asset.localhost/`, `file://`) to the image registry on macOS.
- Keep the current behavior intact for standard data URLs and HTTP/HTTPS images.
- Provide a robust fallback method to read local files when direct WebKit fetches are blocked.

**Non-Goals:**
- Changing how images are displayed or changing the protocols themselves.
- Re-architecting the image registry backend database or API.

## Decisions

### Decision 1: Read local files via Tauri's `@tauri-apps/plugin-fs` as fallback
- **Rationale**: When `fetch()` fails due to CORS or protocol restrictions in WebKit, the frontend cannot retrieve the bytes directly. However, since the app runs in a desktop environment with Tauri privileges, we can use the `@tauri-apps/plugin-fs` module to read the file from the local disk.
- **Alternatives Considered**: 
  - *Custom Rust command*: Creating a new Tauri IPC command just to read file bytes. This is unnecessary since we already have `@tauri-apps/plugin-fs` installed and configured.
  - *Disabling WebKit Web Security*: Disabling web security in Tauri config is a security risk and should be avoided.

### Decision 2: URL parsing helper for local asset protocols
- **Rationale**: To read the file using the fs plugin, we must extract the actual file system path from the URL. A robust parser will handle prefixes like `asset://localhost/`, `https://asset.localhost/`, `http://asset.localhost/`, `asset://`, and `file://`, decoding any URI-encoded characters.
- **Alternatives Considered**: String manipulation only (less robust to query parameters or platform variations).

## Risks / Trade-offs

- **Risk**: Reading files directly from disk requires correct read permissions in Tauri's configuration.
  - **Mitigation**: The app already uses `@tauri-apps/plugin-fs` elsewhere to read and write documents, so the necessary Tauri permissions should already be in place.
