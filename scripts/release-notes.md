### Added

- **Managed Nougat setup** — OCR settings can now install or repair an isolated Python 3.10 environment with the official `nougat-ocr` package, select the managed executable automatically, and report live setup progress and actionable diagnostics.
- **Images on ordinary extracts** — The extract dialog now exposes images captured from the current article plus the complete Image Registry. Selected images are stored locally and embedded with the extract instead of relying on fragile remote hotlinks.

### Fixed & Improved

- **Structured, persistent web imports** — Long imported articles retain headings, lists, tables, figures, and readable typography, and active HTML readers recover cleanly when returning from another tab, workspace, or macOS desktop instead of becoming blank or reporting no readable content.
- **Review Queue sessions start correctly** — Starting an Optimal Session from Review Queue now opens the flashcard study flow using that queue, while session state updates no longer make the active article disappear.
- **Reading Queue and Schedule agree** — “Due All” now includes documents, extracts, and flashcards scheduled anywhere within the current day, matching the Schedule view; expanded queue rows also retain their measured layout instead of clipping or overlapping.
- **Card deletion and Undo work from documents** — Learning-item deletion now calls registered native delete and exact-restore commands, produces one confirmation notification, and patches active review state without reloading or losing session progress.
- **Nougat PDF output compatibility** — Managed Nougat constrains `pypdfium2` below its incompatible 5.0 release, detects runtimes that need repair, handles temporary working directories in production builds, and preserves useful diagnostics when an `.mmd` result is not produced.
- **Protected article images work with Image Registry and occlusion** — Remote images are ingested through the native app to avoid WebView CORS failures. Browser-like referrer headers handle ordinary hotlink protection, with a rendered-pixel capture fallback for hosts that return 403 or present a browser challenge.
- **PDF reader headers adapt to narrow panes** — Document and PDF toolbar groups wrap or scroll according to reader-pane width, preventing page, priority, view-mode, and zoom controls from overlapping in split or constrained layouts.
- **Large-reader responsiveness** — Article hydration, queue virtualization, and tab reactivation avoid unnecessary reloads and measurements, improving startup and navigation responsiveness for large imported pages and queues.
