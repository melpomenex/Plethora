# Traceability Matrix: Restore Assistant & Reader UX Continuity

| Issue Concern | Root Cause Anchor | Requirement | Implementation Tasks | Verification Package |
|---|---|---|---|---|
| **Screenshot 01**: Reader table vertical text squishing | `src/components/viewer/EPUBViewer.tsx:1078` | `assistant-and-reader-ux-continuity`: Responsive reader table rendering | Tasks 1.1, 1.2, 1.3 | T01: Reader table layout suite |
| **Screenshot 02**: Dark theme contrast failure | `src/themes/builtin.ts:420` | `assistant-and-reader-ux-continuity`: WCAG AA contrast compliance across themes | Tasks 2.1, 2.2, 2.3 | T02: Theme contrast audit suite |
| **Screenshot 15 & 16**: Assistant scroll reset / jump button | `src/components/assistant/AssistantPanel.tsx:891` | `assistant-and-reader-ux-continuity`: Assistant conversation scroll retention | Tasks 3.1, 3.2, 3.4 | T03: Assistant scroll stability suite |
| **Screenshot 05**: Empty assistant bubble on dropped chunks | `src/components/assistant/AssistantPanel.tsx:1420` | `assistant-and-reader-ux-continuity`: Assistant conversation scroll retention | Tasks 3.3 | T03: Assistant scroll stability suite |
| **O20**: Assistant position repeatedly moves | `src/components/assistant/useAssistantConversationScroll.ts:93` | `assistant-and-reader-ux-continuity`: Assistant conversation scroll retention | Tasks 3.1, 3.2, 3.4 | T03: Assistant scroll stability suite |
