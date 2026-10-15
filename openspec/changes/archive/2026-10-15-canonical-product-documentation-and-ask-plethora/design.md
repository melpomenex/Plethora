# Technical Design: Canonical Product Documentation & "Ask Plethora" Contextual Help System

## Context

Plethora is a cross-platform learning operating system built on Tauri 2.0 (Rust) and React 19 (TypeScript), operating on macOS, Windows, Linux, Android, and iOS (simulator). The application integrates complex domains:
- **Multi-format document processing & incremental reading** (PDF with reflow, EPUB with CFI tracking, HTML with readability snapshots, Markdown, TXT, video transcripts, audiobooks, Kindle clippings, Arxiv, Anki `.apkg`, legacy third-party collection ZIPs).
- **Spaced repetition learning engines** (FSRS-6, Plethora Adaptive with 3D SInc matrix, Plethora Precision with Arena and Postpone engine, classic Plethora Classic/5/8/15).
- **Review & study surfaces** (Flashcard Studio, Cloze, Q&A, Image Occlusion with OCR, Language Learning dictation/shadowing/sentence mining, Hands-Free Audio Review).
- **Media & Neural TTS** (Pocket TTS in Rust desktop, Sherpa-ONNX / KittenTTS / Kokoro-82M on Android, Fal.ai voice cloning, Souvlaki OS media keys / SMTC / MPRIS, YouTube playback with transcript sync, Podcast Whisper transcription).
- **AI Learning System** (on-device Gemini Nano via ML Kit, LiteRT / EmbeddingGemma semantic memory, cloud LLM providers via OpenRouter/OpenAI/Anthropic/Ollama, Socratic tutor, Active Recall interruptions, answer assessment, NotebookLM Py AppImage integration).
- **Cross-device sync & platform features** (Yjs WebSocket relay, encrypted delta sync, browser extension Axum server, E-ink monochrome display mode, Knowledge Sphere 3D visualization, 100+ themes).

Historically, documentation existed in fragmented, outdated handbooks (`docs/USER_HANDBOOK.md`, `docs/FEATURES_IMPLEMENTED.md`) and scattered specs. Users asking "Why did this item return?", "Why isn't TTS scrolling?", or "Where is E-ink mode?" have had no authoritative, contextual in-app guidance.

This design establishes a dual architecture:
1. **Canonical Product Knowledge Base**: A code-verified, machine-readable documentation corpus (`docs/product/`) with stable hierarchical IDs, behavioral rules, platform parity matrices, failure modes, and allowlisted action references.
2. **"Ask Plethora" Contextual Help System**: A local-first, cost-conscious contextual help and explainability engine embedded into the Command Palette and UI hooks, resolving queries deterministically without LLMs whenever possible, and using minimal grounded RAG (≤1,500 doc tokens) only when natural-language synthesis is required.

---

## Goals / Non-Goals

### Goals
- **Meticulous Code-Derived Documentation**: Document every user-facing feature and behavior verified against the actual Rust and TypeScript source code.
- **Stable Machine-Readable Identifiers**: Assign stable hierarchical IDs (`domain.subdomain.feature`) decoupled from translatable UI strings.
- **Automated Validation & Coverage Gates**: Provide CI tooling (`docs-validate.mjs`, `docs-coverage.mjs`) to prevent schema violations, broken links, duplicate IDs, unregistered actions, and documentation drift.
- **Deterministic Zero-Inference Help**: Answer navigation, setting lookups, and canonical definitions instantly with zero LLM invocations and zero API cost.
- **Local-First Hybrid Retrieval**: Execute sub-50ms offline documentation retrieval via SQLite FTS5 / BM25, alias matching, metadata filtering, and on-device semantic ranking.
- **Strict Grounding & Anti-Hallucination**: Restrict generative synthesis to retrieved documentation chunks and sanitized app state; require honest rejection of undocumented functionality (`evidenceLevel: "none"`).
- **Safe Allowlisted UI Actions**: Permit help answers to surface only pre-registered, typed application action buttons (`[Open E-ink Settings]`), completely prohibiting arbitrary executable code generation.
- **Context-Aware "Why?" Explainability**: Provide structured context collection (`useHelpAppContext`) and universal explainability hooks across the Reader, Queue, Review Arena, and Settings.
- **Strict Privacy & Isolation**: Guarantee untrusted user documents and personal notes never enter the product help knowledge base or prompt stream.
- **Complete Offline Usability**: Ensure full documentation search, navigation, and direct answers operate without network connectivity or configured AI models.

### Non-Goals
- **No Chatbot Paradigm**: Do not create a separate, heavyweight multi-turn conversational window. The Command Palette remains fast, compact, and keyboard-driven.
- **No Brute-Force Manual Prompts**: Never inject the entire documentation corpus into an LLM prompt.
- **No Remote Intent Classification**: Never invoke remote LLM APIs merely to classify command palette input.
- **No Mandatory Proprietary Cloud**: Do not require a Plethora-hosted inference server; all features respect the user's configured provider (or on-device / no-LLM mode).
- **No Document Context Mixing**: Product help retrieval must not search user library documents, and library RAG must not be confused with product help.

---

## Complete Feature Inventory & Taxonomy

Based on systematic inspection of the Plethora codebase (`src/`, `src-tauri/`, `plugins/`), the active product features are categorized into 12 core domains:

