## 1. Backend Model Resolution and Engine Route Dispatch

- [x] 1.1 Update `src-tauri/src/models/hf/manager.rs` to normalize `NEMOTRON_ASR_LOGICAL_KEY` (`nemotron-3.5-asr-0.6b`) and repo ID (`nvidia/nemotron-3.5-asr-0.6b`) to the registered model in `resolve_installed_path`, `resolve_run_contract`, and `stt_route_for_model`
- [x] 1.2 Update `src-tauri/src/commands/podcast.rs` (`run_transcription_job`): resolve installed model path via `resolve_installed_path` in addition to `ModelManager`, resolve route via `stt_route_for_model`, and dispatch through `engine.transcribe_route(...)`
- [x] 1.3 Update `src-tauri/src/commands/audiobook.rs` (`generate_audiobook_transcript`): support HF model lookup via `resolve_installed_path` and dispatch via `stt_route_for_model` and `engine.transcribe_route(...)`
- [x] 1.4 Add or update unit tests in `src-tauri` for Nemotron model resolution and engine route detection

## 2. Frontend Model Resolution and Quality Ranking Integration

- [x] 2.1 Update `src/lib/transcriptionProvider.ts`: expand `MODEL_QUALITY_RANK` to include Nemotron ASR keys (`nemotron-3.5-asr-0.6b`, `nvidia/nemotron-3.5-asr-0.6b`)
- [x] 2.2 Update `resolveTranscription` and `resolveTranscriptionWithReadiness` in `src/lib/transcriptionProvider.ts`: integrate `sttProvider`, `sttModel`, `preferLocal`, and `isLocalNemotronInstalled()`, prioritizing local Nemotron on capable devices when local STT is active
- [x] 2.3 Update `src/lib/transcriptionRouting.ts`: ensure `routeDocumentTranscription` and `routePodcastTranscription` route local Nemotron without forcing Groq fallback
- [x] 2.4 Add or update unit tests in `src/lib/__tests__/transcriptionRouting.test.ts` and `src/lib/__tests__/transcriptionProvider.test.ts` to verify Nemotron routing

## 3. Audiobook and Podcast UI Routing Alignment

- [x] 3.1 Update `src/components/viewer/AudiobookViewer.tsx` `handleTranscribe` to handle resolved local Nemotron transcription for both audiobooks and podcasts
- [x] 3.2 Update `src/components/media/PodcastManager.tsx` `handleTranscribe` to invoke podcast transcription with the resolved local engine
- [x] 3.3 Update `src/api/audiobooks.ts` (`generateTranscript`) and `src/components/import/AudiobookImportDialog.tsx` to support local Nemotron transcription
- [x] 3.4 Update any relevant UI tests in `src/components/viewer/__tests__/AudiobookViewer.test.tsx`

## 4. Verification and Validation

- [x] 4.1 Run unit tests for frontend transcription routing (`npm test -- src/lib/__tests__/transcriptionRouting.test.ts`)
- [x] 4.2 Run Rust compiler check (`cargo check`) to ensure backend commands compile without errors
- [x] 4.3 Verify end-to-end integration and run performance benchmark gate (`npm run bench:check` if applicable)
