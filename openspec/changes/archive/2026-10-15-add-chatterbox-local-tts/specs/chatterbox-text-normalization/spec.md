## Purpose

Normalizes complex Markdown, mathematical notation, and code snippets into natural speech-ready text chunks and pre-buffers audio for seamless continuous listening.

## ADDED Requirements

### Requirement: Markdown Stripping and Spoken Translation
The system SHALL normalize study material containing Markdown formatting, LaTeX equations, and source code into fluent natural language text suitable for speech synthesis. Markdown links SHALL be simplified to their anchor text, and inline formatting syntax SHALL be stripped. Inline LaTeX equations SHALL be transcribed to readable English phrases or spoken placeholders, and code blocks SHALL be handled according to user preferences (read aloud, announce as summary marker, or skip).

#### Scenario: Markdown link and styling simplification
- **WHEN** text containing `[Spaced Repetition](https://en.wikipedia.org/wiki/Spaced_repetition)` and `**important** concept` is submitted for synthesis
- **THEN** the normalizer SHALL output `Spaced Repetition and important concept` without formatting punctuation or URLs

#### Scenario: Spoken math translation
- **WHEN** text contains simple inline math such as `$x \in A$` or `$\frac{a}{b}$`
- **THEN** the normalizer SHALL convert the math tokens to spoken equivalents such as `x in A` or `a over b`

#### Scenario: Configurable code block pronunciation
- **WHEN** a reading extract contains a fenced code block and the user configuration is set to "Announce Summary"
- **THEN** the normalizer SHALL replace the code block with a spoken announcement such as `code block: rust, 5 lines` instead of reading syntax literally

#### Scenario: Skipping code blocks when configured
- **WHEN** a reading extract contains a code block and the user configuration is set to "Skip Code"
- **THEN** the normalizer SHALL omit the code block and synthesize only the surrounding explanatory text

### Requirement: Sentence Splitting and Boundary Detection
The system SHALL split normalized paragraphs into individual sentence segments using boundary heuristics that respect punctuation, quotes, and common abbreviations (e.g., "Dr.", "e.g.", "i.e.", "et al."). Each sentence segment SHALL retain exact character start and end offsets relative to the original document to support synchronized visual highlighting.

#### Scenario: Accurate sentence boundary splitting
- **WHEN** a paragraph containing multiple sentences with quotation marks and abbreviations is processed
- **THEN** the segmenter SHALL produce discrete sentence chunks without splitting on period-bearing abbreviations

#### Scenario: Preservation of character mapping offsets
- **WHEN** text is segmented into sentence chunks
- **THEN** each segment descriptor SHALL include `startOffset` and `endOffset` pointing accurately to the corresponding substring in the raw source document

### Requirement: Multi-Chunk Pre-Buffering Pipeline
The system SHALL maintain a synthesis pre-buffer pipeline that anticipates playback progression. While audio chunk $N$ is being played, the pipeline SHALL pre-synthesize chunk $N+1$ and chunk $N+2$ in the background so that sentence transitions are gapless and immune to momentary inference jitter.

#### Scenario: Gapless playback via lookahead buffering
- **WHEN** the user starts listening to a multi-sentence extract
- **THEN** playback of the first sentence SHALL begin within 450 ms while the second and third sentences are synthesized in the background prior to the first sentence concluding

#### Scenario: Pre-buffer flush upon navigation jump
- **WHEN** the user jumps ahead by several sentences or skips to a new queue item
- **THEN** the system SHALL immediately discard unplayed pre-buffered audio chunks and prioritize synthesis of the new target sentence
