## Context

`DocumentViewer.tsx` builds persisted highlight projections from extracts at `persistedDocumentHighlights`. PDF renders the stored geometry, EPUB uses CFI, and HTML/Markdown use text-range adapters. Preserve these paths and their ordinary highlight behavior. Validate unsupported or stale locators before adding any markers.

## Processed passages

Use existing extract identity, document identity, selection_context and revision. Classify ordinary highlights versus processed extracts using existing persisted category/type metadata where it is unambiguous. Add a nullable kind discriminator only if existing rows cannot distinguish new writes, retaining an unknown legacy state. Classify a legacy row as processed only with positive evidence. Preserve existing highlight rendering and colors.

The source reader offers Show extracted passages, off by default and persisted as a reader preference. If exposed in Settings, add stable target, catalog, coverage and tests. Show a subtle underline or side marker with accessible name, visibly distinct from ordinary highlights. Open the chosen extract through the current viewer; when several overlap, group choices by stable extract ID. Avoid intercepting ordinary selection, TTS and touch gestures. Invalidate by document/revision and committed extract mutations. Deletion removes its marker. Match CFI/range/page to the validated quote and surrounding context. Ambiguity, stale revision, unsupported formats or absent anchor suppress the marker without moving the user's position. OCR/reflow is eligible only where the exact source offset/geometry round-trips. Use the existing Back/Return to Source actions.
