# Tasks: ux-06-ingestion-airlock-and-mobile-ergonomics

**Dependencies:** Coordinates cleanly with `ux-03` (`10m Audio Commute`) and `ux-04` (`audioPlaybackStore`). Mark `[x]` and update `00-UX-MASTER-HANDOFF.md` + Lemmalog after every task.

## 1. Ingestion Airlock Staging Buffer

- [x] 1.1 **UX06-T01 — Implement documentHeadingSplitter and IngestionAirlockModal staging buffer.** Dependencies: none. **Files:** create **NEW** `src/utils/documentHeadingSplitter.ts`, **NEW** `src/components/import/IngestionAirlockModal.tsx`, **NEW** `src/components/import/__tests__/IngestionAirlockModal.test.tsx`; modify `src/components/tabs/TabRegistry.tsx`. **Implement:** Deterministic Markdown/HTML Chapter/H2 splitter (`splitDocumentByHeadings`) and keyboard staging modal (`[1]` Active High-Priority `P10`, `[2]` Evergreen Low-Priority `P65`, `[3]` Reference Only Vault, `Pre-Chunk by Chapter / H2 Headings` preview & commit). Verify: `npx tsc --noEmit && npm run test:run -- src/components/import/__tests__/IngestionAirlockModal.test.tsx`.

## 2. Asymmetric Mobile Ergonomics

- [x] 2.1 **UX06-T02 — Upgrade MobileQueueView with Commute Audio Queue, Bottom Thumb-Arc, and Double-Tap Paragraph Capture.** Dependencies: none. **Files:** modify `src/components/mobile/MobileQueueView.tsx`; create **NEW** `src/components/mobile/__tests__/MobileQueueView.ergonomics.test.tsx`. **Implement:** Add Commute Audio Queue toggle, curved `[data-mobile-thumb-arc="true"]` dock for one-handed SRS grading & priority nudging, and double-tap paragraph instant extraction (`[data-paragraph-index]`) to the desktop processing inbox. Verify: `npx tsc --noEmit && npm run test:run -- src/components/mobile/__tests__/MobileQueueView.ergonomics.test.tsx`.
