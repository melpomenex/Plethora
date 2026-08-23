# Technical Design: Plethora Product Wiki & Help Center

## Context

The Plethora repository contains a rich learning operating system built on Tauri 2.0 (Rust) and React 19 (TypeScript), supporting incremental reading, spaced repetition (FSRS-6, SM-18, SM-20, TAS), multi-engine neural TTS, OCR, AI learning tools, RSS, podcasts, e-ink optimization, and cross-device sync.

Currently, public documentation on `useplethora.com` is minimal:
- `website/src/pages/docs/index.astro` and `website/src/pages/docs/[slug].astro` render a flat list of 6-7 placeholder stubs (`getting-started.md`, `incremental-reading.md`, etc.).
- Articles inherit a generic marketing layout (`commercial.css`) without navigation sidebars, table of contents, breadcrumbs, search, or editorial styling.
- There is significant documentation drift across the repository:
  1. `docs/product/**` (created for in-app help and grounded RAG).
  2. `docs/USER_HANDBOOK.md` and legacy translations (`.de.md`, `.fr.md`, `.es.md`, `.ja.md`, `.zh.md`).
  3. `website/src/content/docs/**`.
- Audits revealed historical overclaims in older handbooks, such as claiming live AnkiConnect sync, unreleased cross-device sync, zero-knowledge encryption, or active StoreKit billing when those features are planned, mocked, or in-development.

This design transforms `/docs` into a world-class, code-verified, searchable product wiki and help center that serves real users, maintains strict claim integrity, and establishes an automated single-source-of-truth pipeline.

## Goals / Non-Goals

### Goals
- **Single Source of Truth**: Establish `docs/product/**` as the authoritative product documentation corpus, automatically transforming and ingesting it into `website/src/content/docs/**`.
- **User-Centric 12-Category Information Architecture**: Structure documentation by user workflows (Start Here, Capture & Import, Read & Listen, Understand & Extract, Organize & Connect, Remember & Review, Scheduling & Algorithms, Language Learning, AI & Providers, RSS & Podcasts, Platforms & Devices, Settings, Privacy & Troubleshooting).
- **Comprehensive Documentation Coverage**: Document all verified shipped features (80+ pages) with precise behavioral rules, platform differences, prerequisites, and troubleshooting.
- **Strict Claim & Truthfulness Verification**: Enforce that public documentation only makes statements backed by verified code, failing CI if any banned or unverified claim is exposed without appropriate qualification.
- **Local-First, Fast Search UX**: Deliver a local-first search system (indexing titles, headings, aliases, keywords, and body text) with modal dialog, keyboard navigation (`/` or `⌘K`), and zero external server dependencies.
- **Dedicated Wiki Layout & Reading Experience**: Provide a paper-and-ink editorial reading experience with responsive desktop sidebar, mobile drawer, table of contents with scrollspy, breadcrumbs, previous/next links, and semantic callouts.
- **Backward Compatibility & Stable URLs**: Maintain canonical URL structure at `/docs` with category routing and automatic redirect support for existing `/docs/[slug]` paths.
- **Full Offline & Progressive Enhancement**: Ensure all articles, categories, and navigation links function cleanly with JavaScript disabled.

### Non-Goals
- **No Application Code Modifications**: This change does not alter desktop/mobile application behavior, database schemas, or Tauri commands.
- **No Marketing of Unverified Capabilities**: Unshipped sync engines, live AnkiConnect sync, or unreleased billing will not be presented as shipping features.
- **No Heavy Hosted Search Services**: No Algolia, Elastic, or proprietary hosted search SaaS; search is fully static and client-side.
- **No Automated Machine Translation of the Whole Wiki**: The wiki will be authored canonically in English. Legacy handbook translations will be archived or linked with honest scope disclosure rather than creating incomplete multilingual stubs.

---

## Decisions

### Decision 1: Canonical Documentation Architecture & Ingestion Pipeline

