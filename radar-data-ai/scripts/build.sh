#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
dist_root="$project_root/dist"

rm -rf "$dist_root"
mkdir -p "$dist_root/server" "$dist_root/.openai"
cp "$project_root/worker/index.js" "$dist_root/server/index.js"
cp "$project_root/worker/company-directory.js" "$dist_root/server/company-directory.js"
cp "$project_root/worker/company-search.js" "$dist_root/server/company-search.js"
cp "$project_root/worker/search-runs.js" "$dist_root/server/search-runs.js"
cp "$project_root/.openai/hosting.json" "$dist_root/.openai/hosting.json"

echo "Built $dist_root"
