# Language-learning integration audit

Audited from the coordinator worktree on 2026-08-20 before implementation. The coordinator owns all shared hot-file integration; no worker edits these files concurrently.

| Integration area | Current host files | Shared language files consumed | Planned ownership |
| --- | --- | --- | --- |
| Reader shell and selection | `src/components/viewer/DocumentViewer.tsx`, `DocumentViewerWrapper.tsx`, `selectionInteraction/*`, `SelectionPopup.tsx`, `SelectionActionsSheet.tsx` | `languageProfileStore`, `languagePeek`, `languageHighlighting`, `languageTranslation`, `languageSentenceMode` | Reader host controller and selection entry points |
| EPUB/HTML/Markdown/text | `EPUBViewer.tsx`, `MarkdownViewer.tsx`, `DocumentViewer.tsx`, `ExtractReader.tsx` | highlighting adapters, source anchors, Peek, sentence mode | Host adapters; source DOM remains immutable |
| PDF | `PDFViewer.tsx`, `PdfReflowRenderer.tsx`, `PdfCanonicalReflowRenderer.tsx`, `PdfPageView.tsx` | PDF anchor adapters, highlighting confidence gate, Peek | Reflow first; fixed PDF only for canonical high-confidence words |
| Queue | `src/pages/QueueScrollPage.tsx`, `ScrollModeArticleEditor.tsx` | coverage, highlighting queue adapter, Peek/practice actions | Queue-safe integration; no lifecycle/ranking edits |
| Video/transcript | `YouTubeViewer.tsx`, `LocalVideoPlayer*.tsx`, `VideoPlayer.tsx`, `TranscriptSync.tsx`, `TranscriptPanel.tsx`, `VideoFeatures.tsx` | `languageVideo`, `languageAudioAlignment`, `languageMining`, translation, highlighting | Reuse current-time source and transcript sync |
| Tutor | `TutorSheet.tsx`, `TutorComposer.tsx`, `TutorTurnBubble.tsx`, existing `src/lib/ai/tutor/*` | `languageTutor`, profile/lexicon state, writing service | Existing tutor session/provider runtime |
| Flashcard Studio/review | `FlashcardStudioModal.tsx`, `flashcardStudioSessions.ts`, `ReviewSession.tsx`, `ReviewQueueView.tsx` | language drafts, practice evidence, SRS bridge | Explicit draft/evidence handoff only; no scheduler fork |
| Practice | No unified language practice host currently; mode contracts exist under `src/lib/language{Practice,Shadowing,Dictation,Writing,Pronunciation,Recommendations}` | practice, tutor, audio alignment, SRS, recommendations | New shared practice shell under `src/components/language/` |
| Persistence | `src-tauri/src/database/migrations.rs`, language repositories/commands, `src/api/*` | migrations through 098; practice/recommendation contracts | Forward migration only after session/attempt shape is stable |

## Hot-file ownership

- `src-tauri/src/database/migrations.rs`, `src-tauri/src/models/*`, `src-tauri/src/commands/*`, `src-tauri/src/database/*`: coordinator-owned sequential integration.
- `src/components/viewer/DocumentViewer*.tsx`, `EPUBViewer.tsx`, `PDFViewer.tsx`, `PdfReflow*.tsx`, `MarkdownViewer.tsx`, `YouTubeViewer*.tsx`, `selectionInteraction/*`: coordinator-owned reader/media integration.
- `src/components/common/ReaderTTSControls.tsx`, `src/api/tts*`, `src/api/transcription.ts`, `src/api/analytics.ts`, `src/api/learning-items.ts`, `src/api/extracts.ts`: consume existing contracts; no parallel replacements.
- `src/stores/settingsStore.ts`, `src/stores/vocabularyHistoryStore.ts`, `src/pages/QueueScrollPage.tsx`, Queue selector/ranking, Flashcard Studio, review/scheduling modules: coordinator-owned compatibility edits.

The first implementation slice is intentionally confined to new shared context/result contracts and tests so that later host wiring can be integrated one surface at a time.