```text
┌─────────────────────────────────────────────────────────────────┐
│              docs/product/** (Canonical Source of Truth)        │
│  - Stable hierarchical IDs (e.g. reader.pdf.scroll_mode)        │
│  - Exact behavioral rules, platform matrices, failure modes     │
└────────────────┬────────────────────────────────────────────────┘
                 │
                 │ Build-time ingestion & validation
                 │ scripts/docs-sync-website.mjs
                 ▼
┌─────────────────────────────────────────────────────────────────┐
│          website/src/content/docs/** (Astro Collection)         │
│  - Ingests canonical markdown body and sections                 │
│  - Injects website frontmatter: category, order, claimIds       │
│  - Validates claimIds against website/src/config/claims.json   │
│  - Filters out unpublished (published: false) internal notes    │
└────────────────┬────────────────────────────────────────────────┘
                 │
        ┌────────┴────────────────────────┬──────────────────────┐
        ▼                                 ▼                      ▼
┌──────────────────┐           ┌──────────────────┐    ┌──────────────────┐
│  /docs (Landing) │           │ /docs/[cat]/[slug│    │ Pagefind Search  │
│  - Category Grid │           │ - Wiki Layout    │    │ - Local Index    │
│  - Search Bar    │           │ - Sidebar + TOC  │    │ - Zero External  │
└──────────────────┘           └──────────────────┘    └──────────────────┘
```

**Relationship between documentation sources:**
1. `docs/product/**` is the single canonical source of truth for all product features, rules, and behaviors.
2. `src/components/settings/handbookContent.ts` and in-app help/RAG consume from the compiled help index (`.help/index.json`) generated from `docs/product/**` by `scripts/build-help-index.mjs`.
3. `website/src/content/docs/**` is populated and validated at build time via `scripts/docs-sync-website.mjs`. It reads `docs/product/**`, validates the frontmatter against the claim matrix, maps domain folders into the 12 public wiki categories, and formats articles for Astro rendering.
4. `docs/USER_HANDBOOK.md` is deprecated as a manually maintained document. It will be retained as an auto-generated export artifact for offline reading.
5. Existing handbook translations (`USER_HANDBOOK.de.md`, `.fr.md`, `.es.md`, `.ja.md`, `.zh.md`) remain accessible in `docs/legacy/` and in-app settings, but the public website honestly discloses that the full 80+ page wiki is currently English-only.

### Decision 2: Public URL Structure & Redirect Strategy

- **Canonical Public Location**: The documentation remains at `/docs`. We avoid migrating to `/wiki` to preserve external links, search rankings, and existing references.
- **Hierarchical Routing**:
  - `/docs` → Main documentation portal / help center home.
  - `/docs/category/[category]` → Category overview page listing all articles in that category with summaries.
  - `/docs/[category]/[slug]` → Individual article page (e.g. `/docs/read-and-listen/pdf-scroll-mode`).
- **Redirect Compatibility**:
  - Existing `/docs/[slug]` URLs (such as `/docs/incremental-reading`, `/docs/reading-formats`, `/docs/spaced-repetition`) automatically redirect via Astro redirects / middleware or render compatibility aliases to their new canonical category path `/docs/[category]/[slug]`.
  - Articles specify `redirectAliases: ["/docs/old-slug", "/docs/other-alias"]` in their frontmatter.

### Decision 3: Expanded Astro Content Collection Schema

`website/src/content.config.ts` is updated with a comprehensive schema:

```ts
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

export const docsCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/docs' }),
  schema: z.object({
    // User-facing metadata
    title: z.string(),
    description: z.string(),
    category: z.enum([
      'start-here',
      'capture-and-import',
      'read-and-listen',
      'understand-and-extract',
      'organize-and-connect',
      'remember-and-review',
      'scheduling-and-algorithms',
      'language-learning',
      'ai-and-models',
      'rss-and-podcasts',
      'platforms-and-devices',
      'settings-privacy-troubleshooting',
    ]),
    order: z.number().default(999),
    published: z.boolean().default(true),
    noindex: z.boolean().optional(),
    featureStatus: z.enum(['shipping', 'experimental', 'planned', 'deprecated']).default('shipping'),
    platforms: z.array(z.enum(['windows', 'macos', 'linux', 'android', 'ios', 'eink', 'all'])).default(['all']),
    readingTimeMinutes: z.number().optional(),
    lastReviewed: z.string().optional(), // ISO date (YYYY-MM-DD)

    // Search & Discovery
    keywords: z.array(z.string()).default([]),
    aliases: z.array(z.string()).default([]),
    relatedDocs: z.array(z.string()).default([]), // Doc IDs

    // Validation & Internal Tracking
    owner: z.literal('E').default('E'),
    claimIds: z.array(z.string()).default([]),
    sourcePath: z.string().optional(), // Path in docs/product/
    redirectAliases: z.array(z.string()).default([]),
  }),
});
```

