## Purpose

Provide a reference-matched command hub that helps Plethora users resume reading, find content, run actions, review cards, capture notes, and ask grounded library questions through one accessible palette.

## ADDED Requirements

### Requirement: Desktop command hub matches the supplied visual reference composition

At the reference viewport of 1586 × 992, the command palette SHALL reproduce the preserved reference's centered panel, prominent outlined search field, scope pills, six-tile Quick Actions row, three-part Resume reading card, and two-column Ask Plethora suggestion grid. The panel SHALL be approximately 838 × 738 CSS pixels with the required regions positioned within 4 CSS pixels of the measured bounds recorded in the design. The palette's color material SHALL derive from the user's active theme — surfaces, outlines, text, accent, and accent ink come from the applied theme's semantic tokens — so a gold-on-black theme reproduces the reference's appearance while other themes show their own material over the same composition. Visual acceptance SHALL compare each region against the preserved reference under the reference-matching theme; changes for readable contrast, effective hit targets, and an accessible close affordance SHALL be documented. Sample document content and the surrounding dashboard SHALL NOT become hardcoded application data or part of this redesign.

#### Scenario: Reference desktop composition
- **WHEN** the palette opens on the dashboard at the reference viewport with representative reading and review data and a near-black, gold-accent theme active
- **THEN** all reference regions appear in the same order, proportions, and alignment
- **AND** the search field and selected Resume reading tile use the theme accent outline and All uses the theme accent selected pill
- **AND** a region-by-region comparison meets the stated geometry and visual acceptance criteria

#### Scenario: Palette adopts the chosen theme
- **WHEN** the user switches to a different theme (for example a light or non-gold theme) and opens the palette
- **THEN** every palette surface, outline, text, and accent role uses that theme's color tokens
- **AND** the composition, geometry, and hierarchy stay unchanged
- **AND** light themes render light surfaces with readable dark text

#### Scenario: Overlay styling stays local
- **WHEN** the command palette is opened and closed
- **THEN** it applies only its own scoped styles and does not change the dashboard, the user's global theme selection, unrelated dialogs, or reader styling

### Requirement: Opening presents a useful home and preserves explicit entry intent

A fresh ordinary open SHALL focus the search input and show the All home with Quick Actions, eligible resume content, and suggestions. The field SHALL use the reference's “Search, ask, or run a command...” wording and an accurate platform shortcut hint. Explicit caller-provided queries SHALL be preserved. Clearing a normal query SHALL restore the current scope's empty-input view, and closing/reopening through an ordinary entry point SHALL return to All home while retaining any unsaved note draft within the app session.

#### Scenario: Ordinary opening
- **WHEN** the user opens the palette through the toolbar or supported global shortcut without an initial query
- **THEN** the input is focused, All is selected, and useful home content is visible without typing

#### Scenario: Prefilled entry
- **WHEN** another application surface opens the palette with a specific search or help query
- **THEN** that query is present and the corresponding results or help mode appear
- **AND** the home reset does not erase the query

### Requirement: Scope controls have exclusive and consistent meanings

The palette SHALL expose All, Actions, Documents, Library, Cards, and Settings in reference order with exactly one selected scope. All SHALL search across existing result kinds. Actions SHALL expose executable global and applicable contextual commands. Documents SHALL expose document title/content results. Library SHALL expose available library destinations/entities and RSS/podcast results. Cards SHALL expose eligible flashcard and extract results. Settings SHALL expose settings destinations and commands. Empty-input scope views SHALL provide bounded useful content or an actionable empty state. Scope changes SHALL preserve the input and SHALL NOT erase exact-hit or destination information.

#### Scenario: Changing scope with a query
- **WHEN** the user types a query and selects Documents
- **THEN** the query remains unchanged and only matching document results appear
- **AND** their page, CFI, passage, or transcript anchors remain available

#### Scenario: Cards exposes real learning content
- **WHEN** the user selects Cards and searches for text in an eligible flashcard or extract
- **THEN** the matching card or extract is returned from real user data
- **AND** activation opens its existing card/deck or source destination

