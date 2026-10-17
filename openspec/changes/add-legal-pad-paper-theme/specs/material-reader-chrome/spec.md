## MODIFIED Requirements

### Requirement: Document content isolation
Applying the Material system SHALL NOT alter document content rendering merely as a consequence of chrome migration: PDF canvases, EPUB iframe content, reflowed HTML, markdown prose, word-highlight overlays, and reader typography settings SHALL retain their content and interaction contracts. Only chrome (toolbars, controls, sheets, menus, players, progress UI) restyles by default. An explicitly selected compatible theme material, including Legal Pad, SHALL be permitted to change reading-surface colors and decoration according to reader appearance precedence while preserving typography controls, source files, semantic structure, anchors, selection and media fidelity. Original PDF pages and fixed-layout/original EPUB content SHALL retain their original visual appearance.

#### Scenario: Reader typography untouched
- **WHEN** a user's reader font family/size/line-height settings are applied
- **THEN** in-document typography remains governed by those settings before and after the Material migration and any compatible material change, including inside EPUB frames

#### Scenario: Selection DOM contracts preserved
- **WHEN** text is selected in a document
- **THEN** the imperative lookups the selection toolbar, word highlighter (`[data-document-scroll-container]`, `.viewer-content-area`), and extract FAB depend on still resolve, and selection→extract→flashcard flows work unchanged

#### Scenario: Explicit paper material
- **WHEN** the user selects Legal Pad and a compatible reader follows the app theme
- **THEN** the reading surface receives paper colors/decoration without modifying stored content, typography settings or anchor identities

#### Scenario: Original source presentation
- **WHEN** an original PDF page or fixed-layout/original EPUB is displayed under Legal Pad
- **THEN** its source rendering stays accurate and material is limited to surrounding application surfaces
