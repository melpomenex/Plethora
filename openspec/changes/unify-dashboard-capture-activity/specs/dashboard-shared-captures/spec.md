## Purpose

Make externally captured library content discoverable from the Dashboard using the capture channel appropriate to the running app: system share-sheet imports on mobile and browser-extension saves on desktop.

## ADDED Requirements

### Requirement: Recent captures follow the runtime platform

Capture Activity SHALL show up to six newest eligible share-sheet library documents on native iOS and Android, and eligible browser-extension documents on desktop. Runtime platform SHALL determine the capture channel independently of layout width. The list SHALL span all collections and save dates, ordered by original save time descending with a stable document-ID tie break. Existing all-source analytics, its labeled reporting window, and needs-attention access SHALL remain available independently of the list.

#### Scenario: Mobile Dashboard shows share-sheet content

- **WHEN** an iOS or Android user opens the Dashboard after supported content shared through the system share sheet has been persisted
- **THEN** the newest eligible shared documents appear in Capture Activity
- **AND** supported links, files, images, audio/video, and text notes qualify without requiring a web URL

#### Scenario: Desktop Dashboard shows extension saves

- **WHEN** a desktop user opens the Dashboard with eligible browser-extension saves in the library
- **THEN** Capture Activity shows the newest extension saves with the existing browser-save eligibility rules
- **AND** manual imports, RSS documents, and share-only documents do not enter that list

#### Scenario: Layout changes do not change the capture channel

- **WHEN** a desktop window is narrowed or a native mobile tablet uses a wide layout
- **THEN** desktop continues showing extension saves and the tablet continues showing share-sheet saves

#### Scenario: Older shares remain discoverable

- **WHEN** the library contains eligible shares older than the analytics window
- **THEN** the newest such shares remain eligible for the list and View all
- **AND** analytics continues reporting its own labeled window

### Requirement: Every persisted mobile share receives durable attribution

The system SHALL persist share-sheet attribution for every supported document saved through mobile share ingress, including URL imports, specialized URL imports, file imports, text notes, and saved failure placeholders. Attribution SHALL distinguish Android and iOS share entry points and retain received time plus batch ID/source-app information when available. Warm-start shares without a batch ID SHALL qualify. Attribution SHALL be persisted before capture-completion notification or staged-batch acknowledgement. Existing content and unrelated metadata SHALL be preserved. Desktop external-open, manual, and RSS imports SHALL NOT acquire share-sheet attribution merely because they use the same import machinery.

#### Scenario: Warm-start Android share has no batch identifier

- **WHEN** Android delivers a supported URL, file, or text share to the running app without a staged batch ID
- **THEN** each successfully saved document carries Android share attribution and is eligible for the mobile list

#### Scenario: Cold-start iOS batch contains mixed supported items

- **WHEN** the app consumes a staged iOS batch containing a URL, a supported file, and text
- **THEN** each resulting saved document has iOS share attribution before the batch is acknowledged
- **AND** attribution merges retain the imported document's content and other metadata

#### Scenario: Shared URL content extraction fails but the URL is saved

- **WHEN** a shared URL cannot be extracted and the import flow persists a retryable library placeholder
- **THEN** that saved placeholder receives share attribution and appears according to the normal mobile eligibility rules
- **AND** an item that produces no persisted library document does not appear as a completed capture

#### Scenario: Desktop external-open uses the shared router

- **WHEN** a desktop file or URL is opened through operating-system external-open handling
- **THEN** it does not receive mobile share-sheet attribution solely from passing through shared routing

#### Scenario: Attribution persistence fails

- **WHEN** document creation succeeds but persisting its share attribution fails
- **THEN** the system reports a recoverable import failure rather than announcing full capture completion or acknowledging that staged batch as complete

### Requirement: Share eligibility uses persisted capture evidence

The mobile list SHALL include live, nonarchived, nondismissed library documents with durable native share-origin evidence or a persisted share-attribution record. It SHALL show each eligible document ID once and SHALL NOT infer share origin from semantic tags, URL presence, file type, or collection name. Re-sharing an existing document SHALL persist share evidence without creating an extra preview or changing its original save timestamp; established browser-origin evidence SHALL remain intact. Existing supported share markers SHALL qualify without recapture. Documents with no recoverable share evidence SHALL remain ordinary library documents.

#### Scenario: Existing share marker is recognized

- **WHEN** a live document already has native share-origin evidence or a persisted share-attribution record
- **THEN** it is eligible without a data migration or another share action

#### Scenario: Re-sharing a document already saved by the extension

- **WHEN** a mobile share deduplicates to an existing browser-captured document
- **THEN** that document gains durable share evidence and appears once in the mobile list
- **AND** it retains its original save timestamp and established browser-origin evidence

#### Scenario: Unrelated or inactive records are excluded

- **WHEN** a record is a manual/RSS import with no share evidence, an archived/dismissed document, or a standalone non-document asset
- **THEN** it is excluded from the mobile list even if its tags mention sharing

### Requirement: Source-aware preview queries accept captures without web URLs

