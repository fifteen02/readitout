#!/usr/bin/env bash
# Deploy the built image to Google Cloud Run.
#
# Usage:
#   PROJECT_ID=my-gcp-project ./scripts/deploy.sh
#   (run ./scripts/build.sh first, or pass IMAGE=… explicitly)
#
# Optional env vars (with defaults):
#   REGION         europe-west1   Cloud Run region
#   SERVICE        readitout      Cloud Run service name
#   IMAGE          <.last-image>  image to deploy (defaults to the last build)
#   PUBLIC_DEPLOY  true           hosted mode: never spend the operator's key;
#                                 free browser voice for all, premium needs the
#                                 user's own key, local-server proxy disabled
#   ALLOW_UNAUTH   true           make the service publicly reachable
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID (e.g. PROJECT_ID=my-project ./scripts/deploy.sh)}"
REGION="${REGION:-europe-west1}"
SERVICE="${SERVICE:-readitout}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-$(cat "${ROOT}/.last-image" 2>/dev/null || true)}"
PUBLIC_DEPLOY="${PUBLIC_DEPLOY:-true}"
ALLOW_UNAUTH="${ALLOW_UNAUTH:-true}"

: "${IMAGE:?No image found. Run ./scripts/build.sh first or pass IMAGE=…}"

AUTH_FLAG="--allow-unauthenticated"
[ "${ALLOW_UNAUTH}" = "true" ] || AUTH_FLAG="--no-allow-unauthenticated"

echo "→ Deploying ${IMAGE}"
echo "→ Service ${SERVICE} in ${REGION} (PUBLIC_DEPLOY=${PUBLIC_DEPLOY})"

gcloud run deploy "${SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${IMAGE}" \
  --platform=managed \
  ${AUTH_FLAG} \
  --port=8080 \
  --cpu=1 --memory=512Mi \
  --min-instances=0 --max-instances=5 \
  --set-env-vars="PUBLIC_DEPLOY=${PUBLIC_DEPLOY}"

URL="$(gcloud run services describe "${SERVICE}" --project="${PROJECT_ID}" --region="${REGION}" --format='value(status.url)')"
echo "✓ Deployed: ${URL}"
