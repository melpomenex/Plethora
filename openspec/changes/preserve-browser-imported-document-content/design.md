## Context

The browser extension sends a page save to the local Axum server with a URL, title, plain text, optional rich HTML, and a request type. The server creates an HTML `Document`, stores plain text in `documents.content`, and may later replace it with a better Readability result. Explicit `extract` requests follow a separate handler and create an `Extract` linked to a parent document.

Two representations of a document are used after startup. Library/startup queries intentionally omit large `content` and `metadata` fields, while `get_document` returns the full row. `DocumentViewer` currently prefers the document already present in the store, so a startup summary can be treated as if it were a fully hydrated document. That makes an imported page appear correct during the extension-save session but empty after restart. The Q&A flow can then fall back to extracts, reinforcing the impression that the article moved from the document into an extract.

The implementation must preserve fast content-free startup lists while ensuring that readers and document-text consumers never mistake a summary for an authoritative full document. It must also tolerate extension payloads without rich HTML and older affected rows.

## Goals / Non-Goals

**Goals:**

- Persist browser page/link text as document content and keep explicit extract saves as extracts.
- Hydrate the full document before reader, assistant, or Q&A features consume body content after startup or tab restoration.
- Prevent asynchronous readability work from clearing or replacing newer valid text.
- Repair legacy browser-extension documents when their content can be deterministically recovered from stored article HTML.
- Cover the save → restart/reload → reopen sequence with regression tests.

**Non-Goals:**

- Redesigning the browser extension UI or changing its wire payload.
- Converting ordinary user-created extracts into document content.
- Guaranteeing recovery when neither document text nor stored article HTML exists and the source URL is unavailable.
- Changing startup lists to eagerly transfer every document body.
- Reworking general web URL imports unrelated to the extension endpoint.

## Decisions

### 1. Keep page and extract handling separate at the server boundary

Only an explicit normalized request type of `extract` creates an `Extract`. `page`, `link`, and the legacy empty request type create an HTML `Document` (except recognized video URLs), with extension plain text as the preferred initial `documents.content`; HTML-derived text is the fallback.

This makes the entity type depend on the user action rather than the presence or format of content. Inferring extracts from payload shape was rejected because page and selection payloads can both contain text and HTML.

### 2. Treat summary documents as partial projections, not hydrated documents

Startup and library queries remain content-free for performance. Reader entry points must always call the full `get_document` path before loading a document body, even when a matching object exists in the document store. The returned full record is merged into store state/current-document state so downstream reader, assistant, and Q&A consumers share the hydrated representation.

Where practical, code will make the distinction explicit with a hydration marker or separate summary type/helper. Checking only `content == null` was rejected as the sole signal because a fully loaded document can legitimately have no extracted text.

### 3. Make initial persistence and duplicate enrichment monotonic

The initial document insert stores the chosen plain text and browser-import metadata together. A repeated save for the same URL updates the existing document only when it supplies missing text or missing article HTML; it does not create an extract or duplicate document.

Background Readability enrichment uses a repository operation that re-reads the current row and updates only when the candidate is non-empty, is a genuine improvement, and has not been superseded by a newer user/extension update. This preserves extension-provided text if fetching fails or returns poorer output. An unconditional last-writer-wins update was rejected because the enrichment task runs after the extension request returns.

### 4. Recover legacy rows from document-owned metadata only

When a full browser-extension HTML document has empty content but non-empty `metadata.article_html`, the backend derives plain text with the existing HTML-to-text logic, persists it idempotently, and returns the repaired document. Recovery may be performed by a bounded migration/repair helper or on full document read, provided it does not slow summary listing.

Existing extracts are not promoted automatically. They may be genuine highlights, and moving or copying them would corrupt the document/extract boundary. If article HTML is absent, the document remains eligible for an explicit resave or a separately visible refetch path.

### 5. Test the persistence boundary, not only in-memory state

Rust tests will use a temporary SQLite database, invoke the page-import behavior, discard the first repository/server state, create a new repository state against the same database, and assert that a full lookup retains content and creates no extract. Additional tests cover duplicate saves, empty/failed enrichment, and metadata recovery.

Frontend tests will seed a content-free startup summary, open or restore its document tab, and assert that the viewer fetches and uses the full document. Q&A tests will assert that persisted document text is preferred and that extract fallback is not used when full content exists.

## Risks / Trade-offs

- **[Extra full-document request when opening a reader]** → Keep lists lightweight and fetch exactly once per open document; cache the hydrated result in the store.
- **[Hydration race when switching tabs quickly]** → Key responses by document ID and ignore stale completions after the active document changes.
- **[Background enrichment overwrites newer text]** → Use a compare-and-update guard based on the current content/update identity and reject empty or stale candidates.
- **[Lazy repair mutates data during a read]** → Keep repair idempotent, limited to browser-extension HTML rows with recoverable metadata, and test both repaired and unaffected rows.
- **[Some historical rows remain unrecoverable offline]** → Never synthesize content from arbitrary extracts; surface resave/refetch as the safe recovery route.

## Migration Plan

1. Ship the guarded persistence and hydration behavior without changing the extension request contract.
2. Enable idempotent recovery for affected rows with stored `article_html` when they are opened through the full-document path.
3. Verify newly saved and repaired documents through reader and Q&A regression tests.
4. Rollback is code-only; no destructive schema migration is required. Repaired content remains valid document data if the application version is rolled back.

## Open Questions

None. Recovery from arbitrary extracts is intentionally excluded because provenance cannot be established safely.