The system SHALL expose a source-selected, metadata-only capture listing for browser-extension and share-target documents. Each item SHALL include document ID, title, type, save timestamp, optional validated original HTTP(S) URL, and optional cover information. The result SHALL include an eligible total and bounded pagination: default six items, page size 1–100, and nonnegative offset. Eligibility SHALL apply before counting and pagination. Share documents without a web URL SHALL remain eligible; browser documents SHALL retain their validated-web-URL requirement. Unsupported source selections SHALL produce an explicit error. Existing browser-only listing callers SHALL retain compatible behavior. Queries SHALL NOT require document bodies, a complete client library cache, or remote metadata retrieval.

#### Scenario: Files and text consume real preview slots

- **WHEN** the newest eligible shared records include a local PDF and a text note with no original web URL
- **THEN** both are returned as capture previews with an absent original URL
- **AND** the eligible total includes them

#### Scenario: Ineligible rows cannot underfill a valid page

- **WHEN** malformed or ineligible newer rows precede at least six valid eligible documents
- **THEN** the default result contains the six newest eligible documents and counts only eligible records

#### Scenario: Query is independent of the client collection cache

- **WHEN** the client has loaded only another collection or a partial page
- **THEN** capture queries still return qualifying documents across the persisted library

#### Scenario: Browser-only caller remains compatible

- **WHEN** an existing caller requests browser capture previews without using the generalized source selection
- **THEN** it receives the same browser-only population, ordering, pagination bounds, and required validated source URLs

### Requirement: Shared previews open saved content without requiring an original page

Every shared preview SHALL show a title or localized fallback, document type, and localized save time, using the existing cover/fallback layout. When a valid original HTTP(S) URL exists, a source domain and independent Open original action SHALL be available. Otherwise, the preview SHALL use document/source information without inventing a domain or offering a broken external-page action. Primary activation SHALL open or focus the persisted document in Plethora by ID, including documents missing from the client cache. Removed documents SHALL produce recoverable feedback and a list refresh. Actions SHALL remain accessible through touch and keyboard, with no hover prerequisite or nested interactive controls.

#### Scenario: User opens a shared local document

- **WHEN** the user taps or keyboard-activates a shared PDF or note without an original web URL
- **THEN** the saved document opens or is focused in Plethora
- **AND** no external-page button or fabricated domain is shown

#### Scenario: User opens a shared web article's original page

- **WHEN** the user activates Open original on a shared article with a validated HTTP(S) URL
- **THEN** the platform opens the source page independently of the saved-document action
- **AND** unsupported schemes are not offered as original-page actions

#### Scenario: Image failure does not hide a shared item

- **WHEN** a shared document has no supported cover or its cover fails to load
- **THEN** its existing themed type/source fallback, title, save time, and primary action remain usable

### Requirement: Capture wording and View all match the selected source

On native mobile, the list SHALL use “Recently shared to Plethora”, “View all shared items”, and an empty state explaining use of the device's Share action to select Plethora. Desktop SHALL retain browser-save wording and extension instructions. All headings, states, action labels, source labels, and dates SHALL use the active locale. View all SHALL open or focus the existing Library with the selected source, all-library scope, newest-first save ordering, and a removable localized source chip. The Library SHALL use the same eligibility as the list before pagination and further filtering, without changing the globally active collection or unrelated tabs.

#### Scenario: Mobile list is empty while analytics has other captures

- **WHEN** the mobile library has manual/RSS/browser capture counts but no eligible share documents
- **THEN** the list explains that items shared to Plethora will appear here and describes the device's Share action
- **AND** it does not instruct the user to install or use the browser extension
- **AND** the successful analytics content remains visible

#### Scenario: View all shows shared items across collections

- **WHEN** a mobile user selects View all shared items while another collection is active
- **THEN** the Library displays qualifying shared documents across collections, newest first, with a removable share-source chip
- **AND** eligible documents beyond the preview limit are reachable and the globally active collection stays unchanged

#### Scenario: Source filter is cleared or replaced

- **WHEN** the user removes the source chip or reuses a Library tab through a new capture-list navigation request
- **THEN** clearing the chip produces an ordinary all-library list, or the new request replaces incompatible tab-local filters
- **AND** ordinary Library tabs do not acquire the capture filter implicitly

### Requirement: Share completion refreshes the active Dashboard

The system SHALL refresh the selected capture list and existing analytics after mobile share documents and their provenance finish persisting, and on Dashboard activation. It SHALL retain the existing browser-save refresh behavior. Incoming payload delivery alone SHALL NOT announce persisted capture completion. Burst completions SHALL be coalesced; inactive Dashboards SHALL defer fetching until activation; obsolete responses SHALL NOT overwrite newer results. Refresh SHALL retain visible content and focus, with independent list/analytics errors and retry actions.

#### Scenario: Share completes while Dashboard is active

- **WHEN** one or more mobile share documents finish persisting while the Dashboard is active
- **THEN** a coalesced refresh shows those eligible documents and updated analytics without an app restart
- **AND** focus remains with the user's current control

#### Scenario: Share arrives while import is still running

- **WHEN** a mobile share payload arrives but document/provenance persistence has not completed
- **THEN** the Dashboard does not treat delivery as a successfully saved capture

#### Scenario: Dashboard is opened after background share import

- **WHEN** share imports complete while the Dashboard is inactive and the user later activates it
- **THEN** the selected list and analytics reload the persisted results

#### Scenario: One refresh fails or an old request arrives late

- **WHEN** one subsection's refresh fails or an earlier request completes after a newer request
- **THEN** successful content and prior previews remain available with appropriate retry feedback
- **AND** the obsolete response does not replace newer data
