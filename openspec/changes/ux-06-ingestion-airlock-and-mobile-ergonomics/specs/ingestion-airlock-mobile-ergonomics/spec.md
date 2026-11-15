# Specification: Ingestion Airlock Staging Buffer & Asymmetric Mobile Ergonomics

## ADDED Requirements

### Requirement: Ingestion Airlock stages incoming imports with [1]/[2]/[3] routing and Chapter/H2 pre-chunking

`IngestionAirlockModal` SHALL intercept staged incoming clips, documents, or playlist items and support single-key keyboard routing:
- `[1]` routes to **Active Course High-Priority** (`prioritySlider = 10`, queued immediately),
- `[2]` routes to **Evergreen Low-Priority** (`prioritySlider = 65`, scheduled normal intake),
- `[3]` routes to **Reference Only / Vault** (archived out of active SRS due queue).
When **Pre-Chunk by Chapter / H2 Headings** is toggled on for long documents, `splitDocumentByHeadings` SHALL deterministically split content along Markdown `## ` / HTML `<h2>` (or Chapter boundaries), creating ordered child chunks that inherit the chosen tier priority.

#### Scenario: Pressing [1] with Pre-Chunk by H2 enabled creates Priority-10 child chunks
- **GIVEN** an incoming article containing 3 `## ` sections staged inside `IngestionAirlockModal` with `preChunkByHeadings = true`
- **WHEN** the user presses `1` (or clicks `Active Course [1]`)
- **THEN** `splitDocumentByHeadings` produces 3 titled section chunks and commits them at `prioritySlider = 10`

#### Scenario: Pressing [3] archives import as Reference Only outside active due queue
- **GIVEN** an incoming bookmark clip staged inside `IngestionAirlockModal`
- **WHEN** the user presses `3`
- **THEN** the item is stored as Reference Only / archived without flooding the active review queue

---

### Requirement: Mobile Queue View provides Commute Audio Queue, Bottom Thumb-Arc controls, and double-tap paragraph capture

When rendered on mobile viewports in `MobileQueueView`, the system SHALL expose:
1. A **Commute Audio Queue** toggle filtering/playing spoken items through the persistent audio player,
2. A one-handed `[data-mobile-thumb-arc="true"]` dock anchored in the lower viewport providing grading actions (`Again`, `Hard`, `Good`, `Easy`) and priority nudge (`+` / `-`) controls,
3. **Double-Tap Paragraph Instant Extraction** on readable paragraphs (`[data-paragraph-index]`) that immediately sends the paragraph to the desktop processing inbox (`extracts` inbox with `mobileInboxFlag` / tag) and shows non-blocking confirmation without opening a modal.

#### Scenario: Double-tapping a paragraph on mobile captures it to the processing inbox
- **GIVEN** an active document/extract rendered inside `MobileQueueView` containing paragraph `"The Raft leader logs append-only entries."`
- **WHEN** the user double-taps that paragraph (`onDoubleClick` or rapid double-pointer tap)
- **THEN** `onInstantExtractParagraph` invokes extract creation queued for desktop processing and displays a brief `"Captured to Inbox"` toast badge

#### Scenario: Thumb-Arc rating and priority controls dispatch actions single-handedly
- **GIVEN** `[data-mobile-thumb-arc="true"]` is mounted in `MobileQueueView`
- **WHEN** the user taps `Good` or taps `Boost Priority (-10)`
- **THEN** the corresponding FSRS/SM rating callback or priority nudge dispatches accurately without opening desktop hover toolbars
