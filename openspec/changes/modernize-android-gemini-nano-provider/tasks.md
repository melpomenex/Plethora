## 1. Error contract

- [x] 1.1 Align `ON_DEVICE_AI_ERROR_CODES` with Kotlin `ErrorCode` (busy, battery_quota_exceeded, background_use_blocked, safety_blocked, queue_full, and any others).
- [x] 1.2 Map them in `ON_DEVICE_CODE_TO_CATEGORY` using categories from change A.
- [x] 1.3 Kotlin + TS tests for each code.

## 2. Readiness vs unsupported

- [x] 2.1 Document and implement the AICore init vs unlocked-bootloader heuristic in `checkStatus` comments + mapping tests (pure function if possible).
- [x] 2.2 Ensure capability TTL still bypasses `downloading`.

## 3. Specialized APIs

- [x] 3.1 Confirm Summarization language routing still matches expand-android spec (EN/JA/KO vs Prompt).
- [x] 3.2 Add Image Description via `com.google.mlkit:genai-image-description:1.0.0-beta1` behind a compile flag + independent capability bit; EN-only short alt text. Do not use it for study cards.
- [x] 3.3 Do not add Proofreading/Rewriting clients.
- [x] 3.4 Stop advertising `multiImage` until `images[]` is actually sent; or implement the wire format.
- [x] 3.5 Map `OnDeviceProvider` `embeddings` from the native snapshot (today it is hardcoded `false`).
- [x] 3.6 Route Summarization/Image Description independently of Prompt so devices on the specialized allowlist but not Prompt (e.g. Galaxy S25 per Google tables) still get cheap APIs.

## 4. Version re-pin

- [x] 4.1 Check Google Maven for newer `genai-prompt` / schema; only upgrade if all Android plugins compile and R8 keeps commands.
- [x] 4.2 Update `docs/android-build-notes.md` (including `plethora-android-genai` path).

## 5. Regression

- [x] 5.1 Do not regress warmup, tokenLimit cache, streaming summarize, structured envelopes in `GenAiSchemas.kt`.
- [ ] 5.2 Plugin JVM tests: `./gradlew :plethora-android-genai:test` (module name as in settings.gradle).
- [x] 5.3 Vitest `onDeviceAI` + errors tests.

## 6. Eval (non-CI)

- [x] 6.1 Keep injection-document eval asserting containment (existing tests). Add a device-only rubric checklist in `docs/` or eval README — not default CI.
