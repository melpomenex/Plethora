### Fixed & Improved

- **Large EPUBs now open** — Files above ~20–30 MB (confirmed: 26 MB and 84 MB repros) previously failed to render because the whole file was shipped across Tauri IPC and decompressed eagerly in the webview. EPUBs now stream from a backend loopback HTTP server with full byte-range support, mirroring how audiobooks already stream; epubjs/JSZip fetch only the central directory and spine entries they need. Also adds a defensive 256 MiB desktop backstop on `read_document_file` so any future caller that bypasses streaming fails loudly instead of hanging the webview.
