## Purpose

Make library documents saved through the browser extension visible and actionable inside Dashboard Capture Activity, with recognizable previews and dependable navigation back to saved content.

## ADDED Requirements

### Requirement: Recent browser saves appear inside Capture Activity

The Dashboard SHALL display up to six newest eligible browser-extension library documents inside Capture Activity, ordered by original save time descending with a stable document-ID tie break. The shelf SHALL cover all save dates and collections independently of the analytics reporting window. Existing section placement, the 30-day sparkline, source totals, and needs-attention entry SHALL remain available, with the reporting window explicitly labeled.

#### Scenario: Newly saved page is recognizable

- **WHEN** an eligible browser-extension page has been saved to the library and the Dashboard loads
- **THEN** its preview shows its title, source domain, document type, and relative save time within the six newest saves
- **AND** the Capture Activity section remains between Continue Reading and Progress

#### Scenario: An older save remains accessible

- **WHEN** eligible extension saves exist but none were added in the last 30 days
- **THEN** the shelf displays the newest of those saves
- **AND** the analytics explicitly reports its 30-day window without hiding the shelf

#### Scenario: Shelf limit does not change totals

- **WHEN** more than six eligible extension documents exist
- **THEN** the shelf shows six previews and offers View all browser saves
- **AND** the existing capture totals describe the full reporting window rather than the preview count

### Requirement: Saved-link eligibility is based on durable provenance

The system SHALL include only nonarchived, nondismissed library documents with a valid original HTTP(S) source URL and persisted browser-extension provenance using the existing capture-source precedence. It SHALL include each qualifying document ID once, support existing metadata source markers, exclude raw flashcard/extract/image-registry records, and refrain from inferring extension origin from semantic tags or URL presence alone. All supported extension document-save paths SHALL persist extension provenance before announcing a successful save.

#### Scenario: Unrelated URL document is excluded

- **WHEN** a manually imported or shared document has a web URL or a browser-extension semantic tag but no qualifying extension provenance
- **THEN** it does not appear in the browser-save shelf

#### Scenario: Existing source marker is accepted

- **WHEN** an older live document has the existing browser-extension metadata source marker and a valid source URL
- **THEN** it is eligible without recapture or a data migration

#### Scenario: Archived and non-document captures are excluded

- **WHEN** an archived document, dismissed document, standalone extract, flashcard, or image-registry asset was captured through the extension
- **THEN** that record is not rendered as an eligible saved link

#### Scenario: Supported video save is discoverable

- **WHEN** the extension successfully saves a supported video as a library document
- **THEN** that document persists qualifying extension provenance before its success notification
- **AND** it can appear in the shelf according to the same eligibility rules

#### Scenario: Re-saving an existing link does not create an activity duplicate

- **WHEN** an extension save reuses an existing library document through import deduplication
- **THEN** the shelf continues to show one preview for that document ID with its original save time

### Requirement: Preview data is bounded and independent of document bodies

The system SHALL provide a paginated, metadata-only query of eligible browser-save documents with document ID, title, file type, validated source URL, save timestamp, optional cover information, and eligible total count. The default page SHALL contain at most six items; page size SHALL be bounded to 1–100 and offsets SHALL be nonnegative. Eligibility SHALL be applied before counting and pagination, and the query SHALL not require document bodies, transcripts, full-library client hydration, or remote metadata fetching.

#### Scenario: Partial client cache does not hide captures

- **WHEN** the client's document cache contains only another collection or an incomplete page of documents
- **THEN** the query still returns the newest eligible extension saves across the library

#### Scenario: Malformed rows do not consume eligible page slots

- **WHEN** newer ineligible records have malformed metadata or invalid URLs and at least six eligible records exist
- **THEN** the default page contains the six newest eligible records
- **AND** its total count counts only eligible records

#### Scenario: Input bounds and ties are stable

- **WHEN** a caller requests an excessive page size or negative offset, or multiple records share a save timestamp
- **THEN** the query applies the page-size and offset bounds
- **AND** repeated queries over unchanged data return the same ordered records

### Requirement: Covers degrade into an intentional fallback

