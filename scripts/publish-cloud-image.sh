#!/usr/bin/env bash
# Build and optionally push the Plethora Cloud Docker image to GHCR.
# Usage:
#   ./scripts/publish-cloud-image.sh              # build locally
#   PUSH=1 ./scripts/publish-cloud-image.sh       # build and push to ghcr.io
#   TAG=cloud-v1.0.0 PUSH=1 ./scripts/publish-cloud-image.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

IMAGE="${PLETHORA_CLOUD_IMAGE:-ghcr.io/melpomenex/plethora-cloud}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || echo local)}"
FULL_TAG="${IMAGE}:sha-${TAG}"

echo "Building ${FULL_TAG}..."
docker build -t "${FULL_TAG}" -t "${IMAGE}:latest" server/

if [[ "${PUSH:-0}" == "1" ]]; then
  echo "Pushing to GHCR..."
  docker push "${FULL_TAG}"
  docker push "${IMAGE}:latest"
  echo "Published ${FULL_TAG}"
else
  echo "Built ${FULL_TAG} (set PUSH=1 to push)"
fi
