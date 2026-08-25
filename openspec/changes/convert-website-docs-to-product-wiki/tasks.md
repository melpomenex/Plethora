## 1. Canonical Source-of-Truth & Ingestion Tooling

- [x] 1.1 Audit existing documentation across `docs/product/**`, `docs/USER_HANDBOOK.md`, `docs/IMPLEMENTATION_STATUS.md`, and `website/src/content/docs/**`, cataloging verified features vs unverified overclaims.
- [x] 1.2 Implement `scripts/docs-sync-website.mjs` to parse canonical markdown files from `docs/product/**`, map domain folders to public categories, inject website frontmatter, and populate `website/src/content/docs/`.
- [x] 1.3 Add claim validation to the ingestion script, verifying all referenced `claimIds` against `website/src/config/claims.json` and asserting that non-public/planned features are labeled correctly.
- [x] 1.4 Add automated checks to exclude internal notes (`published: false`) and draft documents from public production output.
- [ ] 1.5 Deprecate manual authoring in `docs/USER_HANDBOOK.md`, establishing an automated export generator for monolithic offline handbook distribution.
- [ ] 1.6 Archive legacy translated handbooks (`.de.md`, `.fr.md`, `.es.md`, `.ja.md`, `.zh.md`) to `docs/legacy/` and update in-app settings with honest scope labeling.

## 2. Astro Content Schema & Collection Configuration

- [x] 2.1 Update `website/src/content.config.ts` with the expanded docs schema supporting categories, reading times, feature statuses, platform tags, aliases, keywords, and redirect aliases.
- [x] 2.2 Define the 12 typed categories in `website/src/config/docs-taxonomy.ts` with human-readable titles, descriptions, icons, and display ordering.
- [x] 2.3 Add helper utilities in `website/src/lib/docs.ts` for category grouping, article sorting, table-of-contents extraction, and previous/next article resolution.

## 3. Documentation Coverage & Article Authoring

- [x] 3.1 Author and verify Category 1: *Start Here* articles (`getting-started.md`, `installation-desktop.md`, `installation-mobile.md`, `core-concepts-journey.md`, `quick-start-tutorial.md`).
- [x] 3.2 Author and verify Category 2: *Capture & Import* articles (`local-file-imports.md`, `web-url-scraping.md`, `arxiv-papers.md`, `kindle-clippings.md`, `anki-apkg-import.md`, `legacy-third-party-zip-import.md`, `browser-extension.md`).
- [x] 3.3 Author and verify Category 3: *Read & Listen* articles (`pdf-page-mode.md`, `pdf-scroll-mode.md`, `pdf-reflow.md`, `epub-cfi-reader.md`, `html-web-reader.md`, `markdown-latex-reader.md`, `video-transcript-karaoke.md`, `text-to-speech-engines.md`, `vim-reading-navigation.md`, `reading-position-persistence.md`).
- [x] 3.4 Author and verify Category 4: *Understand & Extract* articles (`selections-and-highlights.md`, `incremental-reading-extracts.md`, `extract-priority-inheritance.md`, `extract-lifecycle-management.md`, `dictionary-peek.md`, `notes-and-annotations.md`).
- [x] 3.5 Author and verify Category 5: *Organize & Connect* articles (`collections-and-folders.md`, `tagging-system.md`, `knowledge-graph-3d.md`, `topic-clustering.md`, `global-library-search.md`).
- [x] 3.6 Author and verify Category 6: *Remember & Review* articles (`flashcard-studio.md`, `cloze-deletion-cards.md`, `qa-cards.md`, `image-occlusion-ocr.md`, `audio-review-mode.md`, `review-sessions-grading.md`).
- [x] 3.7 Author and verify Category 7: *Scheduling & Algorithms* articles (`spaced-repetition-fundamentals.md`, `fsrs-6-algorithm.md`, `plethora-schedulers.md`, `topic-aware-scheduling.md`, `neural-queue-composition.md`).
- [x] 3.8 Author and verify Category 8: *Language Learning* articles (`language-profiles.md`, `lexical-coverage-dictionaries.md`, `sentence-mining.md`, `dictation-and-shadowing.md`).
- [x] 3.9 Author and verify Category 9: *AI & Providers* articles (`ai-provider-setup.md`, `byo-api-keys.md`, `on-device-gemini-nano.md`, `socratic-tutor.md`, `grounded-library-rag.md`, `ai-cost-and-privacy.md`).
- [x] 3.10 Author and verify Category 10: *RSS & Podcasts* articles (`rss-feed-management.md`, `rss-full-text-reader.md`, `semantic-preference-learning.md`, `podcast-whisper-transcription.md`).
- [x] 3.11 Author and verify Category 11: *Platforms & Devices* articles (`desktop-macos-windows-linux.md`, `mobile-android-apk.md`, `mobile-ios-status.md`, `eink-monochrome-mode.md`, `keyboard-shortcuts-command-palette.md`).
- [x] 3.12 Author and verify Category 12: *Settings, Privacy & Troubleshooting* articles (`themes-and-appearance.md`, `privacy-architecture-local-shield.md`, `backup-restore-plethora-export.md`, `troubleshooting-faq.md`, `feature-status-roadmap.md`).

