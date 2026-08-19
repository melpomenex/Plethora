## 1. Fix Tag Editor Readability and Popover Opacity

- [x] 1.1 Update `CompactTagEditor.tsx` container styles to ensure a fully opaque, solid background (`bg-popover`, solid backdrop layer, `border-border`, `shadow-xl`) and correct z-index stacking (`z-50`).
- [x] 1.2 Update `ItemTagEditor.tsx` chip styling (`bg-muted/80 text-foreground border-border/70`), input field (`bg-background text-foreground border-border`), and remove button hover/focus states to guarantee WCAG AA contrast.
- [x] 1.3 Update `ThemeContext.tsx` and `src/index.css` so that `--color-popover` resolves to a fully opaque surface color across all dark, light, and glass themes.
- [x] 1.4 Add unit tests in `src/components/common/__tests__/CompactTagEditor.test.tsx` and `ItemTagEditor.test.tsx` verifying opacity, contrast tokens, and Escape focus restoration.

## 2. Backend X/Twitter Thread Ingestion and Normalization

- [x] 2.1 Extend `src-tauri/src/twitter.rs` with `get_twitter_thread` command to parse single tweets, multi-post author threads, NoteTweets (longform text), media attachments, and quoted status results.
- [x] 2.2 Implement thread reply traversal in `twitter.rs` to fetch continuous chronological posts authored by the main user while excluding unrelated third-party replies.
- [x] 2.3 Implement syndication fallback endpoint (`https://cdn.syndication.twimg.com/tweet-result?id=...`) in `twitter.rs` when GraphQL guest token endpoint is unavailable or rate-limited.
- [x] 2.4 Register the new Tauri commands `get_twitter_thread` and `import_twitter_thread` in `src-tauri/src/lib.rs`.
- [x] 2.5 Add Rust unit tests in `src-tauri/src/twitter.rs` covering single tweets, NoteTweets, multi-post threads, quoted tweets, and error scenarios.

## 3. Frontend API, URL Detection, Command Palette, and Mobile Share Target Integration

- [x] 3.1 Update `src/hooks/useURLDetector.ts` to classify `x.com` and `twitter.com` status links with full support for user/status/id, www prefixes, and query parameters.
- [x] 3.2 Add `fetchTwitterThread` and `importTwitterThread` in `src/api/documents.ts` with TypeScript interfaces for `TwitterThread`, `TwitterPost`, `TwitterAuthor`.
- [x] 3.3 Update `src/hooks/useURLMetadata.ts` to fetch thread preview metadata without requiring a video payload.
- [x] 3.4 Update `src/components/search/GlobalSearch.tsx` and `CommandCenter.tsx` to surface the contextual "X Thread: Open and analyze this thread" result, triggering instant reader navigation upon pressing Enter.
- [x] 3.5 Update `src/components/import/ImportPreview.tsx` to render rich thread preview (author, handle, text excerpt, image count, video badges) with dual actions: Open Thread vs. Download Video (if video present).
- [x] 3.6 Update `src/hooks/useShareTarget.ts` to intercept shared X/Twitter links from native Android/iOS share sheets and PWA share targets, bypassing generic web scrapers and directly routing into `openTwitterThread`.

## 4. Reader Experience and Thread Viewer Surface

- [x] 4.1 Implement X thread document adapter in `src/stores/documentStore.ts` to register thread content as a readable HTML document with rich structured metadata (`metadata.xThread`).
- [x] 4.2 Style the thread reading column in `src/components/viewer/DocumentViewer.tsx` with author profile header, continuous thread spine, media grid, quoted tweet cards, and post action buttons.
- [x] 4.3 Implement "Save to Documents" action in the viewer header to promote ephemeral threads to permanent library documents.
- [x] 4.4 Implement one-click "Extract Post" action on each post header and ensure text selection popup (`SelectionPopup`) properly associates selections with the post and source URL.

## 5. Scoped AI Learning Tools (Summary, Insights, Ask, Flashcards)

- [x] 5.1 Update `src/utils/assistantContext.ts` to build normalized structured context (`[Post 1] ... [Post 2] ...`) with post boundaries for X threads.
- [x] 5.2 Add scoped "Summary" quick action in `src/components/assistant/AssistantPanel.tsx` with dedicated prompt scoping to the active thread and visible scope badge (`Scope: This X thread`).
- [x] 5.3 Add scoped "Insights" quick action in `src/components/assistant/AssistantPanel.tsx` generating Core Claims, Key Arguments, Takeaways, and Tensions.
- [x] 5.4 Ensure "Ask" conversational mode in `src/components/assistant/AssistantPanel.tsx` accurately cites and navigates to individual thread posts.
- [x] 5.5 Integrate AI flashcard generation with `/20rules` tool calls and preview/edit/approve workflow via `ChatFlashcardCollection`.

## 6. Mobile Responsiveness, Error States, and Polish

- [x] 6.1 Implement responsive mobile layout with bottom action bar / bottom sheet (`SelectionActionsSheet` / `PwaAssistantButton`) for summary, insights, and chat on mobile viewports.
- [x] 6.2 Implement explicit error cards for private accounts, deleted posts, rate limits, and network errors with "Retry" and "Open in Browser" buttons.
- [x] 6.3 Ensure non-blocking loading so the thread is readable while AI initialization occurs asynchronously in the background.

## 7. Testing and Verification

- [x] 7.1 Add unit tests for URL detection (`useURLDetector.test.ts`), metadata fetching (`useURLMetadata.test.ts`), mobile share routing (`useShareTarget.test.ts`), and command palette dispatch (`GlobalSearch.test.tsx`).
- [x] 7.2 Add integration tests for thread rendering, extract creation, and flashcard generation from X content.
- [x] 7.3 Run accessibility audits (keyboard navigation, focus management, screen reader labels, WCAG AA color contrast).
- [x] 7.4 Run performance benchmark check (`npm run bench:check`) and script tests (`npm run test:scripts`).
