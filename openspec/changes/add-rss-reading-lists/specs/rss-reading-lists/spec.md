## ADDED Requirements

### Requirement: Reading List Persistence
The system SHALL persist Reading Lists (named, ordered sets of feed ids) in a backend store that survives application restart and reinstall, exposed via both Tauri commands and HTTP endpoints, with full create, read, update, and delete operations.

#### Scenario: Create a Reading List
- **WHEN** the user saves a selection as a new Reading List named "Morning Coffee" containing three feed ids
- **THEN** the system SHALL store the list in the `rss_reading_lists` backend table with the given name, feed ids, a generated id, created/updated timestamps, and a sort order, and the list SHALL be available on the next application launch

#### Scenario: Update a Reading List
- **WHEN** the user edits an existing Reading List to add a feed and renames it
- **THEN** the system SHALL update the stored row's name and feed ids and refresh its updated timestamp, leaving all other fields unchanged

#### Scenario: Delete a Reading List
- **WHEN** the user deletes a Reading List
- **THEN** the system SHALL remove the row from the backend store and the list SHALL no longer appear in the UI, and feeds referenced by the deleted list SHALL remain subscribed and unaffected

#### Scenario: Survive reinstall
- **WHEN** the application is uninstalled and reinstalled after a Reading List was created
- **THEN** the Reading List SHALL still be retrievable from the backend store, because it is persisted outside ephemeral client state

### Requirement: Folder and Category Section Scroll Entry
The system SHALL allow users to open RSS Scroll Mode scoped to a single sidebar section (a folder or a category) via a dedicated affordance on that section, loading only the feeds belonging to that section.

#### Scenario: Scroll a folder section
- **WHEN** the user activates the "scroll this section" affordance on a folder divider in the RSS sidebar
- **THEN** the system SHALL open Scroll Mode and load only the feeds assigned to that folder, and the Scroll Mode header SHALL display the folder name

#### Scenario: Scroll a category section
- **WHEN** the user activates the "scroll this section" affordance on a category divider in the RSS sidebar
- **THEN** the system SHALL open Scroll Mode and load only the feeds whose category matches that section, and the Scroll Mode header SHALL display the category name

#### Scenario: Section with no feeds
- **WHEN** the user activates the scroll affordance on a section that contains no active feeds
- **THEN** the system SHALL open Scroll Mode and show the empty state, and SHALL NOT throw or load unrelated feeds

### Requirement: Ad-hoc Feed Selection for Scroll Mode
The system SHALL provide a select mode in the RSS sidebar that lets the user choose any combination of feeds and folders and open Scroll Mode with exactly that selection, without requiring the selection to be saved.

#### Scenario: Enter select mode and scroll an ad-hoc set
- **WHEN** the user enables select mode, selects two individual feeds and one folder, and activates "Scroll selected"
- **THEN** the system SHALL open Scroll Mode scoped to the union of the selected feeds and the feeds inside the selected folder, de-duplicated by feed id, and the header SHALL display the feed count

#### Scenario: Selecting a folder selects its feeds
- **WHEN** the user checks a folder row while in select mode
- **THEN** all feeds currently assigned to that folder SHALL be included in the selection

#### Scenario: Empty ad-hoc selection
- **WHEN** the user activates "Scroll selected" with no feeds or folders checked
- **THEN** the system SHALL keep the "Scroll selected" action disabled and SHALL NOT open Scroll Mode

#### Scenario: Exit select mode discards unsaved selection
- **WHEN** the user exits select mode without saving the selection
- **THEN** the system SHALL clear the current selection and return the sidebar to normal navigation

### Requirement: Save Selection as Reading List
The system SHALL allow the user to save any folder, category, or ad-hoc selection as a named Reading List via a dialog, and the saved list SHALL be immediately launchable.

#### Scenario: Save ad-hoc selection as a Reading List
- **WHEN** the user, while in select mode with several feeds selected, activates "Save as Reading List" and enters a name in the dialog
- **THEN** the system SHALL create a Reading List containing the selected feed ids with the entered name and persist it to the backend, and the list SHALL appear in the Reading Lists panel

#### Scenario: Save the current section as a Reading List
- **WHEN** the user chooses to save the current folder or category section as a Reading List
- **THEN** the system SHALL pre-fill the create dialog with the section's feed ids and a default name derived from the section name

#### Scenario: Name is required
- **WHEN** the user attempts to save a Reading List without entering a name
- **THEN** the system SHALL disable the save action and SHALL NOT create the list

### Requirement: Reading List Management
The system SHALL surface saved Reading Lists in a dedicated panel with launch, edit, duplicate, and delete actions, and SHALL show an unread count per list.

#### Scenario: Launch a Reading List into Scroll Mode
- **WHEN** the user activates the launch-into-scroll action on a saved Reading List
- **THEN** the system SHALL open Scroll Mode scoped to the feeds in that list, de-duplicated and filtered to currently-subscribed feeds, and the header SHALL display the list name

#### Scenario: Launch a Reading List into the article list
- **WHEN** the user activates the launch-into-list action on a saved Reading List
- **THEN** the system SHALL display the combined article list for the feeds in that list in the standard RSS article view

#### Scenario: Edit a Reading List
- **WHEN** the user edits a saved Reading List and changes its feed set or name
- **THEN** the system SHALL persist the changes and the panel SHALL reflect the updated name and unread count

#### Scenario: Duplicate a Reading List
- **WHEN** the user duplicates a saved Reading List
- **THEN** the system SHALL create a new Reading List with a copy of the source feed ids and a derived name (e.g. "Morning Coffee (copy)") and SHALL NOT modify the original

#### Scenario: Unread count per list
- **WHEN** the Reading Lists panel is displayed
- **THEN** each list row SHALL show the total unread article count across its member feeds

#### Scenario: Empty Reading Lists state
- **WHEN** no Reading Lists exist
- **THEN** the panel SHALL show an empty state explaining what Reading Lists are and how to create one

### Requirement: Scroll Mode Respects Feed Scope
When opened with a feed scope, RSS Scroll Mode SHALL load and navigate only the feeds defined by that scope, while preserving all existing scroll-mode behavior (interleaving, engagement ordering, mark-as-read, favorites, summaries, extracts).

#### Scenario: Scoped scroll loads only scoped feeds
- **WHEN** Scroll Mode is opened with a scope of three feeds
- **THEN** the scroll queue SHALL contain only items from those three feeds, interleaved and engagement-sorted, with no items from other feeds

#### Scenario: Mark-as-read works within a scope
- **WHEN** the user marks an item as read while in a scoped Scroll Mode session
- **THEN** the item SHALL be marked read and removed from the queue exactly as in the unscoped flow, and the scope SHALL remain in effect

#### Scenario: Scope header label
- **WHEN** Scroll Mode is open with any non-"all" scope
- **THEN** the header SHALL display the scope's label (section name, reading-list name, or feed count) in addition to the position counter

#### Scenario: Stale feed ids are ignored
- **WHEN** a scope references a feed id that is no longer subscribed
- **THEN** the system SHALL skip that feed id without error and the scroll queue SHALL contain only currently-subscribed feeds in the scope

### Requirement: Reading Lists Internationalization
The system SHALL provide localized strings for all Reading Lists user-facing text in every supported locale (English, Spanish, German, French, Japanese, Chinese).

#### Scenario: Locale coverage
- **WHEN** the application language is set to any of the six supported locales
- **THEN** all Reading Lists labels, buttons, dialog text, empty states, and tooltips SHALL display in that locale with no missing-translation fallback keys shown to the user
