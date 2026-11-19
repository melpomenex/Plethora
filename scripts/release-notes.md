### Added

- **PDF image region detection & save overlay** — Automatically detect embedded image regions on PDF pages (`pdfImageRegions`) and display an interactive `ImageSaveOverlay` to save or extract PDF figures.

### Fixed & Improved

- **SumatraPDF-style geometric PDF text selection** — Added character-level geometric layout (`pdfCharLayout`), improved CJK word spacing, and optimized Windows PDF rendering and selection performance.
- **Right-click text selection menu on OCR & fixed PDFs** — Fixed context menu handling in `PDFViewer` and `DocumentViewer` so right-clicking selected text reliably opens the selection menu on OCR and fixed-layout PDFs.
