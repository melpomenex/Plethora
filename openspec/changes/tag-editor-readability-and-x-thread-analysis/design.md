## Context

Plethora is a spaced repetition and incremental reading desktop application (Tauri 2.0 / React 19 / Rust / SQLite / TailwindCSS). It provides rich document viewers (PDF, EPUB, HTML, Markdown, Video, Audio) linked with contextual AI learning tools (`AssistantPanel`), text selection actions (`SelectionPopup`, `SelectionActionsSheet`), extract management (`Extract`), and flashcard review queues (`LearningItem`).

This design addresses two cohesive enhancements:
1. **Tag Editor Readability**: Resolving the visual bleed-through bug in `CompactTagEditor` / `ItemTagEditor` across the Documents view and ensuring an opaque, high-contrast foreground surface.
2. **First-Class X/Twitter Thread Analysis**: Expanding Plethora's Command Palette, mobile share sheet handling (`useShareTarget`), and reader architecture so that pasting or sharing any X/Twitter post or thread link instantly opens the content in Plethora's document viewer with scoped AI summary, insights, conversational Q&A, extracts, and flashcard generation.

## Goals / Non-Goals

**Goals:**
- Provide a completely opaque, high-contrast, theme-tokenized popover surface for `CompactTagEditor` and `ItemTagEditor`.
- Automatically recognize all canonical X/Twitter URLs (`x.com`, `twitter.com`, `www`, query parameters) in the Command Palette (`GlobalSearch`).
- Intercept incoming X/Twitter links shared via the Android/iOS native share sheet and PWA Web Share Target in `useShareTarget.ts`, bypassing generic scrapers and routing directly into the X thread reader.
- Open X posts and multi-post threads directly into Plethora's existing `DocumentViewer` / `DocumentViewerWrapper` without an upfront save ceremony.
- Provide scoped AI capabilities (Summary, Insights, Ask) preserving post boundaries (`Post 1`, `Post 2`, etc.) and preventing cross-document hallucination.
- Support one-click whole-post and selected-text extracts using Plethora's existing `Extract` schema.
- Support AI flashcard generation with interactive candidate preview, editing, and user approval prior to queue persistence.
- Provide an optional "Save to Documents" affordance to promote an ephemeral thread to a permanent library document.
- Ensure desktop and mobile responsive excellence with non-blocking loading and graceful degradation.

**Non-Goals:**
- Building a standalone, disconnected X client or replicating the full Twitter timeline/feed experience.
- Ingesting arbitrary massive third-party reply trees by default.
- Requiring authenticated Twitter API developer accounts or user Twitter logins (anonymous web guest tokens / syndication used exclusively).
- Forcing users to import/save an X thread to disk before summarizing or asking questions.

## Decisions

### 1. Tag Editor Opacity & Stacking Context
- **Decision**: Update `CompactTagEditor` popover container from bare `bg-popover` to an opaque composite surface with solid backing (`bg-popover`, `bg-background` fallback, `border-border`, `shadow-xl`, and `z-50`). Update `ThemeContext.tsx` so that `--color-popover` enforces an opaque hex/rgb color or uses `color-mix` with solid background even when a theme's `card` or `surface` color has alpha channel transparency.
- **Alternatives Considered**:
  - *Hardcoding `#1e293b` / `#ffffff`*: Rejected because it breaks Plethora's 40+ dynamic custom themes.
  - *Full Modal dialog*: Rejected because `CompactTagEditor` is designed for quick inline editing on dense rows without losing scroll context.

### 2. Command Palette & Mobile Share Sheet URL Routing
- **Decision**:
  - In `GlobalSearch.tsx`: When an X status URL is pasted, display an instant contextual row: **X Thread** — `Open and analyze this thread` (with author `@handle` and post preview). Primary Enter action immediately calls `openTwitterThread(url)`.
  - In `useShareTarget.ts`: When an incoming share intent contains an X/Twitter URL, detect it via `urlDetectorUtils.isTwitterURL`, bypass `importFromUrl` (which runs generic web article scrapers), and route directly into `openTwitterThread(url)`. Surface an informative notification toast with an immediate "Open & Analyze" action.
- **Alternatives Considered**:
  - *Generic article pipeline for X links*: Rejected because X is an SPA that blocks bot scrapers and doesn't serve readable article HTML.
  - *Modal-based import prompt*: Rejected because it introduces unnecessary friction before reading.

### 3. Backend Ingestion & Thread Normalization
- **Decision**: Extend `src-tauri/src/twitter.rs` beyond video extraction. Add `get_twitter_thread(url: String)`:
  - Uses existing guest token + GraphQL `TweetResultByRestId` (and fallback to syndication endpoint `https://cdn.syndication.twimg.com/tweet-result?id=...`).
  - Resolves author profile (name, screen_name, avatar, verified status), creation date, full note tweet text (for longform posts > 280 chars), media attachments (images/video URLs), and quotes.
  - Recursively fetches chronological self-replies from the same author to assemble the complete authored thread.
  - Produces both:
    1. A semantic HTML representation styled with Plethora reader CSS for the visual reading column.
    2. A structured plain-text representation with post boundaries (`[Post 1 by @handle] ... [Post 2 by @handle] ...`) for token-efficient AI context.
