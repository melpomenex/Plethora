## 1. Error contract

- [ ] 1.1 Align `ON_DEVICE_AI_ERROR_CODES` with Kotlin `ErrorCode` (busy, battery_quota_exceeded, background_use_blocked, safety_blocked, queue_full, and any others).
- [ ] 1.2 Map them in `ON_DEVICE_CODE_TO_CATEGORY` using categories from change A.
- [ ] 1.3 Kotlin + TS tests for each code.

## 2. Readiness vs unsupported

- [ ] 2.1 Document and implement the AICore init vs unlocked-bootloader heuristic in `checkStatus` comments + mapping tests (pure function if possible).
- [ ] 2.2 Ensure capability TTL still bypasses `downloading`.

## 3. Specialized APIs

- [ ] 3.1 Confirm Summarization language routing still matches expand-android spec (EN/JA/KO vs Prompt).
- [ ] 3.2 Spike Image Description Maven coordinate; if stable, add compile flag + command + capability bit; else document skip in `android-build-notes.md`.
- [ ] 3.3 Do not add Proofreading/Rewriting clients.

## 4. Version re-pin

- [ ] 4.1 Check Google Maven for newer `genai-prompt` / schema; only upgrade if all Android plugins compile and R8 keeps commands.
- [ ] 4.2 Update `docs/android-build-notes.md` (including `plethora-android-genai` path).

## 5. Regression

- [ ] 5.1 Do not regress warmup, tokenLimit cache, streaming summarize, structured envelopes in `GenAiSchemas.kt`.
- [ ] 5.2 Plugin JVM tests: `./gradlew :plethora-android-genai:test` (module name as in settings.gradle).
- [ ] 5.3 Vitest `onDeviceAI` + errors tests.

## 6. Eval (non-CI)

- [ ] 6.1 Keep injection-document eval asserting containment (existing tests). Add a device-only rubric checklist in `docs/` or eval README — not default CI.
