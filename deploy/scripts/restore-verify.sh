#!/bin/sh
set -eu
umask 077

: "${1:?用法: restore-verify.sh <加密GEO备份集合目录>}"
: "${RECOVERY_BACKUP_KEY_FILE:?必须指定独立备份密钥文件}"
: "${RECOVERY_ADMIN_DATABASE_URL:?必须指定本机隔离演练PG管理连接}"
if [ -n "${VERIFY_DATABASE_URL:-}" ]; then
  printf '%s\n' 'EXISTING_RESTORE_TARGET_FORBIDDEN' >&2
  exit 2
fi
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
export PYTHONPATH="$root/backend${PYTHONPATH:+:$PYTHONPATH}"
exec "${RECOVERY_PYTHON:-$root/backend/.venv/bin/python}" "$root/deploy/scripts/geo-recovery.py" \
  restore "$1" --backup-key-file "$RECOVERY_BACKUP_KEY_FILE"
