#!/usr/bin/env bash
# Build the static site and deploy it to Firebase Hosting.
# Reads settings from .env (copy .env.example → .env and fill it in once).
#
# One-time setup:
#   cp .env.example .env      # then edit FIREBASE_PROJECT_ID
#   firebase login            # (or set FIREBASE_TOKEN in .env for non-interactive)
#
# Usage:
#   ./scripts/deploy-firebase.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT}"

# Load .env if present (KEY=VALUE lines).
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

PROJECT="${FIREBASE_PROJECT_ID:-${PROJECT_ID:-}}"
if [ -z "${PROJECT}" ]; then
  echo "✗ FIREBASE_PROJECT_ID is not set."
  echo "  Copy the template and fill it in:  cp .env.example .env"
  exit 1
fi

echo "→ Building static site (dist/public)…"
npm run build:static

ONLY="hosting"
[ -n "${FIREBASE_HOSTING_SITE:-}" ] && ONLY="hosting:${FIREBASE_HOSTING_SITE}"

ARGS=(deploy --only "${ONLY}" --project "${PROJECT}" --non-interactive)
[ -n "${FIREBASE_TOKEN:-}" ] && ARGS+=(--token "${FIREBASE_TOKEN}")

echo "→ Deploying to Firebase Hosting (project: ${PROJECT})…"
npx --yes firebase-tools "${ARGS[@]}"

echo "✓ Deployed. Your site: https://${FIREBASE_HOSTING_SITE:-${PROJECT}}.web.app"
