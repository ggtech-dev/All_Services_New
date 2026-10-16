#!/bin/sh
# Daily database + uploads backup. Put in cron:  0 2 * * *  /path/to/All_Services_New/deploy/backup.sh
# Keeps 14 days. Copy the backups folder OFF this machine too (another server, Google Drive, …).
set -e
cd "$(dirname "$0")"
DIR=${BACKUP_DIR:-/var/backups/allservices}
STAMP=$(date +%Y%m%d_%H%M)
mkdir -p "$DIR"
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DIR/all_services_$STAMP.dump"
docker compose run --rm -T --no-deps -u root -v "$DIR":/backup --entrypoint sh server \
  -c "tar czf /backup/uploads_$STAMP.tar.gz -C /app uploads private_uploads"
find "$DIR" -type f -mtime +14 -delete
echo "backup done: $DIR (all_services_$STAMP.dump, uploads_$STAMP.tar.gz)"
