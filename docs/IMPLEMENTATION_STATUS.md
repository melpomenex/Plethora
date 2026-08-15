# Implementation Status

Current progress and end-to-end implementation coverage for Incrementum.

> **Version:** 1.79.0 · **Last updated:** July 2026
> This document reflects the live codebase. For a per-feature checklist, see [FEATURES_IMPLEMENTED.md](./FEATURES_IMPLEMENTED.md); for architecture and internals, see [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md).

---

## Table of Contents

1. [Project Status at a Glance](#project-status-at-a-glance)
2. [Platform & Build Support](#platform--build-support)
3. [Codebase Scale](#codebase-scale)
4. [Backend (Rust / Tauri)](#backend-rust--tauri)
5. [Frontend (React + TypeScript)](#frontend-react--typescript)
6. [Learning & Spaced Repetition](#learning--spaced-repetition)
7. [Document Processing & Readers](#document-processing--readers)
8. [AI, OCR & Transcription](#ai-ocr--transcription)
9. [Sync, Integrations & Cloud](#sync-integrations--cloud)
10. [Mobile & PWA](#mobile--pwa)
11. [Recent Major Work](#recent-major-work)
12. [Known Gaps & Roadmap](#known-gaps--roadmap)

---

## Project Status at a Glance

Incrementum is a **production-grade, cross-platform incremental-reading and spaced-repetition application**. It is built with Tauri 2.0, React 19, and Rust, and ships on desktop (Windows, macOS, Linux), Android, and iOS (simulator).

| Area | Status |
|------|--------|
| Core incremental reading (extract → review) | ✅ Complete |
| Spaced repetition (FSRS-6, SM-2/5/8/15, SM-18, SM-20) | ✅ Complete |
| PDF / EPUB / Markdown / HTML / TXT readers | ✅ Complete |
| Video / Audiobook / YouTube / Podcast learning | ✅ Complete |
| AI assistant, RAG, flashcard generation, MCP | ✅ Complete |
| OCR (6 providers) & transcription (local + cloud) | ✅ Complete |
| Themes (100+), i18n (6 locales), keyboard-first UX | ✅ Complete |
| Cross-device sync (Yjs relay + cloud providers) | ✅ Complete |
| Desktop builds (Win/macOS/Linux) | ✅ Shipping |
| Android build & APK install | ✅ Shipping |
| iOS (simulator build/dev) | 🚧 In progress |
| AnkiConnect live sync | 🚧 Planned |

---

## Platform & Build Support

Incrementum uses per-platform Tauri configuration overrides to ship native bundles:

- **Windows** — NSIS + MSI installers (per-platform sidecar DLLs)
- **macOS** — `.app` and `.dmg` bundles (self-signed; see README for Gatekeeper steps)
- **Linux** — `.deb`, `.rpm`, and AppImage (WebKitGTK)
- **Android** — ARM64 APK via `tauri android build` (active; dedicated build skill and `download_update_apk` self-update path)
- **iOS** — Apple Silicon simulator build/dev via `tauri ios` (scaffolding initialized)

Per-platform bundle configs (`tauri.{windows,macos,linux,android,ios}.conf.json`) scope native libraries so each bundle only ships what it needs. Desktop-only sidecars (`whisper`, `sherpa-onnx`) are disabled on Android/iOS via the mobile config overrides.

---

## Codebase Scale

| Metric | Count |
|--------|-------|
| Rust source files (`src-tauri/src`) | 170 |
| Rust lines of code | ~101,000 |
| TypeScript/TSX source files (`src`) | 969 |
| TypeScript/TSX lines of code | ~311,000 |
| Tauri commands (`#[tauri::command]`) | ~598 |
| Frontend test files | 191 |
| Zustand stores | 26 |
| SQLite migrations | 14 (programmatic runner + numbered SQL) |
| Built-in themes | 100+ |

---

## Backend (Rust / Tauri)

The Rust backend is organized into domain modules under `src-tauri/src/`:

```
src-tauri/src/
├── commands/        # 53 Tauri command modules (the IPC API surface)
├── algorithms/      # FSRS, SM-2/5/8/15, SM-18, SM-20, schedulers
├── models/          # Core data models (learning_item, document, extract, …)
├── database/        # SQLite via sqlx + rusqlite; repository pattern
├── processor/       # PDF, EPUB, Markdown, HTML extraction
├── ai/              # LLM + embedding provider abstraction
├── ocr/             # 6 OCR providers + runtime selection
├── transcription/   # Whisper.cpp + sherpa-onnx + cloud engines
├── cloud/           # Dropbox, Google Drive, OneDrive
├── tas/             # Topic-Aware Scheduling
├── mcp/             # Model Context Protocol server + tools
├── backup/          # Local DB backup/restore
└── services/        # Background services
```

### Tauri Command Surface

Approximately **598 `#[tauri::command]`** functions are exposed to the frontend, registered through the `invoke_handler` in `lib.rs`. The largest command groups:

| Domain | Notable modules |
|--------|-----------------|
| RSS / feeds (50+ cmds) | `rss_features.rs`, `rss.rs`, `curated_feeds.rs` |
| Documents (27 cmds) | `document.rs`, `document_bulk.rs`, `pdf_mobile.rs`, `pdf_reflow_cache.rs` |
| AI / LLM / MCP | `ai.rs`, `llm.rs`, `rag.rs`, `mcp.rs` |
| Sync | `sync.rs`, `sync_journal.rs`, `yjs_file.rs`, `commands/cloud/*` |
| Review & algorithms | `review.rs`, `algorithm.rs`, `learning_item.rs`, `queue*.rs` |
| Media | `video.rs`, `podcast.rs`, `audiobook.rs`, `youtube_playlist.rs` |
| Analytics & goals | `analytics.rs`, `reading_goals.rs`, `semantic_graph.rs` |

Additional commands live in top-level modules: `notebooklm.rs` (26), `integrations.rs` (18 — Obsidian/Anki/Logseq + browser-extension server), `youtube.rs` (13), `browser_sync_server.rs` (7), `anki.rs` (7).

### Database

- **SQLite** via `sqlx 0.8` (bundled `libsqlite3-sys`) with `rusqlite 0.31` for backup paths.
- `database/repository.rs` (~252 KB) is the central query layer; `document_repository.rs` handles document-specific queries.
- `database/migrations.rs` runs a programmatic migration runner alongside 14 numbered SQL files in `src-tauri/migrations/` (initial schema through `051_add_document_chunk_embeddings.sql`).

### External-Service Integrations

Beyond the algorithm and AI layers, the backend integrates with: NotebookLM (automation), YouTube (fetch + transcripts), Twitter/X (thread import), SponsorBlock, Pocket TTS, Anki (`.apkg` import/export), Kindle Clippings, Obsidian, Logseq, SuperMemo ZIP, and legacy Study JSON formats. A `browser_sync_server.rs` (~4,400 lines) provides the local HTTP/WebSocket bridge for the browser extension and cross-device pairing.

---

## Frontend (React + TypeScript)

The frontend is a React 19 + TypeScript SPA using Zustand for state, Tailwind for styling, and Vite as the build tool. Routing is `HashRouter`-based with a tab-driven main layout.

### Pages & Tabs

15 route pages plus a tab registry that drives the main shell: Dashboard, Documents, Queue, Queue Scroll, Review, Analytics, Search, Knowledge Graph, Knowledge Sphere, NotebookLM, Podcasts, Image Registry, Integrations, AI Workflows, Continue Reading, Settings.

### Component Organization

~367 component files across 35 feature folders, including `viewer/` (27 — PDF, EPUB, Markdown, audiobook, video, YouTube, OCR overlays, highlights, minimap, split panes), `review/` (31 — review session, Flashcard Studio, FSRS inspector, decks), `settings/` (32), `media/` (54 — RSS, podcasts, audio player, OCR), `graph/` (7), `notebooklm/` (8), `mobile/`, `pwa/`, `adaptive/`, `import/` (10), and more.

### State Management

26 Zustand stores organized by domain: `documentStore`, `extractStore`, `reviewStore`, `queueStore`, `settingsStore`, `llmProvidersStore`, `mcpServersStore`, `ragStore`, `transcriptionQueueStore`, `vimModeStore`, `tasStore`, `undoRedoStore`, `tabsStore`, etc. Persistent stores use `zustand/persist`.

### Internationalization

Six locales ship: English, 中文 (Chinese), Español, Deutsch, Français, 日本語 (Japanese), in `lib/i18n/locales/`. Recent releases have pushed toward full translation coverage of all user-facing strings.

---

## Learning & Spaced Repetition

This is the core of the product. The `AlgorithmType` enum supports **Fsrs, Sm2, Sm5, Sm8, Sm15, Sm18, Sm20** (default: Fsrs).

| Algorithm | Source | Notes |
|-----------|--------|-------|
| **FSRS-6** | Data model + schedulers | Default scheduler. `MemoryState { stability, difficulty }` on every learning item; preview intervals, optimization, and long-form duration safety caps. |
| **SM-2 / SM-5 / SM-8 / SM-15** | `algorithms/supermemo.rs` (~800 lines) | Classic SuperMemo formulas, each as a separate struct with `next_interval()`. |
| **SM-18** | `algorithms/sm18.rs` (~212 KB) + `sm18_data.rs` | Faithful port reverse-engineered from `sm18.exe` via Ghidra. Uses the 21³ (9,261-entry) SInc matrix extracted from SuperMemo's `StabilityIncrease.dat`. |
| **SM-20** | `algorithms/sm20.rs` (~45 KB) | Line-by-line translation of `sm20_reference.py` (75 functions decompiled). Three interval versions (V2/V4/V6), Bayesian smoothing core, and an FSRS-family 3-expert mixture branch. |

Supporting scheduling layers: `engaging_scheduler.rs`, `incremental_scheduler.rs`, `document_scheduler.rs`, `queue_selector.rs` (weighted randomization), `relevance.rs`, `optimizer.rs`, and the Topic-Aware Scheduling system (`tas/` — circular queues, gating, jitter, maturity).

**Card types:** Basic, Cloze, Q&A, Multiple Choice, Image Occlusion, Ordering & Matching — all authorable through Flashcard Studio (`FlashcardStudioModal.tsx`, ~5,000 lines).

**Review UX:** keyboard-first rating (1–4), preview intervals, audio review mode (TTS auto-advance), Zen mode, FSRS Inspector, session limits, recovery actions, queue load management (Easy Days, Load Balancing, Advance).

---

## Document Processing & Readers

### Extraction (`processor/`)

Backend extraction by `FileType`: PDF (`pdf.rs`, lopdf-based, ~29 KB), EPUB (`epub.rs`), Markdown (`markdown.rs`), HTML with readability (`html.rs`).

### Frontend Readers (`components/viewer/`)

| Reader | File | Notes |
|--------|------|-------|
| Master dispatcher | `DocumentViewer.tsx` (~6,900 lines) | Routes by document type, shared chrome |
| PDF | `PDFViewer.tsx` (~4,000 lines) + `PdfPageView`, `PdfReflowRenderer`, `PdfOcrManager` | pdf.js worker; mobile native range source + reflow (v1.78) |
| EPUB | `EPUBViewer.tsx` (~2,700 lines) | epub.js 0.3.93, CFI position tracking |
| Markdown | `MarkdownViewer.tsx` | |
| Audiobook | `AudiobookViewer.tsx` (~2,800 lines) + `AudiobookEpubSyncView` | chapter sync with EPUB |
| Video / YouTube | `LocalVideoPlayer`, `YouTubeViewer` | transcript-follow with comfort offset |

Shared reader features: `HighlightLayer`, `DocumentMinimap`, `SelectionPopup`, `ResizableSplit`, `SplitDocumentDialog`, `ImageSaveOverlay`, `PriorityControl`, OCR overlays.

### Document-Native Vim Reading

A full vim engine lives in `utils/vim/` (26 files + 20 test files): `DocumentVimEngine`, `VimCursorEngine`, motions, operators, text objects, logical-motion adapters for EPUB (CFI) and PDF (page/text positions), caret overlay, and selection manager. Motions and selections survive reflow, zoom, pagination, and chapter/page transitions. Press `?` in-reader for help.

### Segmentation & Extracts

Documents can be split into extracts via smart, paragraph, semantic, or fixed segmentation. Extracts support a full lifecycle (forget / dismiss / done), priority inheritance from parent documents (SuperMemo-style IR chain), and one-click conversion to flashcards (single or bulk AI generation).

---

## AI, OCR & Transcription

### LLM Providers (`ai/`)

`AIProvider` enum dispatches to **OpenAI, Anthropic, OpenRouter, Ollama** (local), with Google **Gemini** added in v1.75. Embedding providers: **OpenAI, Cohere, OpenRouter, Ollama**.

### AI Features

- **AI Assistant** — multimodal chat (paste / drag-drop / attach images), document Q&A with focused section context.
- **Flashcard generation** — `generateFlashcardsFromExtract` / `generateFlashcardsFromContent`; chat-created cards surface as inspectable artifacts.
- **RAG pipeline** — retrieval-augmented generation over the library, with index progress and vector store (`vector_store.rs`).
- **MCP** — full Model Context Protocol server (`mcp/`) exposing 18+ tools (`create_document`, `search_documents`, `create_cloze_card`, `submit_review`, `batch_create_cards`, `extract_video_snippet`, …) plus a client for connecting external MCP servers.
- **Semantic search** — embeddings-based relevance ranking across documents and extracts.

### OCR (`ocr/`)

Six providers, all implementing `OCRProvider`: **Tesseract** (local), **Google Document AI**, **AWS Textract**, **Azure Vision**, **Marker** (local PDF→Markdown), **Nougat** (math OCR), plus **GLM OCR** (local via vLLM). Runtime selection in `runtime.rs`; image preprocessing in `processor.rs`.

### Transcription (`transcription/`)

- **Local engines** — bundled sidecar binaries via `tauri-plugin-shell`: `whisper` (whisper.cpp), `sherpa-onnx` families (**NVIDIA Parakeet TDT/CTC**, **SenseVoice**). Vulkan detection; platform-aware library paths.
- **Cloud engines** — **Groq** and **OpenAI** transcription as fallbacks.
- **Pipeline** — `auto_queue.rs` (automatic worker), `job_queue.rs` (priority queue), `idle_scanner.rs` (idle-time scanning), `model_manager.rs` (download/list/delete models).

### Text-to-Speech

TTS for reading documents and review cards aloud: Pocket TTS (`pocket_tts.rs`), FAL, Groq, with voice cloning. Audio review mode auto-flips and auto-advances cards.

---

## Sync, Integrations & Cloud

### Cross-Device Sync

A substantial sync subsystem lives in `lib/sync/` (~45 files): end-to-end encryption (`argon2id.worker.ts`, `encryption.ts`, `roomCrypto.ts`), sharding (`shardPool`, `shardRepair`, `shardSnapshot`), CRDT-style primitives (`syncClock`, `replicatedMap`), feature flags, telemetry, audit, compaction, dual-write/cutover harness, and chaos testing. QR-based device pairing is backed by a relay and the local `browser_sync_server.rs`.

### Cloud Storage

`cloud/` implements a shared `CloudProvider` trait for **Dropbox**, **Google Drive**, and **OneDrive**, with OAuth token storage in `auth_store.rs` and encrypted credential storage in `secure_storage.rs` (OS keychain).

### Backup & Restore

`backup/manager.rs` (~33 KB) provides local DB backup/restore with scheduled auto-backup (Daily / Weekly / Monthly / Interval).

### Browser Extension

A Chrome/Firefox extension captures web pages, selected text, and highlights, syncing to the desktop app via the local bridge server. Includes an offline queue and a REST automation API for programmatic card creation and review.

### NotebookLM Workspace

Google NotebookLM automation (`notebooklm.rs`, ~4,000 lines) drives chat, artifacts (including mind maps), flashcard preview, and sync-to-learning flows. Frontend workspace in `components/notebooklm/` (Studio, Chat, Sidebar, Login, artifact viewers).

---

## Mobile & PWA

Incrementum ships a fully-adaptive responsive layout tailored for phones, tablets, and e-paper readers (e.g. Boox Palma 2). Key pieces:

- **Mobile shell** — `components/mobile/` (navigation, layout wrappers, queue view, pull-to-refresh, swipeable items), `components/pwa/`, `components/adaptive/` (responsive dialogs/sheets, safe scroll container).
- **Mobile hooks** — form factor, mobile shell, haptic feedback, edge-swipe back/forward, swipe-between-tabs, long press, visual viewport optimization for on-screen keyboards.
- **Native plugins** — `src-tauri/plugins/folder-import/` ships iOS (Swift) and Android (Kotlin) plugins for folder/file picking, APK install, DB backup to downloads, and share-listener registration.
- **Hardware integration** — Android volume-rocker page navigation / scrolling (forwarded from `MainActivity` with `preventDefault()` coordination), e-ink `PageUp`/`PageDown` page-turn support.
- **PWA** — installable web app with offline indicator, push subscription, and an assistant button.
- **Mobile PDF** — v1.78 overhauled mobile PDF loading with a native range-capable source (eliminating WebView `Failed to fetch` errors), semantic reflow, and OCR fallback for scanned PDFs.

Desktop-only features (screenshot capture, battery stats) are stubbed on mobile behind `#[cfg(...)]` gates.

---

## Recent Major Work

Selected highlights from the v1.7x release series (full detail in [CHANGELOG.md](../CHANGELOG.md)):

- **v1.79** — RSS Reading Lists (scroll feeds by folder/category/selection; named persisted lists), bulk Discover-sites subscribe, undo for any training action.
- **v1.78** — Mobile PDF overhaul (native source + semantic reflow + OCR fallback), transcript-follow comfort offset across video/audiobook.
- **v1.77** — Document-native Vim reading for EPUB and PDF (caret tracks stable CFI/page positions across reflow and pagination), volume-rocker scrolling in review.
- **v1.76** — Deliberate-tap overlay activation and content-only volume-key scrolling in Queue Scroll Mode.
- **v1.75** — Google Gemini AI provider across desktop/Android/browser; fresh-install dashboard import fix.
- **v1.74** — Android volume-rocker page navigation and e-ink page-key support.
- **v1.73** — Interactive chat flashcard artifacts, focused document-section context for LLM requests, per-platform leaner Tauri bundles.
- **v1.72** — Settings return navigation, mobile edge-swipe-back, backend-ready gate for mobile webviews.

---

## Known Gaps & Roadmap

Honest assessment of remaining work:

| Item | Status | Notes |
|------|--------|-------|
| **iOS** | 🚧 In progress | Simulator build/dev works on Apple Silicon; not yet shipped as a signed production build. |
| **AnkiConnect live sync** | 🚧 Planned | Static `.apkg` import/export ships; real-time Anki sync is not yet implemented. |
Feature work is tracked through the [OpenSpec](../openspec/) proposal workflow — see `openspec/changes/` for in-progress proposals and `openspec/AGENTS.md` for the contribution process.

---

*Built with Tauri + React + Rust.*
