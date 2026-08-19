# X Thread Reader (Native)

## ADDED Requirements

### Requirement: ThreadReaderApp-first Thread Retrieval
When the user opens an X/Twitter status URL in Plethora, the backend SHALL attempt full-thread retrieval through ThreadReaderApp before any X GraphQL reconstruction: ping the status id to resolve the canonical thread root, fetch the unrolled thread, and normalize it into the existing `TwitterThread` model with posts in chronological authored order.

#### Scenario: Multi-post thread is fully unrolled
- **WHEN** the user opens a URL pointing at any post of a multi-post authored thread
- **THEN** the backend resolves the thread root id via `GET https://threadreaderapp.com/api/v0/ping/{id}.json` (`pong` field)
- **AND** retrieves the complete ordered thread content
- **AND** returns a `TwitterThread` whose `posts` array contains every authored post in chronological order with text, images, and post ids

#### Scenario: No ThreadReaderApp thread — single post fallback
- **WHEN** ThreadReaderApp reports no unrolled thread for the status id (ping `code: 404` or page parse yields no posts)
- **THEN** the backend fetches the single post via the existing X GraphQL/syndication path
- **AND** returns a one-post `TwitterThread`
- **AND** the reader renders it as a normal single-post thread WITHOUT showing an error

#### Scenario: ThreadReaderApp JSON route unavailable
- **WHEN** `GET /api/v0/thread/{id}.json` returns non-200 (the route is currently dead — verified 2026-08-19)
- **THEN** the adapter falls back to parsing the server-rendered `/thread/{root_id}.html` page using per-post `data-tweet` blocks
- **AND** if the JSON route responds with the documented `{"code":200,...}` contract in the future, the JSON `content[]` array is used instead

#### Scenario: Thread ordering and reply scoping
- **WHEN** a thread is retrieved
- **THEN** posts are ordered exactly as authored (document order)
- **AND** duplicate post ids are removed
- **AND** third-party replies are NOT included in the thread

### Requirement: Optional X Enrichment Without Blocking
The backend SHALL expose enrichment of a normalized thread with X GraphQL data (timestamps, engagement counts, video URLs, avatars, quoted-post details) as an optional, non-blocking, failure-isolated operation with bounded concurrency. The reader and AI tools SHALL work from the unrolled data immediately and SHALL NOT wait for enrichment.

#### Scenario: Enrichment completes after the thread is readable
- **WHEN** a thread is opened
- **THEN** the reader displays posts/text/images immediately from the unrolled data
- **AND** enrichment runs in the background with at most 4 concurrent X requests
- **AND** when it completes, timestamps, engagement, video URLs, avatars, and quoted-post details appear in place without layout jumps

#### Scenario: Enrichment fails entirely
- **WHEN** X GraphQL and syndication are unavailable for enrichment
- **THEN** the thread still renders with unrolled text and images
- **AND** no error is shown for the missing optional metadata

### Requirement: Native X Thread Reader (Desktop)
When a document's `metadata.xThread` is present, the viewer SHALL render a dedicated native `XThreadViewer` using Plethora design tokens and layout conventions — NOT the generic HTML iframe, NOT any generated HTML string, and NOT an embedded third-party page.

#### Scenario: Thread opens in a native reading surface
- **WHEN** an X thread document is opened on desktop
- **THEN** the content area shows the native reader with the full Plethora theme background
- **AND** a centered reading column (target 680–760px, responsive) contains the author header and all posts
- **AND** a subtle theme-aware vertical spine visually connects posts in order

#### Scenario: No generic HTML artifacts
- **WHEN** the thread is displayed
- **THEN** no iframe is used for thread content
- **AND** no white/light page background appears in dark themes
- **AND** no webpage-style document chrome, centered fallback text, or generic article typography is applied

#### Scenario: Thread header
- **WHEN** the thread reader is shown
- **THEN** a compact header displays the author avatar, display name, `@handle`, thread/post count, optional date, and actions: Open on X, Save to Documents, and an overflow menu

