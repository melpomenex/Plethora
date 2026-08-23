# Vercel — marketing site (second project)

The repository root `vercel.json` is the **PWA** pipeline (`buildCommand: npm run build:pwa`, SPA rewrite to `index.html`). It must stay that way. This marketing site uses **`website/vercel.json`** in a **separate** Vercel project whose Root Directory is `website`.

Do not paste Vercel tokens into git, chat, or this file.

## Verify before linking

On the maintainer machine:

1. `vercel whoami` — confirm the intended team.
2. `vercel project ls` — identify the existing PWA project. If that project’s root is the repo root / `build:pwa`, **do not** change it.
3. Create a **new** project for useplethora.com if none exists for this directory.
4. Set Root Directory to `website`.
5. Confirm the new project reads `website/vercel.json` (security headers, `www` → apex 308, `trailingSlash: false`, framework `astro`).

Never run `vercel link` in CI without an explicit project id on a trusted machine. This change does not deploy.

## Env vars

See `website/.env.example` and `website/README.md`. Preview and staging stay `PUBLIC_INDEXING=noindex`. Production may set `index` only after launch blockers clear (`website/src/config/launch-blockers.ts`).

No secrets belong in `PUBLIC_*`. Server-only vars, if any later, stay in the Vercel dashboard — never committed.

## Coexistence

| Surface | Config | Output |
|---|---|---|
| PWA | root `vercel.json` | app `dist` via `build:pwa` |
| Marketing | `website/vercel.json` | `website/dist` via `astro build` |
