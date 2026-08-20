## 1. Lock Down Extension Capture Policy

- [x] 1.1 Introduce a single fail-closed settings state for the extension worker; initialize navigation auto-save, history capture, and bookmark capture to `false` and prevent passive listeners from running before settings load completes.
- [x] 1.2 Update `loadSettings`, options-page defaults, and settings-change handling to interpret only explicit `true` values as enabled for passive capture; keep explicit Save Current Tab, Save Link, Save All Tabs, and extract actions independent.
- [x] 1.3 Audit `tabs.onUpdated`, `history.onVisited`, and `bookmarks.onCreated` so each listener checks only its own ready-and-enabled flag and never queues a passive save while disabled.
- [x] 1.4 Align source, debug/minimal worker variants, manifests, option labels, and shipped extension packaging inputs so all distributed variants use the same opt-in defaults.

## 2. Implement Readable Browser Import Persistence

- [x] 2.1 Refactor browser request classification and content selection into testable helpers that preserve page/link/document semantics and reserve extract creation for explicit `extract` requests.
- [x] 2.2 Add readability-first handling for empty, link-only, or navigation-heavy page payloads; persist canonical plain text and article HTML together when a readable candidate is available.
- [x] 2.3 Keep generic HTML-to-text as a bounded lower-confidence fallback, record its fallback status in browser-import metadata, and ensure a later explicit save can enrich the same document.
- [x] 2.4 Preserve normalized source-URL deduplication and add guarded monotonic enrichment so empty, poorer, or stale background candidates cannot replace valid newer content.
- [x] 2.5 Add backend tests for rich captures, link-only fallback, navigation-heavy input, failed extraction, duplicate saves, explicit extracts, and stale enrichment races.

## 3. Make Imported Documents Readable in the App

- [x] 3.1 Ensure document-opening paths hydrate a full document before reader, assistant, search, or Q&A body consumers use a content-free startup/library summary.
- [x] 3.2 Merge hydrated documents by ID and ignore or cache late responses without allowing a response for a previous tab/document to replace the active document.
- [x] 3.3 Update the HTML reader path to prefer stored browser article HTML through the existing sanitization boundary, and update plain-text fallback rendering to preserve paragraph and line boundaries.
- [x] 3.4 Add frontend regression tests for opening a summary after restart, rendering structured imported HTML, rendering text-only imports without a blob, and ignoring stale hydration responses.

## 4. Repair Recoverable Existing Imports

- [x] 4.1 Add an idempotent full-document repair helper that derives plain text from stored browser article HTML when the document body is empty.
- [x] 4.2 Invoke repair only on full-document access, leave startup/list projections lightweight, and never copy arbitrary extracts into the parent document body.
- [x] 4.3 Add repository/integration tests for successful metadata recovery, repeated repair, and unrecoverable legacy rows.

## 5. Verify the End-to-End Contract

- [x] 5.1 Add extension tests covering fresh defaults, startup events before settings load, disabled passive events, independently enabled passive events, runtime disablement, and explicit saves with all passive modes off.
- [x] 5.2 Add a process-boundary regression test that saves a page, recreates repository/application state, opens the document, and verifies readable body content with no page-body extract.
- [x] 5.3 Run `npm run test:browser-extension`, targeted frontend tests, targeted Rust tests, and the extension packaging/check step; resolve failures without changing unrelated worktree files.
- [x] 5.4 Run `openspec validate "fix-browser-import-rendering-and-capture-opt-in" --type change --strict` and confirm all proposal, design, spec, and task artifacts are complete and apply-ready.
