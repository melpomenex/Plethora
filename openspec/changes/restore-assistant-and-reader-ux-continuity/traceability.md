# Traceability Matrix: Restore Assistant & Reader UX Continuity

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 01**: Reader table vertical text squishing | `src/components/viewer/EPUBViewer.tsx:1078` | `assistant-and-reader-ux-continuity`: Responsive reader table rendering | Tasks 1.1, 1.2, 1.3 | T01: Reader table layout suite |
| **Screenshot 02**: Dark theme contrast failure | `src/themes/builtin.ts:420` | `assistant-and-reader-ux-continuity`: WCAG AA contrast compliance across themes | Tasks 2.1, 2.2, 2.3 | T02: Theme contrast audit suite |
| **Screenshot 15 & 16**: Assistant scroll reset / jump button | `src/components/assistant/AssistantPanel.tsx:891` | `assistant-and-reader-ux-continuity`: Assistant conversation scroll retention | Tasks 3.1, 3.2, 3.4 | T03: Assistant scroll stability suite |
| **Screenshot 05**: Empty assistant bubble on dropped chunks | `src/components/assistant/AssistantPanel.tsx:1420` | `assistant-and-reader-ux-continuity`: Assistant conversation scroll retention | Tasks 3.3 | T03: Assistant scroll stability suite |
| **O20**: Assistant position repeatedly moves | `src/components/assistant/useAssistantConversationScroll.ts:93` | `assistant-and-reader-ux-continuity`: Assistant conversation scroll retention | Tasks 3.1, 3.2, 3.4 | T03: Assistant scroll stability suite |

## Current Issue #6 crosswalk


| IDs | Task | Evidence |
| --- | --- | --- |
| U02 | 4.1 | Wrappers present. Native visual comparisons for the reported narrow table behavior pending. |
| U03 | 4.2 | Dark reader link/text contrast visible in issue attachments. Exact theme identity remains unconfirmed. Use computed token evidence. |
| U01 | 4.3 | Current Chromium suite passed 3/3 after browser install. Real webview, device and additional host transitions remain pending. |


The [current matrix](../../planning/issue-6-final-traceability.md) links the source anchors and reporter evidence. The [shared release gates](../qualify-issue-6-remediation/verification.md) define how to record results.

## Spec requirements

| IDs | OpenSpec requirement |
| --- | --- |
| U01 | [Assistant conversation scroll retention](specs/assistant-and-reader-ux-continuity/spec.md#requirement-assistant-conversation-scroll-retention) |
| U02 | [Responsive reader table rendering](specs/assistant-and-reader-ux-continuity/spec.md#requirement-responsive-reader-table-rendering) |
| U03 | [WCAG AA contrast compliance across themes](specs/assistant-and-reader-ux-continuity/spec.md#requirement-wcag-aa-contrast-compliance-across-themes) |
