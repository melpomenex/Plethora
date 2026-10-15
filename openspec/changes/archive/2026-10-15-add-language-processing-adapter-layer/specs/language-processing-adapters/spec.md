# Spec: language-processing-adapters

## ADDED Requirements

### Requirement: Provider-independent analysis contract

The system SHALL expose a versioned adapter contract for language detection, sentence segmentation, tokenization/word boundaries, normalization, lemmatization, POS, morphology, phrase candidates, transliteration, and script metadata. Viewer components MUST consume the contract rather than implement language-specific heuristics.

#### Scenario: Spanish inflection
- **WHEN** an adapter analyzes `hablando` in Spanish
- **THEN** it may return surface `hablando`, lemma `hablar`, POS verb, and gerund morphology with confidence, all tied to source spans

#### Scenario: Non-whitespace script
- **WHEN** a Japanese or Chinese adapter processes text without spaces
- **THEN** it returns valid token spans or an explicit unsupported capability; it does not collapse the whole paragraph into one fake word

### Requirement: Capability negotiation and truthful fallback

Each language/provider combination SHALL declare supported capabilities and confidence. Missing lemma, morphology, transliteration, or phrase support SHALL be represented as unavailable/unknown; the system SHALL retain exact-form tokenization when possible.

#### Scenario: Lemmatization unavailable
- **WHEN** an adapter can tokenize Arabic but cannot lemmatize it
- **THEN** exact-form lexical accounting remains available and no lemma or morphology is displayed as fact

### Requirement: Stable source spans and anchors

Analysis results SHALL preserve sentence and token source offsets plus an optional reader/source anchor (EPUB CFI, PDF canonical word/page, text offset, transcript timestamp). Source spans SHALL be sufficient to recover the original surface form.

#### Scenario: Reopen occurrence
- **WHEN** a token occurrence is selected from an EPUB
- **THEN** its analysis record can resolve back to the original surface text and CFI/range without rewriting the EPUB

### Requirement: Deterministic versioned processing

A processing result SHALL be keyed by content fingerprint, language tag, adapter/provider identity, adapter version, and relevant configuration. Changing any input SHALL create an invalidatable result rather than silently mixing versions.

#### Scenario: Tokenizer upgrade
- **WHEN** the tokenizer version changes
- **THEN** dependent projections are marked stale/reprocessable while existing reader content remains openable and old results are not treated as current

### Requirement: Background, chunked, cancellable execution

Analysis SHALL run lazily or in background chunks, expose loading/progress/error states, support cancellation/resume, and avoid putting the full token stream in Zustand/localStorage or blocking document opening.

#### Scenario: Large novel
- **WHEN** a 500,000-token EPUB is opened
- **THEN** the reader opens before analysis completes, chunks are processed incrementally, and consumers can query analyzed ranges without loading all tokens reactively

### Requirement: Provider privacy and offline behavior

Local processing SHALL be usable without credentials. Cloud/AI fallback SHALL be opt-in, disclose provider use, send only the requested content, cache by the canonical key, and expose typed unavailable/offline states.

#### Scenario: Offline unsupported language
- **WHEN** the device is offline and no local adapter supports the language
- **THEN** ordinary reading and manual vocabulary actions remain usable while analysis is labeled unavailable and retryable

### Requirement: Unicode and script correctness

The contract and reference utilities SHALL handle Unicode normalization, combining marks, apostrophes, hyphens, CJK segmentation, RTL text, mixed scripts, and punctuation without corrupting source offsets.

#### Scenario: Combining mark
- **WHEN** a surface form contains decomposed accents
- **THEN** normalized lookup identity may match the composed form while the stored span still recovers the exact original characters
