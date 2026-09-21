#!/usr/bin/env bash
# Restore onto this machine (a fresh VM needs only: docker, rclone config, this repo, .env).
#   scripts/restore.sh backups/db-2026-09-21.dump   from a local dump
#   scripts/restore.sh 2026-09-21                   fetch that night's dump + all photos from the remote
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

src=${1:?usage: restore.sh <dump file | YYYY-MM-DD>}
if [ ! -f "$src" ]; then
  mkdir -p backups data/photos
  rclone copy "$RCLONE_REMOTE/db/db-$src.dump" backups/
  rclone copy "$RCLONE_REMOTE/photos/" data/photos/
  src="backups/db-$src.dump"
fi

docker compose up -d --wait postgres
docker compose run --rm migrate   # creates the app role that the dump's grants refer to
docker compose stop app
docker compose exec -T postgres pg_restore -U postgres -d zettlevault \
  --clean --if-exists --single-transaction < "$src"
docker compose up -d
echo "restored from $src"
