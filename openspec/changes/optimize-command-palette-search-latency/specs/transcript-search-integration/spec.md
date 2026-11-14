## MODIFIED Requirements

### Requirement: Transcript text is full-text searchable
The system SHALL maintain an FTS5 virtual table (`transcript_search_fts`) synchronized via triggers across `youtube_transcripts`, `video_transcripts`, `podcast_transcript_segments`, and `transcript_segments` (in addition to `document_search`), returning transcript hits in `palette_search` with highlighted snippets and exact millisecond offsets without calling network or transcription APIs during search.

#### Scenario: Transcript appears in search results
- **WHEN** a transcription job completes and the document `content` is updated with transcript text
- **THEN** the existing FTS5 trigger on the `documents` table inserts/updates the `document_search` entry
- **AND** searching for terms from the transcript returns the document in results

#### Scenario: Search result shows transcript excerpt
- **WHEN** a search query matches text within a transcript
- **THEN** the search result displays a snippet from the transcript with the matching term highlighted
- **AND** the result is labeled as a media document with transcript

#### Scenario: Podcast, local video, session, and YouTube transcripts appear in Command Palette search via FTS5
- **WHEN** a user types a phrase spoken in a YouTube video, local video, podcast episode, or recording session transcript
- **THEN** `palette_search` matches `transcript_search_fts` directly in SQLite without fetching captions or invoking `get_youtube_transcript` in the UI search loop
- **AND** returns a result labeled as transcript-matched carrying the segment's millisecond start timestamp

### Requirement: Transcript search matches navigate to timestamp
When a Command Palette search result or secondary hit originates from a YouTube, local video, podcast, or recording session transcript, selecting the result, citation card, or inline `[MM:SS]` / `[HH:MM:SS]` timestamp link in the Assistant response SHALL open the appropriate viewer (`YouTubeViewer`, `LocalVideoPlayer`, `AudiobookViewer`, or `LearningStudio`) and seek to the matched segment timestamp with the segment highlighted.

#### Scenario: Search result navigation to timestamp
- **WHEN** a user clicks a search result or Assistant citation card that matches a transcript segment
- **THEN** the media document opens in the viewer
- **AND** the media player seeks to the timestamp of the matched segment
- **AND** the matched text is highlighted in the transcript view

#### Scenario: Inline timestamp link in Assistant prose seeks active video
- **WHEN** an Assistant response for a video contains a timestamp reference such as `[14:25]` or `[1:02:10]` and the user clicks it
- **THEN** the active YouTube or media player seeks directly to that timestamp

#### Scenario: Activating a transcript hit seeks directly to timestamp
- **WHEN** the user clicks or presses Enter on a transcript search result or secondary segment hit in the Command Palette
- **THEN** the target document opens at the matched `timeSeconds` / `segmentId` and highlights the spoken passage
