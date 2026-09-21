#!/usr/bin/env bash
# Run on the VM. Builds natively (ARM), so no registry and no cross-compilation.
# ponytail: a few minutes of build on the box per deploy; move to CI-built images if that ever hurts.
set -euo pipefail
cd "$(dirname "$0")/.."
git pull --ff-only
docker compose up -d --build --remove-orphans
docker image prune -f
