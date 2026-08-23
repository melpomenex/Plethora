## 1. Content plumbing

- [x] 1.1 Add Astro content collections or MD/MDX for commercial pages with frontmatter: title, description, noindex override, owner, claimIds[].
- [x] 1.2 Implement `claims.json` with the matrix in the design (ids, status, public, evidencePaths, surfaces).
- [x] 1.3 Helper `assertClaim(id)` used by templates; pages MUST NOT interpolate raw untracked slogans for product facts.

## 2. Core pages

- [x] 2.1 `/features` grouped Capture/Read/Understand/Connect/Remember; each card cites claim ids.
- [x] 2.2 `/how-it-works` static version of the journey.
- [x] 2.3 `/pricing` Free vs Pro table, interval toggle, display prices, localized footnote, disabled checkout from flags, trial slot hidden unless config.
- [x] 2.4 `/downloads` detection, recommend, all platforms, requirements, arch, store vs direct, disabled/coming-soon states, no broken hrefs (`href="#"` with role button + message is OK if not advertised as download).
- [x] 2.5 `/privacy` and `/security` draft banners; statements only from public claims.
- [x] 2.6 `/docs` index + article layout from curated files; 404 for unpublished.
- [x] 2.7 `/changelog` parser or curated MD.
- [x] 2.8 `/support` and `/contact` — if email null, use a “contact not published yet” state, not a fake address.
- [x] 2.9 `/terms` and `/refunds` draft scaffolding.

## 3. SEO/audience

- [x] 3.1 Pages for students, readers, researchers, spaced repetition, incremental reading, read-it-later alternative, Anki alternative with unique intros and canonicals.
- [x] 3.2 Anki page states `.apkg` only; explicitly does not claim live AnkiConnect.
- [x] 3.3 JSON-LD SoftwareApplication only with fields that are true (name, os list filtered by public claims, price if display-only flagged as Offer with availability PreOrder/ComingSoon when checkout disabled).

## 4. Copy hygiene

- [x] 4.1 Grep-friendly banned phrase list in `website/src/config/banned-phrases.json` for F.
- [x] 4.2 No Incrementum/readsync.org in nav, footer, titles, or CTAs.

## 5. Validation

- [x] 5.1 Tests: pricing renders disabled CTA; downloads coming-soon; Anki page lacks “AnkiConnect”; draft legal banner when placeholders null.
- [x] 5.2 `openspec validate create-useplethora-commercial-pages --strict`.
