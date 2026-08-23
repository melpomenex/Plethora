## Why

The current public documentation experience on `useplethora.com` is minimal and fragmented: `/docs` renders a flat list of 6-7 placeholder stubs (`getting-started.md`, `incremental-reading.md`, `reading-formats.md`, `spaced-repetition.md`, `anki-packages.md`) through a generic marketing layout (`commercial.css`). It lacks search, deep information architecture, taxonomy, structured navigation (desktop sidebar, mobile drawer, table of contents), breadcrumbs, prev/next links, responsive reading typography, callouts, and comprehensive coverage of Plethora's 80+ real features.

Meanwhile, the application repository maintains three divergent documentation representations:
1. The machine-readable canonical product documentation corpus (`docs/product/**`) created for in-app help and grounded RAG.
2. The legacy monolithic handbook (`docs/USER_HANDBOOK.md`) and translations (`.de.md`, `.fr.md`, etc.).
3. The marketing website's separate doc stubs (`website/src/content/docs/**`).

Without a single canonical source of truth and a dedicated wiki architecture, documentation drifts across files, outdated overclaims (such as live AnkiConnect sync, unreleased cloud sync, or unenforced paywalls) persist, and users cannot easily find trustworthy guidance on using Plethora.

This change converts the current `/docs` section into a comprehensive, searchable product wiki/help center with verified product behavior, an automated single-source-of-truth ingestion pipeline, a rich 12-category information architecture, local-first static search, and responsive editorial typography.

## What Changes

- **Canonical Source-of-Truth Ingestion Pipeline**: Establish `docs/product/**` as the single canonical source of truth for Plethora product documentation. Implement a build-time synchronization tool (`scripts/docs-sync-website.mjs`) that ingests canonical feature documents into Astro's content collection (`website/src/content/docs/`), enriching them with website-specific metadata (`category`, `order`, `claimIds`, `published`, `redirectAliases`, `sourcePath`) while validating claims against `website/src/config/claims.json`.
- **Astro Content Schema Expansion**: Upgrade `website/src/content.config.ts` to support rich metadata including categories, subcategories, reading times, claim IDs, feature statuses, platform tags, aliases, keywords, and related doc references.
- **12-Category User-Goal Information Architecture**: Reorganize documentation around user learning goals:
  1. *Start Here* (Getting Started, Installation, First Launch, Core Concepts)
  2. *Capture & Import* (Local Files, URL Scraping, Arxiv, Kindle Clippings, Anki Packages, SuperMemo ZIPs, Browser Extension)
  3. *Read & Listen* (PDF Page & Scroll Modes, PDF Reflow, EPUB & CFI Tracking, HTML Reader, Markdown & LaTeX, Video Transcripts, TTS Engines, Vim Navigation, Position Persistence)
  4. *Understand & Extract* (Selections & Highlights, Incremental Reading Extracts, Priority & Inheritance, Extract Lifecycle, Dictionary Peek, Notes)
  5. *Organize & Connect* (Collections, Smart Tagging, Knowledge Graph, Topic Clustering, Global Search)
  6. *Remember & Review* (Flashcard Studio, Cloze Cards, Q&A, Image Occlusion, Audio Review Mode, Review Sessions)
  7. *Scheduling & Algorithms* (SRS Principles, FSRS-6, SuperMemo SM-18 / SM-20 / SM-2/5/8/15, Topic-Aware Scheduling, Neural Queue)
  8. *Language Learning* (Language Profiles, Lexical Coverage, Sentence Mining, Dictation & Shadowing)
  9. *AI & Providers* (BYO API Keys, On-Device Models / Gemini Nano, Socratic Tutor, Grounded RAG, Cost & Privacy Controls)
  10. *RSS & Podcasts* (RSS Management, Full-Text Extraction, Semantic Preferences, Podcast Whisper Transcription)
  11. *Platforms & Devices* (Desktop Win/macOS/Linux, Mobile Android APK & iOS Simulator status, E-Ink Mode, Keyboard Shortcuts)
  12. *Settings, Privacy & Troubleshooting* (Themes & Appearance, Local-First Privacy Shield, Backups & .plethora Export, Troubleshooting & Diagnostic Guides, Feature Status)
