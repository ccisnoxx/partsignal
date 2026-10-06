#!/bin/sh
set -eu

: "${1:?用法: restore-verify.sh <backup.sql.gz>}"
: "${VERIFY_DATABASE_URL:?必须指定一次性验证数据库 VERIFY_DATABASE_URL}"

backup=$1
test -s "$backup"
gzip -dc "$backup" | psql "$VERIFY_DATABASE_URL" --set ON_ERROR_STOP=on
psql "$VERIFY_DATABASE_URL" --set ON_ERROR_STOP=on -c 'select count(*) from alembic_version;'
psql "$VERIFY_DATABASE_URL" --set ON_ERROR_STOP=on -c 'select count(*) from users;'
printf '%s\n' "备份恢复验证通过"
