## Why

Secondary pages carry conversion, SEO, and legal risk. Pricing and download facts must come from configuration and the entitlement registry, not slogans. Several documents disagree (AnkiConnect handbook vs `IMPLEMENTATION_STATUS.md`; encryption handbook vs privacy architecture). This change builds the pages and a **claim matrix** that forbids unverifiable sentences from reaching indexed production.

## What Changes

- Implement routes: features, how-it-works, pricing, downloads, privacy, security, docs, changelog, support/contact, terms, refunds, plus audience/SEO pages (students, readers, researchers, spaced-repetition, incremental-reading, alternatives-to-read-it-later, anki).
- Pricing UI: Free vs Pro from `src/types/entitlements.ts` ids; display $5.99 / ~$49.99; monthly/annual toggle; localized-store footnote; CTA destinations from launch flags (disabled by default).
- Downloads: detect OS, recommend, always “All downloads”, system requirements, arch notes, store vs sideload, disabled buttons when artifacts missing.
- Trust pages: local-first copy; encryption/ZK only if matrix `public`.
- Legal pages: clearly **draft** until founder/counsel; no invented LLC, address, email, D-U-N-S, tax, or refund law.
- Docs: curated; do not dump internal RC notes.
- Changelog: derived from `CHANGELOG.md` or a curated subset; no Incrementum user-facing branding.
- Anki page: `.apkg` import/export only unless live AnkiConnect is re-verified in code + tests.
- Claim matrix JSON consumed by F’s grep/test.

## Capabilities

### New Capabilities

- `useplethora-commercial-pages`: IA, pricing, downloads, trust, legal scaffolding, SEO pages, claim matrix.

## Impact

- `website/src/pages/**` except `index.astro` (B) and demo route (D).
- `website/src/content/**` collections.
- Config content owned here: plans copy, download messages, legal placeholder rendering — **types** owned by A.

## Dependencies

- A required.
- C optional for screenshots on features page.
- Billing OpenSpecs: consume, do not implement StoreKit.
- `canonical-product-docs-and-ask-plethora` for docs corpus pointers.

## Ownership

**May modify:** listed pages, content collections, `website/src/config/claims.ts` **data**, plans/downloads **messages**.

**Must not modify:** homepage visual system (B), demo machine (D), A’s types without coordination, app entitlements runtime, root Vercel PWA.
