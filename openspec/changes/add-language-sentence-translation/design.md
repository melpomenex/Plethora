## Context

Readers expose source text through EPUB CFI, PDF canonical/reflow anchors, HTML/Markdown offsets, and transcript segments. Translation providers vary, and existing AI passage actions stream answers but are not a deterministic sentence translation cache.

## Dependencies

- Hard: #1 profiles and #2 processing sentence boundaries/anchors.
- Soft: #3/#4 lexicon/state for context and #13 alignment for replay; #8, #14, #17, and #18 are downstream consumers.
- Freeze cache keys, provenance, and typed unavailable/stale results before those consumers implement UI.

## Goals / Non-Goals

**Goals:**

- Translate exact sentence units with source/profile/provider provenance and reusable cache entries.
- Keep source documents unchanged and translation optional.
- Make cache/provider choice explicit and avoid duplicate paid requests.

**Non-Goals:**

- Replacing generic AI explanations or building a bilingual textbook.
- Claiming translation quality/confidence the provider does not supply.

## Decisions

1. **Translation service contract.** `translateSentence({text, sourceLanguage, targetLanguage, profileId, providerPolicy})` returns text, provider/model, version, confidence/quality metadata, and source fingerprint.
2. **Cache key includes linguistic inputs.** Normalize only for identity; retain exact source text and anchor. Key by source/profile language pair, text hash, provider/model/version, and display-affecting configuration.
3. **Progressive display.** Reader surfaces show source immediately, then translation in a collapsible/inline/reveal layer. No network work on every scroll unless the mode explicitly requests it; prefetch is bounded.
4. **Provider ladder.** Local/on-device first when configured, then dedicated translation, then configured AI; no provider is mandatory for core reading. Each request discloses cloud use where applicable.
5. **Sentence identity is anchor-aware.** Text fingerprint plus source anchor handles repeated sentences; changed content invalidates cache rather than attaching a stale translation.

## Risks / Trade-offs

- [Translation costs grow with inline mode] → Default on-demand, dedupe in-flight requests, cache durably, and expose per-profile limits.
- [Sentence segmentation differs across providers] → Use processing adapter sentence IDs and preserve original boundaries.
- [Bad translation misleads learners] → Label provider/model, allow hide/refresh/report, and never overwrite source.
- [Offline unavailable] → Keep target-only reading and cached translations; show typed retry state.

## Migration Plan

1. Add service/cache/display mode with no default change to ordinary readers.
2. Add Language Mode controls and profile settings.
3. Reuse the service from Peek, Sentence Mode, transcripts/video, and tutor context.

## Open Questions

- Which local translation models can ship within desktop/Android constraints.
- Whether translations should sync by default or be regenerated from source fingerprints.
- Maximum inline translation density for e-ink.
