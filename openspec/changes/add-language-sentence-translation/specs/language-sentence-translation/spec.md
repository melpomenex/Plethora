# Spec: language-sentence-translation

## ADDED Requirements

### Requirement: Profile language pair

Translation SHALL use the resolved Language Profile's target language as source (or verified content language) and base/explanation language as target, with explicit overrides only where the user requests them. It SHALL not use application locale implicitly.

#### Scenario: Spanish profile with English UI
- **WHEN** a Spanish sentence is translated under an English-base profile
- **THEN** the returned translation is English and the UI locale remains independent

### Requirement: Display modes

Language Mode SHALL support Target only, Tap to translate, Target + translation inline, and hidden/blurred-until-revealed. Changing mode SHALL not modify source content or reading position.

#### Scenario: Reveal translation
- **WHEN** the user taps a hidden translation for the current sentence
- **THEN** only the translation layer is revealed and the target sentence/anchor remains unchanged

### Requirement: Cache and provenance

Each translation result SHALL retain original sentence, source/profile language tags, provider/model/version, cache key/fingerprint, optional confidence, and source anchor. Equivalent requests SHALL reuse cache/in-flight work and SHALL NOT repeatedly charge a provider.

#### Scenario: Repeat sentence
- **WHEN** the same sentence is requested twice under the same profile/provider configuration
- **THEN** the second request uses the cached result and preserves the original anchor

### Requirement: Source preservation

Translations SHALL render as a derived layer and SHALL never overwrite or persistently rewrite imported EPUB/PDF/HTML/Markdown/transcript/video source text.

#### Scenario: Imported article
- **WHEN** inline translations are enabled for an article
- **THEN** reopening the article with translations off shows the original source unchanged

### Requirement: Provider neutrality and degradation

The service SHALL support local/on-device, dedicated translation, and configured AI providers behind an adapter. AI/cloud use SHALL be disclosed and optional; offline/provider failure SHALL yield typed status while target reading and cached results continue.

#### Scenario: Offline uncached sentence
- **WHEN** no local provider or cached result exists offline
- **THEN** the target sentence remains readable and the translation control reports unavailable with retry later

### Requirement: Reader integration and performance

Translation SHALL operate on sentence units from the processing/reader anchor contract, load lazily or in bounded prefetch batches, and avoid blocking document open or rerendering an entire large reader for one translation.

#### Scenario: Long EPUB
- **WHEN** inline mode is enabled for a long EPUB
- **THEN** visible/nearby sentences load progressively and the rest of the document remains responsive

### Requirement: Accessibility and platform behavior

Translation controls SHALL have accessible labels, keyboard/touch equivalents, screen-reader semantics, reduced-motion/e-ink variants, and a mobile layout that does not make text unreadable.

#### Scenario: Keyboard reveal
- **WHEN** a keyboard user focuses a hidden translation control and presses Enter
- **THEN** the translation reveals with focus and source context preserved