- **Dedicated Wiki Layout & Navigation**:
  - `/docs` Landing Page: Hero search bar, featured starter tracks, categorized card grid with live counts and descriptions.
  - Left-hand Sidebar: Sticky on desktop, collapsible category groups, active-page indicators, keyboard-accessible accordion.
  - Collapsible Mobile Navigation Drawer: Accessible slide-over with hamburger trigger in header, focus trap, and touch-friendly targets (≥44px).
  - Right-hand "On This Page" Table of Contents: Automatically extracted from `<h2>` and `<h3>` headings, highlighting the currently active section via IntersectionObserver.
  - Breadcrumb navigation (`Docs > Category > Article Title`).
  - Previous / Next article pagination footer.
  - Related documents links.
  - Deep-linkable heading anchor links with hover/focus indicators.
  - Stable URL handling & backward compatibility: preserves `/docs/[slug]` with automatic redirects to new canonical `/docs/[category]/[slug]` paths.
- **Local-First Static Search System**:
  - Build-time search indexing with zero external hosted dependencies.
  - Indexing: title, category, headings, aliases, keywords, and body text.
  - Global keyboard shortcut `/` or `⌘K` / `Ctrl+K`, Escape to dismiss.
  - Accessible results modal: ARIA combobox pattern, keyboard navigation, result counts announced to screen readers via `aria-live="polite"`.
  - Progressive enhancement: full category browsing and article navigation work with JavaScript disabled.
- **Article Editorial Typography & Presentation**:
  - Paper-and-ink reading typography using Source Serif 4 headings and clean UI sans body.
  - Semantic callout components: `note`, `tip`, `important`, `warning`, `platform`, `experimental` with distinct accessible icons, borders, and backgrounds.
  - Code blocks with syntax highlighting, language badge, and 1-click copy button.
  - `<kbd>` styling for keyboard shortcuts.
  - Responsive tables with horizontal scroll wrappers preventing layout breakage on mobile.
  - Numbered procedure steps with bold action verbs and expected outcomes.
- **Documentation Coverage, Validation & Governance**:
  - Documentation audit against shipped code, tests, and claim matrix (`claims.json`).
  - Strict validation check (`website/scripts/check-wiki.mjs` wired into `npm run website:check` and CI): validates all internal links, claim IDs, required frontmatter, heading uniqueness, and non-empty content.
  - Honest disclosure of unverified/planned capabilities (AnkiConnect live sync, cross-device E2EE sync, store checkout) labeled with clear "Planned" / "Experimental" / "Coming Soon" badges.
  - Legacy handbook (`docs/USER_HANDBOOK.md`) handling: deprecated as manual source, replaced by generated export; German/French/Spanish/Japanese/Chinese translations retained in legacy/archive and settings with transparent scope disclosure.

## Capabilities

### New Capabilities

- `website-product-wiki`: Information architecture, wiki layouts, hierarchical category navigation, mobile drawer, table of contents, breadcrumbs, article presentation, editorial callouts, and backward-compatible URL routing for the public documentation center.
- `website-wiki-search`: Local-first static documentation search engine and accessible modal interface, indexing titles, headings, aliases, keywords, and body text with keyboard navigation and zero external dependencies.
- `website-documentation-coverage`: Single-source-of-truth ingestion from `docs/product/**` into `website/src/content/docs/`, comprehensive coverage audit of all shipped features, strict automated link/claim validation, and governance rules preventing documentation drift.

### Modified Capabilities

<!-- No existing capability specs modified -->

## Impact

- **Website Content & Config**:
  - Expands `website/src/content.config.ts` docs collection schema.
  - Populates comprehensive markdown articles in `website/src/content/docs/**`.
  - Updates `website/src/config/routes.ts` and `website/src/config/claims.json` where new public doc claims are validated.
- **Website Layouts & Components**:
  - Replaces `website/src/pages/docs/index.astro` and `website/src/pages/docs/[slug].astro`.
  - Adds `website/src/pages/docs/[category]/[slug].astro` and `website/src/pages/docs/category/[category].astro`.
  - Creates new components in `website/src/components/wiki/`: `WikiLayout.astro`, `WikiSidebar.astro`, `WikiNav.astro`, `WikiToc.astro`, `WikiBreadcrumbs.astro`, `WikiSearch.astro`, `WikiSearchModal.tsx`, `WikiCallout.astro`, `WikiPrevNext.astro`, `WikiCard.astro`.
  - Adds wiki styling in `website/src/styles/wiki.css`.
- **Scripts & CI**:
  - Creates `scripts/docs-sync-website.mjs` for canonical doc transformation and validation.
  - Adds `website/scripts/check-wiki.mjs` (link checking, claim assertions, heading anchor validation) hooked into `npm run website:check`.
- **Dependencies**:
  - Adds local search library (Pagefind static indexer or client-side indexing utility) to `website/package.json`.
