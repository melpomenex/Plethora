## 0. Dependency gates

No hard implementation dependency. Coordinate the language-tag, source-span, capability-manifest, provider-version, and stale-result contracts with #1 before completing the reference runtime; #3 and later changes must consume these interfaces rather than create local analyzers.

## 1. Contract and reference types

- [x] 1.1 Define language tags, capability manifests, analysis versions, confidence, sentence/token/phrase spans, morphology, script, and provider error types.
- [x] 1.2 Implement Unicode-safe offset/normalization utilities with fixtures for Latin, CJK, RTL, combining marks, punctuation, and mixed scripts.
- [x] 1.3 Define deterministic content/configuration fingerprints and stale-result semantics.

## 2. Provider runtime

- [x] 2.1 Add adapter registry and selection policy for local, bundled, configured cloud, and exact-form fallback providers.
- [x] 2.2 Add background chunk/job execution with cancellation, retries, checkpoints, progress, and bounded result paging.
- [x] 2.3 Add durable cache/result tables and migration/cleanup paths that do not put token streams in localStorage.

## 3. Initial adapters and consumers

- [x] 3.1 Implement a deterministic baseline adapter using available platform/library capabilities and a truthful unsupported-language fallback.
- [x] 3.2 Add provider capability diagnostics and privacy/credential disclosure.
- [x] 3.3 Add integration contracts for profiles, readers, transcripts, search, and future lexicon consumers without hardcoding analysis in viewers.

## 4. Tests and performance

- [x] 4.1 Unit-test normalization, spans, IDs, capabilities, version invalidation, retries, and provider failure states.
- [x] 4.2 Integration-test large-document chunking, cancellation/resume, EPUB/PDF/text/transcript anchors, and offline fallback.
- [x] 4.3 Add deterministic benchmarks for tokenization/index lookup and enforce the repository performance gate for intentional changes.