## 4. Wiki Layout, Navigation & Reading Experience

- [x] 4.1 Create `website/src/components/wiki/WikiLayout.astro` providing the 3-column responsive shell (desktop sidebar, main reading measure, and right TOC).
- [x] 4.2 Build `website/src/components/wiki/WikiSidebar.astro` with collapsible category accordions, active article highlighting, and keyboard navigation.
- [ ] 4.3 Build `website/src/components/wiki/WikiMobileNav.astro` drawer with accessible hamburger toggle, focus trap, and touch-target compliance (≥44px).
- [x] 4.4 Build `website/src/components/wiki/WikiToc.astro` generating the "On this page" table of contents from `<h2>` and `<h3>` headings with scrollspy active section tracking.
- [x] 4.5 Build `website/src/components/wiki/WikiBreadcrumbs.astro` with schema.org BreadcrumbList metadata and direct links to parent category and docs home.
- [x] 4.6 Build `website/src/components/wiki/WikiPrevNext.astro` for sequenced pagination across articles within the same category.
- [x] 4.7 Build `website/src/components/wiki/WikiCallout.astro` supporting `note`, `tip`, `important`, `warning`, `platform`, and `experimental` styles with distinct icons and contrast-checked colors.
- [x] 4.8 Create `website/src/styles/wiki.css` establishing paper-and-ink reading typography, `<kbd>` styling, responsive tables with horizontal scroll wrappers, and code block styling with copy buttons.

## 5. Public Routes & Redirect Handling

- [x] 5.1 Redesign `website/src/pages/docs/index.astro` as the wiki home with hero search, quick-start guides, and category cards with article counts.
- [x] 5.2 Implement `website/src/pages/docs/[slug].astro` dynamic route to render individual articles with the full wiki layout.
- [x] 5.3 Implement `website/src/pages/docs/category/[category].astro` category overview pages listing all articles with descriptions and reading times.
- [ ] 5.4 Implement backward-compatible redirect middleware / pages for legacy `/docs/[slug]` URLs to prevent broken external links.
- [ ] 5.5 Create `website/src/pages/404.astro` enhancement with documentation search suggestions for missing `/docs/*` paths.

## 6. Local-First Static Search UX

- [x] 6.1 Configure local static search (Pagefind / bundled JSON index) in `website/astro.config.ts` and build scripts without external network dependencies.
- [x] 6.2 Build `website/src/components/wiki/WikiSearch.astro` hero search bar on `/docs` and compact trigger button on article pages.
- [ ] 6.3 Build `website/src/components/wiki/WikiSearchModal.tsx` accessible dialog with global keyboard shortcut (`/` or `⌘K`), arrow key navigation, and Escape to dismiss.
- [x] 6.4 Implement rich search ranking scoring titles, headings, aliases, keywords, and body text with category badges on results.
- [x] 6.5 Add ARIA combobox pattern and `aria-live="polite"` result count announcements for screen reader accessibility.
- [x] 6.6 Verify progressive enhancement so category browsing and article navigation work seamlessly with JavaScript disabled.

## 7. Testing, Validation & CI Gates

- [x] 7.1 Create `website/scripts/check-wiki.mjs` to validate that all internal links, related document IDs, and claim IDs resolve correctly without broken targets.
- [ ] 7.2 Add automated tests verifying that all heading IDs are unique, valid URL slugs, and match the rendered Table of Contents.
- [x] 7.3 Add automated checks ensuring draft and unpublished notes do not leak into production sitemaps or search indexes.
- [x] 7.4 Wire `website/scripts/check-wiki.mjs` into `npm run website:check` and the CI workflow.
- [ ] 7.5 Run end-to-end accessibility audits (Axe / Playwright) covering keyboard navigation, contrast ratios, and screen-reader headings across desktop and mobile viewports.