Each preview SHALL use supported persisted cover imagery or a supported video thumbnail when available, with fixed media dimensions and lazy image loading. Missing, unsupported, or failed imagery SHALL show a theme-aware source/type fallback without hiding the title or actions, changing layout dimensions, or repeatedly retrying. Titles and metadata SHALL remain readable outside the image. Rendering the shelf SHALL not trigger image generation, favicon services, or page-metadata discovery.

#### Scenario: Stored cover is available

- **WHEN** a preview has a supported cover URL
- **THEN** it displays the cover in the reserved landscape region with the title and metadata below or beside it

#### Scenario: Offline or broken image

- **WHEN** a cover is missing or fails to load
- **THEN** the preview uses the source/type fallback in the same media footprint
- **AND** both reading and original-page actions remain usable

### Requirement: Primary activation opens the saved library document

Activating a preview's primary action SHALL open or focus its saved document in Plethora by document ID, including documents absent from the client cache. The action SHALL be distinct from opening the original website and SHALL not unnecessarily duplicate an already open reader tab. If the document was removed after fetching the preview, activation SHALL display recoverable feedback and refresh the shelf instead of opening an empty reader.

#### Scenario: Saved page opens in the reader

- **WHEN** the user activates a preview by click, tap, Enter, or Space
- **THEN** the saved document opens or is focused in Plethora
- **AND** no original website opens as a side effect

#### Scenario: Saved document is outside the cache

- **WHEN** the requested document is persisted but absent from the collection-scoped cache
- **THEN** it still opens successfully without requiring a full-library reload

#### Scenario: Removed document cannot open

- **WHEN** the saved document was deleted after the shelf fetched it
- **THEN** the user receives localized feedback and the shelf refreshes
- **AND** no empty reader tab is created

### Requirement: Original-page opening is an independent action

Each preview SHALL provide a separately labeled original-page action for its validated HTTP(S) source URL. It SHALL be keyboard and touch accessible, SHALL indicate external navigation, and SHALL not trigger the primary reader action. Invalid or unsupported URL candidates SHALL not be opened, and opening failures SHALL produce localized feedback.

#### Scenario: User opens the original page

- **WHEN** the user activates Open original on a preview
- **THEN** the source page opens through the platform's external-opening behavior
- **AND** the saved document's reader action is not triggered

#### Scenario: Unsupported URL is rejected

- **WHEN** source metadata contains an unsupported scheme
- **THEN** the system does not offer external opening for that candidate
- **AND** a later valid stored URL candidate can still qualify the document

### Requirement: View all opens a meaningful Library destination

View all browser saves SHALL open or focus the existing Library with an explicit browser-extension source filter, all-library scope, and newest-first save ordering. The destination SHALL use the same eligibility rules as the shelf, apply filtering before pagination, display a removable source chip and scope indication, and keep the view local to that Library tab. It SHALL not mutate the globally active collection or depend on a semantic tag search. Additional Library filters SHALL operate on the filtered data set, not just the already loaded page.

#### Scenario: Browse beyond the six previews

- **WHEN** the user activates View all browser saves while another collection is active
- **THEN** the Library shows qualifying extension saves across collections, newest first, with a Browser Extension chip and All library scope indication
- **AND** the globally active collection remains unchanged

#### Scenario: Reusing a Library tab applies the requested view

- **WHEN** a reusable Library tab has stale incompatible search or filters
- **THEN** navigating from the shelf applies the requested source/scope/order and clears conflicting constraints
- **AND** ordinary Library tabs do not acquire this filter implicitly

#### Scenario: User clears the source filter

- **WHEN** the user removes the Browser Extension chip
- **THEN** the destination becomes an ordinary unfiltered Library list within its visibly indicated all-library scope

### Requirement: Hover, focus, touch, and reduced motion have equivalent affordances

Preview interaction SHALL use the active theme's tonal states and clear focus indicators, without moving the tile or surrounding layout. Hover/focus emphasis SHALL reveal or strengthen a reading affordance without hiding titles, domains, or times. Secondary actions SHALL remain discoverable at rest and explicitly visible on touch. Controls SHALL have at least 40px targets, increased to 44px on phone presentation; motion SHALL respect reduced-motion preferences. Interactive actions SHALL not be nested.

