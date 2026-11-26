## 1. Linguistic Adapters & Runtime Persistence

- [x] 1.1 Lazy-loaded multilingual adapters implemented in `src/lib/languageProcessing/adapters/` (`romanceAdapter`, `germanicAdapter`, `japaneseAdapter`, `chineseAdapter`, `koreanAdapter`, `arabicRtlAdapter`) and registered in `LanguageProcessingAdapterRegistry` (`registry.ts`); capabilities are truthful and honor AbortSignal cancellation.
- [x] 1.2 Migration `092_language_processing_results` (jobs/results/chunks/tokens tables) in `src-tauri/src/database/migrations.rs`; `LanguageProcessingRuntime` persists via `SqliteLanguageProcessingStore` (Tauri, `get/put_language_processing_*` commands) and `IndexedDbLanguageProcessingStore` (web/PWA), with `MemoryLanguageProcessingStore` fallback for tests/offline.

## 2. Language Packs & Offline Dictionaries

- [x] 2.1 Migration `158_language_packs_and_dictionaries` (`language_packs`, `language_dictionary_entries`) in `migrations.rs`; `language_packs_repository.rs` + Tauri commands (`list_language_packs`, `install_language_pack_with_entries`, `lookup_language_pack_dictionary`, `verify_language_pack`, `remove_language_pack`) with SHA-256 verification, streaming atomic commit, corruption recovery, and storage/attribution accounting.
- [x] 2.2 `src/lib/languagePacks/` implements the catalog (`LANGUAGE_PACK_CATALOG`, `filterCatalogPacks`, `getStarterPackEntries`), `manager.ts` (download with progress, SHA-256 via WebCrypto + pure-TS fallback, cancel via AbortSignal, update/remove, storage accounting), and `parsers.ts` for StarDict (ifo/idx/dict + XDXF), Yomichan/Yomitan ZIP, Kaikki/Wiktionary JSONL, JSON, and TSV.
- [x] 2.3 `LanguagePeekService` (`src/lib/languagePeek/`) extended with `offlinePackDictionaryProvider` (ordered Language Pack dictionary), `jishoDictionaryProvider`, `wiktionaryMultilingualProvider`, and `aiDictionaryFallbackProvider`, composed in `createDefaultLanguagePeekProviders`.

## 3. Verification

- [x] 3.1 `multilingualAdapters.test.ts` covers Spanish/French/Portuguese/Italian, German/Dutch, Japanese, Chinese (simplified/traditional), Korean (Hangul Jamo), and Arabic RTL — tokenization, lemmatization/deinflection, reading annotations, and metadata; `contracts.test.ts`/`fingerprints.test.ts` cover UTF-16 source spans and fingerprints.
- [x] 3.2 `packs.test.ts` covers exact SHA-256 digests/byte sizes for embedded packs, streaming download verification, checksum mismatch rejection before commit, clean cancellation without partial entries, corrupt-pack detection/repair, and license attribution; `npm run check:bundle` passes.
