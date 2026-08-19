## ADDED Requirements

### Requirement: Contextual Recognition of X/Twitter URLs in Command Palette
When the user pastes or types an X/Twitter post or thread URL into the Command Palette (`GlobalSearch`), the system SHALL immediately classify it as an X content URL and surface a prominent contextual result enabling direct opening and analysis. Supported URL patterns SHALL include canonical `x.com/<user>/status/<id>`, `twitter.com/<user>/status/<id>`, `www` prefixes, and trailing query parameters.

#### Scenario: User pastes an x.com status link into the Command Palette
- **WHEN** the user pastes `https://x.com/karpathy/status/1756000000000000000` into the Command Palette
- **THEN** the palette detects the X status URL and displays an X Thread action: "Open and analyze this thread"
- **AND** normal search results are augmented or replaced with this contextual action

#### Scenario: User pastes a twitter.com link with query parameters
- **WHEN** the user pastes `https://twitter.com/sama/status/1780000000000000000?s=20&t=xyz` into the Command Palette
- **THEN** the status ID is extracted accurately and the action presents the normalized target

#### Scenario: Keyboard activation immediately opens the thread
- **WHEN** the X Thread action is active in the Command Palette and the user presses Enter
- **THEN** the Command Palette closes and Plethora opens the X content in the reader workspace

#### Scenario: Fast metadata resolution enriches the palette item
- **WHEN** X metadata resolves while the palette is open
- **THEN** the palette displays the author name, `@handle`, verified status, and opening post excerpt without blocking the user from pressing Enter immediately

### Requirement: Mobile Share Sheet Ingestion and Routing
When a user shares an X/Twitter post or thread URL from a mobile browser or the native X application via the Android/iOS share sheet or PWA Web Share Target into Plethora, the system SHALL intercept the URL in `useShareTarget`, recognize it as an X status URL, bypass generic HTML scrapers, and immediately route it to the dedicated X thread reader.

#### Scenario: User shares an X link to Plethora on mobile
- **WHEN** a user selects "Share" on an X post in the native X app or mobile browser and picks Plethora
- **THEN** `useShareTarget` recognizes the URL as an X status URL
- **AND** displays an immediate status toast ("Opening X thread...") with author and snippet
- **AND** automatically opens the thread in the reader or provides a one-tap "Open & Analyze" notification action

#### Scenario: Background app cold start via share intent
- **WHEN** Plethora is launched cold from an incoming mobile share intent containing an X link
- **THEN** the share listener processes the queued batch and navigates directly to the X thread viewer upon app initialization

### Requirement: First-Class X Reader Workspace
Plethora SHALL render the X post or thread inside the application's reader experience (`DocumentViewer` / `DocumentViewerWrapper`), presenting the thread author, timestamp, post sequence, rich media/images, and quoted posts as the central reading surface. Long-form posts (`note_tweet`) SHALL be displayed in full.

#### Scenario: Multi-post thread is rendered in continuous reading order
- **WHEN** a multi-post thread is opened
- **THEN** all posts in the authored thread are rendered in chronological sequence in the central reading column
- **AND** third-party unrelated replies are excluded from the default thread reading surface

#### Scenario: Quoted posts and media render inline
- **WHEN** a post in the thread quotes another post or contains images
- **THEN** the quoted post is styled distinctly within the parent post container
- **AND** images are rendered with zoom/inspect capability

#### Scenario: Non-blocking loading sequence
- **WHEN** an X URL is opened
- **THEN** the thread content renders as soon as the text/media payload is fetched
- **AND** learning tools (Summary, Insights, Ask, Flashcards) initialize asynchronously without displaying a full-page blocking spinner

### Requirement: Scoped AI Summary and Insights
The X reader workspace SHALL provide one-click Summary and Insights actions strictly scoped to the normalized thread content. The summary SHALL answer "What does this thread say?", while insights SHALL structure central claims, key arguments, evidence, practical takeaways, and tensions.

#### Scenario: Summary operates strictly on the active X thread
- **WHEN** the user triggers "Summary" from the X thread analysis panel
- **THEN** the AI generates a concise summary derived exclusively from the thread posts
- **AND** no external documents, open tabs, or general library items are mixed into the context
- **AND** a clear scope indicator (`Scope: This X thread`) is visible

#### Scenario: Insights generates structured analytical takeaways
- **WHEN** the user triggers "Insights"
- **THEN** the system returns structured points: Core Claims, Supporting Arguments, Key Takeaways, and Notable Tensions/Nuances

### Requirement: Scoped Conversational Q&A (Ask)
The X reader workspace SHALL provide a conversational Q&A assistant (`AssistantPanel`) scoped to the active X thread, with post boundary awareness enabling questions about specific numbered posts and precise citations.

