# Spec: video-language-learning-mode

## ADDED Requirements

### Requirement: Normal and Language Mode coexist

Existing video playback SHALL remain available unchanged when Language Mode is inactive. Language Mode SHALL be explicit or profile-associated and MUST reuse the existing video/transcript/document identity.

#### Scenario: Normal playback
- **WHEN** a user opens a YouTube video without enabling Language Mode
- **THEN** normal controls/playback/transcript behavior remains available with no lexical processing requirement

### Requirement: Synchronized transcript

Language Mode SHALL show a transcript synchronized to playback, scroll/focus the current sentence when appropriate, and seek playback from a sentence. It SHALL preserve existing listening/video position and allow user scroll without unwanted retargeting.

#### Scenario: Tap sentence
- **WHEN** the learner taps a transcript sentence
- **THEN** the video seeks to the current valid alignment range and the sentence becomes active

### Requirement: Language annotations and Peek

When analysis/state is available, transcript tokens SHALL use shared language highlighting and selection SHALL open the shared Language Peek with surface/lemma/morphology/state actions. Unsupported analysis SHALL degrade to exact-form/manual actions.

#### Scenario: Token state
- **WHEN** playback reaches a Learning word with valid word timing
- **THEN** the transcript shows defined language/TTS emphasis and selection opens the same profile-aware Peek as document readers

### Requirement: Translation/subtitle controls

The mode SHALL support target subtitles, target+base translation, hidden/reveal translation, and sentence translation caching through the shared translation service. Translation failure SHALL not stop playback or transcript use.

#### Scenario: Translation unavailable
- **WHEN** the base translation provider is offline and no cache exists
- **THEN** target transcript and playback continue and the translation control reports unavailable/retryable

### Requirement: Original audio replay and controls

Sentence replay, loop, auto-pause, and repeat SHALL use current original alignment ranges where available, with TTS fallback only when needed. Normal playback remains accessible.

#### Scenario: Repeat native sentence
- **WHEN** the learner activates Loop on a caption-aligned sentence
- **THEN** the original video/audio range repeats without synthesizing TTS

### Requirement: Mining and source provenance

The mode SHALL expose sentence mining that passes sentence text, target selection, translation, timestamp/alignment, source video/document, and optional frame to the shared mining/Flashcard Studio flow.

#### Scenario: Mine YouTube sentence
- **WHEN** a learner mines the active sentence
- **THEN** the draft retains the YouTube source and timestamp and can omit optional frame/media gracefully

### Requirement: Platform degradation and accessibility

Desktop, touch/mobile, keyboard, screen reader, reduced-motion, and e-ink behavior SHALL be supported. E-ink MAY omit playback but SHALL retain transcript navigation, language inspection, translation, and source timestamp.

#### Scenario: E-ink transcript
- **WHEN** video playback is unavailable in e-ink mode
- **THEN** transcript learning controls remain usable and the UI explains playback unavailability

### Requirement: Performance and safety

Long transcripts SHALL be virtualized/paged; processing/translation shall be lazy; language interactions MUST NOT mutate source captions, rate/advance Queue items, or corrupt media position.

#### Scenario: Long video
- **WHEN** a two-hour transcript is opened
- **THEN** only bounded transcript ranges render/analyze while sentence seeking remains responsive
