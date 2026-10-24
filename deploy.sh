#!/usr/bin/env bash
# Deploys Nagar Lens: Cloud Run (Express app + API) behind Firebase Hosting.
# Run in Google Cloud Shell from the repo root:  bash deploy.sh <project-id>
set -euo pipefail
PROJECT="${1:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-south1}"
echo "==> Project: $PROJECT  Region: $REGION"
gcloud config set project "$PROJECT" >/dev/null

echo "==> Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  firebasehosting.googleapis.com firebase.googleapis.com

echo "==> Deploying Cloud Run service (builds the Dockerfile)"
gcloud run deploy nagar-lens --source . --region "$REGION" --allow-unauthenticated --quiet
RUN_URL=$(gcloud run services describe nagar-lens --region "$REGION" --format='value(status.url)')
echo "==> Cloud Run: $RUN_URL"

echo "==> Building client for Firebase Hosting"
npm --prefix client ci --no-audit --no-fund
npm --prefix client run build

echo "==> Deploying Firebase Hosting"
if ! firebase projects:list 2>/dev/null | grep -q "$PROJECT"; then
  firebase projects:addfirebase "$PROJECT" || true
fi
firebase deploy --only hosting --project "$PROJECT" --non-interactive

echo
echo "==> DONE"
echo "Firebase:  https://$PROJECT.web.app"
echo "Cloud Run: $RUN_URL"
