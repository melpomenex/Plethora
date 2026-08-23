# useplethora.com (marketing site)

Astro 5 static site for **https://useplethora.com**. This package is independent of the Tauri app and of the **root** `vercel.json`, which deploys the **PWA** (`npm run build:pwa`). Do not point marketing DNS at that project. Do not use root `vercel.json` for this site.

## Local

Node ≥ 20 (see `.nvmrc`). From this directory:

```bash
npm install
npx playwright install chromium
npm run dev
npm run build
npm run preview
npm run check
npm test
npm run check:dist
npm run check:assets
npm run test:e2e
```

Quality gates live in `website/tests/**` and `.github/workflows/website.yml` (path-filtered; does not run app/Rust CI). See `docs/launch.md` and `docs/a11y.md`.

From the repo root (does not install Astro into the app): `npm run website:dev`.

## Environment

Copy `.env.example`. Never commit secrets. Never put tokens in `PUBLIC_*`.

| Variable | Committed default | Preview | Production |
|---|---|---|---|
| `PUBLIC_INDEXING` | `noindex` | `noindex` | `index` only after launch gates |
| `PUBLIC_DOWNLOADS_ENABLED` | `false` | `false` | `true` when artifacts exist |
| `PUBLIC_CHECKOUT_ENABLED` | `false` | `false` | `true` when billing + entity exist |
| `PUBLIC_ANALYTICS_ENABLED` | `false` | `false` | after vendor + consent |
| `PUBLIC_DEMO_ENABLED` | `true` | `true` | as needed |
| `PUBLIC_COMMERCIAL_STOREFRONT_READY` | `false` | `false` | when stores are live |
| `PUBLIC_SITE_ORIGIN` | `https://useplethora.com` | preview URL | `https://useplethora.com` |
| `PUBLIC_PLAUSIBLE_DOMAIN` | unset | unset | only if Plausible is chosen |

Indexing policy: **robots `Disallow: /` + meta `noindex, nofollow`** when `PUBLIC_INDEXING=noindex`. The sitemap generator emits an **empty** urlset in that mode so crawlers are not handed a route list. Flip both by setting `PUBLIC_INDEXING=index`.

Vercel project setup: [`docs/vercel.md`](./docs/vercel.md).
