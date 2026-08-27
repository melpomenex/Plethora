## ADDED Requirements

### Requirement: Effective resource base follows document URL semantics

Every surface that resolves a relative imported media URL (canonical pipeline, raw-page fallback, rendered fallback, and import-dialog preview) MUST resolve it against one effective resource base, determined by this precedence:

1. a `<base href>` declared by the fetched document, when it absolutizes against the final document URL to an absolute `http(s)` URL;
2. otherwise the redirect-resolved final document URL, used verbatim;
3. otherwise the requested URL.

The effective resource base MUST NOT be derived from canonical-link, `og:url`, or JSON-LD URL metadata: those declare article identity, not the location the assets were actually served from. The resource base MUST NOT be mutated by host-specific path edits such as appending a trailing slash; verbatim document-URL semantics reproduce exactly what the source browser resolved.

#### Scenario: arXiv versioned page with version-prefixed figure paths

- **WHEN** `https://arxiv.org/html/2410.07524v1` is imported and the page contains `<img src="2410.07524v1/upcycle.png">`
- **THEN** the resolved media URL is `https://arxiv.org/html/2410.07524v1/upcycle.png` (not `…/2410.07524v1/2410.07524v1/upcycle.png`)

#### Scenario: arXiv versionless page serving latest-version markup

- **WHEN** a bare ID or abstract URL for `2410.07524` is imported, the fetched document URL is `https://arxiv.org/html/2410.07524`, and the page contains `<img src="2410.07524v2/upcycle.png">`
- **THEN** the resolved media URL is `https://arxiv.org/html/2410.07524v2/upcycle.png`

#### Scenario: Generic page whose canonical URL differs from the document URL

- **WHEN** `https://example.com/articles/2026/research/` is imported with `<link rel="canonical" href="https://example.com/canonical-slug">` and an image `figures/chart.png`
- **THEN** the resolved media URL is `https://example.com/articles/2026/research/figures/chart.png`, not a URL under the canonical path

#### Scenario: Document-declared base href wins when safe

- **WHEN** the fetched page declares `<base href="https://cdn.example.org/assets/">` and references `img/foo.png`
- **THEN** the resolved media URL is `https://cdn.example.org/assets/img/foo.png`

#### Scenario: Unsafe base href is ignored

- **WHEN** the fetched page declares a `<base href>` that is relative-only, or absolutizes to a non-http(s) scheme such as `javascript:` or `file:`
- **THEN** the base element is ignored and the final document URL is used, and the base element is still stripped before persistence

#### Scenario: Redirects re-anchor the resource base

- **WHEN** the requested URL redirects and the transport reports a final URL with a different path (e.g. a version or slug is appended), and the page contains relative media references
- **THEN** relative media URLs resolve against the final URL, not the requested URL

### Requirement: Persisted article media references are origin-independent

Persisted canonical article HTML MUST reference media only through absolute `http(s)` URLs or `plethora-asset://` logical URLs. Relative or scheme-relative media `src` values MUST NOT survive into persisted HTML: they are either absolutized against the effective resource base or the image is dropped with a diagnostic. Persisted HTML MUST NOT rely on any `<base>` element injected at display time to load media.

#### Scenario: No relative media survives import

- **WHEN** a source page references `image.png`, `./image.png`, `../image.png`, `images/image.png`, `/root-image.png`, and `//cdn.example.org/image.png`
- **THEN** each surviving persisted `img src` is an absolute `http(s)` URL or `plethora-asset://` URL, with the protocol-relative form normalized to `https:` when the document was served over `https:`

#### Scenario: Sanitization boundary is not weakened

- **WHEN** imported media URLs use schemes outside the allowed media set (`http`, `https`, `plethora-asset`)
- **THEN** they are dropped by sanitization exactly as before, and `javascript:`, `data:text/html`, `file:`, and other unsafe schemes remain blocked

### Requirement: Import surfaces share one resource-resolution behavior

The same source document MUST produce materially equivalent media URLs regardless of whether it was imported through the URL field, the arXiv dialog HTML format, share-sheet/palette URL entry, raw-page fallback, or rendered fallback. Import UI previews MUST resolve relative resources with the same effective-resource-base semantics as the persisted import; a preview MUST NOT rebuild a page base from only the origin.

#### Scenario: Preview keeps the page path

- **WHEN** `https://example.com/articles/foo/` is previewed and the page references `images/chart.png`
- **THEN** the preview resolves the image against `https://example.com/articles/foo/`, not `https://example.com/`

#### Scenario: Raw-page fallback resolves figures like the pipeline

- **WHEN** a page is stored through the "import full page anyway" escape hatch with relative images
- **THEN** those images are absolutized against the same effective resource base the canonical pipeline would use

### Requirement: Resource-resolution diagnostics are recorded

Article import diagnostics MUST record the effective resource base actually used, and bounded counts of media URL outcomes: discovered, absolutized, dropped (with reason category), and — when asset ingestion runs — failed/reused/imported. Diagnostics MUST NOT log page bodies or cookie values.

#### Scenario: Broken import is inspectable from diagnostics

- **WHEN** an import absolutizes 20 figures, drops 2 as tracking pixels, and ingestion later fails for 3
- **THEN** the persisted provenance diagnostics include the resource base URL and the per-outcome counts, without requiring database inspection
