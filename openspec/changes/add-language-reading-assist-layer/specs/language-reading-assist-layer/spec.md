# Spec: language-reading-assist-layer

## ADDED Requirements

### Requirement: Generic assist contract

The system SHALL expose a provider-independent `ReadingAssistLayer` (or equivalent) for script annotations including transliteration, furigana/ruby, pinyin, script variants, morphology hints, diacritics, and future pronunciation metadata. Each annotation SHALL include source span, kind, provider/version, confidence, and direction/script.

#### Scenario: Japanese ruby
- **WHEN** a Japanese provider supports furigana for a source span
- **THEN** the layer can render ruby tied to the original characters and hide it without changing source text

### Requirement: Capability truthfulness

Adapters SHALL declare supported assist kinds per language. Unsupported or failed annotations SHALL be omitted/labeled unavailable; the system MUST NOT fabricate transliteration, tones, pitch, or morphology.

#### Scenario: No Arabic transliteration
- **WHEN** no provider supports Arabic transliteration offline
- **THEN** Arabic text remains readable and no bogus transliteration is inserted

### Requirement: Density and profile settings

Users SHALL be able to disable assists or choose density/presentation per profile, with optional content overrides where supported. Language Mode off SHALL disable the layer.

#### Scenario: Assist disabled
- **WHEN** the profile setting is Off
- **THEN** the reader renders original text with no assist layout or processing work

### Requirement: Coexistence with reader systems

Assist annotations SHALL coexist with vocabulary state highlighting, user highlights/extracts, TTS spoken-word highlighting, selection, EPUB styling, PDF reflow, reading position, and e-ink. Selecting assist text SHALL resolve to the original source span unless explicitly configured otherwise.

#### Scenario: Select ruby text
- **WHEN** a user selects a Japanese ruby annotation
- **THEN** the action resolves to the associated source text/anchor and does not create a duplicate token occurrence

### Requirement: Script and direction correctness

The layer SHALL support CJK layout, ruby/line breaking, mixed scripts, RTL direction/bidi isolation, combining marks, and screen-reader order without corrupting source offsets.

#### Scenario: RTL assist
- **WHEN** transliteration is displayed above an Arabic source span
- **THEN** visual and screen-reader order remain understandable and source selection/navigation remains correct

### Requirement: Performance and cache

Assists SHALL be computed lazily/background, cached by source/profile/language/provider/version/config, and rendered only in bounded visible ranges where necessary. E-ink redraw cost and mobile memory SHALL be considered.

#### Scenario: Long Japanese EPUB
- **WHEN** assistance is enabled for a long EPUB
- **THEN** visible chapters annotate progressively and changing density does not reprocess the entire book synchronously

### Requirement: Privacy/provider behavior

Local assist SHALL work without credentials where available; cloud/provider use SHALL be disclosed, bounded, cacheable, and optional. Core reading MUST remain available offline.

#### Scenario: Cloud assist disabled
- **WHEN** the user has disabled cloud processing
- **THEN** local/cached assists may render and missing annotations do not block reading
