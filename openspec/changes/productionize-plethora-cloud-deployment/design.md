# Design: Productionize Plethora Cloud Deployment

## Context

Plethora Cloud (`server/`) is an Express 4 API with v1 routes already implemented. Production deployment must be **stateless at the compute layer**: authoritative state in managed PostgreSQL and S3-compatible object storage. Target host: ~4 vCPU, 6 GB RAM, Ubuntu/Debian, Docker + Compose, ~€5/month VPS.

Upstream architecture (do not duplicate):
- Proposal 5: `/v1/jobs`, quotas, provider registry
- Proposal 3: `/v1/auth/*`, sessions, devices
- Proposal 4: `/v1/billing/*`, StoreKit verification
- Proposal 6: `/v1/sync/*` E2EE ciphertext relay
- Proposal 24: metrics baselines, observability gates

## Goals / Non-Goals

**Goals:**
- Disposable VPS: reprovision + restore `.env.production` + `docker compose up` = back online
- External managed Postgres (Neon) + R2 for blobs
- Caddy TLS reverse proxy; API internal-only on Docker network
- Versioned GHCR images for easy rollback
- Fail-fast production config validation
- Documented operator path from bare VPS to live API

**Non-goals:**
- Job worker process (jobs remain enqueue-only until proposal 5 worker lands)
- Kubernetes, Terraform, Redis
- Marketing site in API compose stack
- Stripe billing

## Architecture

```
Internet → Cloudflare DNS/proxy → VPS:443 (Caddy) → api:3000 (internal)
                                              ↓
                                    Neon PostgreSQL (DATABASE_URL)
                                    Cloudflare R2 (S3_* env vars)
```

### Services (production Compose)

| Service | Image | Ports | Role |
|---------|-------|-------|------|
| `caddy` | `caddy:2-alpine` | 80, 443 (host) | TLS, reverse proxy, security headers |
| `api` | `ghcr.io/melpomenex/plethora-cloud:<tag>` | internal 3000 | Plethora Cloud API |
| `migrate` | same as api | none | One-shot: `node dist/db/migrate.js` |

No `db`, no `frontend`, no `uploads` volume in production.

### Migration strategy

**Explicit one-shot migrate service** (option B) — safest for small deployment:
1. `docker compose run --rm migrate` applies schema
2. `docker compose up -d api caddy`

Deploy script runs migrate before `up`. Migrations are idempotent (`IF NOT EXISTS`). No auto-migrate on API startup (avoids race with multiple replicas; explicit operator/CI control).

### Object storage

Single `StorageBackend` interface:
- `putObject(key, body, contentType)` 
- `getSignedDownloadUrl(key, expiresSec)`
- `getSignedUploadUrl(key, contentType, expiresSec)`
- `deleteObject(key)`

Production: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against R2 endpoint.
Dev: `LocalStorageBackend` when `S3_ENDPOINT` unset (legacy `/files` path only).

Production startup **requires** `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Sync ciphertext remains in Postgres (proposal 6); large artifacts/job outputs use object storage per proposal 5 intent.

### Environment variables

| Category | Variables |
|----------|-----------|
| Core | `PLETHORA_ENV=production`, `NODE_ENV=production`, `PORT=3000`, `DATABASE_URL` |
| Auth | `JWT_SECRET` (required, min 32 chars, not dev default) |
| CORS | `CORS_ORIGINS` (comma-separated production origins) |
| API host | `PLETHORA_API_HOST` (for Caddy, e.g. `api.plethora.app`) |
| DB pool | `PG_POOL_MAX` (default 8), `DATABASE_SSL=true` for Neon |
| S3/R2 | `S3_ENDPOINT`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` |
| Apple billing | `APP_STORE_KEY_ID`, `APP_STORE_ISSUER_ID`, `APP_STORE_PRIVATE_KEY`, `APP_STORE_BUNDLE_ID`, `APP_STORE_ENV` |
| Observability | `METRICS_TOKEN` (bearer auth for `/metrics`) |
| Legacy | `ENABLE_LEGACY_ROUTES=false` (default in production) |

