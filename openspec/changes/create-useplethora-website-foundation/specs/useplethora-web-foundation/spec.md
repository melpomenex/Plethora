## ADDED Requirements

### Requirement: Marketing site lives in a separate Astro package
The repository SHALL contain a `website/` package implemented with Astro 5 and TypeScript that builds a static site into `website/dist` without using the Tauri Vite config or the root `vercel.json` PWA pipeline.

#### Scenario: Isolated build
- **WHEN** a developer runs the website build from `website/`
- **THEN** the command succeeds and does not require Tauri, Rust, or `npm run build:pwa`

#### Scenario: Root PWA config untouched
- **WHEN** this change is applied
- **THEN** the root `vercel.json` still describes the PWA (`build:pwa` / `dist`) and is not used as the marketing site config

### Requirement: Launch configuration defaults are commercially safe
The website SHALL load typed launch configuration whose committed defaults disable checkout, disable download of missing binaries, disable analytics, and set indexing to `noindex`.

#### Scenario: Fresh clone
- **WHEN** the site is built with no extra env vars
- **THEN** pages include robots/meta instructions that prevent indexing and checkout CTAs are not live payment links

### Requirement: Shared commercial types are the single contract
The website SHALL implement the TypeScript contracts documented in `openspec/planning/useplethora-website-shared-contracts.md` (platforms, downloads, plans, claims, legal placeholders, demo stages, analytics event names, asset manifest).

#### Scenario: Downstream owners
- **WHEN** changes B–F implement features
- **THEN** they import these modules instead of declaring parallel flag or plan types

### Requirement: Canonical origin is useplethora.com
Canonical URLs, Open Graph defaults, and documented production origin SHALL use `https://useplethora.com` (not `plethora.app` and not `readsync.org`). `www` SHALL redirect to apex.

#### Scenario: WWW request
- **WHEN** a client requests `https://www.useplethora.com/pricing`
- **THEN** configuration specifies a permanent redirect to `https://useplethora.com/pricing`

### Requirement: Secrets never enter the repository
Website configuration SHALL use environment variables for any future private tokens. No `.env` with secrets SHALL be committed. Public flags MUST use `PUBLIC_` / equivalent client-safe names only for non-secret values.

#### Scenario: Env documentation
- **WHEN** an implementer reads `website/docs/vercel.md`
- **THEN** they are instructed to verify Vercel identity and project list before linking and never to paste tokens into git or prompts

### Requirement: Layout exposes landmarks and a demo slot
The default layout SHALL include skip-to-content, header, main, footer, and a named homepage slot for the interactive demo owner (`HomeDemoSlot`) that MAY render empty.

#### Scenario: Keyboard user
- **WHEN** a page is rendered
- **THEN** a skip link is present and landmarks are unique