```text
Plethora Product Domains
├── 1. Reading & Document Viewers (PDF, EPUB, HTML, Markdown, TXT, Video Transcripts, Audiobooks)
├── 2. Document Management & Ingestion (Local import, URL scraping, Arxiv, Anna's Archive, Anki, Plethora, Kindle clippings)
├── 3. Queue & Incremental Reading (Reading Queue, Priority scoring, Inheritance, Reappearance intervals, Neural queue)
├── 4. Scheduling & Algorithms (FSRS-6, Plethora Adaptive, Plethora Precision Arena & Postpone, Plethora Classic/5/8/15, Topic-Aware Scheduling TAS)
├── 5. Review & Learning Items (Flashcard Studio, Cloze, Q&A, Image Occlusion OCR, Audio Review Mode, Zen Mode)
├── 6. Language Learning System (Profiles, Lexicon & Coverage, Dictation, Shadowing, Sentence Mining, Dictionary Peek)
├── 7. Media, Audio & TTS (Pocket TTS, Sherpa-ONNX, Fal.ai cloning, Souvlaki OS media keys, Hands-Free Study)
├── 8. AI Learning System & Tools (On-device Gemini Nano, Task router, Ask Library RAG, Socratic Tutor, Active Recall, Assessment)
├── 9. RSS & Podcasts (Feed subscriptions, NewsBlur, Full article reader, Semantic preference learning, Podcast Whisper)
├── 10. Platform Specifics & Display Modes (Desktop Win/macOS/Linux, Android SAF/GenAI/TTS, E-ink Mode, PWA)
├── 11. Search, Navigation & Command Palette (CommandCenter, Contextual actions, URL import, Knowledge Sphere 3D)
└── 12. Settings, Appearance, Sync & Security (Themes [100+], Yjs sync, Delta logs, Browser extension, Privacy toggles)
```

### Detailed Domain Breakdown

#### Domain 1: Reading & Document Viewers
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `reader.pdf.page_mode` | PDF Page Mode Reading | Implemented | `DocumentViewer.tsx`, `PDFViewer.tsx` | Page-by-page PDF navigation, two-page spread, zoom (fit-width, fit-page, custom 25-500%). |
| `reader.pdf.scroll_mode` | PDF Scroll Mode Reading | Implemented | `PDFContinuousReader.tsx` | Continuous vertical PDF scrolling with virtualized canvas rendering and progress tracking. |
| `reader.pdf.reflow` | PDF Reflow Engine | Implemented | `src-tauri/src/commands/pdf_reflow.rs`, `PDFReflowViewer.tsx` | Converts complex multi-column PDFs into reflowable text with custom fonts, line-height, and margins. |
| `reader.epub.cfi` | EPUB CFI Position Tracking | Implemented | `EPUBViewer.tsx`, `epub_server.rs` | EPUB.js rendering, reflowable chapters, exact CFI position restoration on reopen. |
| `reader.html.article` | HTML Web Article Reader | Implemented | `HTMLViewer.tsx`, `readable-readability` | Clean readability extraction, sanitized DOM styling, gzip source snapshot retention. |
| `reader.markdown.native`| Native Markdown Reader | Implemented | `MarkdownViewer.tsx` | GitHub Flavored Markdown, KaTeX math formula rendering, code block syntax highlighting. |
| `reader.video.transcript`| Video Transcript Karaoke | Implemented | `VideoTranscriptViewer.tsx`, `youtube.rs` | Word/segment-level transcript synchronization with embedded YouTube / local video playback. |
| `reader.vim.navigation` | Vim Reading Navigation | Implemented | `vimModeStore.ts`, `useVimReading.ts` | Vim shortcuts (`j`/`k` scroll, `gg`/`G` bounds, `/` search, `f` hint navigation). |
| `reader.selection.actions`| Selection Action Controller | Implemented | `SelectionActionBar.tsx`, `overhaul-reader-selection-ux` | Anchored action bar on text selection: Highlight, Extract, Learn This, Dictionary Peek, Ask AI. |
| `reader.position.restore`| Reading Position Persistence| Implemented | `position.rs`, `usePositionPersistence.ts` | Exact scroll offset / CFI / page persistence across restarts and multi-tab switches. |

#### Domain 2: Document Management & Ingestion
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `import.local_files` | Multi-Format File Import | Implemented | `document.rs`, `plethora-folder-import` | Drag-and-drop or file picker for PDF, EPUB, MD, TXT, MP3, MP4, APKG. Recursive folder scanning. |
| `import.url_scraping` | Web URL Ingestion | Implemented | `article_capture.rs`, `useURLDetector.ts` | URL paste in Command Palette / Toolbar with live metadata preview, Defuddle/Readability extraction. |
| `import.arxiv` | ArXiv Research Paper Import | Implemented | `arxiv.ts`, `arxiv.rs` | Direct ArXiv ID/URL resolution, abstract extraction, PDF downloading, and author metadata tagging. |
| `import.kindle` | Kindle Clippings Ingestion | Implemented | `kindle_clippings.rs`, `KindleImportModal.tsx` | Parses `My Clippings.txt`, matches book titles to library documents, and creates linked extracts. |
| `import.anki_apkg` | Anki Deck Import (.apkg) | Implemented | `anki.rs`, `StudyJsonImport.tsx` | Imports SQLite Anki decks, media files, MathJax/KaTeX LaTeX syntax, and schedules. |
| `import.legacy-third-party_zip` | legacy third-party collection XML/ZIP Import | Implemented | `legacy_third_party_import.rs` | Imports Plethora collections, preserving hierarchy, extracts, and learning intervals. |
| `import.browser_ext` | Browser Extension Bridge | Implemented | `browser_sync_server.rs`, `axum` | Axum HTTP server on `localhost:9527` receiving 1-click captures from Chrome/Firefox extension. |
| `library.collection` | Document Collections | Implemented | `collectionStore.ts`, `collection_archive.rs` | Hierarchical folder collections, bulk tagging, filtering, and `.plethora-collection` archive export. |