### Decision 4: 12-Category Information Architecture & Article Mapping

The wiki taxonomy organizes Plethora's verified capabilities into 12 coherent categories:

| Category Key | Category Title | Description | Key Articles Covered |
| :--- | :--- | :--- | :--- |
| `start-here` | Start Here | Fundamentals, installation, and first launch. | `getting-started`, `installation-desktop`, `installation-mobile`, `core-concepts-journey`, `quick-start-tutorial` |
| `capture-and-import` | Capture & Import | Getting books, papers, articles, and decks into Plethora. | `local-file-imports`, `web-url-scraping`, `arxiv-papers`, `kindle-clippings`, `anki-apkg-import`, `supermemo-zip-import`, `browser-extension` |
| `read-and-listen` | Read & Listen | Comprehensive reading viewers, audio, and TTS engines. | `pdf-page-mode`, `pdf-scroll-mode`, `pdf-reflow`, `epub-cfi-reader`, `html-web-reader`, `markdown-latex-reader`, `video-transcript-karaoke`, `text-to-speech-engines`, `vim-reading-navigation`, `reading-position-persistence` |
| `understand-and-extract` | Understand & Extract | Distilling knowledge through selections and extracts. | `selections-and-highlights`, `incremental-reading-extracts`, `extract-priority-inheritance`, `extract-lifecycle-management`, `dictionary-peek`, `notes-and-annotations` |
| `organize-and-connect` | Organize & Connect | Structuring your library and discovering associations. | `collections-and-folders`, `tagging-system`, `knowledge-graph-3d`, `topic-clustering`, `global-library-search` |
| `remember-and-review` | Remember & Review | Active recall surfaces and card authoring. | `flashcard-studio`, `cloze-deletion-cards`, `qa-cards`, `image-occlusion-ocr`, `audio-review-mode`, `review-sessions-grading` |
| `scheduling-and-algorithms` | Scheduling & Spaced Repetition | The science and algorithms behind retention. | `spaced-repetition-fundamentals`, `fsrs-6-algorithm`, `supermemo-algorithms`, `topic-aware-scheduling`, `neural-queue-composition` |
| `language-learning` | Language Learning | Tools for foreign language immersion and vocabulary. | `language-profiles`, `lexical-coverage-dictionaries`, `sentence-mining`, `dictation-and-shadowing` |
| `ai-and-models` | AI & Providers | Augmenting study with on-device and cloud models. | `ai-provider-setup`, `byo-api-keys`, `on-device-gemini-nano`, `socratic-tutor`, `grounded-library-rag`, `ai-cost-and-privacy` |
| `rss-and-podcasts` | RSS & Podcasts | Continuous learning from web feeds and audio broadcasts. | `rss-feed-management`, `rss-full-text-reader`, `semantic-preference-learning`, `podcast-whisper-transcription` |
| `platforms-and-devices` | Platforms & Devices | Hardware optimizations and cross-platform capabilities. | `desktop-macos-windows-linux`, `mobile-android-apk`, `mobile-ios-status`, `eink-monochrome-mode`, `keyboard-shortcuts-command-palette` |
| `settings-privacy-troubleshooting` | Settings, Privacy & Troubleshooting | Personalization, privacy guarantees, and problem solving. | `themes-and-appearance`, `privacy-architecture-local-shield`, `backup-restore-plethora-export`, `troubleshooting-faq`, `feature-status-roadmap` |

### Decision 5: Local-First Static Search UX

- **Engine**: Pagefind static search (indexed during build) with fallback to a lightweight bundled JSON inverted index (Fuse.js / Lunr). Zero external API calls, completely client-side.
- **Search UI Entry Points**:
  1. *Landing Page Hero*: Prominent `<input type="search">` on `/docs` with instant preview.
  2. *Article Header / Sticky Trigger*: Compact search button with `⌘K` or `/` hotkey badge.
  3. *Search Modal Dialog*: Accessible overlay opened via hotkey or trigger button.
- **Keyboard Navigation**:
  - `/` or `⌘K` / `Ctrl+K` opens search modal from anywhere in `/docs`.
  - Up/Down arrows navigate results.
  - Enter selects and navigates to the result.
  - Escape closes the search modal.
