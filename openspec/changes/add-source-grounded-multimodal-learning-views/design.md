# Design: Add Source-Grounded Multimodal Learning Views

## Architecture

- **Mind Map (`StudyMindMapView.tsx`)**: Projects bounded concept nodes/edges from `study-mode-mind-map` task + existing `concepts`/`concept_links` + `ConceptMasterySummary` (`unknown` / `needs-attention` / `developing` / `demonstrated-consistently`). Promotion to personal KG uses explicit `propose_link_validated`.
- **Timelines & Diagrams (`StudyTimelineDiagramView.tsx`)**: Deterministic SVG renderer for `TimelineArtifact` (events, dates/order, source anchors, ordering check) and `StructuredDiagramArtifact` (nodes, typed edges, causal/process flow). Rejects unsafe markup.
- **Audio Lessons (`StudyAudioLessonView.tsx`)**: Generates & verifies `AudioLessonScript` (`study-mode-audio-script` task) first, then synthesizes via existing `generateSpeech` / `useTTS` / `audioPlaybackStore` role voices (`extractVoiceId` / `promptVoiceId`), preserving cache limits and keeping audio completion separate from mastery.
- **Narrated Slides (`StudySlidesView.tsx`)**: Generates & verifies `NarratedSlideDeck` (`study-mode-slides` task) on demand; renders native accessible slides with keyboard navigation (`ArrowLeft`/`ArrowRight`), optional TTS narration via `useTTS`, and source jumps.
