## MODIFIED Requirements

### Requirement: Paths derive from library structure, not free-form generation
Curriculum structure SHALL derive from frozen library evidence across any supported Plethora source type, canonical concepts, and confirmed prerequisite relations, with the LLM confined to bounded topic/objective/rationale and prerequisite proposals. Retrieval and verification SHALL evaluate content revisions independently of reading or playback position timestamps, index transcript-backed and child sources reliably, and preserve exact timestamps/locators or explicit coarse fallback for every grounded reference. Unsupported or un-prepared sources (such as un-transcribed media or scanned PDFs/images without OCR) SHALL surface honest readiness states and user-initiated preparation actions rather than failing silently or substituting model-only fabrication.

#### Scenario: Ordering respects prerequisites
- **WHEN** a path is generated over a fixture graph where virtual memory requires memory which requires processes
- **THEN** the node order is topologically valid and reproducible across regenerations with unchanged inputs

#### Scenario: Material gaps are explicit
- **WHEN** a required concept has no covering source in the library
- **THEN** the node is marked as a material gap with find-material actions rather than silently omitted

#### Scenario: YouTube video with cached or freshly fetched transcript generates a verified grounded plan
- **WHEN** a user selects an indexed or freshly transcribed YouTube document in `SourceScopePicker`, saves playback checkpoints (`date_modified` updates), and runs curriculum generation
- **THEN** canonical transcript content hashes and `content_updated_at` remain stable across playback position updates
- **AND** `retrieve` returns verified `"transcript"` semantic chunks with clickable `{ kind: "youtube", timeSeconds, segmentId, textQuote }` citations that seek `YouTubeViewer` to the cited moment

#### Scenario: Un-transcribed media or un-OCRed scan surfaces honest readiness gate
- **WHEN** a user selects a local video, podcast episode, audio file, image, or scanned PDF lacking extractable text/transcript/OCR
- **THEN** the source picker and preflight classify the source as `needs-transcript` or `needs-ocr` with an explicit user-triggered preparation control rather than pretending readiness or inventing grounded citations

#### Scenario: Rejection reasons during evidence verification remain actionable and privacy-safe
- **WHEN** evidence retrieval finds candidate passages that cannot be verified
- **THEN** structured diagnostic reason counts (e.g., missing index, revision mismatch, excerpt mismatch, AI-excluded) are returned to the coordinator without leaking protected document text into error strings

## ADDED Requirements

### Requirement: Universal Source Adapter covers all applicable Plethora library sources
Study Plans SHALL support selecting, preparing, retrieving, verifying, citing, and opening PDFs (native and OCR), EPUBs, HTML/web/X threads, Markdown, plain text, YouTube videos, local videos, audio/audiobooks, recording sessions, podcast episodes, RSS articles, extracts, notes/annotations, image OCR documents, collections, and tags through one canonical source adapter contract while strictly enforcing `is_ai_excluded` and `is_local_only`.

#### Scenario: Mixed-source study plan combines PDF, YouTube transcript, podcast/RSS item, and extract
- **WHEN** a user builds a study plan scoping a PDF, a YouTube lecture transcript, a promoted RSS article or podcast episode, and an extract or annotation
- **THEN** each source is resolved to a canonical `documents` identity, indexed if ready, cited with valid `StudySourceRefV1` records, and opened at its matching page, quote, or playback timestamp
- **AND** any `is_ai_excluded` source in scope is refused from AI generation/embedding and any `is_local_only` source is permitted only on on-device/local routes

#### Scenario: Historical citations remain valid after reading/playback navigation
- **WHEN** a user opens a cited source from an existing Study Plan and updates reading progress (`save_position`) or audio checkpoints (`commit_checkpoint_under_authority`)
- **THEN** existing `StudySourceRefV1` citations resolve as `current` unless the underlying document text or transcript itself changed
