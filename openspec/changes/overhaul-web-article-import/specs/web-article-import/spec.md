## ADDED Requirements

### Requirement: URL import runs the article pipeline
Every URL imported via the Android Share Sheet, the PWA share target, or the toolbar Import URL dialog SHALL pass through the Web Article Import Pipeline (normalize → fetch → metadata extraction → competing extraction → scoring → selection → normalization → sanitization → persistence) before a document is created.

#### Scenario: Shared URL enters the pipeline
- **WHEN** a URL shared from the Android Share Sheet is received by `useShareTarget`
- **THEN** the import is processed by the article pipeline and the resulting document content is the extracted article, not the flattened page

#### Scenario: Pipeline is shared across platforms
- **WHEN** the same article URL is imported on Android, desktop, and PWA
- **THEN** all platforms execute the same extraction/scoring/normalization/sanitization stages and differ only in fetch transport and rendered-DOM capture capability

### Requirement: URL normalization and canonical URL detection
The pipeline SHALL normalize the shared URL (scheme restricted to http/https, host lowercased, default ports and fragment stripped, known tracking parameters removed) while preserving the exact original URL for provenance, and SHALL determine a canonical URL using deterministic precedence: `<link rel="canonical">` → JSON-LD `url`/`mainEntityOfPage` → `og:url` → final redirect-resolved URL → normalized original.

#### Scenario: Tracking parameters stripped
- **WHEN** a URL containing `utm_source`/`fbclid`/`gclid` query parameters is imported
- **THEN** those parameters are removed for fetching and dedupe purposes and the original URL is stored verbatim in metadata

#### Scenario: Canonical link wins
- **WHEN** the fetched page declares `<link rel="canonical">` pointing at a different URL form than the shared one
- **THEN** the canonical URL is used as the dedupe key and relative-URL resolution base

### Requirement: Fetch reports redirect resolution and status
The backend fetch used by the pipeline SHALL return the HTTP status, the final URL after redirects, the header-derived content type, and SHALL enforce the existing SSRF guard and a response size cap.

#### Scenario: Redirecting URL
- **WHEN** a shared URL responds with HTTP redirects
- **THEN** the pipeline records the final resolved URL and uses it for canonicalization and relative-URL resolution

#### Scenario: HTTP error
- **WHEN** the fetch completes with an HTTP 4xx/5xx status
- **THEN** the import fails with the `http_error` code and no document is created

### Requirement: Competing extraction candidates
The pipeline SHALL run both Defuddle and Mozilla Readability against independent deep clones of the same fetched DOM (engines mutate their input), and SHALL compare the resulting candidates through the scorer rather than treating one engine as a fallback for the other's exceptions.

#### Scenario: Both engines produce candidates
- **WHEN** a page is statically fetched and both engines return content
- **THEN** both candidates are scored and the higher-scoring candidate is selected deterministically

#### Scenario: Engine isolation
- **WHEN** the first engine mutates or destroys its cloned DOM during parsing
- **THEN** the second engine still receives an unmodified clone of the original document

#### Scenario: One engine throws
- **WHEN** one engine fails with an exception on a page where the other succeeds
- **THEN** the surviving candidate is scored and can still be selected

### Requirement: Deterministic extraction scoring and selection
The pipeline SHALL score every candidate with a deterministic function of structural and metadata signals (prose volume and quality, link density, generic chrome lexicon hits, heading/figure structure, metadata agreement, completeness relative to the source), producing a numeric score and a confidence level (`high`/`medium`/`low`), with all weights and thresholds held in versioned constants; selection SHALL be highest score with deterministic tie-breaks and identical inputs SHALL always produce identical scores.

#### Scenario: Chrome-heavy candidate loses
- **WHEN** one candidate contains substantial coherent prose and another contains mostly navigation, subscribe prompts, and repeated link blocks
- **THEN** the prose candidate scores strictly higher and is selected

#### Scenario: Determinism
- **WHEN** the same fixture page is imported twice in tests
- **THEN** candidate scores, confidence levels, and the selected extractor are identical

### Requirement: Successful execution is not acceptance
A candidate whose engine executed without error SHALL NOT be accepted on that basis alone; acceptance SHALL require the selected candidate's confidence and minimum word count to meet configured thresholds, otherwise the rendered-page fallback runs, and if confidence remains below the acceptance floor after fallback the import SHALL fail with a typed error rather than store low-quality content as success.

#### Scenario: Wrong-subtree extraction rejected
- **WHEN** an engine successfully returns a short non-article region of a large page and the resulting confidence is low
- **THEN** the pipeline triggers the rendered-page fallback instead of accepting the candidate

#### Scenario: Below floor after fallback
- **WHEN** the best candidate after rendered fallback is still below the acceptance floor
- **THEN** the import fails with `low_confidence` and no document is created silently