#### Scenario: Provider-specific results honor scope
- **WHEN** the user changes from All to Settings while an RSS or podcast view is active
- **THEN** the displayed results contain settings actions/destinations rather than unrelated feed or episode results

### Requirement: Catalogue and example controls perform visible useful actions

View all SHALL open an explicit all-items catalogue without losing the input. See all actions SHALL select the complete available action catalogue, with applicable contextual actions first. A displayed Ctrl/Cmd+/ shortcut SHALL perform View all only while the palette is open. See examples SHALL expand a bounded library-question catalogue. Existing advanced filters, recent searches, and saved searches SHALL remain reachable in browse/search mode. Save search SHALL be offered only when saving is supported by the caller.

#### Scenario: Browse every available action
- **WHEN** the user activates See all actions with an empty input
- **THEN** all available registered actions can be reached without inventing a query
- **AND** unavailable platform commands are not presented as executable actions

#### Scenario: View all shortcut remains local
- **WHEN** the user presses the displayed Ctrl/Cmd+/ shortcut while the palette is open
- **THEN** View all opens with the current input preserved
- **WHEN** the same shortcut is pressed while the palette is closed
- **THEN** the palette does not intercept that shortcut

#### Scenario: Saved search remains usable
- **WHEN** a caller supplies a saved search and the user selects it in browse/search mode
- **THEN** its query is applied and normal scoped results are shown

### Requirement: Quick actions dispatch real application workflows

The home SHALL expose Resume reading, Open recent document, Review due cards, Ask about your library, Open settings, and Create a note in the reference order. Each enabled tile SHALL perform the same action from pointer, touch, and keyboard activation, exactly once. A missing prerequisite SHALL have an explanatory unavailable state and a useful supported alternative. The due badge SHALL represent the same eligible card set as the review workflow; zero due SHALL show a caught-up state without a misleading due badge.

#### Scenario: Resume and review act on real targets
- **WHEN** the user activates Resume reading with an eligible unfinished document
- **THEN** that document opens at its persisted position
- **WHEN** the user activates Review due cards with eligible due cards
- **THEN** the normal review workflow starts for the active collection/deck

#### Scenario: No cards are due
- **WHEN** the active scope has no eligible due cards
- **THEN** the review tile communicates that the user is caught up and omits the due badge
- **AND** its available alternative opens the existing review/deck overview

#### Scenario: Feature is unavailable
- **WHEN** the library-assistant feature is unavailable on the current platform or configuration
- **THEN** the home communicates that state and offers the supported setup or alternative route
- **AND** activating the tile cannot invoke an unsupported action or silently do nothing

### Requirement: Resume content is accurate and actionable

The Resume reading card SHALL target the active eligible reader with saved progress, otherwise the most recent eligible unfinished item in the active collection. It SHALL display actual available title, cover, progress, format, location, timestamp, page count, description, and saved passage. It SHALL NOT invent missing values, call arbitrary document text a last-read quote, or label a modification timestamp as reading activity. Missing artwork SHALL retain the cover footprint with a fallback glyph. Continue Reading SHALL use the same target as the Resume tile; View in Library SHALL reveal the same item without changing reading position. Overflow SHALL expose document details, Copy title, and Copy source link only when a source URL exists.

#### Scenario: Persisted location survives resume
- **WHEN** a user resumes a PDF, EPUB, article, or media document with a persisted position
- **THEN** the appropriate saved page, CFI, scroll position, or timestamp is restored
- **AND** a normal resume does not introduce a search-hit highlight

#### Scenario: Metadata is incomplete
- **WHEN** a resume candidate has progress but lacks a cover, reading timestamp, summary, or saved passage
- **THEN** its identity, progress, and available actions remain usable
- **AND** missing facts are omitted or accurately labeled, with no fabricated quote or summary

