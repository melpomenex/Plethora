## Purpose

Provides an end-to-end multi-stage pipeline for automatically detecting and classifying commercial advertisements, promotional bumpers, and cross-promotions in podcast episodes before listening.

## ADDED Requirements

### Requirement: Metadata-First Advertisement Candidate Detection
The system SHALL inspect episode chapter metadata, description timestamps, and sponsor tags to identify candidate advertisement intervals prior to initiating speech transcription or language model inference.

#### Scenario: Publisher ad chapter detected without ASR
- **WHEN** a podcast episode contains chapter metadata with titles matching configured ad keywords (such as "Sponsor", "Ad Break", "Commercial", or "A Word From Our Sponsors")
- **THEN** the system SHALL mark the matching chapter interval as a high-confidence advertisement candidate
- **AND** the system SHALL NOT require speech recognition or LLM inference to identify that advertisement segment

#### Scenario: Untrusted or ambiguous chapter labels
- **WHEN** a chapter title contains sponsor keywords but also educational or content terms (such as "Interview with Acme Corp Founder" or "Discussion: Clean Energy Sponsors")
- **THEN** the system SHALL NOT automatically classify the chapter as an advertisement
- **AND** the system SHALL mark the chapter for semantic analysis if transcription is performed

### Requirement: Contextual Transcript-Based Semantic Classification
When an episode transcript is available or generated, the system SHALL evaluate transcript segments using an on-device language model or local classifier to distinguish external sponsor advertisements from technical discussions and first-party announcements.

#### Scenario: External sponsor advertisement classification
- **WHEN** an episode transcript excerpt contains promotional sales language, discount codes, sponsor URLs, or explicit calls to action for an external commercial entity
- **THEN** the classifier SHALL assign the category `external_ad` with confidence score between 0.0 and 1.0
- **AND** the classifier SHALL output structured JSON specifying the affected segment identifiers or offsets

#### Scenario: Host-read self-promotion preservation
- **WHEN** a podcast host discusses their own first-party books, newsletters, live tours, or Patreon memberships without external commercial sponsorship
- **THEN** the classifier SHALL categorize the segment as `host_self_promo`
- **AND** the segment SHALL NOT be marked for automatic skipping unless the user's skip policy explicitly includes self-promotion

#### Scenario: Technical or educational brand mention
- **WHEN** a podcast episode features case studies, architectural discussions, or critical reviews mentioning commercial company names without promotional call to action
- **THEN** the classifier SHALL categorize the content as `discussion` with low advertisement confidence
- **AND** the system SHALL preserve the content without adding it to the skip map

### Requirement: Overlapping Transcript Windowing and Chunk Budgeting
The classifier SHALL process long podcast transcripts in sequential, overlapping context windows to avoid context-length overflow, maintaining continuity across chunk boundaries.

#### Scenario: Advertisement spanning across chunk boundaries
- **WHEN** an advertisement begins near the end of one transcript chunk and continues into the subsequent chunk
- **THEN** the windowing orchestrator SHALL include an overlap window of at least 30 seconds of context
- **AND** the classifier SHALL coalesce adjacent identifications across the boundary into a single contiguous advertisement block

#### Scenario: Malformed or truncated model response recovery
- **WHEN** a local inference call returns truncated output or invalid JSON
- **THEN** the orchestrator SHALL retry the chunk once with reduced context
- **AND** if retry fails, the orchestrator SHALL record a classification warning without discarding completed transcript segments

### Requirement: Fine-Grained Boundary Refinement
The system SHALL refine advertisement start and end timestamps using detected silence intervals, transition phrases, and word-level timestamps when available, without interpolating unmeasured word timings.

#### Scenario: Word-level timestamp alignment
- **WHEN** word-level timestamps are provided by the transcription engine (such as Cactus Needle or Groq word timings)
- **THEN** the boundary refiner SHALL snap the advertisement start to the first word of the sponsor lead-in
- **AND** the boundary refiner SHALL snap the advertisement end to the final word of the call to action or exit bumper

#### Scenario: Boundary refinement with segment-only timestamps
- **WHEN** the transcription engine provides only segment-level timestamps
- **THEN** the refiner SHALL use silence gaps between adjacent segments and intro/outro phrase detection to adjust boundaries
- **AND** the refiner SHALL NOT synthesize artificial word-level timestamps that were not measured by the engine

### Requirement: Deterministic Interval Validation and Merging
The detection pipeline SHALL validate, deduplicate, and merge raw candidate intervals into a sorted, non-overlapping skip map adhering to safety constraints.

#### Scenario: Merging proximate advertisement segments
- **WHEN** two detected advertisement intervals are separated by a gap of less than 8.0 seconds and share sponsor cues or high confidence
- **THEN** the interval merger SHALL unite both intervals into a single continuous skip interval spanning from the earliest start to the latest end

#### Scenario: Rejecting isolated weak candidate detections
- **WHEN** an isolated candidate segment has duration under 10 seconds, confidence below 0.85, and contains zero strong cues (no URL, promo code, or phone number)
- **THEN** the interval validator SHALL reject the candidate to prevent accidental excision of short content remarks

#### Scenario: Excessive cut guardrail
- **WHEN** a single candidate advertisement block exceeds 180 seconds in duration without corroborating chapter markers or repeated explicit promo codes
- **THEN** the validator SHALL flag the block as suspicious and clamp or downgrade its confidence rather than automatically removing substantial listening content
