## 1. Investigation and specifications

- [x] 1.1 Audit all three viewer navigation/restoration paths and record root causes with source references in verification.md.
- [x] 1.2 Amend this PDF change and the existing EPUB/TTS pending specifications without duplicate capability definitions; verify OpenSpec validation.

## 2. Navigation ownership and correction

- [x] 2.1 Implement permanent initial-restoration cancellation and request identities; verify authority unit tests and direct-input integration coverage.
- [x] 2.2 Fix EPUB continuous gestures, resize redisplays, fragment/CFI resolution and stale queued/in-flight displays; verify EPUB component and anchor tests.
- [x] 2.3 Fix fixed PDF same-page destinations, delayed virtualization, transform conversion and stale lookups; verify PDFViewer integration tests.
- [x] 2.4 Map reflow TOC destinations to semantic blocks and preserve legitimate restored anchors; verify source geometry and reflow integration tests.
- [x] 2.5 Remove parent-child restore competition, retain persisted positions, and preserve follow/re-center, selection, and paginated navigation; verify affected suites.

## 3. Verification

- [x] 3.1 Run focused unit/integration tests, TypeScript, relevant lint, OpenSpec validation and npm run bench:check; record command outcomes and limitations.
- [ ] 3.2 Verify the Android device matrix in verification.md, including long/image-heavy EPUBs and virtualized/rotated/reflow PDFs; record real device, WebView version and observations. Do not mark this complete without actual device execution.
