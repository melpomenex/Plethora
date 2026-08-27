## ADDED Requirements

### Requirement: Display-time repair uses the resolved document URL

When the reader must resolve any residual relative URL in persisted HTML, its base MUST be selected by precedence: the persisted resolved (final) document URL, then the stored arXiv HTML URL, then the original source URL, then the stored file path. The canonical-identity URL MUST NOT take precedence over the resolved document URL for resource resolution. Documents classified as legacy arXiv HTML keep their existing historical base repair, which matches the markup vintage of that corpus.

#### Scenario: Canonical article with a residual relative URL

- **WHEN** a canonical article somehow persisted a relative `img src` and provenance records `resolvedUrl: https://arxiv.org/html/2410.07524v2` while the canonical URL is `https://arxiv.org/abs/2410.07524`
- **THEN** display-time resolution uses `https://arxiv.org/html/2410.07524v2`

#### Scenario: Legacy arXiv document unchanged

- **WHEN** a pre-canonical arXiv HTML document (no canonical provenance) is opened
- **THEN** it continues to receive the existing trailing-slash base repair tuned to its historical markup, with no content mutation

### Requirement: Missing image sources never resolve to the document base

Reader HTML preparation MUST treat an `img` with an empty, whitespace-only, or missing `src` as having no usable source and remove the element. It MUST NOT resolve an empty source against the reader base URL, which would point the image at an HTML document and render the WebView's broken-image placeholder.

#### Scenario: Image without a source is dropped

- **WHEN** persisted article HTML contains `<img alt="Figure 1">` (no `src`) or `<img src="">`
- **THEN** the rendered document omits the image entirely and shows no broken-image placeholder for it

#### Scenario: Unresolvable image source is dropped

- **WHEN** an `img src` uses a blocked host, a private address, or a non-http(s) scheme at display time
- **THEN** the image is removed rather than rendered with a broken-image placeholder

### Requirement: Asset render-URL resolution stays lazy and bounded

Resolution of `plethora-asset://` references to render URLs MUST happen at display time, MUST degrade gracefully when an asset is missing from the registry (the image is omitted), and MUST NOT bake filesystem paths or `data:` payloads into the persisted HTML.

#### Scenario: Missing registry asset

- **WHEN** an article references a `plethora-asset://` id that the registry no longer contains
- **THEN** the reader omits that image without errors, and other figures still render