### Requirement: Post Presentation
Each thread post SHALL render with author identity, thread position, full untruncated body text with preserved paragraph breaks, media, quoted posts, and restrained learning actions.

#### Scenario: Long-form and multi-paragraph posts
- **WHEN** a post contains long-form (NoteTweet) or multi-paragraph text
- **THEN** the full text renders with preserved line/paragraph breaks and comfortable reading typography
- **AND** no arbitrary centering, no cramped or overly wide lines, and no truncation

#### Scenario: Post actions
- **WHEN** the user interacts with a post
- **THEN** an unobtrusive overflow menu offers Extract Post, Create Flashcard, Copy post text, and Open on X
- **AND** text selection inside a post opens Plethora's existing selection actions (Extract / Explain / Ask / Summarize Selection / Create Flashcard)
- **AND** no permanent row of five controls is shown under every post

### Requirement: Media Rendering
Thread media SHALL render natively with correct aspect ratios, rounded corners, grids for multi-image posts, lazy loading, alt text, and graceful handling of videos.

#### Scenario: Image layouts
- **WHEN** a post contains images
- **THEN** single images render full-width with correct aspect ratio
- **AND** 2+ images render in a grid consistent with Plethora's design system
- **AND** images are not stretched, are lazy-loaded, and can be inspected/zoomed using existing image infrastructure

#### Scenario: Video posts
- **WHEN** a post contains a video and enrichment provided a usable mp4 URL
- **THEN** an inline native video player renders with a poster and controls
- **WHEN** no usable video URL is available
- **THEN** an attractive preview card links to the video on X instead of a broken player

### Requirement: Quoted Posts
Quoted posts SHALL be visually distinct from main-thread posts and preserved distinctly in AI context.

#### Scenario: Post quotes another post
- **WHEN** a thread post quotes another post (resolved via enrichment)
- **THEN** the quote renders inside the parent post on a subdued secondary surface with avatar, name, handle, clamped text, and Open on X
- **AND** the quote is not styled like a main thread post
- **WHEN** the quoted post cannot be resolved
- **THEN** a subdued "View quoted post on X" card renders instead

### Requirement: Mobile X Thread Reader
On mobile viewports the thread SHALL render in a dedicated mobile layout: full-width theme surface, safe-area handling, compact sticky header, bottom learning toolbar, and a native bottom-sheet assistant.

#### Scenario: Mobile reading surface
- **WHEN** an X thread is opened on a narrow viewport
- **THEN** the reader fills the width with 16–20px horizontal padding and safe-area insets
- **AND** there is no horizontal overflow, no white page background, and no iframe/page margins

#### Scenario: Mobile assistant bottom sheet
- **WHEN** the user taps Summary, Insights, or Ask
- **THEN** a native bottom sheet opens with compact/peek, half, and expanded states
- **AND** closing or minimizing the sheet restores the reader exactly where the user was (no unmount, no refetch, scroll preserved)

#### Scenario: Mobile learning toolbar
- **WHEN** the reader is open on mobile
- **THEN** a compact bottom toolbar offers Summary / Insights / Ask / More
- **AND** the toolbar does not cover the final lines of the thread

### Requirement: Unified AI Context
The same normalized thread model that drives the visible reader SHALL drive AI summary, insights, and Ask, with stable post boundaries and post-level citations.

#### Scenario: AI sees exactly what the reader shows
- **WHEN** Summary, Insights, or Ask is used on an X thread
- **THEN** the context contains every post from the same `metadata.xThread` the viewer renders, framed with post boundaries (`[Post N of M]`)
- **AND** a scope indicator ("Scope: This X thread") is visible

#### Scenario: Post-level questions and citations
- **WHEN** the user asks about a specific post (e.g. "Explain post 4")
- **THEN** the assistant answers using that post's content
- **AND** the answer's citation can scroll the reader to the corresponding post and highlight it

### Requirement: Extracts with Provenance
X thread content SHALL support Plethora extracts from selection and from whole posts, with provenance including source URL, thread root id, post id, post index, and author.