#### Scenario: User asks questions about a specific post in the thread
- **WHEN** the user asks "Explain the argument made in the 3rd post"
- **THEN** the assistant references the specific 3rd post content and provides a direct, scoped answer

#### Scenario: User asks for evidence or assumptions
- **WHEN** the user asks "What assumptions does the author make about AI scaling?"
- **THEN** the assistant synthesizes the answer from the thread posts with attribution to the author

### Requirement: Extracts from X Content
Users SHALL be able to create Plethora `Extract` records directly from X thread content, both via text selection and via a one-click whole-post extraction action. Extracts SHALL preserve full provenance linking back to the source URL, author, and post ID.

#### Scenario: Selecting text within a post creates an extract
- **WHEN** the user highlights text within any post of the X thread and selects "Extract" from the selection popup
- **THEN** an `Extract` object is created in Plethora with the highlighted text, document ID, and source metadata
- **AND** a confirmation toast appears allowing immediate review or card formulation

#### Scenario: One-click whole-post extraction
- **WHEN** the user clicks the "Extract Post" action on a specific post
- **THEN** the entire post text is captured as an `Extract` tagged with the author and post ID

### Requirement: Flashcard Generation and Review Workflow
The X reader workspace SHALL support creating flashcards manually from extracts/selections, as well as AI-assisted candidate flashcard generation. AI-generated cards SHALL be presented in a candidate review modal/list where the user can inspect, edit, delete, or approve cards before saving them into their spaced repetition review system.

#### Scenario: Manual flashcard creation from selection
- **WHEN** the user selects text in the thread and chooses "Create Flashcard"
- **THEN** the flashcard modal/studio opens pre-populated with the selection and linked to the source

#### Scenario: AI-assisted flashcard candidate generation
- **WHEN** the user clicks "Generate Flashcards"
- **THEN** the AI proposes a set of atomic flashcards (Q&A or Cloze adhering to 20 rules of knowledge formulation)
- **AND** the cards are displayed in candidate preview state
- **AND** unapproved cards are NOT added to the review queue

#### Scenario: User reviews, edits, and approves candidate flashcards
- **WHEN** candidate cards are displayed
- **THEN** the user can edit the question/answer text, delete unwanted candidates, and click "Approve"
- **AND** only approved cards are committed to SQLite with appropriate deck and document tags

### Requirement: Persistence and Optional Save
Opening an X URL SHALL create a lightweight ephemeral or temporary backing document so that learning operations (extracts, cards, notes) have an anchor ID. An explicit "Save to Documents" action SHALL be available to convert the thread into a permanent library document.

#### Scenario: Ephemeral thread viewing without upfront import
- **WHEN** the user pastes an X URL and reads/summarizes it without clicking "Save to Documents"
- **THEN** the thread is readable and AI tools work immediately without cluttering the user's primary Documents view

#### Scenario: User explicitly saves thread to Documents
- **WHEN** the user clicks "Save to Documents"
- **THEN** the thread is committed as a permanent document with tags, category, and reading progress tracking

#### Scenario: Extracts and cards retain provenance regardless of explicit save
- **WHEN** the user creates extracts or cards from an X thread without explicitly clicking "Save to Documents"
- **THEN** the underlying source record and URL metadata are persisted so that reviewing the card or extract always links back to the original X post

### Requirement: Error Handling and Graceful Degradation
The X ingestion and reader pipeline SHALL provide explicit, user-friendly error handling for deleted posts, private accounts, network errors, and AI provider unavailability.

#### Scenario: Private or deleted tweet
- **WHEN** an X URL points to a deleted, suspended, or private post
- **THEN** the reader surface displays an informative error card ("Post unavailable or private") with a "Retry" and "Open in Browser" button

#### Scenario: AI provider error or offline mode
- **WHEN** the user's configured AI provider fails or is unreachable
- **THEN** the X thread remains completely readable and manual text selection/extracts continue to function normally
- **AND** a non-intrusive toast explains that AI features are currently unavailable

### Requirement: Responsive Desktop and Mobile Layouts
The X reading and analysis experience SHALL adapt to desktop and mobile form factors without compromising readability. Desktop SHALL offer a dual-pane layout (central thread reading column + side assistant panel), while mobile SHALL offer a single-column thread reader with an expandable bottom action sheet for tools.

#### Scenario: Desktop side-by-side workspace
- **WHEN** viewing an X thread on a desktop viewport (>= 1024px)
- **THEN** the thread occupies the main reader column and the analysis panel resides on the side with resizable split

#### Scenario: Mobile contextual tool sheet
- **WHEN** viewing an X thread on a mobile device (< 768px)
- **THEN** the thread occupies the full screen width and tapping "Summary", "Insights", or "Ask" slides up a contextual bottom sheet without unmounting the reader
