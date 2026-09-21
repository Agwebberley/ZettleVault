#!/usr/bin/env bash
# Nightly, from the host's cron: dump the database, copy dump + photos off the machine.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

stamp=$(date -u +%F)
dump="backups/db-$stamp.dump"
mkdir -p backups

docker compose exec -T postgres pg_dump -U postgres -Fc zettlevault > "$dump"
# a truncated dump must not count as a backup
docker compose exec -T postgres pg_restore --list < "$dump" > /dev/null

find backups -name 'db-*.dump' -mtime +7 -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$dump" "$RCLONE_REMOTE/db/"
  rclone delete --min-age 30d "$RCLONE_REMOTE/db/"
  if [ -d data/photos ]; then
    # copy, not sync: a photo deleted here by mistake must survive in the backup.
    # ponytail: the remote keeps photos of deleted cards forever; prune by hand if it ever matters.
    rclone copy data/photos "$RCLONE_REMOTE/photos/"
  fi
fi

# Dead man's switch: healthchecks.io alerts when this ping does NOT arrive.
if [ -n "${HEALTHCHECK_URL:-}" ]; then
  curl -fsS -m 10 "$HEALTHCHECK_URL" > /dev/null
fi
echo "backup ok: $dump"
