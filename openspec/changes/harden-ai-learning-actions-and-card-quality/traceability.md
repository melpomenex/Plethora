# Traceability Matrix: Harden AI Learning Actions & Card Quality

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 04**: `topic parameter is required` failure | `src/lib/ai/agent/tools/readonly.ts:482` | `ai-learning-actions-and-card-quality`: Tool parameter alias normalization | Tasks 1.1, 1.2, 1.3, 1.4, 1.5 | T01: Tool parameter alias suite |
| **Screenshot 08**: Shingles Apple AI `safety_blocked` | `src-tauri/native/apple-ai/FmBridgeCore.swift:184` | `ai-learning-actions-and-card-quality`: Graceful on-device safety block recovery | Tasks 2.1, 2.2, 2.3, 2.4, 2.5 | T02: Safety block fallback test |
| **Screenshot 07**: Summary failure toast without retry | `src/features/summary/useDocumentSummary.ts:98` | `ai-learning-actions-and-card-quality`: Graceful on-device safety block recovery | Tasks 2.4, 2.5 | T02: Safety block fallback test |
| **Orig_05**: Assistant Chat flashcard SQLite FK 787 error | `src-tauri/src/database/cards.rs:412` | `ai-learning-actions-and-card-quality`: Validated source lineage for card creation | Tasks 3.1, 3.2, 3.3 | T03: Extract card creation FK test |
| **Orig_12**: Pinned section context dropped | `src/lib/ai/agent/tools/readonly.ts:310` | `ai-learning-actions-and-card-quality`: Validated source lineage for card creation | Tasks 1.1, 1.3 | T01: Tool parameter alias suite |
| **AGENTS.md**: Settings search discoverability | `src/components/settings/search/settingsSearchCatalog.ts` | `ai-learning-actions-and-card-quality`: Graceful on-device safety block recovery | Tasks 4.1, 4.2, 4.3, 4.4 | T04: Settings search catalog coverage gate |

## Current Issue #6 crosswalk


| IDs | Task | Evidence |
| --- | --- | --- |
| A01 | 5.1 | Partial alias support and silent conflict discard verified in source. Adapter matrix pending. |
| A02 | 5.2 | Generation-to-acceptance provider spy sees zero requests in both full and focused runs. Assistant panel missing-save failure passed focused rerun. Neither result alone establishes a native defect. |
| A03, A08 | 5.3 | Blank rendering guard and refusal mapping present. Terminal/stream/consent matrix pending. |
| A04, A05, A09 | 5.4 | Validator has no production consumer in current search. Existing lineage/receipt paths need cross-surface SQLite/IndexedDB tests. |
| A06, A07 | 5.5 | Summary native default-provider path and full-row write confirmed. Run current route and failure matrix with scripted providers. |


The [current matrix](../../planning/issue-6-final-traceability.md) links the source anchors and reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define how to record results.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| A01 | [Tool parameter alias normalization](specs/ai-learning-actions-and-card-quality/spec.md#requirement-tool-parameter-alias-normalization) |
| A02 | [Section scope follows generation through acceptance](specs/ai-learning-actions-and-card-quality/spec.md#requirement-section-scope-follows-generation-through-acceptance) |
| A03 | [Terminal Assistant response states are actionable](specs/ai-learning-actions-and-card-quality/spec.md#requirement-terminal-assistant-response-states-are-actionable) |
| A04, A05, A09 | [Shared generated-card acceptance](specs/ai-learning-actions-and-card-quality/spec.md#requirement-shared-generated-card-acceptance) |
| A06, A07 | [Extract learning actions report typed failure](specs/ai-learning-actions-and-card-quality/spec.md#requirement-extract-learning-actions-report-typed-failure) |
| A08 | [Graceful on-device safety block recovery](specs/ai-learning-actions-and-card-quality/spec.md#requirement-graceful-on-device-safety-block-recovery) |
