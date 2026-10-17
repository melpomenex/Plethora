## Purpose

Ensures complete YouTube and video transcript comprehension by persisting canonical timestamped transcripts across all ingestion paths, eliminating premature frontend token truncation, indexing transcript segments with millisecond timestamps, and planning query-aware retrieval or hierarchical whole-video synthesis across all viewer surfaces.

## ADDED Requirements

### Requirement: Canonical YouTube transcript persistence across all ingestion paths
Whenever a YouTube transcript is fetched via any supported pathway (on-device InnerTube, `yt-dlp`, custom transcript server, or browser fallback), the system SHALL persist the complete canonical transcript—including `video_id`, `document_id`, language metadata, plain searchable text, and structured `segments_json` with start time, duration, and available word timings—into `youtube_transcripts` AND synchronize the full transcript text into `documents.content` for the associated YouTube document. Subsequent transcript requests for the same `video_id` SHALL read from `youtube_transcripts` before making network calls unless the user explicitly triggers a refresh.

#### Scenario: Desktop InnerTube transcript fetch reads and writes SQLite cache
- **WHEN** the user opens a YouTube document in the viewer and `get_youtube_transcript_by_id` succeeds via on-device InnerTube
- **THEN** the complete transcript and segment timings are saved to `youtube_transcripts` and `documents.content`
- **WHEN** the user reopens the same video or switches to Document Q&A
- **THEN** the persisted transcript is loaded immediately from SQLite without re-fetching from YouTube

#### Scenario: Switching videos invalidates stale in-memory transcript context
- **WHEN** the user switches from Video A to Video B in the viewer or Queue Scroll
- **THEN** the Assistant context immediately clears Video A's transcript and playback position and resolves strictly against Video B

### Requirement: Elimination of premature frontend 2,000-token transcript truncation
The viewer wrapper and context resolution layer SHALL NOT pre-truncate video transcripts to the first 2,000 tokens (`tokens.slice(0, maxTokens)`) or re-run tokenizer encoding on playback `currentTime` ticks. The complete canonical transcript and segment array SHALL remain available to the Assistant context planner, with newline structure preserved between timestamped transcript lines.

#### Scenario: Two-hour video retains end-of-video content for Assistant queries
- **WHEN** the user opens a two-hour YouTube video and asks about a topic discussed in the final 15 minutes without selecting text in the transcript panel
- **THEN** the Assistant retrieves and explains the relevant late-video passages with accurate timestamps rather than seeing only the first ~10 minutes

#### Scenario: Playback time updates do not trigger full-transcript re-tokenization
- **WHEN** a YouTube video is playing and `currentTime` updates continuously
- **THEN** the viewer updates the playback timestamp reference without re-encoding or slicing the full transcript on the main thread

### Requirement: Timestamp-preserving semantic transcript chunking and indexing
When a YouTube or local video transcript is persisted, the system SHALL chunk the transcript into semantically coherent overlapping windows that preserve segment start/end timestamps (`location.timestamp_ms`) and chapter boundaries (when present) in `semantic_chunks` with `source_type = "transcript"`. Duplicate re-indexing and re-embedding SHALL be skipped when the transcript's content hash is unchanged.

#### Scenario: Persisted transcript creates timestamped semantic chunks
- **WHEN** a video transcript is persisted for a document
- **THEN** `semantic_chunks` contains ordered chunks with `source_type = "transcript"` and `location.timestamp_ms` set to the start millisecond of each chunk's first segment

### Requirement: Query-aware video retrieval and hierarchical full-video comprehension
The Assistant video context planner SHALL select the retrieval strategy based on the user's request and the model's available input budget:
1. **Full-transcript fit**: When the complete timestamped transcript fits within the model's allocated source budget, include the complete transcript.
2. **Playback-position window**: When the user asks about what is currently playing (e.g., "What did they just say?", "Explain this part"), include a timestamped window centered around `currentTime` alongside topically relevant chunks.
3. **Explicit timestamp window**: When the user references a specific timestamp or range (e.g., "around 42:00", "at 1:15:30"), retrieve the transcript segments covering that timestamp window.
4. **Topical retrieval**: When the user asks about a specific concept or claim on a long video that exceeds the prompt budget, retrieve the top-ranked semantic and lexical transcript chunks with surrounding timestamp context.
5. **Whole-video hierarchical synthesis**: When the user asks for a whole-video summary, outline, or main arguments of a transcript that exceeds the single-pass budget, segment the entire transcript across its full duration, synthesize chapter/window-level summaries with preserved `[MM:SS]` / `[HH:MM:SS]` anchors, and answer from the complete full-video representation.

#### Scenario: Short video uses complete transcript
- **WHEN** a video's complete transcript fits within the active model's source token budget and the user asks "Summarize this video"
- **THEN** the Assistant receives the complete transcript from start to finish and produces an accurate summary

#### Scenario: Playback-relative question uses currentTime window
- **WHEN** the user pauses or plays a video at `34:20` and asks "What did the speaker just mean by that?"
- **THEN** the Assistant receives the transcript window surrounding `34:20` and answers about that passage

#### Scenario: Timestamp-targeted question retrieves matching time range
- **WHEN** the user asks "What was discussed around 42 minutes?" on a 90-minute video
- **THEN** the Assistant retrieves the transcript segments around `42:00` and explains the material with `[42:xx]` timestamp citations

#### Scenario: Whole-video summary on a long lecture covers the entire duration
- **WHEN** the user asks "What are the main arguments across the whole video?" on a two-hour lecture whose transcript exceeds the prompt token budget
- **THEN** the Assistant synthesizes coverage across the entire duration of the transcript (beginning, middle, and end) with timestamp citations rather than summarizing only the opening excerpt

### Requirement: Honest transcript availability states and parity across surfaces
The Assistant UI and viewer surfaces (`YouTubeViewer`, `DocumentViewerWrapper`, `QueueScrollPage`, `DocumentQATab`, and `VideoFeatures`) SHALL accurately distinguish and display transcript status: `loading`, `ready` (full transcript or indexed transcript), `partial`, `unavailable`, or `failed` (with retry action). The UI SHALL NEVER display `"Transcript attached"` when the transcript is still loading, empty, unavailable, or failed, and SHALL NEVER silently substitute a video title or description for a missing transcript.

#### Scenario: Missing or failed transcript reported honestly
- **WHEN** a YouTube video has no captions or transcript extraction fails
- **THEN** the Assistant context indicator displays `"Transcript unavailable"` (or `"Transcript failed"` with a retry control) instead of `"Transcript attached"`
- **AND** in `Document` scope the Assistant informs the user that the transcript is unavailable, while in `Chat` scope the Assistant discloses that the transcript is unavailable and offers to discuss the topic using general knowledge

#### Scenario: Queue Scroll provides identical video transcript and timestamp context
- **WHEN** the user views a YouTube video in Queue Scroll mode and asks the Assistant about the current playback moment or a late-video topic
- **THEN** Queue Scroll supplies the canonical timestamped transcript and live `currentTime` playback position with the same retrieval behavior as the standard viewer