#### Domain 3: Queue & Incremental Reading
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `queue.scroll_session` | Composed Scroll Queue | Implemented | `QueueScrollPage.tsx`, `queueScrollBudget.ts` | Continuous TikTok-style feed interleaving documents, extracts, and cards per composition sliders. |
| `queue.composition` | Queue Composition Sliders | Implemented | `settingsStore.ts` (`scrollQueue.composition`) | User-configured percentage mix between full documents, extracts, flashcards, RSS, and podcasts. |
| `queue.priority_score` | 0-100 Priority Scoring | Implemented | `priority_queue.rs`, `priority_vector.rs` | Priority weighting affecting next-item selection; 0=highest priority, 100=lowest. |
| `queue.extract_chain` | Plethora IR Extract Chain | Implemented | `extractStore.ts`, `extract_lifecycle` | Extract creation inherits parent document priority; parent returns to queue after extraction. |
| `queue.extract_lifecycle`| Extract Lifecycle Actions | Implemented | `extract_lifecycle_actions` | Extract graduation states: Keep in Queue, Dismiss (retire without deleting), Done (mastered). |
| `queue.neural_queue` | Neural Topic Queue | Implemented | `neural_queue.rs`, `algorithms/neural_queue.rs` | Semantic similarity clustering sequencing related articles and extracts sequentially. |
| `queue.reappearance` | Reappearance Interval Rules | Implemented | `queue.rs`, `incremental_scheduler.rs` | Document reappearance calculation based on rating, length, reading speed, and current queue load. |

#### Domain 4: Scheduling & Spaced Repetition Algorithms
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `scheduler.fsrs` | FSRS-6 Modern Spaced Repetition| Implemented | `fsrs = "5.2"`, `ts-fsrs`, `fsrsParameters.ts` | 19-parameter Free Spaced Repetition Scheduler with desired retention target (default 90%). |
| `scheduler.adaptive` | Plethora 18 Algorithm | Implemented | `adaptive.rs` (212KB), `adaptive_data.rs` | Full Plethora 18 engine: 3D Stability Increase (SInc) matrix, D-Factor, Retrievability calculation. |
| `scheduler.precision.arena` | Plethora Precision Algorithm Arena | Implemented | `precision/`, `ArenaChoiceRail.tsx` | Head-to-head algorithm comparisons, coach advice, and post-grade algorithm selection. |
| `scheduler.precision.postpone`| Plethora Precision Postpone Engine | Implemented | `postpone.rs`, `postpone_engine` | Algorithmic workload management postponing low-priority items while preserving stability. |
| `scheduler.scoped_params`| Scoped FSRS Overrides | Implemented | `settingsStore.ts` (`scopedFsrsOverrides`) | Per-deck and per-tag retention targets and custom FSRS weight overrides. |
| `scheduler.load_balancing`| Queue Load Management | Implemented | `queue_load_management` | Easy Days scheduling, load smoothing across weeks, and advance review batching. |

#### Domain 5: Review & Flashcards
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `review.flashcard_studio`| Flashcard Studio Editor | Implemented | `FlashcardStudio.tsx`, `cardValidator.ts` | Multi-type card creation: Basic Q/A, Cloze deletion `{{c1::answer}}`, Multiple Choice, Matching. |
| `review.image_occlusion` | OCR Image Occlusion | Implemented | `ImageOcclusionEditor.tsx`, `ai-image-occlusion`| Region editor over diagrams/charts with OCR bounding-box detection and hide-one/reveal-all modes. |
| `review.audio_review` | Hands-Free Audio Review | Implemented | `useTTS.ts`, `AudioReviewModeSettings` | TTS reads front of card, pauses for configured autoFlipDelayMs, reads back, and auto-rates. |
| `review.zen_mode` | Zen Fullscreen Review | Implemented | `ZenReviewMode.tsx`, `PresentationContext.tsx` | Minimalist distraction-free card review with source context peek on hover/shortcut. |
| `review.source_provenance`| Review Card Source Provenance | Implemented | `ReviewSourceContext.tsx`, `sourceRefs` | Collapsible "From: Document Name (Page X)" footer linking directly back to the origin text. |
| `review.undo` | Review Rating Undo | Implemented | `reviewUndoStore.ts`, `undoRedoStore.ts` | `Ctrl+Z` reverts the last card rating and restores previous scheduling parameters. |

