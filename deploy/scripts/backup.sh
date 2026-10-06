#!/bin/sh
set -eu
umask 077

: "${DATABASE_URL:?必须指定只读备份来源 DATABASE_URL}"
: "${BACKUP_DIR:?必须指定受保护 BACKUP_DIR}"
: "${RECOVERY_BACKUP_KEY_FILE:?必须指定独立备份密钥文件}"
: "${RECOVERY_SECRETS_FILE:?必须指定配套密钥清单文件}"
: "${RECOVERY_DEPLOYMENT_EVIDENCE:?必须指定当前部署与材料检查证据}"
: "${RECOVERY_RELEASE_MANIFEST:?必须指定来源 release manifest}"

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
mkdir -p "$BACKUP_DIR"
target="$BACKUP_DIR/geo-$(date -u +%Y%m%dT%H%M%SZ)-$$"
set -- backup "$target" --backup-key-file "$RECOVERY_BACKUP_KEY_FILE" \
  --secrets-file "$RECOVERY_SECRETS_FILE" --deployment-evidence "$RECOVERY_DEPLOYMENT_EVIDENCE" \
  --release-manifest "$RECOVERY_RELEASE_MANIFEST"
if [ -n "${RECOVERY_RUNTIME_ENV_FILE:-}" ]; then
  set -- "$@" --runtime-env "$RECOVERY_RUNTIME_ENV_FILE"
fi
if [ -n "${RECOVERY_NGINX_CONFIG_FILE:-}" ]; then
  set -- "$@" --nginx-config "$RECOVERY_NGINX_CONFIG_FILE"
fi
export PYTHONPATH="$root/backend${PYTHONPATH:+:$PYTHONPATH}"
exec "${RECOVERY_PYTHON:-$root/backend/.venv/bin/python}" "$root/deploy/scripts/geo-recovery.py" "$@"
