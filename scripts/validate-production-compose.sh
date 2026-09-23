#!/usr/bin/env bash
# Validate production compose configuration without starting services.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${ENV_FILE:-.env.production.example}"
COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"

echo "Validating $COMPOSE_FILE with $ENV_FILE..."

# Provide dummy values for required secrets so config validation passes
export DATABASE_URL="${DATABASE_URL:-postgresql://user:pass@localhost:5432/plethora?sslmode=require}"
export JWT_SECRET="${JWT_SECRET:-$(openssl rand -base64 48 2>/dev/null || echo 'dummy-secret-for-validation-only-32chars+')}"
export METRICS_TOKEN="${METRICS_TOKEN:-dummy-metrics-token-for-validation}"
export S3_ENDPOINT="${S3_ENDPOINT:-https://example.eu.r2.cloudflarestorage.com}"
export S3_BUCKET="${S3_BUCKET:-plethora-production}"
export S3_ACCESS_KEY_ID="${S3_ACCESS_KEY_ID:-dummy}"
export S3_SECRET_ACCESS_KEY="${S3_SECRET_ACCESS_KEY:-dummy}"
export PLETHORA_API_HOST="${PLETHORA_API_HOST:-api.example.com}"
export CORS_ORIGINS="${CORS_ORIGINS:-https://app.example.com}"
export PLETHORA_ENV_FILE="$ENV_FILE"

docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config >/dev/null

echo "OK: compose.production.yml is valid"

# Verify production compose has no local postgres or uploads volume
if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config 2>/dev/null | grep -q 'image: postgres'; then
  echo "ERROR: production compose must not include postgres" >&2
  exit 1
fi

if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config 2>/dev/null | grep -q 'uploads:'; then
  echo "ERROR: production compose must not include uploads volume for customer data" >&2
  exit 1
fi

echo "OK: no local postgres or uploads volume in production compose"