#### Domain 6: Language Learning System
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `language.profiles` | Language Learning Profiles | Implemented | `languageProfileStore.ts`, `language_profiles.rs` | Target language profiles (A1-C2 CEFR levels, native language, study goals). |
| `language.vocabulary` | Lexical Coverage & Highlight | Implemented | `languageKnowledgeStore.ts`, `language_lexicon.rs`| Color-coded vocabulary highlighting in readers based on user's known/learning/new lemma states. |
| `language.dictionary_peek`| Dictionary Peek Card | Implemented | `DictionaryPeek.tsx`, `dictionaryPeek` flag | Auto-opening definition, IPA phonetics, audio pronunciation, and lemma examples for clicked words. |
| `language.sentence_mining`| Sentence Mining | Implemented | `SentenceModePanel.tsx`, `languageSrs.ts` | One-click extract turning sentence + audio snippet + definition into target-language cloze cards. |
| `language.shadowing` | Shadowing & Pronunciation | Implemented | `ShadowingMode.tsx`, `languagePractice.rs` | Loop-playback of native audio with microphone recording playback comparison. |

#### Domain 7: Media, Audio & Neural TTS
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `tts.playback` | Multi-Engine Text-to-Speech | Implemented | `useTTS.ts`, `pocket_tts.rs`, `fal-tts` | Desktop Pocket TTS (Rust), Android Sherpa-ONNX, Cloud Fal/Groq/OpenRouter/ElevenLabs. |
| `tts.word_highlighting` | TTS Word Highlighting | Implemented | `ReaderTTSControls.tsx`, `highlightSpokenWord`| Word-level highlighting synchronized with audio utterance playback across all document formats. |
| `tts.auto_scroll` | TTS Viewport Auto-Scroll | Implemented | `followSpokenWord`, `SafeScrollContainer.tsx`| Viewport automatically scrolls to keep active spoken sentence centered without jumping. |
| `tts.resume_position` | TTS Position Persistence | Implemented | `position.rs`, `ttsResume` | Resumes audio playback exactly at the last spoken sentence rather than document top. |
| `audio.media_controls` | OS Media Key / Headphone Sync| Implemented | `media_control.rs`, `souvlaki` | macOS Now Playing, Windows SMTC, Linux MPRIS, Android Media3 bridge for play/pause/skip. |
| `audio.hands_free_study`| Hands-Free Headphone Actions | Implemented | `HandsFreeStudySettings`, `media_control.rs` | Remaps headphone next/prev buttons to "Save Extract", "Replay Passage", or "Ask Plethora". |
| `audiobook.sync` | Audiobook EPUB Synchronization | Implemented | `AudiobookPlayer.tsx`, `audiobook-epub-sync` | Plays audiobook audio while synchronizing text highlight in parallel EPUB viewer. |

#### Domain 8: AI Learning System & Tools
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `ai.task_router` | Unified AI Task Router | Implemented | `src/lib/ai/`, `onDeviceAI.ts` | Routes fast/full/reasoning tasks across on-device Gemini Nano and cloud providers with JSON repair. |
| `ai.learn_this` | "Learn This" Card Generation | Implemented | `tasks/definitions/learnThisTask.ts` | Multi-type flashcard generation from selected text with grounded provenance and deduplication. |
| `ai.library_rag` | Grounded Ask-Library RAG | Implemented | `useAskLibrary.ts`, `tasks/libraryTask.ts` | Semantic retrieval across whole library with numbered citation refs `[N]` and untrusted containment. |
| `ai.socratic_tutor` | Socratic Tutoring Sessions | Implemented | `tutor/`, `tasks/definitions/socraticTutor.ts` | Multi-turn pedagogical tutoring with progressive hints and "just explain it" escape hatch. |
| `ai.active_recall` | Active Recall In-Reading Prompts| Implemented | `recall/`, `activeRecallMode` | Optional reading interruptions testing comprehension with free-response answer grading. |
| `ai.notebooklm` | NotebookLM Integration | Implemented | `NotebookLMPage.tsx`, `notebooklm.rs` | Py AppImage sidecar integration for Google NotebookLM source ingestion and audio overview import. |

#### Domain 9: RSS & Podcasts
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `rss.feed_reader` | Full-Text RSS Feed Reader | Implemented | `rss.rs`, `RSSReaderView.tsx`, `NewsBlur` | Atom/RSS parser, NewsBlur syncing, full article content extraction, and unread management. |
| `rss.queue_integration`| RSS in Reading Queue | Implemented | `settingsStore.ts` (`rssQueue`) | Mixes unread RSS articles into the reading queue per session percentage and max-age filters. |
| `rss.semantic_learning`| Semantic Preference Learning | Implemented | `rss_preferences.rs`, `rss-classifiers` | Trains Bayesian / vector classifiers on liked/disliked articles to recommend high-value feeds. |
| `podcast.whisper` | Podcast Search & Local Whisper | Implemented | `podcast.rs`, `podcast-whisper-transcription`| Apple Podcasts search, background MP3 download, and local Whisper speech-to-text transcription. |

#### Domain 10: Platform Specifics & Display Modes
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `platform.eink` | True E-Ink Monochrome Mode | Implemented | `EinkSettingsPanel.tsx`, `PresentationContext.tsx`| Pure monochrome styling (`data-display-mode="eink"`), zero animations, paginated tap zones. |
| `platform.mobile_android`| Android Native Integration | Implemented | `tauri-plugin-os`, `plethora-android-*` | Storage Access Framework (SAF) folder import, ML Kit GenAI (Gemini Nano), Sherpa-ONNX TTS. |
| `platform.desktop_native`| Desktop Window & Tray | Implemented | `tray.rs`, `tauri-plugin-window-state` | Window size/position restoration, system tray icon with quick-study shortcuts, multi-window split. |
| `platform.battery_saver` | Battery & Thermal Optimization | Implemented | `battery.rs`, `battery_optimization` | Throttles background indexing and disables canvas animations when on battery power or high thermal state. |

