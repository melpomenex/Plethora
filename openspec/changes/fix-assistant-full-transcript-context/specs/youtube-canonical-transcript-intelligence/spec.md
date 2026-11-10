## MODIFIED Requirements

### Requirement: Elimination of premature frontend 2,000-token transcript truncation
The viewer wrapper, context resolution layer, and Assistant context actions SHALL NOT pre-truncate video transcripts to the first 2,000 tokens, apply arbitrary budget multipliers (such as 0.55), or slice the transcript head via `trimToTokenWindow` before planning. The complete canonical transcript and segment array SHALL remain available to the Assistant context planner and orchestrator across all Assistant entry points, with newline structure preserved between timestamped transcript lines. Playback `currentTime` ticks SHALL NOT trigger tokenizer re-encoding on the main thread.

#### Scenario: Two-hour video retains end-of-video content for Assistant queries
- **WHEN** the user opens a two-hour YouTube video and asks about a topic discussed in the final 15 minutes without selecting text in the transcript panel
- **THEN** the Assistant retrieves and explains the relevant late-video passages with accurate timestamps rather than seeing only the first ~10 minutes

#### Scenario: Whole-source context action receives untruncated transcript
- **WHEN** the user invokes a whole-source context action (such as "Key points", "Summarize", "Outline document", or "Quiz me") on a two-hour video
- **THEN** the context action target resolves the complete canonical transcript without head-trimming or pre-truncating to a 55% token budget
- **AND** the target preserves complete-source coverage intent for the downstream video context planner

#### Scenario: Playback time updates do not trigger full-transcript re-tokenization
- **WHEN** a YouTube video is playing and `currentTime` updates continuously
- **THEN** the viewer updates the playback timestamp reference without re-encoding or slicing the full transcript on the main thread

### Requirement: Query-aware video retrieval and hierarchical full-video comprehension
The Assistant video context planner SHALL select the grounding strategy based on the user's request intent and the active model's effective input budget:
1. **Full-transcript direct fit**: When the complete timestamped transcript fits within the model's allocated source budget, the system SHALL include the complete transcript directly from start to finish without truncation.
2. **Whole-source hierarchical synthesis**: When the user requests a whole-source action (such as Key points, Summarize, Outline document, Examine argument, Quiz me, or Flashcards) or asks an unbounded question whose transcript exceeds the single-pass budget, the system SHALL divide the entire transcript into timestamped chronological segments across its full duration, summarize each segment with a bounded minimum token allocation (preserving `[MM:SS]` anchors, key claims, and late-video conclusions), and hierarchically compose the segments until the combined representation fits within the prompt budget. Intermediate window allocations SHALL NOT degrade below a viable threshold (at least 150 tokens) regardless of transcript length.
3. **Whole-transcript semantic and lexical retrieval**: When the user asks a specific factual or conceptual question on an over-budget video that does not concern what is currently playing or a referenced timestamp, the system SHALL search across the entire transcript index, retrieving top-ranked semantic chunks and neighboring context rather than assuming relevant evidence is located near the playback position.
4. **Playback-position window**: When the user explicitly asks about what is currently playing (e.g., "What did they just say?", "Explain this part", "What does he mean right now?"), the system SHALL include a timestamped window centered around `currentTime`.
5. **Explicit timestamp window**: When the user references a specific timestamp or range (e.g., "around 42:00", "between 35:00 and 42:00"), the system SHALL retrieve the transcript segments covering that timestamp window.

#### Scenario: Short video uses complete transcript
- **WHEN** a video's complete transcript fits within the active model's source token budget and the user asks "Summarize this video"
- **THEN** the Assistant receives the complete transcript from start to finish and produces an accurate summary

#### Scenario: Whole-source action on a two-hour lecture covers the entire duration
- **WHEN** the user invokes "Key points" or "Summarize" on a two-hour lecture whose transcript exceeds the single-pass prompt budget
- **THEN** the Assistant processes the entire transcript through hierarchical synthesis, covering beginning, middle, and ending segments with timestamp citations, and does NOT restrict its evidence to the opening minutes

#### Scenario: Whole-video summary on a long lecture covers the entire duration
- **WHEN** the user asks "What are the main arguments across the whole video?" on a two-hour lecture whose transcript exceeds the prompt token budget
- **THEN** the Assistant synthesizes coverage across the entire duration of the transcript (beginning, middle, and end) with timestamp citations rather than summarizing only the opening excerpt

#### Scenario: Factual question on a long video searches whole transcript
- **WHEN** the user pauses a two-hour video at 18:20 and asks "What did the speaker say about plants?" where plant discussion occurs only at 1:45:00
- **THEN** the Assistant retrieves evidence from the late-video plant discussion rather than confining its search to the 18:20 playback window

#### Scenario: Playback-relative question uses currentTime window
- **WHEN** the user pauses or plays a video at `34:20` and asks "What did the speaker just mean by that?"
- **THEN** the Assistant receives the transcript window surrounding `34:20` and answers about that passage

#### Scenario: Timestamp-targeted question retrieves matching time range
- **WHEN** the user asks "What was discussed around 42 minutes?" on a 90-minute video
- **THEN** the Assistant retrieves the transcript segments around `42:00` and explains the material with `[42:xx]` timestamp citations

### Requirement: Honest transcript availability states and parity across surfaces
The Assistant UI and viewer surfaces (`YouTubeViewer`, `DocumentViewerWrapper`, `QueueScrollPage`, `DocumentQATab`, and mobile/PWA assistant) SHALL accurately distinguish and display transcript acquisition status (`loading`, `ready-full`, `ready-indexed`, `partial`, `unavailable`, `failed`) and processing coverage (`full`, `hierarchical-full`, `window`, `chunks`, `none`). The Assistant SHALL NEVER claim full source coverage when only a bounded window or chunk set was processed, and SHALL NOT display "supplied window" disclaimers when full direct or hierarchical coverage was achieved.

#### Scenario: Full hierarchical coverage reported accurately
- **WHEN** an over-budget transcript is processed via hierarchical whole-video synthesis
- **THEN** the response metadata indicates `sourceCoverage: "hierarchical-full"`
- **AND** the UI indicates that the complete transcript was analyzed in sections rather than warning of a coverage limitation

#### Scenario: Bounded window reported honestly
- **WHEN** an explicit playback or timestamp request uses a localized window of a long transcript
- **THEN** the response metadata indicates `sourceCoverage: "window"`
- **AND** the prompt builder informs the model that only a bounded window was supplied

#### Scenario: Missing or failed transcript reported honestly
- **WHEN** a YouTube video has no captions or transcript extraction fails
- **THEN** the Assistant context indicator displays "Transcript unavailable" (or "Transcript failed" with a retry control) instead of "Transcript attached"
- **AND** in `Document` scope the Assistant informs the user that the transcript is unavailable, while in `Chat` scope the Assistant offers to discuss the topic using general knowledge

#### Scenario: Queue Scroll provides identical video transcript and timestamp context
- **WHEN** the user views a YouTube video in Queue Scroll mode and asks the Assistant about the current playback moment or a late-video topic
- **THEN** Queue Scroll supplies the canonical timestamped transcript and live `currentTime` playback position with the same retrieval behavior as the standard viewer

#### Scenario: Cross-surface consistency for video transcript actions
- **WHEN** a user invokes "Key points" on the same YouTube video from the Document Viewer, Queue Scroll, or Document Q&A
- **THEN** all three surfaces execute full-transcript context planning and report identical source coverage semantics