#### Scenario: Candidate disappears
- **WHEN** the displayed resume candidate is deleted, archived, inaccessible, or removed from the active collection before activation
- **THEN** the palette revalidates the target and presents a recoverable message or replacement
- **AND** it does not open a different unrelated document

### Requirement: Recent document opening reflects real activity

Open recent document SHALL prefer the most recently opened eligible document in the active collection. If no opening history exists, it SHALL use an eligible recently modified document with wording that accurately describes that fallback. Merely rendering a palette preview SHALL NOT create reading/opening history, and new collection scopes SHALL NOT reuse another collection's recent target.

#### Scenario: Recently opened document differs from last modified document
- **WHEN** a user opens one document and later edits another document's metadata
- **THEN** Open recent document still targets the most recently opened eligible document

#### Scenario: Opening history is unavailable
- **WHEN** no eligible document-opening history exists but the library contains documents
- **THEN** the action uses the stated recently modified fallback rather than pretending an opening time is known

### Requirement: Note capture saves durable user content

Create a note SHALL open a focused composer with title, body, Save, and Cancel. Saving SHALL persist a Markdown document in the active collection, make it available through normal library/search flows, and open the saved document. Success SHALL be reported only after content is durably stored. Duplicate submission SHALL be blocked. Cancellation SHALL not save content, and errors SHALL preserve the draft and avoid orphaned partial documents. An unsaved draft SHALL remain recoverable within the current app session. Local note capture SHALL work offline where normal local document persistence is supported.

#### Scenario: Save a note
- **WHEN** the user enters a title and body and activates Save
- **THEN** one Markdown document with that content is persisted in the active collection
- **AND** the document opens and becomes available to normal search after refresh

#### Scenario: Failure and retry
- **WHEN** persistence fails after note composition or partial creation
- **THEN** an actionable error is shown and the draft remains intact
- **AND** retry cannot create duplicate or orphaned documents

#### Scenario: Escape leaves a recoverable draft
- **WHEN** the user presses Escape in the note composer and later chooses Create a note in the same app session
- **THEN** the unsaved draft can be resumed
- **AND** no document was created by leaving the composer

### Requirement: Suggested prompts route to the correct workflow

The Ask Plethora region SHALL show four actionable suggestions in the reference's semantic roles: library themes, a document-specific summary, related documents, and today's review. Suggestions SHALL use actual eligible document/topic data or honest generic replacements. Library questions SHALL prefill and focus the grounded user-library assistant composer with the complete prompt and applicable document context; the user SHALL explicitly send from that composer. Related-document suggestions SHALL invoke real document search, and review suggestions SHALL open real review/deck information. Product-help queries SHALL continue to use product-help retrieval.

#### Scenario: Prefill a document question
- **WHEN** the user selects the summary suggestion for the resume document
- **THEN** the library-assistant composer opens with the full question and the intended document context
- **AND** no cloud or model request starts until the user sends the question

#### Scenario: Search and review suggestions
- **WHEN** the user selects a related-document suggestion
- **THEN** a document search for its relevant topic runs in the palette
- **WHEN** the user selects today's-review suggestion
- **THEN** the current review/deck overview opens using real due data

#### Scenario: No document is available
- **WHEN** no eligible resume document exists
- **THEN** the document-specific suggestion is replaced with an honest generic library prompt
- **AND** no sample title from the reference is displayed as the user's content

### Requirement: Existing search and exact-hit navigation remain functional

Typed searches SHALL retain mixed ranking, applicable contextual-action priority, content excerpts, secondary hits, and normal destination behavior for documents, extracts, cards, RSS articles, podcasts, commands, sections, and help results. Exact-anchor navigation/highlighting SHALL remain consistent between keyboard and pointer activation. A scope change SHALL not convert an exact content hit into an ordinary resume. Selecting a secondary match SHALL target that match without also activating the parent result.

#### Scenario: Exact match opens from keyboard and pointer
- **WHEN** the user activates a content-backed result with Enter or a click
- **THEN** the destination opens at the same exact matched span/segment and highlights it according to the existing exact-hit contract

