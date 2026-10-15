# Tasks: Productionize Plethora Cloud Deployment

## 1. Server production hardening

- [x] 1.1 Add `server/src/config/env.ts` with production validation and typed config
- [x] 1.2 Add `/ready` endpoint and improve `/health`
- [x] 1.3 Implement graceful shutdown (SIGTERM/SIGINT)
- [x] 1.4 Env-driven DB pool sizing and TLS (`PG_POOL_MAX`, `DATABASE_SSL`)
- [x] 1.5 Fail-fast JWT secret validation in production
- [x] 1.6 Fix `capture.ts` auth (`authMiddleware` + `AuthRequest`)
- [x] 1.7 Secure `/v1/api/tokens` and `/v1/api/webhooks` with `authMiddleware`
- [x] 1.8 Protect `/metrics` with `METRICS_TOKEN` in production
- [x] 1.9 Reject unsigned non-Apple billing webhooks in production
- [x] 1.10 Session expiry check in auth middleware
- [x] 1.11 Gate legacy routes with `ENABLE_LEGACY_ROUTES`
- [x] 1.12 Add basic rate limiting on auth endpoints
- [x] 1.13 `trust proxy` for reverse proxy deployments

## 2. Object storage (S3/R2)

- [x] 2.1 Add `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
- [x] 2.2 Implement `StorageBackend` interface and S3/R2 backend
- [x] 2.3 Local dev fallback when S3 not configured
- [x] 2.4 Production requires S3 configuration at startup

## 3. Docker and Compose

- [x] 3.1 Harden `server/Dockerfile` (NODE_ENV, HEALTHCHECK, labels)
- [x] 3.2 Add `server/.dockerignore`
- [x] 3.3 Create `compose.production.yml` (api + caddy + migrate profile)
- [x] 3.4 Add `deploy/Caddyfile`
- [x] 3.5 Create `.env.production.example`
- [x] 3.6 Refine dev `docker-compose.yml` comments (keep local Postgres)

## 4. Deploy and CI

- [x] 4.1 Add `scripts/deploy-production.sh`
- [x] 4.2 Add `scripts/validate-production-compose.sh`
- [x] 4.3 Add `.github/workflows/cloud-server.yml` (build, test, publish GHCR)

## 5. Documentation

- [x] 5.1 Add `docs/deploy/PLETHORA_CLOUD_PRODUCTION.md` (full operator runbook)

## 6. Tests and validation

- [x] 6.1 Add `server/src/__tests__/productionConfig.test.ts`
- [x] 6.2 Add `server/src/__tests__/healthAndShutdown.test.ts`
- [x] 6.3 Validate Docker image builds and compose config
- [x] 6.4 Run existing server tests