#### Scenario: Selection extract
- **WHEN** the user selects text in a post and chooses Extract
- **THEN** an Extract is created with the selected text and metadata linking to the post and thread
- **AND** the extract can navigate back to its source post when opened

#### Scenario: Whole-post extract
- **WHEN** the user chooses Extract Post from a post's overflow menu
- **THEN** an Extract is created from the post's full text with the same provenance

### Requirement: Flashcards
X thread content SHALL support flashcard creation from selection, from a post, and AI generation from the whole thread, using Plethora's existing preview/edit/approve workflow.

#### Scenario: Card creation paths
- **WHEN** the user creates a flashcard from a selection, a post, or the assistant's Flashcards action
- **THEN** the existing candidate preview/edit/approve flow is used
- **AND** no X-specific card records are created

### Requirement: Persistence and Provenance Durability
Opening an X URL SHALL immediately produce a readable, AI-capable thread document without an explicit import; the normalized thread model SHALL be persisted so it survives app restarts; repeated opens of the same URL SHALL NOT create duplicate permanent documents.

#### Scenario: Immediate reading without import ceremony
- **WHEN** the user pastes or shares an X link
- **THEN** the thread opens in the reader and AI tools work immediately without an explicit import step

#### Scenario: Model survives restart
- **WHEN** a thread document is loaded from the library after an app restart
- **THEN** `metadata.xThread` is restored from the persisted `structured_content`
- **AND** the native viewer and post-boundary AI context both work from the restored model

#### Scenario: No duplicate documents
- **WHEN** the same X URL (or a mid-thread URL of the same thread) is opened again
- **THEN** the existing document is focused instead of creating a duplicate

### Requirement: Progressive Loading and Error States
The reader SHALL show a native skeleton while loading and native, actionable error states on failure; the core reading experience SHALL NOT fail because optional data failed.

#### Scenario: Loading skeleton
- **WHEN** a thread URL is accepted and data is being fetched
- **THEN** a skeleton shaped like the thread (posts, spine, media placeholders) is shown
- **AND** AI tools enable as soon as the normalized thread text exists

#### Scenario: Thread unavailable
- **WHEN** the post is private, deleted, or otherwise unavailable
- **THEN** the reader shows "Unable to load this X thread" with a reason and Retry / Open on X actions

#### Scenario: ThreadReaderApp unavailable but the post exists
- **WHEN** full-thread retrieval fails but the direct post is fetched
- **THEN** the single post renders as a normal reader with a dismissible "Full thread could not be retrieved" note — not an alarming error

#### Scenario: AI unavailable
- **WHEN** the configured AI provider is unavailable
- **THEN** the thread remains fully readable and non-AI actions (selection, extracts, manual flashcards) keep working

### Requirement: Theme, Accessibility, Security, and Performance
The X reader SHALL use only Plethora theme tokens; be keyboard/screen-reader accessible; never inject unsanitized third-party HTML; and avoid redundant network requests.

#### Scenario: Theme parity
- **WHEN** the app is in a dark, light, glass, or e-ink theme
- **THEN** the entire reader surface, spine, quote cards, skeleton, and error states render with the corresponding tokens and sufficient contrast

#### Scenario: Accessibility
- **WHEN** a screen reader or keyboard user reads a thread
- **THEN** each post is announced as "Post N of M" with author attribution, images have meaningful alt text, all controls have accessible names and focus states, and reduced-motion preferences are respected

#### Scenario: Sanitized content
- **WHEN** thread content originates from ThreadReaderApp HTML fragments
- **THEN** it is parsed into structured text/media (tags and scripts removed server-side)
- **AND** no `dangerouslySetInnerHTML` is used for third-party content in the viewer

#### Scenario: No redundant requests
- **WHEN** the user opens, closes, and reopens the AI panel or revisits the same thread
- **THEN** no duplicate TRA/GraphQL requests are made for content already retrieved (in-memory cache keyed by thread root id)