#### Scenario: Secondary hit activation
- **WHEN** the user activates a result's secondary content match
- **THEN** only that selected anchor is opened
- **AND** the parent result's primary action does not also execute

### Requirement: URL import and help entry modes coexist with the hub

Recognized URL input SHALL transition to the existing preview/import workflow regardless of selected scope, preserving duplicate detection, import options, import feedback, and batch-import behavior. Escape in URL mode SHALL clear the URL and restore the previous scope. Failed imports SHALL retain useful retry context. Existing help prefixes and caller-provided help queries SHALL retain their meaning; ordinary typing SHALL NOT silently submit to an assistant.

#### Scenario: URL overrides a search scope
- **WHEN** the user pastes a supported URL while Cards is selected
- **THEN** the import preview and options appear instead of an irrelevant card result list
- **AND** Escape clears the URL and returns to the Cards empty-input view

#### Scenario: Continue importing
- **WHEN** an import succeeds
- **THEN** existing success feedback appears and the input is ready for another import
- **AND** opening the imported item remains an explicit supported action

#### Scenario: Product-help query
- **WHEN** the user enters an existing product-help prefix or opens with a product-help query
- **THEN** help results retain their established documentation/action behavior
- **AND** the query is not redirected to user-library retrieval

### Requirement: Keyboard selection and focused controls cannot conflict

With input focus, Up/Down SHALL move a stable visible action/result selection and Enter SHALL activate it once. A fresh home SHALL highlight the first eligible primary action. Left/Right SHALL retain native text editing when the input owns focus. Focused tiles SHALL support movement consistent with their visible row/columns. Tab-focused chips, buttons, menus, secondary-hit controls, and composer controls SHALL own Enter/Space activation. IME composition, typing in a multiline note, and child surfaces SHALL NOT accidentally execute palette actions. Escape SHALL dismiss the innermost transient surface first and otherwise follow the active mode's close/clear behavior.

#### Scenario: Execute a selected home action
- **WHEN** the user opens the home and presses Enter with input focus and an eligible selected action
- **THEN** that action executes exactly once

#### Scenario: Focused chip receives Enter
- **WHEN** the user Tabs to Settings and presses Enter
- **THEN** Settings becomes the selected scope
- **AND** the previously highlighted action does not execute

#### Scenario: Composition and multiline editing
- **WHEN** the user confirms an IME composition or enters a newline in the note body
- **THEN** the text operation completes normally
- **AND** no selected search result, home action, or note-save action executes accidentally

### Requirement: Palette enforces accessible modal behavior

The palette SHALL have a meaningful dialog name and input label, move focus inside when opened, keep Tab/Shift+Tab inside while active, block interaction/scroll with the background, and offer a keyboard-reachable Close control. Dismissal SHALL restore the invoker or a logical destination after navigation. Selection and availability SHALL not rely on color alone. Result/operation states SHALL be announced politely without reading every keystroke. Normal text SHALL achieve at least 4.5:1 contrast, and control/focus indicators SHALL achieve at least 3:1 contrast against adjacent colors. On coarse pointers interactive controls SHALL have effective targets of at least 44 × 44 CSS pixels.

#### Scenario: Focus stays inside and returns
- **WHEN** the user cycles Tab/Shift+Tab through the open palette and closes it using Close or Escape
- **THEN** focus stays inside until dismissal and then returns to the invoking control
- **AND** the underlying app could not be activated while the palette was open

#### Scenario: Result count and active item are perceivable
- **WHEN** a search finishes and the user changes the selected result with the keyboard
- **THEN** assistive technology can identify the settled result count and active result
- **AND** the visible selected state has an outline or equivalent non-color cue

### Requirement: Responsive layouts retain all primary controls

Wide layouts SHALL retain the six-tile row and three-part resume card. Narrower layouts SHALL reflow tiles to three then two columns, stack resume details, and use one-column suggestions on phones. The input and scopes SHALL stay reachable while the body scrolls within the viewport. Every scope and View all SHALL remain reachable without page-level horizontal overflow. Safe areas, short windows, page zoom, large fonts, and software-keyboard viewport changes SHALL not hide input, focused controls, or primary actions. Reduced-motion and reduced-transparency preferences SHALL be honored.

