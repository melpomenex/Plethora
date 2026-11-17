# Guided Reading verification

## Manual walkthrough

1. From the repository root, run `npm run tauri:dev` to open the native app with its SQLite backend.
2. In **Study Plans**, open a published library-grounded plan that has current EPUB, PDF, HTML, or Markdown source references. **Start Guided Reading** prepares its first trail locally. **Refresh passages** retries preparation for an existing trail.
3. In the topic list or graph inspector, choose **Read for This Topic**. The plan's **Reading assignments** section lets you expand an assignment to read it in full or choose **Open in reader**. To author a passage, select a current source, paste the bounded passage from that source, and choose **Verify and save passage**.
4. Read the highlighted text in the document from the single underline to the double underline. Open the **Guided Reading** menu in the reader toolbar and choose **Mark passage complete**. Open the menu again and choose **Next passage**. A topic that uses several documents may move to another tab. Topics with unfinished prerequisite reading wait until the prerequisite is completed or explicitly skipped.
5. Close the reader or relaunch Plethora. Return to the same plan and choose **Continue Reading**. The reader opens at the saved passage.
6. After completing a topic, choose **Quick check** from the toolbar menu. Plethora opens a ready source-grounded topic check if available, or opens the existing assessment builder with a three-question Practice configuration.
7. Take and submit a source-grounded examination for the plan. In its results, choose **Review supporting passage** on a missed question with matching assigned reading. Choose **Return to results** from the toolbar menu to reopen the same attempt. The grounding source remains available for conventional source navigation.
8. For an unresolved passage, open the **Guided Reading** menu and try **Retry passage**, **Open nearby location** if a structural hint is available, or **Skip passage**. If the source changed since publication, verify the new source evidence in a new plan version and prepare reading for that version.

## Automated checks

- `openspec validate guided-study-reading-trails --strict`
- `cd src-tauri && RUST_MIN_STACK=33554432 cargo test --no-default-features --features screenshot --test study_reading`
- `npm run test:run -- src/lib/study-plans/reading src/components/study-plans/__tests__/StudyPlanEditor.test.tsx src/components/study-plans/__tests__/StudyPlanGraphView.test.tsx src/components/study-plans/results/__tests__/AttemptResults.test.tsx src/components/study-plans/attempts/__tests__`
- `PLETHORA_TEST_CHROMIUM=/usr/bin/chromium npm run test:visual -- study-reading-trail.visual.spec.ts`. Omit the environment variable when Playwright's Chromium is installed. The browser uses real reader, tab, plan, and assessment components with controlled IPC responses. The native integration suite exercises the SQLite migration and persisted version ownership separately.
- `npm run bench:check` and the production bundle budget check.

## Resolution limits

Quote-only EPUB lookup is capped at 48 sections when a canonical spine hint is unavailable. Long books with indexed passages use the stored spine position. PDFs without a reliable rendered text layer can open at a known page. Reading preparation expands the plan's existing verified citations using local indexed text and reports objectives it cannot link to those passages.

## Results

- Strict OpenSpec validation passed.
- The native integration suite passed both tests. It applied migration 153, checked compare-and-set conflicts, preserved historical progress and version ownership, and rejected unverified or excluded sources.
- The focused Vitest run passed 57 tests across 13 files. The latest Chromium run passed ten tests across all four readers. It verified the visible orange highlight against the active Linked Source color, mobile EPUB toolbar placement and keyboard dismissal, missing-source recovery, PDF text-layer replacement, virtualization and zoom, duplicate EPUB quotes, scanned PDF fallback, multi-document resume, a formative check, exam submission, and review from results. The browser workflow fixture uses controlled native IPC responses.
- The production Vite build and bundle budget check passed on Node 24.22.3. The new quote-resolution benchmark passed at 0.09858 calibrated cost against a 0.11 baseline.
- The full benchmark gate exceeded existing thresholds on the working tree and an independent export of unchanged HEAD. The benchmark suites that exceeded thresholds varied across runs. Five thresholds failed in both Node 24 runs. This change does not adjust the existing thresholds.
- The full TypeScript check still reports the two existing `ondevice` type errors in `src/lib/study-plans/generation/__tests__/pinnedTask.test.ts`.
- The native desktop build opened with an isolated profile. Its startup log confirmed migration 153 and a ready WebView. The full study workflow was exercised in Chromium with real readers and a controlled IPC fixture.