#### Domain 11: Search, Navigation & Command Palette
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `palette.command_center`| Global CommandCenter | Implemented | `CommandCenter.tsx`, `GlobalSearch.tsx` | `Cmd/Ctrl+K` unified palette for navigation, commands, content search, and URL imports. |
| `palette.contextual_actions`| Per-View Contextual Actions | Implemented | `contextualActions.ts`, `paletteActionEvents.ts`| Dynamic action sets matching active tab (e.g. PDF zoom/paging, RSS mark read, Podcast skip). |
| `graph.knowledge_sphere`| 3D Knowledge Sphere | Implemented | `KnowledgeSpherePage.tsx`, `three.js` | Interactive 3D WebGL graph visualising document connections, tags, and semantic similarities. |

#### Domain 12: Settings, Appearance, Sync & Security
| Stable ID | Feature Name | Status | Key Source Files | User Behavior & Rules |
| :--- | :--- | :--- | :--- | :--- |
| `settings.themes` | 100+ Themes & Custom Font | Implemented | `ThemeContext.tsx`, `index.css` (78KB) | 26 modern themes, 121 legacy palettes, 65 bundled font packages, custom primary color picker. |
| `sync.yjs_cloud` | End-to-End Encrypted Sync | Implemented | `cloud_sync.rs`, `browser_sync_server.rs` | Yjs CRDT real-time sync with AES-GCM encryption over WebSocket (`sync.readsync.org`) or local relay. |
| `security.privacy_toggle`| AI Paid Billing Safety Gate | Implemented | `aiBillingConsent.ts`, `paidConsent/` | Explicit user opt-in required before making any billable API call (`paidTtsEnabled`, `paidEmbeddingsEnabled`). |

---

## Canonical Documentation Schema & Structure

All canonical product documentation lives under `docs/product/` with the following structure:

```text
docs/product/
├── schema.json                 # JSON Schema defining frontmatter and required sections
├── index.yaml                  # Master feature taxonomy and hierarchy index
├── features/
│   ├── reading/
│   │   ├── pdf-page-mode.md
│   │   ├── pdf-reflow.md
│   │   ├── epub-reader.md
│   │   ├── html-reader.md
│   │   ├── markdown-reader.md
│   │   ├── video-transcripts.md
│   │   ├── vim-navigation.md
│   │   └── selection-actions.md
│   ├── queue/
│   │   ├── scroll-queue.md
│   │   ├── composition-sliders.md
│   │   ├── priority-system.md
│   │   ├── extract-chains.md
│   │   ├── extract-lifecycle.md
│   │   ├── neural-queue.md
│   │   └── reappearance-rules.md
│   ├── scheduling/
│   │   ├── fsrs-algorithm.md
│   │   ├── adaptive-algorithm.md
│   │   ├── precision-arena.md
│   │   ├── precision-postpone.md
│   │   ├── scoped-parameters.md
│   │   └── queue-load-management.md
│   ├── review/
│   │   ├── flashcard-studio.md
│   │   ├── cloze-cards.md
│   │   ├── image-occlusion.md
│   │   ├── audio-review-mode.md
│   │   ├── zen-mode.md
│   │   └── source-provenance.md
│   ├── language/
│   │   ├── learning-profiles.md
│   │   ├── lexical-coverage.md
│   │   ├── dictionary-peek.md
│   │   ├── sentence-mining.md
│   │   └── shadowing-mode.md
│   ├── tts/
│   │   ├── playback-engines.md
│   │   ├── word-highlighting.md
│   │   ├── auto-scroll.md
│   │   ├── resume-position.md
│   │   ├── media-controls.md
│   │   └── hands-free-study.md
│   ├── ai/
│   │   ├── task-router.md
│   │   ├── learn-this.md
│   │   ├── ask-library-rag.md
│   │   ├── socratic-tutor.md
│   │   ├── active-recall.md
│   │   └── notebooklm-integration.md
│   ├── media/
│   │   ├── rss-reader.md
│   │   ├── podcast-whisper.md
│   │   └── audiobook-sync.md
│   ├── platform/
│   │   ├── eink-mode.md
│   │   ├── android-capabilities.md
│   │   ├── desktop-native.md
│   │   └── battery-optimization.md
│   ├── search/
│   │   ├── command-center.md
│   │   ├── contextual-actions.md
│   │   └── knowledge-sphere.md
│   └── settings/
│       ├── themes-appearance.md
│       ├── encrypted-sync.md
│       └── billing-safety.md
├── concepts/                   # Deep algorithmic/conceptual explanations
│   ├── incremental-reading.md
│   ├── spaced-repetition-math.md
│   └── topic-aware-scheduling.md
└── troubleshooting/            # Problem-oriented recovery recipes
    ├── tts-not-scrolling.md
    ├── queue-item-reappearing.md
    └── eink-ghosting.md
```

### Frontmatter Schema (Zod / JSON Schema)

