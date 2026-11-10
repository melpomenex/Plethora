# Traceability Matrix: Harden AI Learning Actions & Card Quality

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 04**: `topic parameter is required` failure | `src/lib/ai/agent/tools/readonly.ts:482` | `ai-learning-actions-and-card-quality`: Tool parameter alias normalization | Tasks 1.1, 1.2, 1.3, 1.4, 1.5 | T01: Tool parameter alias suite |
| **Screenshot 08**: Shingles Apple AI `safety_blocked` | `src-tauri/native/apple-ai/FmBridgeCore.swift:184` | `ai-learning-actions-and-card-quality`: Graceful on-device safety block recovery | Tasks 2.1, 2.2, 2.3, 2.4, 2.5 | T02: Safety block fallback test |
| **Screenshot 07**: Summary failure toast without retry | `src/features/summary/useDocumentSummary.ts:98` | `ai-learning-actions-and-card-quality`: Graceful on-device safety block recovery | Tasks 2.4, 2.5 | T02: Safety block fallback test |
| **Orig_05**: Assistant Chat flashcard SQLite FK 787 error | `src-tauri/src/database/cards.rs:412` | `ai-learning-actions-and-card-quality`: Validated source lineage for card creation | Tasks 3.1, 3.2, 3.3 | T03: Extract card creation FK test |
| **Orig_12**: Pinned section context dropped | `src/lib/ai/agent/tools/readonly.ts:310` | `ai-learning-actions-and-card-quality`: Validated source lineage for card creation | Tasks 1.1, 1.3 | T01: Tool parameter alias suite |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `ai-learning-actions-and-card-quality`: Graceful on-device safety block recovery | Tasks 4.1, 4.2, 4.3, 4.4 | T04: Settings search catalog coverage gate |
