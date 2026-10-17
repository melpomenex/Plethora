## Purpose

Make the selected paper material visible in compatible Plethora readers and RSS paths while preserving explicit reader choices, source media, document anchors and original-layout fidelity.

## ADDED Requirements

### Requirement: Reader appearance precedence
Reader appearance SHALL resolve accessibility first, source-fidelity restrictions next, explicit reader color/original preferences next, applied global theme next, and plain color fallback last. Existing explicit preferences SHALL NOT be silently overwritten by choosing Legal Pad. Theme changes SHALL update presentation without modifying imported source files or stored document content.

#### Scenario: Explicit palette under paper app
- **WHEN** Legal Pad is active and a reader has an explicit supported dark/light/sepia/slate/oled preference
- **THEN** that reader retains its explicit palette with no paper decoration, while surrounding application chrome remains paper

#### Scenario: Accessibility overrides a reader choice
- **WHEN** E-Ink or forced-color mode activates while an explicit reader palette is selected
- **THEN** the effective reading presentation becomes accessible without overwriting that stored choice

### Requirement: Reflowable EPUB paper presentation
Reflowable EPUB sections in App theme appearance SHALL receive the applied paper material inside the rendition, including initial display, new chapters, font changes and theme previews. The EPUB reader SHALL provide App theme and Original book appearance choices. Paper updates SHALL preserve typography controls, CFI/location, selection, annotations, search and spoken-word navigation.

#### Scenario: Open and change chapters
- **WHEN** a reflowable EPUB opens in App theme appearance under Legal Pad and advances to another chapter
- **THEN** initial and subsequent content frames display coherent opaque paper colors/material without an exposed white frame or loss of reading controls

#### Scenario: Live preview with current selection
- **WHEN** Legal Pad is previewed and canceled while a reflow EPUB has an active selection
- **THEN** material updates without rebuilding the book, anchors remain valid and existing geometry invalidation keeps selection actions aligned

#### Scenario: Select original book
- **WHEN** the user switches from App theme to Original book
- **THEN** publisher styling is restored from unchanged book data and the current location is restored after layout

### Requirement: Fixed-layout and illustrated EPUB integrity
Fixed-layout, cover and conservatively unclassified EPUB sections SHALL preserve publisher layout and graphics, including section-specific layout metadata. Paper SHALL apply to surrounding chrome rather than recoloring the book. Application theming SHALL NOT strip required publisher styles, recolor SVG artwork or flatten equations/semantic color legends in these sections.

#### Scenario: Mixed-layout publication
- **WHEN** a reflowable book enters a per-section fixed-layout illustration
- **THEN** the illustration retains its original layout/colors and paper remains limited to surroundings until compatible reflow content resumes

#### Scenario: Unknown layout or cover
- **WHEN** layout cannot be safely classified or a cover section is displayed
- **THEN** original section styling is retained and paper rules do not cross the artwork

### Requirement: PDF page fidelity and reflow material
Original PDF page modes, scanned pages, crops and columns SHALL preserve rendered source pixels and text-layer alignment; paper SHALL appear only around original pages. Both canonical and legacy PDF reflow SHALL use paper when their existing theme preference is system, while explicit light/dark remain plain. Original figures and graphical fallback content SHALL retain source pixels in every mode.

#### Scenario: Original-page comparison
- **WHEN** the same PDF page is rendered with Legal Pad on and off at identical settings
- **THEN** original page canvas pixels and text selection bounds are unchanged while page surroundings may use paper

#### Scenario: Reflow and explicit override
- **WHEN** PDF reflow uses system appearance under Legal Pad
- **THEN** readable reflow text receives paper with working selection/search/highlights
- **AND** selecting explicit light or dark removes paper only from that reading surface

#### Scenario: View original figure
- **WHEN** a reflowed PDF opens a source figure or graphical fallback
- **THEN** the original image remains accurate and surrounding paper does not tint or obscure it

### Requirement: Markdown plain text and extracts
Markdown, ordinary text and compatible expanded extract reading SHALL inherit the paper appearance without replacing anchored text solely for theme changes. Code, tables, math, images, highlights, copy/paste and original source links SHALL remain meaningful and readable. Small previews and action surfaces SHALL use unruled paper.

#### Scenario: Annotated markdown theme switch
- **WHEN** an annotated Markdown document switches into and out of Legal Pad
- **THEN** existing text offsets, search results, copy selection and annotations remain valid while the reading background changes

#### Scenario: Expanded rich extract live update
- **WHEN** the applied theme changes while a rich extract is expanded
- **THEN** its content appearance updates without iframe navigation, anchor loss or altered source data

### Requirement: RSS app-theme inheritance and overrides
Every app-rendered RSS reader path SHALL interpret effective system appearance as the applied global theme/material, using existing global/feed preference inheritance. Explicit light/dark/sepia/slate/oled choices SHALL remain supported, with null feed values inheriting global settings. RSS appearance SHALL NOT resolve the global material only from a light/dark variant flag.

#### Scenario: Full-content app appearance
- **WHEN** Legal Pad is active and RSS full-content appearance is system
- **THEN** the article uses paper, effective reader ink/link/control colors and unruled header surfaces rather than independent light/slate defaults

#### Scenario: Feed override and reset
- **WHEN** one feed explicitly uses oled while global RSS appearance is system
- **THEN** that feed's reading surface remains oled and other feeds follow paper
- **AND** clearing the override to null restores global paper inheritance

#### Scenario: Preview global theme
- **WHEN** a different global theme is previewed and reverted while RSS appearance is system
- **THEN** open RSS content follows and reverts with the application without saving a competing RSS palette

### Requirement: RSS layout and interactive coverage
Feed lists/navigation, article previews, individual/basic articles, full-content, Story, Scroll and magazine/grid/list/compact layouts SHALL participate in Legal Pad according to their surface role. Long reading surfaces SHALL support ruled paper; dense navigation/cards SHALL remain unruled. Annotation/highlight actions, assistant overlays, media and sticky headers SHALL remain readable and interactive.

#### Scenario: Scroll mode with assistant
- **WHEN** the user reads multiple RSS articles in Scroll mode and opens a selection or assistant overlay
- **THEN** reading content remains paper, overlays remain opaque and legible, and selection gestures/anchors continue working

#### Scenario: Feed layouts
- **WHEN** the user switches between magazine, grid, list and compact feed presentation
- **THEN** effective paper colors/material remain coherent without repeated per-row texture creation or recolored article images

### Requirement: Same-origin HTML and OCR participation
Compatible imported HTML/articles, browser captures, arXiv, raw fallbacks and OCR-derived reflow text SHALL use the shared material according to their classification, without broadening sanitizer permissions or altering stored source. Cross-origin live web pages SHALL retain their appearance inside paper-themed chrome.

#### Scenario: OCR text with scan image
- **WHEN** OCR-derived text and original scan imagery appear in a reader
- **THEN** readable text can use paper while the original scan image and selection mappings remain intact

#### Scenario: External live page
- **WHEN** a live cross-origin web page opens under Legal Pad
- **THEN** only surrounding application chrome receives paper and no unsupported cross-origin injection is attempted
