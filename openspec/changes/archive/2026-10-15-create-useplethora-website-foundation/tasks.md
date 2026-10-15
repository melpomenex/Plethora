## 1. Package scaffold

- [x] 1.1 Create `website/` with Astro 5, TypeScript strict, `output: 'static'`, Node ≥ 20 documented in `website/.nvmrc` matching Vercel.
- [x] 1.2 Add `website/package.json` scripts: `dev`, `build`, `preview`, `check` (`astro check`).
- [x] 1.3 Add `website/README.md` covering local run, env table, and **do not use root vercel.json**.
- [x] 1.4 Ensure the Tauri app still installs/builds without requiring website deps (no accidental root dependency on Astro).

## 2. Shared contracts

- [x] 2.1 Implement `website/src/config/` modules for launch flags, platforms, downloads, plans, claims, legal placeholders, demo stages, analytics event names, and asset manifest types — matching `openspec/planning/useplethora-website-shared-contracts.md`.
- [x] 2.2 Default `LaunchFlags`: `indexing: "noindex"`, downloads/checkout/analytics/demoCommercialStorefront `false` (demo island may still be `demoEnabled: true` for UX; checkout remains false).
- [x] 2.3 Copy capability ids into `entitlementIds.ts` with a header comment pointing at `src/types/entitlements.ts`; do not import app source.
- [x] 2.4 Seed display prices `$5.99` / `$49.99` USD with `storefrontLocalized: true` and CTAs `mode: "disabled"`.
- [x] 2.5 Seed `LegalPlaceholders` all `null` / `false`.
- [x] 2.6 Unit-test (Vitest or Node test) that defaults keep checkout/downloads/analytics off and indexing noindex.

## 3. Layout and routing

- [x] 3.1 Global layout: skip-to-content, `header`, `main`, `footer`, `html lang="en"`.
- [x] 3.2 Nav links to all IA routes (stubs allowed).
- [x] 3.3 Footer: product name Plethora, origin useplethora.com, legal links, “draft” badge if legal not final.
- [x] 3.4 Pages: `/` stub owned by B; commercial routes stub owned by E; optional `/demo` stub owned by D.
- [x] 3.5 `HomeDemoSlot` empty component with comment for D.
- [x] 3.6 404 page with link home.

## 4. SEO shell (flags)

- [x] 4.1 Per-route title/description slots (placeholder copy OK).
- [x] 4.2 `robots.txt` derived from indexing flag (`Disallow: /` when noindex).
- [x] 4.3 `noindex, nofollow` meta when flag is noindex.
- [x] 4.4 Canonical URL helper using `PUBLIC_SITE_ORIGIN`.
- [x] 4.5 Empty `sitemap.xml` generator that omits routes when noindex **or** still generates but robots disallows — pick one, document it (prefer robots disallow + meta noindex).

## 5. Vercel (website directory only)

- [x] 5.1 Add `website/vercel.json`: headers (security), `www` redirect, trailing-slash policy, static framework.
- [x] 5.2 Add `website/docs/vercel.md`: verify `vercel whoami`; `vercel project ls`; create **new** project if the existing one is the PWA; set Root Directory `website`; never commit tokens; preview = noindex.
- [x] 5.3 Document required `PUBLIC_*` env vars for preview vs production.
- [x] 5.4 Do **not** modify root `vercel.json`. Add a comment in `website/docs/vercel.md` that root file is PWA (`build:pwa`).

## 6. DX hygiene

- [x] 6.1 `.gitignore` for `website/dist` and `website/node_modules` if not covered.
- [x] 6.2 Optional root script `"website:dev": "npm --prefix website run dev"` — only if it does not change app install semantics.
- [x] 6.3 Run `cd website && npm run build` and `openspec validate create-useplethora-website-foundation --strict`.
