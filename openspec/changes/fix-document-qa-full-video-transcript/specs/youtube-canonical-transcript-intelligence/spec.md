## ADDED Requirements

### Requirement: Complete transcript queryability and repair before transcript-grounded answers

The complete canonical transcript persisted for a video document SHALL be the queryable source of truth for every transcript-grounded answer surface, including Document Q&A. A single-video answer turn SHALL NOT pre-truncate the transcript to a leading token window before strategy planning; the untruncated transcript SHALL be evaluated so that full-transcript fit and hierarchical composition are decided over the whole duration. When the stored transcript for the targeted video is absent or empty at answer time, the system SHALL attempt the canonical fetch/backfill, persist the complete transcript with its segment timings, and only then answer. Import-time persistence SHALL store every fetched segment with no silent cap, and a regression check SHALL verify that the stored transcript's segment count and text correspond to the fetched transcript.

#### Scenario: Late-video question is answerable after import

- **WHEN** a two-hour video was imported with a complete transcript and the user asks about a topic discussed only after the 105-minute mark
- **THEN** the stored canonical transcript includes that late-video segment with its timestamp
- **AND** the answer turn can ground on it without re-fetching or reporting the transcript as partial

#### Scenario: Stored transcript parity with the fetched transcript

- **WHEN** a transcript is fetched through any ingestion path and persisted
- **THEN** `youtube_transcripts` and the document's searchable content contain every non-empty segment from the fetch, in order, with start times
- **AND** no truncation limit, head-only slice, or segment cap reduces the stored transcript

#### Scenario: Missing stored transcript is repaired before answering

- **WHEN** a video document has no stored transcript (for example a failed import-time fetch) and the user asks a transcript question with that video as the only eligible source
- **THEN** the system fetches the canonical transcript, persists the complete segments, and answers from the repaired transcript
- **AND** if the repair fails, the response discloses that the transcript is unavailable rather than answering as if the video lacked the material

## MODIFIED Requirements

### Requirement: Query-aware video retrieval and hierarchical full-video comprehension

The Assistant video context planner and the Document Q&A workspace SHALL select the retrieval strategy based on the user's request and the model's available input budget, evaluating the complete untruncated transcript:
1. **Full-transcript fit**: When the complete timestamped transcript fits within the model's allocated source budget, include the complete transcript from the first segment to the last segment.
2. **Playback-position window**: When the user asks about what is currently playing (e.g., "What did they just say?", "Explain this part"), include a timestamped window centered around `currentTime` alongside topically relevant chunks.
3. **Explicit timestamp window**: When the user references a specific timestamp or range (e.g., "around 42:00", "at 1:15:30"), retrieve the transcript segments covering that timestamp window.
4. **Topical retrieval**: When the complete transcript exceeds the prompt budget and the question explicitly targets a bounded region — a referenced timestamp, the current playback position, or a specific quoted passage — or when hierarchical composition is unavailable (for example no generator can produce window summaries), retrieve the top-ranked semantic and lexical transcript chunks with surrounding timestamp context.
5. **Whole-video hierarchical synthesis**: When the complete transcript exceeds the single-pass budget, segment the entire transcript across its full duration, synthesize window-level summaries with preserved `[MM:SS]` / `[HH:MM:SS]` anchors, and answer from the complete full-video representation. This SHALL apply both to whole-video summary, outline, or main-argument requests and to single-video knowledge questions whose evidence may lie anywhere in the video, so a bounded retrieval set is never substituted for a complete-coverage answer while hierarchical composition is available.

For a single-video turn the workspace SHALL determine coverage from the untruncated transcript; a leading-window truncation before planning SHALL NOT cause the tail of a long transcript to be treated as absent.

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

#### Scenario: Single-video question on an over-budget transcript is not answered from fragments

- **WHEN** the user asks an ordinary knowledge question about a video whose complete transcript exceeds the model's source budget
- **THEN** the workspace composes hierarchical coverage of every transcript window and answers with `[MM:SS]` anchors
- **AND** the workspace does not answer that it only has access to a few provided chunks while the complete transcript is available

#### Scenario: Head truncation never hides the end of a long transcript

- **WHEN** the user asks about the final minutes of a two-hour video without referencing a timestamp
- **THEN** the transcript planner evaluates the segment containing that final content and the answer can cite it
- **AND** the workspace does not silently drop transcript content beyond a leading token window