- **Accessible State**:
  - `role="combobox"`, `aria-expanded`, `aria-autocomplete="list"`.
  - `aria-live="polite"` announces result count ("Found 14 matching articles").
- **Progressive Enhancement**:
  - Search field gracefully falls back to category links if JavaScript is disabled.

### Decision 6: Article Layout & Editorial Typography

- **Layout Structure**:
  ```text
  ┌────────────────────────────────────────────────────────────────────────┐
  │                           SiteHeader.astro                             │
  ├──────────────┬──────────────────────────────────────────┬──────────────┤
  │ WikiSidebar  │ Breadcrumbs                              │ WikiToc      │
  │ - Category   │ Article Title + Metadata                 │ - On this    │
  │   Accordions │ ───────────────────────────────────────  │   page       │
  │ - Active Doc │ Callout (Tip/Note/Warning)               │ - Section 1  │
  │   Indicator  │ Body Text (Editorial Source Serif 4)     │ - Section 2  │
  │              │ Code Block / Kbd / Steps / Tables        │ - Section 3  │
  │              │ ───────────────────────────────────────  │              │
  │              │ Prev / Next Navigation Footer            │              │
  ├──────────────┴──────────────────────────────────────────┴──────────────┤
  │                           SiteFooter.astro                             │
  └────────────────────────────────────────────────────────────────────────┘
  ```
- **Semantic Admonitions / Callouts**:
  - `<WikiCallout type="note">`: Helpful context or background information.
  - `<WikiCallout type="tip">`: Power-user shortcuts or optimization advice.
  - `<WikiCallout type="important">`: Critical workflow requirements or prerequisites.
  - `<WikiCallout type="warning">`: Data-loss risks, unsupported combinations, or breaking steps.
  - `<WikiCallout type="platform" platform="android">`: Platform-specific instructions (e.g. Android SAF permissions, macOS Gatekeeper).
  - `<WikiCallout type="experimental">`: Honest labeling of features in active testing (e.g. iOS simulator build).
- **Typography & Elements**:
  - Headings: `Source Serif 4` display serif font, comfortable line height.
  - Body: UI sans font, optimal reading measure (65–75 characters per line).
  - `<kbd>` elements: Distinct keycap styling for keyboard shortcuts (e.g. `<kbd>Ctrl</kbd> + <kbd>E</kbd>`).
  - Code blocks: Syntax highlighted with language label and copy-to-clipboard button.
  - Tables: Wrapped in horizontal scroll container on mobile viewports to prevent overflow.

### Decision 7: Verification & Quality Governance

- **Script `website/scripts/check-wiki.mjs`**:
  - Verifies that every published article resolves valid internal markdown links (`[text](../category/doc)`).
  - Verifies that all `claimIds` exist in `website/src/config/claims.json` and are valid public claims.
  - Ensures no banned phrases (`banned-phrases.json`) appear in user-facing copy unless marked with `data-historical-quote`.
  - Validates that every `relatedDocs` ID resolves to a published document.
  - Enforces that all heading anchor IDs are unique and URL-safe.
  - Checks that every article contains non-empty body text, clear prerequisites, and expected outcomes.
- **CI Integration**: Wired into `npm run website:check` and `npm run website:build`.

---

## Risks / Trade-offs

| Risk / Trade-off | Mitigation Strategy |
| :--- | :--- |
| **Documentation Drift**: Features added in code without updating docs. | Strict CI gate via `scripts/docs-coverage.mjs` and `website/scripts/check-wiki.mjs` running on every PR and build. |
| **Search Index Size**: Generating a full-text search index could increase client payload. | Use Pagefind chunked static indexing (only downloads query slices as needed) or compile a compressed JSON index (<150KB gzip for 80+ pages). |
| **Stale Translations**: Legacy German/French handbooks falling behind the English wiki. | Scope translated handbooks as legacy references in settings with explicit status notes. Do not claim the full wiki is multilingual until dedicated localization is performed. |
| **Broken Inbound Links**: Existing links to `/docs/[slug]` breaking when category paths are introduced. | Provide automatic redirects for all legacy slugs via Astro route mapping and `redirectAliases`. |
| **Overclaiming Unshipped Features**: Mentioning sync, billing, or AnkiConnect as fully available. | Continuous validation against `website/src/config/claims.json` where non-public or planned features throw build errors if stated as shipping facts. |
