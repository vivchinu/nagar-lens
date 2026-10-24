#!/usr/bin/env bash
# Hosts the Nagar Lens front end on Firebase Hosting (free Spark plan) and points it at an API server
# that is already running elsewhere (Render by default).
# Usage (Cloud Shell, repo root): bash deploy-firebase.sh <project-id> [api-base-url] [site-id]
set -euo pipefail
PROJECT="${1:?usage: bash deploy-firebase.sh <project-id> [api-base-url] [site-id]}"
API_BASE="${2:-https://nagar-lens.onrender.com}"
SITE="${3:-nagar-lens}"
echo "==> Project: $PROJECT  API: $API_BASE  Site: $SITE"

if ! firebase projects:list 2>/dev/null | grep -q "$PROJECT"; then
  echo "==> Adding Firebase to $PROJECT"
  firebase projects:addfirebase "$PROJECT"
fi

if firebase hosting:sites:get "$SITE" --project "$PROJECT" >/dev/null 2>&1 \
  || firebase hosting:sites:create "$SITE" --project "$PROJECT" >/dev/null 2>&1; then
  echo "==> Using site $SITE"
else
  SITE="$PROJECT"
  echo "==> Site name not available, using default site $SITE"
fi
node -e "const fs=require('fs');const f=JSON.parse(fs.readFileSync('firebase.json','utf8'));f.hosting.site=process.argv[1];fs.writeFileSync('firebase.json',JSON.stringify(f,null,2))" "$SITE"

echo "==> Building client against $API_BASE"
npm --prefix client ci --no-audit --no-fund
VITE_API_BASE="$API_BASE" npm --prefix client run build

echo "==> Deploying to Firebase Hosting"
firebase deploy --only hosting --project "$PROJECT" --non-interactive

echo
echo "==> DONE: https://$SITE.web.app"
