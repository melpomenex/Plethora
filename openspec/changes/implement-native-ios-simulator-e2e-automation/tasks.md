## 1. Tooling & Maestro Infrastructure Setup

- [ ] 1.1 Add Maestro dependency check in `scripts/ios-test/setup.sh` (detect `maestro` CLI and provide automated install instruction `curl -fsSL "https://get.maestro.mobile.dev" | bash`).
- [ ] 1.2 Create `scripts/ios-test/e2e.sh`: boot simulator, verify Maestro installation, execute all flow YAML files in `tests/ios/flows/`, collect failure screenshots, and return classified exit codes.
- [ ] 1.3 Add NPM script in `package.json`: `"test:ios:e2e": "bash scripts/ios-test/e2e.sh"`.

## 2. Accessibility Identifier Annotations

- [ ] 2.1 Annotate `src/components/navigation/MobileNavigation.tsx` with `data-testid`: `nav-tab-dashboard`, `nav-tab-documents`, `nav-tab-queue`, `nav-tab-review`, `nav-tab-settings`.
- [ ] 2.2 Annotate `src/components/documents/DocumentsPage.tsx` and toolbar elements with `data-testid`: `btn-import-document`, `btn-scan-folder`, `input-search-documents`.
- [ ] 2.3 Annotate `src/components/reader/ReaderView.tsx` with `data-testid`: `reader-viewport`, `btn-close-reader`, `btn-reader-page-next`, `btn-reader-page-prev`.
- [ ] 2.4 Annotate `src/components/common/Toast.tsx` and modal hosts with `data-testid`: `toast-notification`, `toast-title`, `toast-message`, `modal-dialog-host`.

## 3. Fixture Injection & Share Extension Harness

- [ ] 3.1 Create `scripts/ios-test/inject-fixture.sh`: helper script to copy fixture files directly into the active simulator app sandbox directory via `xcrun simctl get_app_container`.
- [ ] 3.2 Create `scripts/ios-test/inject-share.sh`: helper script to stage `.ready` share extension payloads (URL, text, or file) into the App Group container (`group.com.plethora.app.shared/shares/.ready/`).
- [ ] 3.3 Add sample test fixtures in `tests/ios/fixtures/`: `sample-article.epub`, `sample-paper.pdf`, `sample-note.md`.

## 4. Core E2E Flow Implementation

- [ ] 4.1 Create `tests/ios/flows/01_startup_and_navigation.yaml`: test launching, tab navigation (Dashboard -> Documents -> Queue -> Review -> Settings), app termination, cold relaunch, and state recovery.
- [ ] 4.2 Create `tests/ios/flows/02_import_and_read_pdf.yaml`: test PDF fixture staging, import completion toast, document appearance in library, opening in reader, and scrolling.
- [ ] 4.3 Create `tests/ios/flows/03_import_and_read_epub.yaml`: test EPUB fixture staging, multi-chapter reading, and TOC navigation.
- [ ] 4.4 Create `tests/ios/flows/04_navigation_stress.yaml`: test rapid 20x tab switching across all 5 main tabs to verify no race conditions or deadlocks occur.
- [ ] 4.5 Create `tests/ios/flows/05_share_extension_handoff.yaml`: test injecting a URL share payload into App Group container, launching app, and asserting share ingestion and deduplication.

## 5. Verification & Documentation

- [ ] 5.1 Run `npm run test:ios:e2e` against iPhone 17 Pro simulator and verify all 5 flows pass with 0 failures.
- [ ] 5.2 Create `docs/testing/ios-e2e.md` detailing flow authoring guidelines, Maestro syntax, fixture injection, and CI troubleshooting.
- [ ] 5.3 Create `docs/testing/ios-device-boundary.md` documenting the formal boundary between simulator-validated features and physical-device release gates.