#### Scenario: Phone palette
- **WHEN** the palette opens at a 390 × 844 phone viewport
- **THEN** a safe-area-aware sheet shows the input/scopes, two-column quick actions, stacked reading content, and single-column suggestions
- **AND** all content is reachable through the body scroller without page-level horizontal scrolling

#### Scenario: Short viewport or software keyboard
- **WHEN** the available height is reduced by a short window, larger text, or the phone keyboard
- **THEN** the input and focused action remain visible and the body can scroll
- **AND** no primary control is permanently covered or clipped

### Requirement: Empty loading failure and offline states remain useful

The palette SHALL distinguish a first-use empty library, no resume target, zero due cards, no matching results, enrichment loading, provider failure, unavailable assistant, and unsupported platform capability. Each state SHALL offer an applicable next action or retry without fabricated data. Enrichment SHALL keep stable cover/card footprints. Failures SHALL not clear a user's query or unsaved draft. Offline operation SHALL retain locally available navigation, resume, search, and note capture; network-dependent flows SHALL use their existing recoverable failure behavior.

#### Scenario: First-use library
- **WHEN** the user opens the palette with an empty library
- **THEN** the hub offers import/open-library guidance and explains unavailable resume/recent actions
- **AND** no reference book, quote, percentage, or due count is presented as real user data

#### Scenario: Resume enrichment fails
- **WHEN** cover or resume metadata enrichment fails
- **THEN** the bounded cached item remains usable with honest fallbacks
- **AND** the failure does not block the input or unrelated quick actions

#### Scenario: Search provider fails
- **WHEN** a requested search provider fails
- **THEN** a recoverable failure or partial-result state appears with the original query retained
- **AND** the user can retry or change scope

### Requirement: Hub respects data scope and existing assistant privacy behavior

Home items, recent targets, card counts, saved notes, and category results SHALL respect the active collection and applicable deck/platform scope. A collection change SHALL invalidate stale targets and pending responses. Assistant handoff SHALL preserve existing local-only and AI-excluded restrictions, provider availability, retrieval fallback, and privacy indicators. Opening or previewing the palette SHALL not send user content to an AI provider.

#### Scenario: Change collection while enrichment is pending
- **WHEN** the user changes the active collection before a previous collection's result or enrichment response arrives
- **THEN** the old response does not replace the new collection's home/results or become an executable target

#### Scenario: Local-only or excluded content
- **WHEN** a user follows a suggestion involving local-only or AI-excluded content
- **THEN** the existing assistant eligibility and privacy rules remain enforced
- **AND** the palette introduces no bypass through its prompt context

### Requirement: Opening and asynchronous search remain bounded and responsive

Opening All/home SHALL render its shell and cached primary content without waiting for library-wide content extraction, extract/card/transcript loading, embedding generation, or network/model work. Optional home enrichment SHALL be limited to the chosen reading target. Category searches SHALL use bounded results, and settled results SHALL correspond to the latest input, scope, and collection. Closed palettes SHALL not accept stale palette-local responses. The redesigned palette SHALL pass the repository's local performance and bundle budget gates and remain usable with a library of at least 3,000 documents.

#### Scenario: Large library opens immediately from cached state
- **WHEN** a user opens All/home with at least 3,000 documents available
- **THEN** the shell, input, and cached home actions render without an eager whole-library content or card load
- **AND** typing can begin while optional reading enrichment is pending

#### Scenario: Out-of-order responses
- **WHEN** the user types rapidly or changes scopes and an older request completes after the latest request
- **THEN** only the latest applicable response controls visible results and selection

#### Scenario: Close during enrichment
- **WHEN** the palette closes before enrichment or search completes
- **THEN** the completed response does not reopen it or restore stale selection/content into a later unrelated session
