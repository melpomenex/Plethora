## Context

Browsers and Tauri WebViews lack built-in lemmatization, CJK deinflection, German compound splitting, or offline dictionaries, while bundling multi-megabyte dictionaries into Vite `dist/` would breach `scripts/bundle-budgets.json` (32 MB total dist limit).

## Goals / Non-Goals

**Goals:**
- Provide deterministic, offline-capable, zero-server local linguistic adapters for Romance (`es`, `fr`, `pt`, `it`), Germanic (`de`, `nl`), Japanese (`ja`), Chinese (`zh`), Korean (`ko`), and Arabic/RTL (`ar`, `he`, `fa`, `ur`) languages.
- Keep large dictionaries and extended wordlists as optional downloadable/importable Language Packs persisted in SQLite (`language_dictionary_entries`), never bundled in the main JS entry chunk.
- Preserve exact UTF-16 source spans, diacritics, RTL directionality, and homograph boundaries.

**Non-Goals:**
- Requiring Python, external local HTTP servers, or paid cloud LLMs for basic segmentation, deinflection, or dictionary lookup.
- Claiming full morphological analysis for languages that only have basic segmentation installed.

## Decisions

1. **Tiered local-first adapters.** Built-in lightweight rule + curated irregular-paradigm adapters load lazily per language family and upgrade seamlessly when an optional Language Pack supplies a full dictionary/frequency table.
2. **Indexed SQLite dictionary store.** Imported StarDict, Yomichan/Yomitan ZIP, JMdict/CC-CEDICT/FreeDict JSON, and TSV packs parse into `language_dictionary_entries` indexed by `(language_tag, normalized_headword)` and `(language_tag, lemma)` for fast offline lookup and cross-platform compatibility (Linux, macOS, Windows, Android, iOS).
3. **Truthful manifest updates.** Every adapter and pack exposes exact `capabilities` and `offlineAvailable` flags; unavailable capabilities fail cleanly without fabricating lemmas or definitions.

## Risks / Trade-offs

- [Rule-based lemmatizers can mis-lemmatize rare irregulars] -> Attach lower confidence to heuristic stem rules than paradigm/dictionary hits, preserve surface forms, and never merge low-confidence homographs.
- [Large JSON/ZIP imports on mobile] -> Stream/chunk inserts inside bounded SQLite transactions with cancellation support.
