#!/usr/bin/env bash
# Build the container image with Cloud Build and push it to Artifact Registry.
# No local Docker required.
#
# Usage:
#   PROJECT_ID=my-gcp-project ./scripts/build.sh
#
# Optional env vars (with defaults):
#   REGION   europe-west1     Artifact Registry + Cloud Run region
#   REPO     readitout        Artifact Registry repository name
#   SERVICE  readitout        image / service name
#   TAG      <git sha|date>   image tag
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID (e.g. PROJECT_ID=my-project ./scripts/build.sh)}"
REGION="${REGION:-europe-west1}"
REPO="${REPO:-readitout}"
SERVICE="${SERVICE:-readitout}"
TAG="${TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M%S)}"

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${SERVICE}:${TAG}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Project : ${PROJECT_ID}"
echo "→ Region  : ${REGION}"
echo "→ Image   : ${IMAGE}"

# Create the Artifact Registry repo on first run (no-op if it already exists).
if ! gcloud artifacts repositories describe "${REPO}" \
      --location="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "→ Creating Artifact Registry repo '${REPO}' in ${REGION}…"
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker --location="${REGION}" --project="${PROJECT_ID}"
fi

# Build + push (Cloud Build reads the Dockerfile in the repo root).
gcloud builds submit "${ROOT}" --project="${PROJECT_ID}" --tag "${IMAGE}"

# Remember the freshly-built image so deploy.sh can pick it up.
echo "${IMAGE}" > "${ROOT}/.last-image"
echo "✓ Built and pushed ${IMAGE}"
