# Specification: Multimodal Video Slices, Role-Voice TTS PiP, Breakout Overlays & Socratic Margin

## ADDED Requirements

### Requirement: Transcript selection captures bounded video slices with exact start and end timestamps

Highlighting text spanning one or more segments in `TranscriptSync` / `TranscriptPanel` SHALL resolve the earliest intersecting segment `start` and latest intersecting segment `end` timestamps, render an inline `Capture Video Slice [mm:ss - mm:ss]` button, and invoke `createVideoExtract` with `{ documentId, startTime, endTime, transcriptText }` when activated.

#### Scenario: Multi-segment transcript highlight creates bounded video extract
- **GIVEN** a transcript containing segments `[01:10 - 01:18] "Consensus ensures..."` and `[01:18 - 01:26] "that replicas agree."`
- **WHEN** the user highlights across both segments and clicks `Capture Video Slice [01:10 - 01:26]`
- **THEN** `createVideoExtract` is called with `start_time = 70`, `end_time = 86`, and `transcript_text` matching the selected range

#### Scenario: Invalid or collapsed selection suppresses video slice trigger
- **GIVEN** no transcript text is highlighted or the start time is greater than or equal to the end time
- **WHEN** `resolveTranscriptSelectionBounds` evaluates the selection
- **THEN** no `Capture Video Slice` action bar is shown and invalid zero-length requests are blocked

---

### Requirement: Persistent TTS PiP Mini-Player supports waveform scrub, 1.0x-2.5x speed, [B] 30s Bookmark Extract, and Role Voices

`MiniAudioPlayer` and `audioPlaybackStore` SHALL remain mounted across route/tab transitions as a collapsible bottom-right PiP dock exposing waveform scrub seeking, speed presets (`1.0x`, `1.25x`, `1.5x`, `2.0x`, `2.5x`), a `[B]` **Bookmark & Extract Last 30s** shortcut/button capturing `[Math.max(0, currentTime - 30), currentTime]` into a scheduled extract, and automatic Role Voice profile selection (Voice A for reading extracts; transition chime + Voice B for Q&A prompts and AI summaries).

#### Scenario: Pressing [B] captures the trailing 30 seconds of audio/TTS into an extract
- **GIVEN** the PiP player is actively playing at `currentTime = 142` seconds with transcript/chunk text covering `112s–142s`
- **WHEN** the user clicks `[B] Bookmark Last 30s` (or presses `b` with player focus/no editable input active)
- **THEN** an extract capturing `[112s, 142s]` and the corresponding buffered text is created in the inbox/queue

#### Scenario: Queue role change switches between Voice A and Chime + Voice B
- **GIVEN** `audioPlaybackStore` plays a reading extract (`role = "extract"`) using `voiceProfileA`
- **WHEN** playback transitions to a flashcard Q&A prompt (`role = "qa_prompt"`)
- **THEN** the playback controller plays the role-transition chime cue and switches synthesis to `voiceProfileB`

---

### Requirement: Breakout View overlay provides pan-and-zoom inspection for tables, math, and code blocks

`BreakoutOverlayModal` SHALL attach via an accessible "Breakout View" trigger on wide `<table>`, `.katex-display` math formulas, and `<pre><code>` blocks inside `EPUBViewer`, `MarkdownViewer`, and `ExtractScrollItem`, opening an isolated pan-and-zoom (`0.5x–3.0x`) canvas with keyboard `+`/`-`/`0` zoom controls and high-contrast theme tokens.

#### Scenario: Opening Breakout View on a wide Markdown table zooms cleanly without mutating underlying DOM
- **GIVEN** a Markdown or EPUB document containing a multi-column `<table>` block
- **WHEN** the user activates `Breakout View` and zooms to `150%`
- **THEN** `BreakoutOverlayModal` renders the cloned table at scale `1.5` inside a pan/zoom container with high-contrast tokens
- **AND** pressing `Escape` closes the overlay without modifying the source document

---

### Requirement: Selection-Anchored Socratic Margin Thread explains highlighted passages and converts insights into extracts or cards

Pressing `Cmd/Ctrl + J` (or clicking `Socratic Margin` in the selection toolbar) on highlighted document text or an equation SHALL open `SocraticMarginThread` anchored to the selected quote/context, allow multi-turn Socratic Q&A against the selected snippet, and provide 1-click **Convert Explanation to Extract** and **Convert to Flashcard** buttons linking back to the parent document.

#### Scenario: Opening Socratic Margin with Cmd+J and converting AI explanation to flashcard
- **GIVEN** the user has selected `"Byzantine fault tolerance requires 3f+1 nodes"` in `DocumentViewer`
- **WHEN** the user presses `Cmd/Ctrl + J`, asks `"Why 3f+1 and not 2f+1?"`, receives a grounded reply, and clicks `Convert to Flashcard`
- **THEN** `SocraticMarginThread` displays the conversation anchored beside the quote
- **AND** clicking `Convert to Flashcard` invokes `createLearningItem` with the parent `documentId` and explanation
