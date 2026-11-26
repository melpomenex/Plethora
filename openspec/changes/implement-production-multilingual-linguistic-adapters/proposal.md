## Why

Plethora's default language processing registry (`src/lib/languageProcessing/registry.ts`) currently ships only Unicode `Intl.Segmenter` sentence/word segmentation and exact-form fallback (`baselineAdapter` and `exactFormFallbackAdapter`), while readers still use regex tokenization and `languagePeekService` rejects all non-English lookups. Learners studying Spanish, French, Portuguese, Italian, German, Dutch, Japanese, Chinese, Korean, or Arabic cannot resolve inflections to lemmas, see reading annotations (furigana, pinyin, romanization), or look up words offline.

## What Changes

- Register real local-first multilingual linguistic adapters (`romanceAdapter`, `germanicAdapter`, `japaneseAdapter`, `chineseAdapter`, `koreanAdapter`, `arabicRtlAdapter`) in `LanguageProcessingAdapterRegistry`, with honest capability manifests and confidence scoring.
- Add optional downloadable/importable Language Pack infrastructure (manifest catalog, progress/cancellation, SHA-256 integrity verification, versioning, updates, removal, storage usage, license attribution, corruption recovery) backed by SQLite `language_packs` and `language_dictionary_entries`.
- Support offline dictionary lookup from imported/installed packs (StarDict, Yomichan/Yomitan ZIP, JMdict/CC-CEDICT/FreeDict JSON/TSV), ordered ahead of online multilingual dictionary providers (Wiktionary, Jisho, `dictionaryapi.dev`) and optional AI fallback.
- Connect `LanguageProcessingRuntime` (chunked, cached, cancellable, SQLite + IndexedDB backed) to readers, transcripts, and coverage without blocking the main UI thread.

## Capabilities

### New Capabilities

- `multilingual-linguistic-adapters`: Local-first morphological analysis, lemmatization, deinflection, compound handling, script detection, and transliteration across Romance, Germanic, CJK, and RTL languages with truthful capability declarations.
- `language-packs-and-offline-dictionaries`: Downloadable/importable optional language packs and indexed offline dictionary storage with SHA-256 verification, license attribution, storage accounting, and corrupt-pack recovery.

### Modified Capabilities

- `language-processing-adapters`: Extend the default production registry beyond exact-form baseline when language-specific adapters and optional packs are available.
- `dictionary-peek`: Support offline language-pack dictionaries and multilingual online dictionaries ahead of optional AI assistance.

## Impact

- `src/lib/languageProcessing/adapters/*`, `src/lib/languageProcessing/registry.ts`, `src/lib/languagePacks/*`, `src/lib/languagePeek/*`.
- Rust migrations `158_language_packs_and_dictionaries`, `language_pack_repository.rs`, `language_processing_repository.rs`, and associated Tauri commands + browser-backend fallbacks.
- Reader/transcript DOM bridges and `DictionaryPeek.tsx`.