```yaml
id: tts.word_highlighting
title: TTS Word Highlighting
domain: tts
status: implemented # implemented | partial | experimental | deprecated | planned
platforms:
  - desktop-macos
  - desktop-windows
  - desktop-linux
  - mobile-android
  - mobile-ios
summary: Synchronizes real-time text highlight with spoken audio words across PDF, EPUB, HTML, and Markdown readers.
how_to: Open any document, click the TTS Play button in the reader header or press Alt+P. Highlighting follows active speech automatically.
why: Word-level highlighting creates dual-coding cognitive reinforcement, maintaining visual focus and preventing eye fatigue during high-speed listening.
aliases:
  - audio karaoke
  - read aloud highlight
  - follow speech
  - spoken word tracking
settings:
  - tts.highlightSpokenWord
  - tts.followSpokenWord
actions:
  - id: settings.tts.highlighting
    label: Open TTS Settings
    shortcut: "Alt+,"
related:
  - tts.playback
  - tts.auto_scroll
  - tts.resume_position
  - reader.epub.cfi
version_added: "1.2.0"
last_verified_commit: "HEAD"
```

### Mandatory Markdown Sections Template

Every document MUST follow this standard structure:
```markdown
# [Feature Title]

## Purpose
[Why the feature exists and what problem it solves.]

## User-Facing Behavior
[Exactly what the user sees, clicks, and experiences.]

## Entry Points
- UI Button: [Location]
- Keyboard Shortcut: [Key combo]
- Command Palette: [Keywords]
- Context Menu: [Trigger condition]

## Exact Behavioral Rules
1. [State transition 1]
2. [State transition 2]
3. [Algorithmic rule]

## Rationale
[Why Plethora behaves this way; answers user "Why?" questions.]

## Settings & Defaults
| Setting Key | Default Value | Description |
| :--- | :--- | :--- |
| `tts.highlightSpokenWord` | `true` | Toggles visual word highlighting. |

## Platform Behavior
- **Desktop (macOS/Win/Linux)**: [Behavior]
- **Android**: [Behavior / limitations]
- **E-ink**: [Rendering adjustments]

## Interactions & Dependencies
- Depends on: [`tts.playback`](file:///docs/product/features/tts/playback-engines.md)
- Interacts with: [`tts.auto_scroll`](file:///docs/product/features/tts/auto-scroll.md)

## Persistence & State Lifecycle
- **Survives restarts**: Yes, persisted in SQLite `position` table.
- **Sync behavior**: Position is synced across devices via delta log.

## Edge Cases & Limitations
- [Known limitation 1]
- [Edge case 2]

## Failure Modes & Troubleshooting
- **Symptom**: Word highlight does not advance.
  - **Cause**: TTS engine returned audio without word timestamps (e.g. legacy proxy).
  - **Resolution**: Switch to Pocket TTS or Sherpa-ONNX in Settings → TTS.

## Safe Actions
- `settings.tts.highlighting`: Navigates to TTS Settings panel.
```

---

## Tooling & CI Verification Architecture

To prevent documentation drift and eliminate hallucination, two automated tools run during `npm run build:check` and CI:

### 1. `scripts/docs-validate.mjs`
Validates:
- **YAML Frontmatter Schema**: All required fields present and typed.
- **Duplicate ID Detection**: Fails if any two files declare the same `id`.
- **Broken Reference Checking**: Verifies every entry in `related` and internal markdown links `[Title](file:///docs/product/...)` resolves to an existing file.
- **Action Allowlist Integrity**: Verifies every declared `action.id` exists in the TypeScript `RegisteredHelpActionId` union.
- **Platform Matrix Validation**: Validates platforms match allowed target enums.

### 2. `scripts/docs-coverage.mjs`
Performs static analysis comparing:
- Rust Tauri commands in `src-tauri/src/commands/`
- TypeScript Zustand stores in `src/stores/`
- Command Palette actions in `src/commandPalette/contextualActions.ts`
- Routes in `src/routes/`

Outputs coverage statistics:
```text
========================================
PLETHORA DOCUMENTATION COVERAGE REPORT
========================================
Total User-Facing Features Inventoried: 218
Documented in docs/product/:            218 (100%)
Code-Verified against HEAD:             218 (100%)
Schema Validation Errors:                 0
Broken Cross-References:                  0
Unregistered Actions:                     0
Coverage Gate:                          PASSED (100% >= 95% threshold)
========================================
```

---

## "Ask Plethora" Architecture: Intent Classification & Retrieval

```text
User Input in Command Palette (Cmd+K)
                   │
                   ▼
┌────────────────────────────────────────────────────────┐
│     Deterministic Local Intent Classifier              │
│     (Regex, Exact Aliases, Prefix Heuristics)           │
└────────────────────────────────────────────────────────┘
                   │
   ┌───────────────┼────────────────────────┬──────────────────────┐
   │               │                        │                      │
   ▼               ▼                        ▼                      ▼
[Explicit ? Prefix] [Navigation Query]   [Canonical Lookup]   [Complex Help Query]
   │               │                        │                      │
   │               ▼                        │                      │
   │        Execute Action / Route          │                      │
   │        (Zero LLM, Instant)             ▼                      │
   │                                  [Exact Summary & Link]       │
   │                                  (Zero LLM, <5ms)             │
   │                                                               │
   └─────────────────────────┬─────────────────────────────────────┘
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│             Local-First Hybrid Help Retrieval Engine             │
│  1. SQLite FTS5 / BM25 Index over docs/product/                  │
│  2. Alias & Keyword Matcher                                      │
│  3. Semantic Cosine Re-rank (LiteRT / Local Embedding)           │
│  4. Contextual App State Boosting (View, Format, TTS, Algorithm)  │
│  5. Bounded Token Budgeting (k ≤ 5 chunks, ≤1,500 doc tokens)    │
└──────────────────────────────────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                 │
     [Confidence ≥ 0.92]             [Synthesis Required]
            │                                 │
            ▼                                 ▼
   Show Direct How-To Card            ┌────────────────────────────┐
   & Action Button                    │  askPlethoraTask (Lib AI)  │
   (Zero LLM, Zero Cost)              │  - Untrusted Containment   │
                                      │  - Active Provider Routing │
                                      │  - Schema Validation       │
                                      │  - Verified Citations      │
                                      │  - Allowlisted UI Actions  │
                                      └────────────────────────────┘
                                                     │
                                                     ▼
                                      Render Grounded Response Card
                                      with Citation Badges & Actions
```

