# Startup baseline

Observed from the current source before implementing this change:

1. `src/main.tsx` invokes `useCollectionStore.getState().loadCollections()` during module evaluation, before the React tree mounts.
2. `MainLayout` starts `useDocumentStore.getState().loadDocuments()` from its mount effect. That call reads `activeCollectionId` at whatever point the asynchronous collection request has reached, so it can race the persisted active collection and query the default collection first.
3. The tab system intentionally keeps inactive tabs mounted. The default Dashboard and Queue tabs therefore both mount during boot. Dashboard requests dashboard stats and continue-reading progress; Queue's review queue view requests queue items and stats even when Queue is hidden.
4. The document summary path avoids full document content but still reads every row in the selected collection and maps tags, scheduling fields, and other row data across IPC. Queue construction scans and materializes the complete candidate queue before selecting visible items.
5. Frontend first-paint telemetry currently ends on the first animation frame. It measures a painted shell, not the completion of the first collection/document/queue result.
6. Native `invokeCommand` waits for `wait_for_backend_ready`, which correctly protects migrations and integrity recovery but adds native setup time before the first query. Yjs, file sync, and other background systems are already deferred and should remain outside this critical path.

The implementation will keep this baseline as the comparison point and add labeled request counters so tests can prove that the coordinated path removes duplicate startup reads.

## Post-change evidence (2026-07-16)

- The startup path now uses one versioned, bounded snapshot: up to 50 document summaries, 50 queue items, and 10 continue-reading rows, with explicit native projections and collection/date indexes.
- The Boox Palma 2 was authorized, installed with the rebuilt APK, and cold-launched five times after the final fix. `am start -W` reported 241, 247, 254, 249, and 243 ms (`max/p95 sample: 254 ms`). This is activity-start timing; first-data telemetry remains covered by the in-app startup phases and automated tests.
- The first device trace exposed two frontend issues introduced on the new path: a fresh `[]` returned from a Zustand startup selector caused React error #185 (maximum update depth), and the first snapshot could be rejected while the collection store still held its placeholder default ID. Both are fixed.
- After the fixes, the clean Palma trace contained no React error, no `yjs_file_upload`, no startup document-read storm, and no large snapshot warning. A single active/restored EPUB viewer still attempted to read a 22.8 MB EPUB through the mobile memory-limited command; that is on-demand viewer behavior, not startup database hydration.