#### Scenario: Hover and keyboard focus communicate the same action

- **WHEN** a pointer hovers a preview or keyboard focus enters it
- **THEN** the preview indicates that its primary action opens the saved document
- **AND** the title and metadata remain visible with no layout shift

#### Scenario: Phone interaction needs no hover

- **WHEN** the shelf is used on a touch phone
- **THEN** both reading and original-page actions are visible and usable without a hover gesture

#### Scenario: Reduced motion preserves functionality

- **WHEN** reduced motion is enabled
- **THEN** interaction feedback remains immediate and clear with image scaling and animated transitions disabled

### Requirement: Layout follows available space and content

At wide section widths the shelf SHALL display a compact three-column grid; intermediate widths SHALL use two columns; phone widths SHALL use a vertical thumbnail list. One or two previews SHALL not stretch into oversized feature cards. Long titles, long hosts, localized labels, and 200% text scaling SHALL not produce page overflow or obscure actions.

#### Scenario: A narrow dashboard panel reflows

- **WHEN** the Dashboard's content area becomes narrow despite a wide desktop window
- **THEN** the shelf adapts to its own available width rather than retaining three unusably narrow columns

#### Scenario: Long content and enlarged text

- **WHEN** a saved item has a long title/domain or the user enlarges text to 200%
- **THEN** the layout reflows or truncates display text while preserving its accessible full value and usable controls

### Requirement: Saved content refreshes without disrupting the dashboard

The shelf SHALL load on Dashboard activation and refresh after successful browser-document saves while the Dashboard is active. Burst events SHALL be coalesced, inactive views SHALL defer work to their next activation, and stale responses SHALL not overwrite newer results. Background refresh SHALL retain visible previews and focus. Notifications SHALL be polite, without unsolicited focus movement or duplicate save toasts.

#### Scenario: Save arrives while the Dashboard is open

- **WHEN** the extension persists an eligible document and announces its successful save while the Dashboard is active
- **THEN** the shelf and capture totals refresh after the burst has settled without restarting the app
- **AND** focus is not moved to the new preview

#### Scenario: Save arrives while the Dashboard is inactive

- **WHEN** extension saves occur while the Dashboard is inactive
- **THEN** the next activation loads the latest persisted saves

#### Scenario: Older request finishes late

- **WHEN** an earlier shelf request completes after a later successful refresh
- **THEN** it does not replace the later result

### Requirement: Empty, loading, and failure states are independently recoverable

Initial loading SHALL use stable-footprint shelf placeholders without blocking other Dashboard content. An empty shelf SHALL explain where browser saves appear even when other capture sources have data. Initial shelf errors SHALL show an inline retry; refresh errors SHALL preserve existing previews with a retry notice. Shelf and analytics failures SHALL not suppress each other's successful content.

#### Scenario: Other sources have captures but the shelf is empty

- **WHEN** share/manual/RSS capture counts are nonzero but no eligible browser saves exist
- **THEN** the shelf explains that browser-extension saves will appear here
- **AND** the existing analytics remains visible

#### Scenario: One query fails independently

- **WHEN** either the shelf query or analytics query fails while the other succeeds
- **THEN** the successful subsection remains available and the failed subsection offers an appropriate retry
- **AND** the rest of the Dashboard continues to function

#### Scenario: Background refresh fails

- **WHEN** previously loaded previews exist and a refresh fails
- **THEN** those previews remain visible with recoverable stale-content feedback

### Requirement: Shelf text and dates honor the active locale

All shelf labels, state messages, document-type names, fallbacks, action labels, and accessible names SHALL use the app's localization system. Relative and absolute save times SHALL honor the active locale. The full stored title and a machine-readable save timestamp SHALL remain accessible when the displayed text is shortened.

#### Scenario: Shelf is used in a different locale

- **WHEN** the active locale changes
- **THEN** shelf labels, action names, and date wording follow that locale rather than fixed English literals
