# Tasks: Harden AI Learning Actions & Card Quality

## 1. Tool Parameter Normalization & Agent Robustness

- [ ] 1.1 Implement `extractStringParam` helper supporting alias resolution in `src/lib/ai/agent/tools/paramUtils.ts`.
- [ ] 1.2 Update `get_related_material` in `src/lib/ai/agent/tools/readonly.ts` to accept `query`, `search`, `concept`, `term`, and `text` as aliases for `topic`.
- [ ] 1.3 Update `relationshipAdapter.ts` to accept `source`, `target`, `relation`, and `type` aliases gracefully.
- [ ] 1.4 Soften `rejectUnknownParams` to log warnings for harmless auxiliary fields (e.g. `reasoning`, `context`) instead of failing validation.
- [ ] 1.5 Add Vitest unit tests in `src/lib/ai/agent/tools/__tests__/readonly.params.test.ts` verifying parameter aliasing works for all common LLM variations.

## 2. Safety Degradation & Fallback Handling

- [ ] 2.1 Update `src-tauri/native/apple-ai/FmBridgeCore.swift` to catch safety errors and return structured `safety_blocked` JSON rather than generic failure.
- [ ] 2.2 Add typed `safety_blocked` representation in `src/lib/ai/onDeviceAI.ts`.
- [ ] 2.3 Create `SafetyBlockedNotice.tsx` component in `src/components/assistant/` with provider explanation and one-click retry buttons.
- [ ] 2.4 Update `src/features/summary/useDocumentSummary.ts` to surface structured safety alerts with fallback options.
- [ ] 2.5 Add unit tests in `src/lib/ai/__tests__/safetyFallback.test.ts` verifying that safety blocks trigger appropriate fallback recommendations.

## 3. Flashcard Lineage & Foreign Key Resolution

- [ ] 3.1 Update `src-tauri/src/database/cards.rs` to verify parent document UUIDs when creating cards from extract IDs.
- [ ] 3.2 Implement transactional batch creation in `cards.rs` with per-item error reporting.
- [ ] 3.3 Add Rust integration tests in `cards.rs` verifying that cards created from extracts resolve foreign keys without error 787.

## 4. Settings UI & Search Catalog Coverage

- [ ] 4.1 Add AI Safety Fallback Provider selector in `src/components/settings/sections/AISettings.tsx`.
- [ ] 4.2 Add stable DOM `id="setting-ai-safety-fallback"`.
- [ ] 4.3 Register `setting-ai-safety-fallback` in `src/components/settings/search/settingsSearchCatalog.ts` under `SettingsTab.AI`.
- [ ] 4.4 Add search coverage test in `src/components/settings/search/__tests__/settingsSearchCatalog.test.ts`.
- [ ] 4.5 Run `npm run bench:check` to ensure no performance regression.
