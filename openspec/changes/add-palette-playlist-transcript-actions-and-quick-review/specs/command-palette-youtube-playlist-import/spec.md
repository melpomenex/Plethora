## Purpose

Allows users to paste a YouTube playlist URL into the Command Palette, browse the playlist's videos directly inside the Command Palette dropdown list, and selectively import individual or multiple videos into their library.

## ADDED Requirements

### Requirement: Command Palette detects and previews YouTube playlist URLs
The system SHALL detect YouTube playlist URLs (`youtube.com/playlist?list=...`) and YouTube video URLs carrying a playlist parameter (`list=...`) when entered or pasted into the Command Palette search input, and SHALL fetch and display the playlist metadata (title, channel, video count) and its list of videos inside the Command Palette dropdown.

#### Scenario: User pastes a dedicated YouTube playlist URL
- **WHEN** the user pastes a YouTube playlist URL (e.g., `https://www.youtube.com/playlist?list=PL...`) into the Command Palette
- **THEN** the Command Palette enters URL import mode, fetches the playlist metadata and video entries, and displays the playlist header and scrollable list of videos in the dropdown

#### Scenario: User pastes a watch URL that includes both video ID and playlist ID
- **WHEN** the user pastes a YouTube watch URL containing both `v=<videoId>` and `list=<playlistId>`
- **THEN** the Command Palette allows the user to switch between single-video import preview and the playlist video dropdown list

#### Scenario: Playlist metadata fetch fails
- **WHEN** the playlist metadata or video list cannot be retrieved
- **THEN** the Command Palette displays a clear error state with an option to retry or subscribe to the playlist URL directly

### Requirement: Users can filter and select specific playlist videos to import
The system SHALL allow users to select or deselect individual videos, select all or deselect all videos, and filter videos by title within the Command Palette playlist dropdown list before importing.

#### Scenario: Selecting individual videos and importing batch
- **WHEN** the user checks three videos in the Command Palette playlist dropdown and activates "Import Selected (3)"
- **THEN** the system imports each selected video into the library with any chosen tags or collection, displays progress and completion feedback, and refreshes the document store

#### Scenario: Importing a single video directly from a playlist row
- **WHEN** the user clicks the per-video import action on a specific video row in the playlist dropdown
- **THEN** the system imports that single video immediately and marks the row as imported without losing the user's place in the playlist list

#### Scenario: Filtering videos within a large playlist
- **WHEN** the user types a filter query in the playlist video filter input inside the Command Palette preview
- **THEN** the visible video rows narrow to videos whose titles match the filter query while preserving existing selections

### Requirement: Playlist dropdown indicates already-imported videos
The system SHALL cross-reference playlist video IDs against existing YouTube documents in the user's library and visually mark any video that has already been imported.

#### Scenario: Playlist contains videos already in the library
- **WHEN** a fetched playlist includes a video whose YouTube video ID already exists in the library
- **THEN** that video row displays an "Imported" badge, defaults to unselected in batch selection, and provides an action to open the existing document
