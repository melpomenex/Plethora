## ADDED Requirements

### Requirement: Local-first multilingual linguistic analysis
`LanguageProcessingAdapterRegistry` SHALL provide registered local adapters for Romance (`es`, `fr`, `pt`, `it`), Germanic (`de`, `nl`), Japanese (`ja`), Chinese (`zh`), Korean (`ko`), and Arabic/RTL (`ar`, `he`, `fa`, `ur`) languages that resolve supported inflections/conjugations to lemmas, preserve exact surface spans, and report truthful capability manifests and confidence scores.

#### Scenario: Spanish and German inflection resolution
- **WHEN** the Romance or Germanic adapter analyzes `hablo`, `habló`, `hablando` (`es`) or `spreche`, `sprach`, `gesprochen` (`de`)
- **THEN** it resolves them to lemmas `hablar` and `sprechen` respectively with morphological metadata while preserving exact surface offsets

#### Scenario: CJK and RTL tokenization and reading extraction
- **WHEN** the Japanese, Chinese, Korean, or Arabic adapter analyzes unspaced CJK text or diacritized Arabic text
- **THEN** it segments words without relying on ASCII whitespace, preserves UTF-16 offsets and RTL directionality, and never merges unrelated homographs

### Requirement: Optional Language Packs and offline dictionary lookup
The system SHALL manage optional Language Packs with discovery, progress/cancellation, SHA-256 integrity verification, versioning, removal, storage usage, license attribution, and corrupt-pack recovery, and `LanguagePeekService` SHALL query installed offline pack dictionaries before online or AI providers.

#### Scenario: Offline lookup via installed Language Pack
- **WHEN** a user has installed a Spanish or Japanese Language Pack and looks up a word while offline
- **THEN** `LanguagePeekService` returns the pack's local definition, reading, and attribution without network access
