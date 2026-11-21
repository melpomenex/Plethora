# Plethora Reliability, Reader, Intelligence, and UX Improvement Program

## Overview

This master coordination document tracks the 12 requirements across four coordinated OpenSpec changes, preserving full end-to-end traceability from root-cause diagnosis through specification, implementation, and verification.

## Coordinated Changes

| Change ID | Focus | Requirements |
|---|---|---|
| [`fix-reader-navigation-and-statistics-regressions`](../../changes/fix-reader-navigation-and-statistics-regressions/proposal.md) | Critical application stability & regression remediation | #6, #11 |
| [`improve-document-reader-reliability-and-grounding`](../../changes/improve-document-reader-reliability-and-grounding/proposal.md) | Document reading, indexing, and AI grounding | #1, #3, #8, #10 |
| [`refine-dashboard-and-desktop-interactions`](../../changes/refine-dashboard-and-desktop-interactions/proposal.md) | Dashboard insights, tray, iconography, terminology, rescheduling | #2, #4, #5, #9, #12 |
| [`benchmark-and-modernize-local-decision-models`](../../changes/benchmark-and-modernize-local-decision-models/proposal.md) | Evidence-based local decision model audit & benchmarking | #7 |

## Traceability Matrix

| Req # | Requirement | Change ID | Spec Capability | Key Files |
|---:|---|---|---|---|
| 1 | Persist PDF zoom per document | `improve-document-reader-reliability-and-grounding` | `pdf-zoom-persistence` | `DocumentViewer.tsx`, `PDFViewer.tsx`, `readerPosition.ts` |
| 2 | Surface Sleep & Learning Insights on Dashboard | `refine-dashboard-and-desktop-interactions` | `dashboard-learning-insights` | `DashboardTab.tsx`, `SleepLearningDashboardCard.tsx`, `health.ts` |
| 3 | Fix arXiv paper tables being clipped/cut off | `improve-document-reader-reliability-and-grounding` | `arxiv-table-overflow` | `articleReaderStyles.ts`, `compatibilityReaderStyles.ts` |
| 4 | Expand Plethora's native OS tray menu | `refine-dashboard-and-desktop-interactions` | `tray-integration` | `src-tauri/src/tray.rs`, `MainLayout.tsx` |
| 5 | Give AI Flashcard Studio a distinct toolbar icon | `refine-dashboard-and-desktop-interactions` | `flashcard-studio-icon` | `DocumentViewer.tsx`, `FlashcardStudioModal.tsx` |
| 6 | Fix views failing to load on first navigation | `fix-reader-navigation-and-statistics-regressions` | `first-view-loading-reliability` | `TabRegistry.tsx`, `TabContent.tsx`, `documentStore.ts`, `startupStore.ts`, `SettingsPage.tsx` |
| 7 | Research, benchmark, and modernize local decision models | `benchmark-and-modernize-local-decision-models` | `local-decision-models` | `decisionModelDownloads.ts`, `decisionModelOptions.ts`, `hf/manager.rs`, `hf/adapters.rs`, `daqe/` |
| 8 | Automatically index newly imported documents for RAG | `improve-document-reader-reliability-and-grounding` | `automatic-semantic-indexing` | `src-tauri/src/ai_learning/indexer.rs`, `commands/ai_learning.rs`, `database/repository.rs`, import commands |
| 9 | Correct scheduling algorithm terminology in Handbook | `refine-dashboard-and-desktop-interactions` | `handbook-scheduler-terminology` | `docs/USER_HANDBOOK.md`, translated handbooks, `docs/product/features/scheduling/` |
| 10 | Repair PDF section targeting using `#` in Assistant | `improve-document-reader-reliability-and-grounding` | `document-section-mention-resolution` | `sectionIndex.ts`, `AssistantPanel.tsx`, `DocumentQATab.tsx`, `PDFViewer.tsx` |
| 11 | Fix Statistics crashing PDF and EPUB readers (#185) | `fix-reader-navigation-and-statistics-regressions` | `item-statistics-stability` | `ItemStatsModal.tsx`, `ItemStatsButton.tsx`, `StatsCurves.tsx`, `DocumentViewer.tsx` |
| 12 | Make overdue and due-date labels interactive | `refine-dashboard-and-desktop-interactions` | `reader-due-date-rescheduling` | `DocumentViewer.tsx`, `src-tauri/src/commands/queue_bulk.rs`, `src/api/queue.ts` |

## Sequencing & Dependencies

1. **Phase 1 (Critical Stability):** `fix-reader-navigation-and-statistics-regressions` (#6, #11) establishes deterministic view loading and modal/chart stability before adding new Dashboard cards or reader interactions.
2. **Phase 2 (Reader & Grounding):** `improve-document-reader-reliability-and-grounding` (#1, #3, #8, #10) fixes zoom persistence, arXiv table geometry, post-commit semantic indexing, and PDF `#` section resolution.
3. **Phase 3 (Dashboard & UX):** `refine-dashboard-and-desktop-interactions` (#2, #4, #5, #9, #12) adds the non-blocking Dashboard Sleep & Learning card, expands the tray menu, updates the Flashcard Studio icon, updates Handbook terminology, and adds interactive due-date rescheduling.
4. **Phase 4 (Decision Models):** `benchmark-and-modernize-local-decision-models` (#7) audits Laya delivery/checkpoint configuration, documents candidate research, builds a reproducible benchmark harness, and updates/retains models based on measured evidence.
