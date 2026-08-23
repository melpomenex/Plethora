## 1. Harness (can start after A)

- [x] 1.1 Add `website` Playwright config, `data-testid` convention doc.
- [x] 1.2 Smoke: all IA routes return 200 on `astro preview`.
- [x] 1.3 Add `.github/workflows/website.yml` path-filtered.
- [x] 1.4 `astro check` + unit test script in `website/package.json`.

## 2. A11y and motion

- [x] 2.1 axe WCAG 2.2 AA on home, pricing, downloads, privacy, features.
- [x] 2.2 Keyboard-only demo path test (after D; skip if slot empty).
- [x] 2.3 Reduced-motion fixture: no `animation-iteration-count: infinite` on mascot.
- [x] 2.4 Skip-link test.

## 3. Performance

- [x] 3.1 Fail CI if homepage initial JS > budget or demo imported from layout eagerly.
- [x] 3.2 Reserve aspect-ratio test: device frames have width/height or CSS aspect-ratio (no CLS fixture).
- [x] 3.3 Document Lighthouse run; optional CI on main.

## 4. SEO, robots, claims

- [x] 4.1 Assert unique titles; canonicals; OG tags present.
- [x] 4.2 Preview/noindex invariant test.
- [x] 4.3 Grep build output for banned phrases and `readsync.org` / `Incrementum` in HTML (allow changelog historical quotes via data attribute exemption list).
- [x] 4.4 Claim matrix: if `PUBLIC_INDEXING=index`, fail on `public:false` claim ids found in dist HTML.
- [x] 4.5 Sitemap/robots match flag.

## 5. Analytics and links

- [x] 5.1 Analytics disabled unless flag; event names match contracts; payload schema test forbids `text`/`html` fields.
- [x] 5.2 Broken-link check on dist (internal).
- [x] 5.3 Invoke C freshness script as `npm run check:assets` when indexing index.

## 6. Launch ops

- [x] 6.1 Write `website/docs/launch.md` with verification, domain, rollback, post-deploy smoke.
- [x] 6.2 Write `website/docs/a11y.md` keyboard script.
- [x] 6.3 Browser matrix checklist (manual) in launch.md.
- [x] 6.4 `openspec validate establish-useplethora-website-quality-gates --strict`.
