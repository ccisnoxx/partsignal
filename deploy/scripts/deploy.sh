#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
python3 "$script_dir/check-production-inputs.py" --deployment-boundary \
  "${ENV_FILE:?必须通过 ENV_FILE 指定 Production 环境文件}"
exec python3 "$script_dir/prepare-production-data.py" deploy-production "$@"
