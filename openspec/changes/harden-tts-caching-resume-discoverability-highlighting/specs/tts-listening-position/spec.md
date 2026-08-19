## ADDED Requirements

### Requirement: Durable per-document TTS listening checkpoint distinct from visual progress

The system SHALL persist a dedicated TTS listening checkpoint per document and per profile, representing where the user stopped listening — not where they stopped reading. Listening position and normal visual reading position MUST be stored separately and remain semantically distinct, while still allowing the visual position to co-advance when spoken-word follow is active.

#### Scenario: Stop halfway through a document and resume after reopen

- **WHEN** the user listens, stops mid-sentence (e.g., halfway through chunk 37), closes the document, and reopens it later
- **THEN** the system has durably stored a checkpoint for that document keyed by `(profileId, documentId)` that records the stable document anchor (`SourceAnchor` + `chunkTextHash` + `wordIndex` + `normalizedCharOffset` + `intraChunkMs`) and the document content fingerprint at save time

#### Scenario: Listening position survives app restart

- **WHEN** the app is restarted after a listening checkpoint was saved
- **THEN** `getTTSListeningPosition(documentId)` still returns the checkpoint for that document for the active profile

#### Scenario: Profile isolation

- **WHEN** profile A saves a listening checkpoint for document D
- **THEN** profile B (or `anon`) does not observe A's checkpoint when opening D; each profile has its own checkpoint namespace mirroring `document-view-state:v2:u:{profileId}:…`

### Requirement: Resume offer at reopen with robust fallback

On opening a document that has a valid listening checkpoint not equal to the document start, the system SHALL surface a lightweight, non-blocking resume affordance (e.g., banner near the TTS bar: "Resume listening from 37:42?" with **Resume**, **Start from current reading position**, **Start over**). The user MUST NOT be dropped back to the document start or to the current visible page without being offered resume when meaningful progress exists. If the stored anchor cannot be resolved (content changed, chunking changed, anchor stale), the system SHALL fall back in order: `normalizedCharOffset` within owning section → fuzzy `surroundingText` within section → closest known document position (`cfi`/`page` path) → normal visual position → start, and MUST NOT resume at an unrelated duplicate-text occurrence.

#### Scenario: Resume from meaningful progress

- **WHEN** the user reopens a document where they previously listened beyond a small threshold (e.g., >30 s listened or >2% of the document) and the checkpoint is not at the current viewport
- **THEN** the resume affordance is shown with enough context (elapsed/total derived from cached durations when available, otherwise section/word count) and does not auto-play

#### Scenario: Auto-play is prohibited on open

- **WHEN** the user opens a document with a stored listening checkpoint
- **THEN** playback does not start automatically regardless of checkpoint presence; playback only starts on explicit user action

#### Scenario: Stale checkpoint recovery after chunking change

- **WHEN** a checkpoint was saved under a different `CHUNK_MAX` or segmentation revision so `chunkIndex` numbers no longer align
- **THEN** resume still lands near the exact sentence/word via the stable `SourceAnchor`/char-offset path rather than jumping to an unrelated chunk

#### Scenario: Stale checkpoint recovery after content change

- **WHEN** the document text was edited between saves so the checkpoint anchor is stale
- **THEN** the resolver attempts `chunkTextHash`/offset/fuzzy recovery constrained to the owning section and, on failure, falls back gracefully to the closest document position rather than highlighting/starting at the wrong duplicate sentence

### Requirement: Persistence strategy with throttled and edge-triggered writes

Listening progress MUST be persisted without excessive writes and without silent loss. Writes SHALL occur at a throttled cadence while playing (at most once per ~4 s) plus immediately on every meaningful edge: `chunkChange`, `pause`, `stop`, `seek/skip`, `document close`, `tab close`/`tab eviction`, `visibilitychange`/`pagehide`/`beforeunload`, and app background. Reads occur once on document open to resolve the resume anchor.

#### Scenario: Periodic throttling not starved

- **WHEN** the user listens continuously for two minutes
- **THEN** at most ~30 persistent checkpoint writes occur (one per ~4 s), not one per word or per animation frame

#### Scenario: Pause is immediately persisted

- **WHEN** the user pauses playback at second 42 of a segment
- **THEN** the checkpoint including `intraChunkMs≈42_000` is committed within ~350 ms and visible to a subsequent reopen without waiting for the next throttle window

#### Scenario: Tab eviction flushes checkpoint

- **WHEN** the tab store evicts the document viewer for `readerTabCap=2` (active + one warm) or the user navigates away
- **THEN** any pending throttled checkpoint is flushed synchronously (read: via an immediate write before unmount) so no last-chunk progress is lost

### Requirement: Separate synchronization rules for reading vs listening progress

When spoken-word follow (`followSpokenWord`) is active, TTS-driven `onChunkChange` MAY co-advance the visual reading position coarsely at chunk boundaries via `DocumentPosition`/`ViewState`. When follow is off, listening progress MUST NOT advance visual progress. Conversely, a manual read that updates the visual position MUST NOT overwrite the stored listening checkpoint. Provider/voice/model changes MUST NOT invalidate the listening position — only the cached audio identity depends on synthesis configuration.

#### Scenario: Auto-follow advances the page but stopping does not lose listen position

- **WHEN** TTS with follow on plays across several chunks
- **THEN** the visual reader position tracks chunk boundaries; after stopping, reopening offers to resume listening near the last spoken word, not at the most recent visual scroll top

#### Scenario: Manual scroll while paused does not corrupt listening checkpoint

- **WHEN** playback is paused and the user scrolls manually to a different paragraph
- **THEN** the persisted listening checkpoint remains at the paused word until the next successful Play's checkpoint update; the next Play re-anchors to the viewport per the existing Play priority chain but the fallback listening checkpoint path remains valid

#### Scenario: Voice/provider change keeps meaningful resume position

- **WHEN** the user changes TTS voice or provider after listening progress was saved
- **THEN** resume still addresses the same word (next synthesis uses the new voice/model under a new cache key)