### Deterministic Intent Decision Tree

```typescript
export type UserHelpIntent =
  | { kind: "navigation"; actionId: string; targetPath: string }
  | { kind: "direct_lookup"; featureId: string; summary: string; actionId?: string }
  | { kind: "product_help"; query: string; forcedPrefix: boolean }
  | { kind: "document_content"; query: string };

export function classifyPaletteInput(
  rawInput: string,
  context: HelpAppContext
): UserHelpIntent {
  const query = rawInput.trim();

  // 1. Explicit ? or /help prefix forces Product Help
  if (query.startsWith("?") || query.toLowerCase().startsWith("/help ")) {
    const cleanQuery = query.replace(/^(\?|\/help\s+)/i, "").trim();
    return { kind: "product_help", query: cleanQuery, forcedPrefix: true };
  }

  // 2. Exact match against App Section Navigation (Dashboard, Queue, Documents, Settings)
  const sectionMatch = findMatchingSections(query);
  if (sectionMatch.length > 0 && sectionMatch[0].score >= 0.95) {
    return {
      kind: "navigation",
      actionId: `nav.${sectionMatch[0].section.id}`,
      targetPath: sectionMatch[0].section.path,
    };
  }

  // 3. Exact match against Canonical Feature Aliases ("e-ink mode", "tts speed", "precision")
  const aliasMatch = findDirectAliasMatch(query);
  if (aliasMatch && aliasMatch.confidence >= 0.95) {
    return {
      kind: "direct_lookup",
      featureId: aliasMatch.feature.id,
      summary: aliasMatch.feature.summary,
      actionId: aliasMatch.feature.actions?.[0]?.id,
    };
  }

  // 4. Natural language question patterns ("how do i", "why is", "can plethora", "where is")
  if (isHelpQuestionPattern(query)) {
    return { kind: "product_help", query, forcedPrefix: false };
  }

  // 5. Default: Standard Command / Content Search
  return { kind: "document_content", query };
}
```

---

## Contextual Application State Adapter (`useHelpAppContext`)

To enable contextual inquiries like "Why isn't this scrolling?" without requiring the user to type a lengthy prompt, the help system collects a minimal, privacy-sanitized application context:

```typescript
export interface HelpAppContext {
  activeView: "queue" | "document-viewer" | "review" | "rss" | "podcast" | "audiobook" | "settings" | "analytics";
  documentFormat?: "pdf" | "epub" | "html" | "markdown" | "video" | "audio";
  platform: "desktop-macos" | "desktop-windows" | "desktop-linux" | "mobile-android" | "mobile-ios";
  ttsActive: boolean;
  ttsProvider?: string;
  activeAlgorithm: "fsrs" | "adaptive" | "precision" | "m1";
  einkActive: boolean;
  activeSettingsTab?: string;
}
```

### Contextual Boosting Multiplier

During local retrieval, chunks that match active application state receive a multiplicative relevance boost:

$$\text{FinalScore}(c) = \text{BaseScore}(c) \times \prod_{d \in \text{Dimensions}} \text{Boost}(c, d)$$

Where:
- **View Boost**: $\times 1.4$ if chunk's domain matches `activeView` (e.g. `reading/` when in `document-viewer`).
- **Format Boost**: $\times 1.3$ if chunk references `documentFormat` (e.g. `epub` when reading an EPUB).
- **TTS State Boost**: $\times 1.5$ for `tts.auto_scroll` and `tts.word_highlighting` if `ttsActive === true`.
- **Algorithm Boost**: $\times 1.4$ for the active algorithm (`fsrs`, `adaptive`, `precision`).
- **Platform Boost**: $\times 1.3$ if chunk matches running OS (`mobile-android`, `eink`).

---

## Grounded Synthesis Task: `askPlethoraTask`

When a query requires natural language synthesis, it executes the `askPlethoraTask` in `src/lib/ai/tasks/definitions/askPlethoraTask.ts`.

### Strict System Prompt

```text
You are the built-in Plethora Product Assistant.
Your sole purpose is to explain how Plethora works, how to use its features, and why it behaves in specific ways.

RULES:
1. Answer using ONLY the supplied <untrusted_doc_chunk> blocks and allowed application state.
2. If the supplied documentation does not contain enough information to answer completely and accurately, state honestly: "The current Plethora documentation does not contain enough information to answer this question." Set evidenceLevel to "none".
3. NEVER hallucinate features, settings, shortcuts, algorithms, or behaviors not present in the provided chunks.
4. Keep answers concise, clear, and focused on user action.
5. Cite every claim using [N] markers corresponding to the supplied chunk numbers. Every citation number MUST map to a chunk id in sourceRefs with a verbatim quote.
6. If the documentation describes a safe action that helps the user, include its exact registered actionId in suggestedActions. NEVER invent new action IDs.
7. Return output strictly matching the JSON schema.
```

