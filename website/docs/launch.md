# Launch, verification, and rollback — useplethora.com

This is the marketing site for **https://useplethora.com**. It is a **separate Vercel project** whose Root Directory is `website`. The repository root `vercel.json` is the **PWA** and must not be used for this domain.

Do not paste Vercel tokens, cookies, or API keys into git or this file. This change does not deploy.

Staging and preview deployments stay **`PUBLIC_INDEXING=noindex`**. Production may set `index` only after launch blockers are empty (`website/src/config/launch.ts` / `launch-blockers.ts`).

## Pre-deploy verification

From `website/`:

```bash
npm ci
npm run check
npm test
npm run build
npm run check:dist
npm run check:assets
npx playwright test
```

Confirm flags on the **preview** URL (Vercel Preview is always noindex):

| Flag | Preview / staging | Indexed production |
|---|---|---|
| `PUBLIC_INDEXING` | `noindex` | `index` only after blockers clear |
| `PUBLIC_DOWNLOADS_ENABLED` | `false` until artifacts exist | `true` when URLs are real |
| `PUBLIC_CHECKOUT_ENABLED` | `false` until billing + legal entity exist | `true` when checkout is real |
| `PUBLIC_ANALYTICS_ENABLED` | `false` until vendor + consent | as decided |
| `PUBLIC_SITE_ORIGIN` | preview origin | `https://useplethora.com` |

Legal entity name, D-U-N-S, and counsel-final terms are **not invented here**. If they are still null, do not flip indexing.

## Domain

1. Attach **useplethora.com** to the **website** Vercel project (not the PWA project).
2. `www.useplethora.com` must 308 to the apex (`website/vercel.json`).
3. Confirm HTTPS and that DNS does not point at the PWA deployment.

## Indexing flip

1. Preview QA on the production-like build with `noindex`.
2. Confirm `website/src/config/launch-blockers.ts` has no `block` severity items that still apply.
3. Confirm legal `termsFinal` / `privacyFinal` / `legalEntityName` before `PUBLIC_INDEXING=index`.
4. Confirm screenshot placeholders are gone (CI fails placeholders **only** when indexing is `index`).
5. Set production env, redeploy, then check `/robots.txt` allows crawling and `/sitemap.xml` lists routes.

## Rollback (bad production deploy)

Do **not** rewrite git history.

1. In the Vercel dashboard for the **website** project, use **Instant Rollback** to the previous production deployment, **or** redeploy the previous deployment and assign the production alias.
2. Confirm `https://useplethora.com` serves the restored HTML (home heading, pricing, downloads, privacy).
3. If the bad release was an env-flag flip (indexing, checkout, downloads), revert the env vars and redeploy — no git rewrite required.
4. Leave the git commit in place; fix forward on `main` after the site is stable.

## Post-deploy smoke

Hit these on production (and on staging after every preview promote):

- `/` `/features` `/how-it-works` `/pricing` `/downloads` `/privacy` `/security` `/docs` `/changelog` `/support` `/terms`
- `/demo` or `/#demo` when D has shipped
- `/robots.txt` and `/sitemap.xml` match `PUBLIC_INDEXING`
- HTTPS; `www` → apex
- No analytics network unless `PUBLIC_ANALYTICS_ENABLED=true`

## Lighthouse (optional)

Local, against `astro preview` (median of 3; retry once on flake):

```bash
cd website
npm run build && npm run preview
npx @lhci/cli autorun --config=./lighthouserc.cjs
```

Budgets (homepage, cable/4G, mid-range Android): LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.05. Homepage initial JS ≤ 180 KB gzip (enforced in `npm run check:dist`). GitHub Actions may run LHCI on `main` only; that job is allowed to warn without blocking on flake.

## Browser matrix (manual)

Check last-pass dates when rehearsing launch. Automated CI covers Chromium and WebKit on Ubuntu.

| Surface | Versions | Homepage | Pricing | Downloads | Demo keyboard | Notes |
|---|---|---|---|---|---|---|
| Chrome | last 2 stable | | | | | |
| Edge | last 2 stable | | | | | |
| Firefox | current ESR + stable | | | | | |
| Safari | 16.4+ | | | | | scroll-driven motion may degrade; a11y still required |
| iOS Safari | current − 1 | | | | | |
| Android Chrome | current; include a **mid-range** device | | | | | JS budget must survive |

Forced-colors / reduced-motion: re-run skip-link + mascot checks from `docs/a11y.md`.