### Requirement: Structured metadata extraction with deterministic precedence
The pipeline SHALL extract OpenGraph, JSON-LD (schema.org Article/NewsArticle/BlogPosting), Twitter card, meta author, language, and canonical signals before discarding the source DOM, and SHALL resolve field-level conflicts with a tested deterministic precedence where engine-derived values are validated against metadata rather than blindly overridden.

#### Scenario: JSON-LD author preferred
- **WHEN** a page has JSON-LD `author` and a differing `meta[name=author]`
- **THEN** the JSON-LD value is used and the conflict is recorded as a diagnostic

#### Scenario: Metadata does not override a clearly better extraction
- **WHEN** `og:title` disagrees with the extracted article title and the extraction scored high
- **THEN** the extracted title is kept and the disagreement is reflected in the metadata-agreement score component

### Requirement: Extraction is separated from presentation
The pipeline SHALL output a canonical semantic article representation (publication, title, dek, byline/date header, hero figure, semantic body) that carries no publisher CSS or classes, and imported articles SHALL render through Incrementum's existing HTML viewer so reader typography, themes, e-ink mode, and preferences apply; publisher styling SHALL NOT be required for display.

#### Scenario: Reader settings apply to imported articles
- **WHEN** an imported article is opened and the user changes font size, line height, theme, or enables e-ink mode
- **THEN** the article re-renders with those settings like any other HTML document

#### Scenario: No publisher CSS dependency
- **WHEN** the sanitized article is persisted
- **THEN** it contains no external stylesheets, inline styles, or publisher class attributes and remains fully readable in the Incrementum reader

### Requirement: Figures and images are first-class
The pipeline SHALL preserve `<figure>`/`<img>`/`<figcaption>` structures in reading order with captions attached, resolve lazy-load attributes (`data-src`, `data-lazy-src`, `data-original`) and `srcset`/`<picture>` sources to a single best absolute image URL, resolve relative URLs against the canonical URL, keep alt text, identify a hero image when available, and reject tracking pixels, logos, nav icons, and repeated chrome images.

#### Scenario: Captioned figure preserved
- **WHEN** the winning candidate contains a figure with an image and caption
- **THEN** the persisted article contains the figure with the resolved absolute image URL and its figcaption in the same position

#### Scenario: Lazy-loaded image resolved
- **WHEN** an image's real source is in `data-src` with a placeholder in `src`
- **THEN** the persisted image URL is the resolved absolute `data-src` value

#### Scenario: Chrome images rejected
- **WHEN** the candidate contains a 1×1 tracking pixel or an image whose source repeats across many blocks
- **THEN** those images are excluded from the persisted article

### Requirement: Site-specific override escape hatch
The pipeline SHALL support domain-scoped extractor modules that produce candidates through the same scoring/selection path as the generic engines, and a site-specific rule SHALL only be introduced when the generic pipeline reproducibly fails on an important site and a generic fix would risk unrelated sites; the Mother Jones regression SHALL be fixed by generic signals.

#### Scenario: Override competes by score
- **WHEN** a registered site-specific extractor produces a candidate for its domain
- **THEN** the candidate is scored against the generic candidates and wins only by score

#### Scenario: No domain hack for the regression case
- **WHEN** the Mother Jones regression fixture is imported
- **THEN** the winning candidate comes from a generic engine and no `motherjones.com` special case exists in the scorer

### Requirement: Typed failure behavior instead of silent garbage
Article import failures SHALL surface as typed error states distinguishing at least: `invalid_url`, `network_failed`, `http_error`, `auth_required`, `empty_content`, `no_candidates`, `low_confidence`, `rendered_unavailable`, `rendered_failed`, `sanitization_degenerate`, and `canceled`; a failed share-sheet import SHALL NOT create a document and SHALL present the failure reason with a retry affordance.

#### Scenario: Paywalled page
- **WHEN** the fetched page returns HTTP 403 or a login/subscription wall is detected
- **THEN** the import fails with `auth_required`, the reason is surfaced, and no document is created

#### Scenario: Failure does not create garbage
- **WHEN** any pipeline failure occurs on the share-sheet path
- **THEN** no document is created and the user sees the typed failure with a retry action

### Requirement: Existing study features work on imported articles
Imported articles SHALL remain first-class Incrementum documents supporting reading position, text selection, highlights/extracts, flashcard creation, TTS, AI document operations, search, and offline reading via the existing mechanisms, with stable semantic text ordering so selections map predictably to article content.

#### Scenario: Highlighting an imported article
- **WHEN** the user selects text in an imported article and creates an extract
- **THEN** the extract anchors, repaints, and restores exactly as it does for existing HTML documents

#### Scenario: TTS over an imported article
- **WHEN** the user starts TTS on an imported article
- **THEN** spoken text follows the article's reading order and excludes non-content elements injected at render time
