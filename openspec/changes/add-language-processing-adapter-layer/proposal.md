## Why

Current selection and transcript logic assumes English-like whitespace words and provider-specific data shapes. A language-learning system needs one provider-independent contract for detection, segmentation, token identity, lemmas, morphology, scripts, and confidence while still working when a language has only exact-form tokenization.

## What Changes

- Define a versioned `LanguageProcessingAdapter` contract and capability manifest.
- Represent sentences, token spans, normalized forms, lemmas, POS, morphology, phrase candidates, scripts, transliteration, and confidence without hardcoding viewers.
- Add provider selection, local/remote fallback, caching, deterministic processing fingerprints, and incremental reprocessing.
- Add adapters/providers behind the contract and a safe exact-form fallback for unsupported languages.

## Dependencies

- Hard dependencies: none for the contract; language profiles consume the language identifiers.
- Soft dependencies: `add-language-learning-profiles` for persisted processor configuration.
- This proposal is required by the lexicon, highlighting, translation, sentence mode, coverage, and practice proposals.

## Capabilities

### New Capabilities

- `language-processing-adapters`: Provider-independent language analysis, capability negotiation, versioning, caching, fallback, and reprocessing.

### Modified Capabilities

- None; existing reader selection and transcript timing remain compatible.

## Impact

- New shared TypeScript/Rust interfaces and processing worker/service boundaries.
- SQLite processing-job/cache metadata and token/sentence serialization, not viewer-local heuristics.
- Reader, transcript, import, and search integrations will consume spans/anchors but remain usable without advanced morphology.
- Optional local libraries/models and configured cloud providers; no provider becomes mandatory for core reading.
