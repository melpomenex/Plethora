## 1. Database & Data Models

- [x] 1.1 Add Rust SQLite migrations for `audio_editions`, `audio_edition_sections`, `audio_edition_anchors`, `listening_sessions`, and `listening_session_items` in `src-tauri/migrations/`
- [x] 1.2 Implement Rust repository methods and Tauri command handlers for Audio Editions and sessions in `src-tauri/src/commands/audiobook.rs`
- [x] 1.3 Define TypeScript types for `AudioEdition`, `AudioEditionSection`, `AudioEditionAnchor`, `ListeningSession`, and `RemoteMediaCommand` in `src/types/audioEdition.ts`
- [x] 1.4 Create frontend API clients `src/api/audioEditions.ts` and `src/api/listeningSessions.ts` invoking Tauri commands
- [x] 1.5 Implement idempotent legacy migration converting `audiobook-*` localStorage records and single-file audio documents into canonical Audio Edition manifests

## 2. Semantic Chapterization & Section Analysis

- [x] 2.1 Extend `src/utils/sectionIndex.ts` to extract semantic sections from EPUB navigation TOC and spine structure
- [x] 2.2 Add PDF outline and canonical reflow heading segmentation to `src/utils/sectionIndex.ts`
- [x] 2.3 Implement HTML article heading segmentation (`<h1>`-`<h3>`) and heuristic fallback paragraph chapterization
- [x] 2.4 Add unit tests for document chapterization across EPUB, PDF, and HTML articles in `src/utils/__tests__/sectionIndex.audioEdition.test.ts`

## 3. Progressive Generation Engine & Provider Dispatch

- [x] 3.1 Implement durable generation queue store `src/stores/audioEditionGenerationStore.ts` with pause, resume, and cancellation
- [x] 3.2 Build section-level TTS worker invoking `TTSProviderAdapter` registry with error isolation and section retry logic
- [x] 3.3 Implement source-to-audio anchor computation and database persistence during section chunk synthesis
- [x] 3.4 Implement pre-flight character, duration, and monetary cost estimation calculator in `src/utils/audioEditionEstimation.ts`
- [x] 3.5 Build in-situ document voice audition preview synthesis in `src/api/audioEditions.ts`
- [x] 3.6 Add unit and integration tests for generation queue state, retry isolation, and anchor indexing in `src/stores/__tests__/audioEditionGeneration.test.ts`

## 4. Audio Edition Creation UX & Settings

- [x] 4.1 Build `CreateAudioEditionDialog.tsx` with Quality selector (Fast/Natural/Best), Advanced parameters, voice audition, and cost disclosure
- [x] 4.2 Add "Create Audio Edition", "Listen", and "Listen from here" context menu triggers across library cards and document viewers
- [x] 4.3 Update `src/components/tabs/AudiobooksTab.tsx` to display document Audio Editions with generation badges and playback controls
- [x] 4.4 Add pronunciation dictionary editor in `src/components/settings/TTSSettings.tsx` and pre-synthesis text transformation

## 5. Bidirectional Synchronization & Read-Along

- [x] 5.1 Implement bidirectional reading/listening position synchronization hook `src/hooks/useAudioEditionSync.ts`
- [x] 5.2 Integrate position synchronization into `AudiobookViewer.tsx`, `EPUBViewer.tsx`, `PDFViewer.tsx`, and `ArticleViewer.tsx`
- [x] 5.3 Implement synchronized read-along highlighting for active paragraphs and sentences in document viewers
- [x] 5.4 Update paired external audiobook alignment engine with 3-tier confidence mapping (`high`, `medium`, `low`)
- [x] 5.5 Add automated tests for position persistence, anchor lookup, and read-along tracking in `src/hooks/__tests__/useAudioEditionSync.test.ts`

## 6. Native Media Session & Hands-Free Study Mode

- [x] 6.1 Implement Android Media3 `MediaSession` and `MediaSessionService` in `src-tauri/plugins/plethora-android-tts/`
- [x] 6.2 Implement iOS `MPRemoteCommandCenter` and `AVAudioSession` remote command bridge
- [x] 6.3 Implement Desktop OS media key handlers and Web MediaSession synchronization
- [x] 6.4 Build normalized remote media command dispatcher (`Play`, `Pause`, `TogglePlayPause`, `Next`, `Previous`, `SeekForward`, `SeekBackward`)
- [x] 6.5 Add Normal vs. Study mode toggle and configurable remote command mapping in `useSettingsStore` and settings UI
- [x] 6.6 Implement subtle audio confirmation chime and playback volume ducking in `src/utils/audioFeedback.ts`

## 7. Smart Extract Extraction & Learning Actions

- [x] 7.1 Implement Smart Recent Extract boundary resolver expanding playback timestamp to complete sentence/paragraph boundaries
- [x] 7.2 Implement multi-press gesture extension logic with short debounce window
- [x] 7.3 Implement semantic hands-free markers (`Bookmark`, `Mark Interesting`, `Mark Confusing / Needs Explanation`)
- [x] 7.4 Connect hands-free extracts with `src/stores/extractStore.ts` and `src/api/extracts.ts`
- [x] 7.5 Build context-scoped "Ask Plethora about what I just heard" integration with Document Q&A
- [x] 7.6 Add source-provenance flashcard creation from audio player and extracted passages

## 8. Listening Session Inbox & Listen Later Queue

- [x] 8.1 Implement `ListeningSessionInbox.tsx` modal and review surface for triaging hands-free captures
- [x] 8.2 Build rapid triage actions (Keep Extract, Add Note, Turn into Flashcard, Ask Plethora, Discard)
- [x] 8.3 Integrate daily listening analytics with `DailyReadingStats` and workload calendar
- [x] 8.4 Implement `ListenLaterQueue.tsx` store and continuous auto-advancing playlist player
- [x] 8.5 Build lazy vs. immediate audio synthesis scheduler for queued articles

## 9. Cross-Platform Verification & Integration Testing

- [x] 9.1 Add unit tests for anchor resolution, smart boundary expansion, command normalization, and cost estimation
- [x] 9.2 Add integration tests for EPUB $\to$ Audio Edition, PDF $\to$ Audio Edition, and Article $\to$ Audio Edition flows
- [x] 9.3 Validate Android locked-screen background playback, Bluetooth media controls, and notification actions
- [x] 9.4 Validate macOS / Desktop media keys and keyboard shortcut controls
- [x] 9.5 Run performance benchmark gate `npm run bench:check` and ensure zero regression
