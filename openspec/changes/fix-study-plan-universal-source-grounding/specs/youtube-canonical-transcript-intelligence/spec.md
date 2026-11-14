## MODIFIED Requirements

### Requirement: Canonical YouTube transcript persistence across all ingestion paths
Whenever a YouTube transcript is fetched via any supported pathway (on-device InnerTube, `yt-dlp`, custom transcript server, cache hit copied onto a new document, or browser fallback), the system SHALL persist the complete canonical transcript into `youtube_transcripts`, synchronize the full transcript text, `content_hash`, and `content_updated_at` onto associated `documents` rows, and reliably enqueue or ensure semantic chunk indexing regardless of whether an optional UI `AppHandle` was supplied by the caller.

#### Scenario: Desktop InnerTube transcript fetch reads and writes SQLite cache
- **WHEN** the user opens a YouTube document in the viewer and `get_youtube_transcript_by_id` succeeds via on-device InnerTube
- **THEN** the complete transcript and segment timings are saved to `youtube_transcripts` and `documents.content`
- **WHEN** the user reopens the same video or switches to Document Q&A
- **THEN** the persisted transcript is loaded immediately from SQLite without re-fetching from YouTube

#### Scenario: Switching videos invalidates stale in-memory transcript context
- **WHEN** the user switches from Video A to Video B in the viewer or Queue Scroll
- **THEN** the Assistant context immediately clears Video A's transcript and playback position and resolves strictly against Video B

#### Scenario: Cached or headless YouTube transcript persistence produces valid content revision and indexed chunks
- **WHEN** `persist_canonical_youtube_transcript` or `extract_document_text` saves or links a YouTube transcript
- **THEN** `documents.content`, `documents.content_hash`, and `documents.content_updated_at` are updated deterministically
- **AND** semantic transcript chunks become available for retrieval without requiring manual re-indexing
- **AND** subsequent `youtube_transcripts` or playback checkpoint writes for the same unchanging transcript keep `content_hash` identical

### Requirement: Timestamp-preserving semantic transcript chunking and indexing
When a YouTube or local video transcript is persisted, the system SHALL chunk the transcript into semantically coherent overlapping windows that preserve segment start/end timestamps (`location.timestampMs`) and chapter boundaries (when present) in `semantic_chunks` with `source_type = "transcript"`. Citation verification SHALL verify normalized transcript passages cleanly whether formatted with `[mm:ss]` prefixes or raw transcript text, and clicking a Study Plan citation from a YouTube or video chunk SHALL seek to the cited timestamp.

#### Scenario: Persisted transcript creates timestamped semantic chunks
- **WHEN** a video transcript is persisted for a document
- **THEN** `semantic_chunks` contains ordered chunks with `source_type = "transcript"` and `location.timestamp_ms` set to the start millisecond of each chunk's first segment

#### Scenario: Multi-segment `[mm:ss]` transcript chunk verifies against canonical transcript and navigates to timestamp
- **WHEN** a Study Plan citation references a multi-segment `"transcript"` chunk from a YouTube video
- **THEN** `resolve_study_source_refs` verifies the excerpt and `youtube` timestamp locator as `current` and `exact`
- **AND** opening the citation launches `YouTubeViewer` at the matching `timeSeconds` and highlights the cited transcript segment
