## ADDED Requirements

### Requirement: Structured Wiki Information Architecture & Category Taxonomies
The public documentation center SHALL organize all user-facing documentation into 12 structured categories (`start-here`, `capture-and-import`, `read-and-listen`, `understand-and-extract`, `organize-and-connect`, `remember-and-review`, `scheduling-and-algorithms`, `language-learning`, `ai-and-models`, `rss-and-podcasts`, `platforms-and-devices`, `settings-privacy-troubleshooting`) with dedicated category overview pages and structured hierarchical navigation.

#### Scenario: User navigates to docs landing page
- **WHEN** user visits `/docs`
- **THEN** the page renders a prominent search bar, starter guide highlights, and a 12-category card grid displaying title, description, and published article count for each category.

#### Scenario: User navigates to a category overview page
- **WHEN** user visits `/docs/category/read-and-listen`
- **THEN** the system renders a category landing page listing all published articles in that category with article summaries, estimated reading times, and platform badges.

### Requirement: Three-Column Responsive Wiki Layout & Navigation
The documentation system SHALL provide a responsive three-column layout on desktop (navigation sidebar on left, article reading measure in center, table of contents on right), collapsing gracefully to a single-column layout with an accessible slide-over navigation drawer on mobile viewports (<1024px).

#### Scenario: Desktop viewport rendering
- **WHEN** user views an article at viewport width ≥1024px
- **THEN** the desktop sidebar displays sticky collapsible category accordions with the current article highlighted, the article content is centered with optimal line measure (65–75ch), and the right sidebar displays the "On this page" table of contents.

#### Scenario: Mobile viewport navigation drawer
- **WHEN** user views an article at viewport width <1024px and taps the documentation menu button
- **THEN** an accessible slide-over drawer opens displaying the complete hierarchical documentation navigation with touch targets ≥44px, trapping focus inside the drawer until closed.

### Requirement: Dynamic Table of Contents with Scrollspy
Articles with two or more headings SHALL display an "On this page" Table of Contents that automatically extracts `<h2>` and `<h3>` headings and dynamically highlights the active section in view as the user scrolls.

#### Scenario: Scrollspy active section highlighting
- **WHEN** user scrolls through an article past an `<h2>` heading
- **THEN** the corresponding entry in the Table of Contents receives the active visual state (`aria-current="location"` or active styling class) without layout jitter.

#### Scenario: Deep linking to heading anchor
- **WHEN** user clicks a heading link or enters a URL with a `#heading-id` hash
- **THEN** the viewport smoothly scrolls to the target heading, sets focus appropriately, and updates the browser history state.

### Requirement: Breadcrumb & Sequenced Article Pagination
Every documentation article SHALL include structured breadcrumbs at the top and previous/next article pagination controls at the bottom to support progressive linear reading within categories.

#### Scenario: Breadcrumb trail navigation
- **WHEN** user views an article at `/docs/read-and-listen/pdf-scroll-mode`
- **THEN** the breadcrumb trail renders `Docs › Read & Listen › PDF Scroll Mode`, with valid link targets to `/docs` and `/docs/category/read-and-listen`.

#### Scenario: Previous and Next article footer navigation
- **WHEN** user reaches the end of an article within a category
- **THEN** the footer provides labeled links to the previous and next articles in that category's defined sequence.

### Requirement: Semantic Callouts & Editorial Typography
The documentation renderer SHALL support semantic callout admonitions (`note`, `tip`, `important`, `warning`, `platform`, `experimental`) with distinct accessible icons, borders, and high-contrast background surfaces, alongside styled code blocks with copy buttons, `<kbd>` keyboard shortcuts, and responsive table wrappers.

#### Scenario: User views an editorial callout
- **WHEN** an article contains `<WikiCallout type="warning">`
- **THEN** the callout renders with an accessible warning icon, an alert border, WCAG AA compliant text and background contrast, and is announced with appropriate semantics.

#### Scenario: Code block copy to clipboard
- **WHEN** user clicks the copy button on a code block
- **THEN** the code snippet is copied to the system clipboard and the button momentarily displays visual confirmation text ("Copied!").

### Requirement: Backward-Compatible URL Routing & Legacy Redirects
The documentation system SHALL maintain `/docs` as its canonical base URL and automatically redirect legacy flat URLs (`/docs/[slug]`) to their new hierarchical category paths (`/docs/[category]/[slug]`).

#### Scenario: User visits legacy document slug
- **WHEN** user requests `/docs/incremental-reading`
- **THEN** the server returns an HTTP 301/308 redirect or client rewrite to `/docs/understand-and-extract/incremental-reading-extracts`.