### Resource budget (6 GB VPS)

| Component | Budget |
|-----------|--------|
| OS + Docker + headroom | ~1.5 GB |
| Caddy | ~64 MB |
| Node API | 512 MB heap (`NODE_OPTIONS=--max-old-space-size=512`), mem_limit 768m |
| Deploy/migrate spike | ~256 MB |

`PG_POOL_MAX=8` (not 20). Docker log rotation: `max-size=10m`, `max-file=3`.

### Health endpoints

- `GET /health` — liveness, no deps, always 200 if process alive
- `GET /ready` — readiness, checks DB `SELECT 1`, 503 if DB down

Caddy healthcheck proxies to `/health`. Deploy script waits on `/ready`.

### Security (post-adversarial review)

| Finding | Mitigation |
|---------|------------|
| Unauthenticated API token CRUD | `authMiddleware` on management routes; userId from JWT |
| JWT dev secret fallback | `validateProductionConfig()` fails startup |
| Unsigned billing webhooks | Reject non-`appstore` webhooks when `PLETHORA_ENV=production` |
| `/metrics` unauthenticated | Bearer `METRICS_TOKEN` required in production |
| API port public | Not published in production compose |
| Cloudflare origin trust | `app.set('trust proxy', 1)`; optional `TRUSTED_PROXY_CIDRS` |
| Migration race | One-shot migrate service, not auto on startup |
| Disk exhaustion from logs | Docker log driver limits |
| R2 credentials in image | Env-only, never baked |
| Session expiry not checked | Check `expires_at < NOW()` in auth middleware |
| Legacy routes in prod | `ENABLE_LEGACY_ROUTES=false` skips mounting |

### CI/CD

`.github/workflows/cloud-server.yml`:
- On push to `main` (server changes) + tags `cloud-v*`:
  - `npm ci && npm test && npm run build` in `server/`
  - `docker build` + push to `ghcr.io/melpomenex/plethora-cloud`
  - Tags: `sha-<short>`, semver from tag, `latest` on main only with caution documented
- `docker compose -f compose.production.yml config` validation

VPS deploy model: `docker login ghcr.io` → set `PLETHORA_CLOUD_IMAGE` → `scripts/deploy-production.sh`

### Rollback

1. Set `PLETHORA_CLOUD_IMAGE=ghcr.io/melpomenex/plethora-cloud:<previous-tag>`
2. Run deploy script (skips migrate if `SKIP_MIGRATE=1` and schema compatible)
3. Document: only rollback app if migrations were additive

### Scaling path

API containers are stateless. Scale horizontally:
```
Cloudflare LB → VPS1 (caddy+api) + VPS2 (caddy+api) → shared Neon + R2
```
No redesign needed; increase `PG_POOL_MAX` per instance conservatively; add connection pooler (Neon pooler) before many replicas.

## Decisions

1. **Caddy over nginx** — automatic HTTPS, simple config, Cloudflare-compatible.
2. **Migrate as one-shot compose service** — explicit, no startup race.
3. **R2 via AWS SDK** — S3-compatible API; no custom abstraction beyond thin `StorageBackend`.
4. **GHCR image publish** — VPS pulls rather than builds; faster deploy, easier rollback.
5. **No Redis for rate limiting v1** — in-memory rate limit per instance acceptable for initial SaaS; document limitation for multi-instance.

## Risks / Trade-offs

- **Jobs enqueue-only** — document in ops runbook until worker ships.
- **In-memory rate limits** — not global across replicas; acceptable for single VPS v1.
- **Sync ciphertext in Postgres** — acceptable for v1; blob offload is future optimization.
- **Legacy `/files` disabled in production** — clients use v1 sync / external Yjs relay.
