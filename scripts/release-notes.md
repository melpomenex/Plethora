### Added

- **Customizable dashboard** — configure a personal widget layout and quick actions, with focus timer, streak goals, queue, pinned documents, saved queues, and scratchpad widgets.
- **Sleep and health export imports** — import Apple Health, Garmin, Oura, WHOOP, Google/Fitbit, Samsung Health, Withings, RingConn, Polar, Plethora JSON, and mapped CSV exports or supported archives. Imports include provider detection, preview, progress and cancellation, provenance, safe reimport/reconciliation, and optional watched folders; aggregate-only sleep stages remain aggregate data and new records flow into sleep and learning insights.
- **Language Learning workspace** — discover the new guided workspace with onboarding, vocabulary management, assessments, content recommendations, language packs, practice, and analytics; surfaces use shared theme tokens and support six languages.
- **Language practice in readers and media** — add multilingual adapters, dictionary Peek and lookup history, translation, reading assistance, sentence-aligned original-audio replay, and practice entry points across supported readers, queues, transcripts, and video. Preserve original-media ranges when sending language material to flashcard creation and practice.
- **Learner-aware tutoring and speaking** — personalize tutor guidance from learner context, add capability-gated voice conversations, and manage durable tutor sessions with resume, delete, clear, and export actions.
- **Language-linked study plans** — optionally connect a language profile to a study plan and generate evidence-based gap recommendations.
- **Library and review workflows** — search extracts across libraries, manage saved views with delete and undo plus cross-tab sync, and pin or highlight source context in review before creating an extract.
- **Smarter RSS curation** — add local Laya decision controls and token-aware multi-passage classification for Smart Feeds.
- **Podcast ad skipping** — detect ad intervals and skip them during playback.
- **Scroll-mode editing and navigation** — insert images into extracts and configure horizontal-wheel page navigation.
- **Progressive transcript rendering** — render long transcripts incrementally so large media sessions remain responsive.

### Fixed & Improved

- **Review and scheduling consistency** — synchronize scheduled-review state and undo across review modes; preserve scroll-mode ratings, bulk deletion, and tags; persist interval modifiers and item identity; and validate language-source provenance when saving.
- **Saved views and PDF highlights** — repair saved-view handling and align PDF highlights with the correct source text; keep saved-view updates synchronized across tabs.
- **Import, indexing, and model diagnostics** — persist EPUB import paths, harden AI indexing, stabilize curriculum preflight and Mirage Vision FFI probing, and explain missing or unpulled embedding models with an Ollama warning.
- **Reading and assistant rendering** — unify rich-text list indentation and fix assistant math rendering.
- **Language privacy and playback** — require consent before cloud speech recognition and improve subtitle controls and replay reliability.
- **Command-palette actions** — keep Study Plan selection actions unique and in a stable order; include the Language Learning destination.
- **Startup and build reliability** — use one lazy-view cache with bounded boot prefetch, share the Cargo job policy in Tauri development builds, and provision the macOS Cactus library with the required loading entitlement.
- **Benchmark stability** — fold startup-timeline benchmark results into a scalar sink so repeated measurements do not grow an allocation array or incur avoidable garbage-collection noise.
- **Android wearable-import builds** — compile the local folder picker only for desktop targets while retaining the explicit unsupported response on Android and iOS.