- **Alternatives Considered**:
  - *Generic HTML web article scraper (Defuddle / Readability)*: Rejected because Twitter/X dynamic JavaScript web pages block static scrapers and return empty shells.
  - *Headless browser rendering (Playwright/Puppeteer)*: Rejected due to heavy memory footprint and complexity compared to lightweight guest GraphQL/syndication API.

### 4. Reader Workspace & Scoped Learning Tools
- **Decision**: Reuse Plethora's `DocumentViewerWrapper` and `AssistantPanel`. When an X thread is opened:
  - It creates an ephemeral document in `useDocumentStore` (`fileType: "html"`, `tags: ["x", "twitter", "thread"]`, `metadata.source: url`, `metadata.xThread: ...`).
  - Sets `AssistantContext` with `type: "document"`, `source: "x-thread"`, and `content: structuredText`.
  - Contextual AI actions:
    - **Summary**: Injected system prompt strictly instructing concise summary of the author's thread points without preamble.
    - **Insights**: Structured analysis prompt dividing takeaways into Core Claims, Key Arguments, Practical Takeaways, and Tensions.
    - **Ask**: Conversational chat with post-level source citations.
    - **Flashcards**: Triggers `/20rules` tool calling (`create_qa_card`, `create_cloze_card`) using `ChatFlashcardCollection` for candidate preview/edit/approval.
  - Contextual reader actions:
    - **Extract**: Text selection triggers `createExtract` linked to the thread document ID with start/end offset and tweet post reference.
    - **Extract Post**: Post header button extracts the full post directly.
- **Alternatives Considered**:
  - *Separate X-only page/route*: Rejected because it duplicates the document viewer, AI assistant, selection popups, split-screen tabs, and theme integrations.

### 5. Ephemeral vs. Permanent Persistence Model
- **Decision**:
  - Opening a thread creates an ephemeral document (in-memory document store entry + cache in SQLite).
  - If the user creates an extract, card, or tag, the document is automatically committed to the database so references remain permanent.
  - A top-bar button `Save to Documents` allows explicit library saving with custom collection assignment.
- **Alternatives Considered**:
  - *Requiring explicit import before viewing*: Rejected; violates frictionless exploratory reading.
  - *Never saving to database*: Rejected; would break extracts and flashcards once the app restarts.

## Component Architecture

```
Command Palette (GlobalSearch.tsx)       Mobile Native Share Sheet (useShareTarget.ts)
                    │                                         │
                    └────────────────────┬────────────────────┘
                                         │ (Detected X/Twitter URL)
                                         ▼
                             Twitter Thread Ingestion
                     (src-tauri/src/twitter.rs + api/documents.ts)
                      - Guest Token & GraphQL / Syndication fetch
                      - Author, Posts, NoteTweets, Media, Quotes
                      - Generates HTML Reader View + Structured Text
                                         │
                                         ▼
                               Document Store & Tabs
                     (documentStore.ts / tabsStore.ts / TabRegistry.tsx)
                      - Registers ephemeral Document (fileType: "html")
                      - Opens "document-viewer" tab
                                         │
                                         ▼
                      DocumentViewerWrapper (Reader Surface)
      ┌─────────────────────────────────────────────────────────────┐
      │ Top Bar: Title, @Author, [Save to Docs]                     │
      ├──────────────────────────────┬──────────────────────────────┤
      │ Main Reading Column:         │ Assistant Panel / Sheet:     │
      │  - Author Profile Card       │  - Scope Indicator           │
      │  - Post 1 [Extract]          │  - [Summary] Tab             │
      │    - Media / Text            │  - [Insights] Tab            │
      │  - Post 2 [Extract]          │  - [Ask / Q&A] Tab           │
      │  - Quoted Posts              │  - [Flashcards] Tab          │
      │  - Text Selection Popup      │    - Candidate Review / Edit │
      └──────────────────────────────┴──────────────────────────────┘
```

## Risks / Trade-offs

- **[Risk]**: X changes guest GraphQL endpoints or rate-limits guest tokens.
  - **Mitigation**: Implement automatic fallback to syndication endpoint (`https://cdn.syndication.twimg.com/tweet-result?id=...`) which is resilient and widely used by embedded widgets. Display clear retry / "Open in Browser" buttons if all endpoints are blocked.
- **[Risk]**: Thread parsing might include irrelevant third-party replies.
  - **Mitigation**: Filter thread posts strictly by the original author's user ID and `in_reply_to_status_id_str` chain. Exclude third-party replies from default context.
- **[Risk]**: Long threads could exceed LLM context window tokens.
  - **Mitigation**: Utilize Plethora's existing `trimToTokenWindow` utility with intelligent post-aware chunking to prioritize opening posts and conclusions while preserving post IDs.
- **[Risk]**: CompactTagEditor opacity fix could affect unintended popovers if a global token is changed carelessly.
  - **Mitigation**: Apply the opaque background styling explicitly to `CompactTagEditor.tsx` and ensure `--color-popover` in `ThemeContext.tsx` is normalized to solid opacity without modifying unrelated text colors.

## Migration & Compatibility

- 100% backward compatible: Existing video import (`importTwitterVideo` / `TwitterVideoInfo`) continues to work seamlessly.
- Existing documents, extracts, and flashcard schemas remain unchanged.
- All 40+ existing light, dark, and glass themes will render the tag editor with full legibility.