### JSON Schema (`askPlethoraAnswer.ts`)

```typescript
export interface AskPlethoraAnswer {
  answerText: string;
  evidenceLevel: "supported" | "weak" | "none" | "conflicting";
  sourceRefs: Array<{
    refId: string;        // Stable feature ID or chunk ID
    title: string;        // e.g. "TTS › Auto-Scroll"
    quote: string;        // Verbatim supporting sentence
  }>;
  suggestedActions: Array<{
    actionId: string;     // Allowlisted action ID, e.g. "settings.appearance.eink"
    label: string;        // Button label, e.g. "Open E-ink Settings"
  }>;
}
```

---

## Allowlisted Safe Interactive Actions

The LLM is strictly prohibited from executing arbitrary code or inventing commands. Action dispatching is gated by an application-owned allowlist in `src/features/help/registeredHelpActions.ts`:

```typescript
export const REGISTERED_HELP_ACTIONS = {
  "settings.appearance.eink": () => dispatchNavigation("/settings?tab=appearance&panel=eink"),
  "settings.learning.algorithm": () => dispatchNavigation("/settings?tab=learning&focus=algorithm"),
  "settings.tts.general": () => dispatchNavigation("/settings?tab=tts"),
  "settings.audio.hands_free": () => dispatchNavigation("/settings?tab=hands-free"),
  "action.reader.toggle_reflow": () => window.dispatchEvent(new CustomEvent("palette-action", { detail: { id: "doc.toggleReflow" } })),
  "action.reader.toggle_tts": () => window.dispatchEvent(new CustomEvent("toggle-tts")),
  "action.queue.open_composition": () => dispatchNavigation("/settings?tab=scroll-queue"),
} as const;

export type RegisteredHelpActionId = keyof typeof REGISTERED_HELP_ACTIONS;
```

---

## Contextual Explainability Hooks ("Why?")

Universal explainability triggers are embedded across the interface:

```text
┌────────────────────────────────────────────────────────┐
│ Reading Queue Item Details Popover                     │
├────────────────────────────────────────────────────────┤
│ Title: Deep Learning Optimization                      │
│ Format: PDF (Page 42)                                  │
│ Next Due: Today (Interval: 14 days)                    │
│ Priority: 18 / 100                                     │
├────────────────────────────────────────────────────────┤
│ [? Why am I seeing this item today?]                   │
│   → Triggers explainability query:                     │
│     item = { stability: 14.2, reps: 3, algorithm: precision }│
│     Returns grounded mathematical/policy explanation   │
└────────────────────────────────────────────────────────┘
```

---

## Response Caching & Invalidation Strategy

To prevent redundant API costs and speed up repeated lookups, help responses are cached in IndexedDB:

```text
Cache Key = SHA-256(
  appVersion + ":" +
  docCorpusHash + ":" +
  normalizedQuery + ":" +
  relevantAppStateHash + ":" +
  modelId
)
```

- **Invalidation**: Any change to `docs/product/` updates the build `docCorpusHash`, instantly invalidating all cached responses on update.
- **TTL**: 30 days default; cleared on manual "Clear Cache" in Settings.

---

## Performance Budgets & Acceptance Criteria

| Metric | Target / Gate | Enforcement Mechanism |
| :--- | :--- | :--- |
| Local Help Search Latency | < 50 ms | Vitest benchmark (`helpRetrieval.bench.ts`) |
| Direct Lookup Latency | < 5 ms | Synchronous memory map lookup |
| Max Prompt Context Tokens | ≤ 1,500 tokens | Token estimation truncation (`askPlethoraTask.ts`) |
| LLM Invocations for Lookups | 0 calls | Intent classification unit test suite |
| Pre-Indexed Help DB Size | < 3.0 MB | Bundle budget gate (`check-bundle-budget.mjs`) |
| Documentation Coverage | 100% active features | `scripts/docs-coverage.mjs` in CI |
| Broken Link / ID Collision | 0 errors | `scripts/docs-validate.mjs` in CI |

---

## Evaluation Benchmark Suite

A dedicated regression test suite (`src/features/help/__tests__/retrievalQuality.test.ts`) verifies 40+ canonical queries across diverse categories:

1. **Exact Feature Lookups**: "Where is TTS speed?", "How to turn on E-ink mode?" (Must resolve zero-LLM with action button).
2. **Colloquial Synonyms**: "AirPods buttons", "read aloud follow along", "reappearing articles" (Must retrieve correct feature IDs).
3. **Contextual Vague Questions**: "Why isn't this scrolling?" (With `ttsActive=true`, must rank `tts.auto_scroll` #1).
4. **"Why" Inquiries**: "Why did my queue item come back?", "Why is Plethora Adaptive interval shorter?" (Must cite `## Rationale`).
5. **Non-Existent Features**: "Can Plethora sync via Bluetooth with Plethora 19?" (Must return `evidenceLevel: "none"` without hallucination).
6. **Multi-Feature Interaction**: "How does E-ink mode affect TTS auto-scrolling?" (Must retrieve both `platform.eink` and `tts.auto_scroll`).
