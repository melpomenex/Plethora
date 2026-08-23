## 1. Error taxonomy and fallback unification

- [ ] 1.1 Add `Busy`, `QuotaExceeded`, `BatteryQuotaExceeded`, `ForegroundRequired`, `PermissionDenied`, `ModelDownloadRequired`, `ResourceExhausted` to `AI_ERROR_CATEGORIES` and export mapping tables for the known Kotlin codes (even before B wires them).
- [ ] 1.2 Change `allowCloudFallback()` to `=== true`. Add/adjust unit tests so `undefined` and `false` never allow paid fallback.
- [ ] 1.3 Document the `preferOnDevice` × `allowCloudFallback` policy mapping in `provider.ts` comments; do not add a conflicting third boolean.
- [ ] 1.4 Update `errors.test.ts` and `providerFallback.test.ts`.

## 2. Capability surface types and fakes

- [ ] 2.1 Add `PlatformCapabilityDescriptor` and capability ids (`speech.transcribe`, `vision.scan`, `language.identify`, `search.semantic`, `translate.sentence`).
- [ ] 2.2 Add Speech/Vision/LanguageId/Retriever TypeScript interfaces + Fake* providers in `src/lib/ai/__fixtures__/`.
- [ ] 2.3 Add generic `Transcript` and `ScanImport` DTOs with optional timings; reuse `GeneratedFlashcard`, `SmartTaggingOutput`, `LibraryAnswer` — no Android-prefixed domain types.
- [ ] 2.4 Unit-test fakes only (no native).

## 3. Enrichment policy and privacy indicator

- [ ] 3.1 Implement `enrichmentPolicy.ts` with cheap/moderate/expensive; default import path runs cheap only.
- [ ] 3.2 Specify the single-run “On-device” indicator helper (pure function: providerKind + fallbackPath → label). No UI restyle beyond a helper used later by feature agents.
- [ ] 3.3 Tests for “import does not enqueue expensive jobs” and “fallbackPath cloud-fallback is not on-device”.

## 4. Retriever/generator pairing type

- [ ] 4.1 Add `RagComposition { retrieverId, generatorKind }` type used by Ask Library; default retriever remains `ai_learning`.
- [ ] 4.2 Tests: help vs library namespace constants cannot be the same string.

## 5. Verification

- [ ] 5.1 `npx vitest run src/lib/ai/__tests__/errors.test.ts src/lib/ai/__tests__/providerFallback.test.ts` (and new tests).
- [ ] 5.2 `npx tsc --noEmit`.
