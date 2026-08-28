# Change: Productionize Plethora Cloud Deployment

> Wave 4 — Production cutover. Hard-depends on existing cloud API implementation (`implement-plethora-pro-cloud-service-and-usage-quota-architecture`), auth (`implement-plethora-accounts-authentication-and-entitlements`), billing (`implement-cross-platform-subscription-billing-and-license-management`), sync (`implement-plethora-pro-end-to-end-encrypted-cloud-sync`), and observability baselines (`implement-plethora-pro-observability-cost-controls-and-cloud-performance-gates`). This change does **not** re-implement those feature contracts — it productionizes their deployment.

## Why

The Plethora Cloud API (`server/`) is implemented as an Express service with v1 routes for auth, billing, sync, jobs, entitlements, and usage — but it is **deployed nowhere in production today**. The existing `docker-compose.yml` is a local dev stack with bundled Postgres, local disk uploads, weak default secrets, and no TLS. Operators cannot provision a small VPS and deploy safely without reverse-engineering the codebase.

This change delivers a **disposable application-server** deployment model: managed PostgreSQL (Neon), S3-compatible object storage (Cloudflare R2), Caddy reverse proxy with automatic HTTPS, production Compose, deploy scripts, CI image publishing, and operator documentation — so `api.<domain>` can be brought online with a small number of commands.

## What Changes

- **Production Docker image** — hardened `server/Dockerfile` (multi-stage, non-root, `NODE_ENV=production`, healthcheck, `.dockerignore`, no secrets baked in).
- **Production Compose** — new `compose.production.yml` with `api` + `caddy` only; **no** bundled Postgres, **no** authoritative uploads volume.
- **Development Compose** — retain `docker-compose.yml` for local Postgres + API; clearly dev-only.
- **Caddy reverse proxy** — TLS termination, HTTP→HTTPS, security headers, proxy to internal API; ports 80/443 only public.
- **Environment contract** — `.env.production.example` documenting all production env vars; startup validation with fail-fast errors.
- **Database** — external managed Postgres via `DATABASE_URL`; TLS support; env-driven pool sizing (default max 8 for small VPS).
- **Object storage** — S3-compatible abstraction wired for Cloudflare R2; presigned upload/download URLs; production requires object storage (no local authoritative blob storage).
- **Health/readiness** — `/health` (liveness), `/ready` (DB connectivity); Docker and Caddy healthchecks.
- **Graceful shutdown** — SIGTERM handler drains HTTP server and closes DB pool.
- **Production security hardening** — fail-fast on missing/weak `JWT_SECRET`; protect `/metrics`; auth on API token/webhook management routes; disable unsigned non-Apple billing webhooks in production; optional legacy route gating.
- **Deploy script** — `scripts/deploy-production.sh` (validate config → migrate → pull/build → up → readiness wait).
- **CI/CD** — GitHub Actions workflow building/publishing `ghcr.io/.../plethora-cloud:<version>`; compose validation smoke test.
- **Operator documentation** — `docs/deploy/PLETHORA_CLOUD_PRODUCTION.md` with VPS bootstrap, Neon, R2, DNS, firewall, upgrade, rollback, disaster recovery.

## Capabilities

### New Capabilities

- `plethora-cloud-production-deployment`: Production deployment topology, Compose, Caddy, env contract, deploy script, CI image publish, operator runbook.
- `plethora-cloud-object-storage`: S3-compatible storage backend (R2) with presigned URLs; production-required; local fallback for dev only.
- `plethora-cloud-production-readiness`: Startup config validation, health/readiness endpoints, graceful shutdown, production security gates.

### Modified Capabilities

- (none — this is infrastructure/deployment; feature API contracts owned by proposals 3–6 remain unchanged)

## Impact

### Affected Code Areas

- `server/Dockerfile`, `server/.dockerignore`, `server/package.json`
- `server/src/config/`, `server/src/storage/`, `server/src/index.ts`, `server/src/db/connection.ts`
- `server/src/middleware/auth.ts`, `server/src/routes/v1/api.ts`, `server/src/routes/v1/capture.ts`
- `compose.production.yml`, `deploy/Caddyfile`, `.env.production.example`
- `scripts/deploy-production.sh`, `scripts/validate-production-compose.sh`
- `.github/workflows/cloud-server.yml`
- `docs/deploy/PLETHORA_CLOUD_PRODUCTION.md`

### Non-goals

- No new cloud feature job kinds, no job worker implementation, no quota enforcement (owned by proposal 5).
- No Stripe or new payment architecture; Apple/Google billing verification unchanged.
- No marketing website deployment in production API stack.
- No Kubernetes, Terraform, Redis, or Kafka.
- No multi-region HA.

### Dependencies

- Proposals 3 (auth), 4 (billing), 5 (cloud framework), 6 (sync), 24 (observability baselines) — contracts consumed, not re-implemented.
- External: Neon Postgres, Cloudflare R2, Cloudflare DNS/proxy (recommended), GHCR for images.

### Acceptance

An operator can provision a fresh Ubuntu/Debian VPS (~4 vCPU / 6 GB RAM), install Docker, create `.env.production` from the example, point DNS at the host, and run the deploy script to bring Plethora Cloud online. VPS loss requires only secrets restore + redeploy — no customer data restoration from local disk.
