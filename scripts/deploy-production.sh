#!/usr/bin/env bash
# Deploy Plethora Cloud to production.
# Usage: ./scripts/deploy-production.sh
#
# Prerequisites:
#   - Docker Engine + Compose plugin
#   - .env.production (from .env.production.example)
#   - Logged in to GHCR if pulling private images: docker login ghcr.io

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
READINESS_URL="${READINESS_URL:-https://${PLETHORA_API_HOST:-localhost}/ready}"
READINESS_TIMEOUT="${READINESS_TIMEOUT:-120}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

# ── 1. Prerequisites ──────────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || fail "docker is not installed"
docker compose version >/dev/null 2>&1 || fail "docker compose plugin is not installed"
[[ -f "$ENV_FILE" ]] || fail "$ENV_FILE not found — copy from .env.production.example"

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

[[ -n "${DATABASE_URL:-}" ]] || fail "DATABASE_URL is not set in $ENV_FILE"
[[ -n "${JWT_SECRET:-}" ]] || fail "JWT_SECRET is not set in $ENV_FILE"
[[ -n "${PLETHORA_API_HOST:-}" ]] || fail "PLETHORA_API_HOST is not set in $ENV_FILE"

if [[ "${PLETHORA_ENV:-production}" == "production" ]]; then
  [[ -n "${S3_ENDPOINT:-}" && -n "${S3_BUCKET:-}" && -n "${S3_ACCESS_KEY_ID:-}" && -n "${S3_SECRET_ACCESS_KEY:-}" ]] \
    || fail "S3_* variables are required in production"
  [[ -n "${METRICS_TOKEN:-}" ]] || fail "METRICS_TOKEN is required in production"
fi

if [[ "${VERIFY_R2:-0}" == "1" ]]; then
  log "Running R2 storage smoke test..."
  (cd server && npm run verify:r2) || fail "R2 smoke test failed (set VERIFY_R2=0 to skip)"
fi

log "Using image: ${PLETHORA_CLOUD_IMAGE:-ghcr.io/melpomenex/plethora-cloud:latest}"
log "API host: ${PLETHORA_API_HOST}"

# ── 2. Validate compose ───────────────────────────────────────────────────────
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config >/dev/null
log "Compose configuration valid"

# ── 3. Pull or build images ───────────────────────────────────────────────────
if [[ "${BUILD_LOCAL:-0}" == "1" ]]; then
  log "Building images locally..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build api
else
  log "Pulling images..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" pull api caddy 2>/dev/null || {
    log "Pull failed — building locally instead"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build api
  }
fi

# ── 4. Database migrations ────────────────────────────────────────────────────
if [[ "$SKIP_MIGRATE" != "1" ]]; then
  if [[ -z "${DATABASE_URL_UNPOOLED:-}" && "${DATABASE_URL:-}" == *-pooler* ]]; then
    log "WARNING: DATABASE_URL_UNPOOLED is unset but DATABASE_URL uses Neon pooler — migrations may fail; set the direct URL in $ENV_FILE"
  fi
  log "Running database migrations..."
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" --profile migrate run --rm migrate
  log "Migrations complete"
else
  log "Skipping migrations (SKIP_MIGRATE=1)"
fi

# ── 5. Start services ─────────────────────────────────────────────────────────
log "Starting services..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d api worker caddy

# ── 6. Wait for readiness ─────────────────────────────────────────────────────
log "Waiting for readiness at $READINESS_URL (timeout ${READINESS_TIMEOUT}s)..."

if [[ "$READINESS_URL" == https://* ]]; then
  CURL_OPTS=(-k)
else
  CURL_OPTS=()
fi

elapsed=0
while [[ $elapsed -lt $READINESS_TIMEOUT ]]; do
  if curl -sf "${CURL_OPTS[@]}" "$READINESS_URL" >/dev/null 2>&1; then
    log "API is ready"
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
    log "Deployment successful"
    exit 0
  fi
  sleep 3
  elapsed=$((elapsed + 3))
done

fail "Readiness check timed out after ${READINESS_TIMEOUT}s"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" logs --tail=50 api
exit 1
