#!/bin/sh
set -eu

: "${BACKUP_DIR:?必须指定 BACKUP_DIR}"
: "${POSTGRES_DB:?必须指定 POSTGRES_DB}"
: "${POSTGRES_USER:?必须指定 POSTGRES_USER}"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/partsignal-$timestamp.sql.gz"
mkdir -p "$BACKUP_DIR"

docker compose -f "${COMPOSE_FILE:-compose.prod.yaml}" exec -T postgres \
  pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip -9 >"$target"

test -s "$target"
printf '%s\n' "$target"
