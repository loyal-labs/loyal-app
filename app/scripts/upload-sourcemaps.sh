#!/bin/bash
set -e

if [ -z "$DATADOG_API_KEY" ]; then
  echo "DATADOG_API_KEY not set, skipping source map upload"
  exit 0
fi

# Derive the same short commit hash used in datadogRum.init({ version })
COMMIT_HASH="${VERCEL_GIT_COMMIT_SHA:0:7}"
if [ -z "$COMMIT_HASH" ]; then
  COMMIT_HASH=$(git rev-parse --short HEAD)
fi

echo "Uploading source maps for version $COMMIT_HASH"

npx datadog-ci sourcemaps upload .next/static \
  --service=app-frontend \
  --release-version="$COMMIT_HASH" \
  --minified-path-prefix=/_next/static/

echo "Source map upload complete"
