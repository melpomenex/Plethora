# Implementation Tasks

## 1. Consent model + persistence
- [x] 1.1 Add `embedding.paidEmbeddingsEnabled` (default false) and `tts.paidTtsEnabled` (default false) to `settingsStore` defaults, `src/config/defaultSettings.ts`, `src/types/settings.ts`, `src/utils/settingsValidation.ts`; add a schema migration for existing users (default false)
- [x] 1.2 Add visible paid/external-API indicators in `EmbeddingSettings.tsx`, `TTSSettings.tsx`, `VoiceBrowser.tsx`, `CreateAudioEditionDialog.tsx`, `AiIndexPanel.tsx`

## 2. Gate embedding call paths
- [x] 2.1 Gate `AiIndexPanel` enable/reindex CTA (confirmation + workload/cost estimate) in `src/components/settings/AiIndexPanel.tsx`
- [x] 2.2 Gate `ragConfig.ts` cloud key resolution / retrieval-side `embed_text`; add consent check before billable query embeds
- [x] 2.3 Gate semantic-graph embedding triggers (`QueueScrollPage` neural mode, `KnowledgeGraphPage` via `semanticEngine.ts`)

## 3. Gate TTS call paths
- [x] 3.1 Gate `generateSpeech` in `src/api/tts.ts` for billable adapters on `paidTtsEnabled`; open a consent surface when disabled
- [x] 3.2 Gate voice previews (replace the one-time confirm with the consent flag + confirmation), `auditionVoicePreview`, and `audioEditionGenerationStore.startJob`
- [x] 3.3 Ensure read-aloud with a billable provider selected but consent off shows the opt-in surface on first play (no repeated confirmation each chunk)

## 4. Fallback safety
- [x] 4.1 Re-evaluate `allowCloudFallback` default in `settingsStore.ts` (default now OFF); make `runAiAction` cloud fallback require consent/confirmation
- [x] 4.2 Audit embedding/OCR free→cloud fallbacks (`embeddings_backend.rs`, `documentAutoExtract.ts`) so they never silently bill

## 5. Backend defensive gates
- [x] 5.1 Add consent checks to `src-tauri/src/commands/ai_learning.rs` (enqueue/index/retrieve) and the semantic-graph embedding commands; return a typed error the UI maps to an opt-in prompt

## 6. Tests
- [x] 6.1 API key configured but paid embeddings disabled → no request sent, opt-in UX surfaced
- [x] 6.2 API key configured but paid TTS disabled → no request sent, opt-in UX surfaced
- [x] 6.3 Explicit paid operation → allowed
- [x] 6.4 Large job (index/audio edition) → pre-flight confirmation with workload + estimate (or "cannot estimate" text)
- [x] 6.5 Free/local → paid fallback never silent (blocked without consent)
- [x] 6.6 Backend rejects unconsented paid embedding
- [x] 6.7 Run `npm run test:run` affected suites; add Rust tests for the defensive gates

## 7. Spec
- [x] 7.1 Confirm spec matches implementation