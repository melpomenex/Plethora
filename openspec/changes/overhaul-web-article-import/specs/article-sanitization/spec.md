## ADDED Requirements

### Requirement: Allowlist sanitization before persistence
All untrusted internet HTML SHALL pass through a DOMPurify-based sanitizer with an explicit semantic allowlist (headings, paragraphs, text-level semantics, links, lists, blockquotes, figures/images/figcaptions, tables, pre/code, sup/sub, hr/br, dl/dt/dd, time/abbr/small, MathML) before being persisted or rendered, and elements/attributes outside the allowlist (including `style`, `class`, `data-*`, `svg`, `template`, `noscript`, `form` controls, `iframe`, `object`, `embed`, `link`, `meta`, `base`) SHALL be removed.

#### Scenario: Semantic content survives
- **WHEN** a winning candidate contains headings, paragraphs, lists, blockquotes, figures with captions, tables, and code blocks
- **THEN** all of those elements survive sanitization in the persisted article

#### Scenario: Non-semantic markup dropped
- **WHEN** candidate HTML contains publisher `class`/`style` attributes or non-allowlisted wrapper elements
- **THEN** they are removed while their semantic children are preserved in order

### Requirement: Scripts and event handlers are removed
The sanitizer SHALL remove `<script>` elements, inline event handler attributes, and any executable content from imported HTML, and persisted articles SHALL contain no executable markup.

#### Scenario: Script injection attempt
- **WHEN** source HTML embeds `<script>` blocks or `on*` handler attributes anywhere in the article region
- **THEN** none of them appear in the persisted article HTML

#### Scenario: Mutation-XSS vectors
- **WHEN** crafted HTML tries parser-differential tricks (e.g., `noscript` context confusion, foreign-content escapes)
- **THEN** the sanitizer's output re-parse contains no script or event-handler content

### Requirement: Dangerous URLs are rejected
URL-bearing attributes (`a href`, `img src`, `srcset`, `cite`) SHALL be validated after sanitization: link URLs are limited to http/https/mailto and in-document fragments; media URLs to http/https after absolutization; `javascript:`, `data:`, `vbscript:`, and unknown schemes SHALL be stripped with the element retained where meaningful and a diagnostic recorded.

#### Scenario: javascript: link
- **WHEN** an anchor's href is `javascript:...`
- **THEN** the href attribute is removed while the anchor text is preserved

#### Scenario: data: image
- **WHEN** an image src is a `data:` URL
- **THEN** the image is dropped or its src removed, and it never reaches the persisted article

### Requirement: Imported content cannot invoke privileged Tauri APIs
Imported article HTML SHALL never execute publisher JavaScript (the static pipeline extracts from inert parsed DOMs; the rendered capture runs in an IPC-less WebView), and the persisted article rendered in the reader's sandboxed iframe SHALL NOT gain access to Tauri IPC, commands, or filesystem capabilities by virtue of its web origin.

#### Scenario: Imported page cannot call the bridge
- **WHEN** a captured rendered page's scripts execute inside the capture WebView
- **THEN** those scripts have no Incrementum Tauri API access and the persisted article retains none of their markup

### Requirement: Degenerate sanitization detection
The pipeline SHALL compare pre- and post-sanitization text volume: losing more than 40% SHALL record a warning diagnostic, and losing more than 75% SHALL fail the import with `sanitization_degenerate` rather than persist a husk.

#### Scenario: Over-aggressive stripping detected
- **WHEN** sanitization removes most of the candidate's text
- **THEN** the import fails with `sanitization_degenerate` instead of storing a near-empty document
