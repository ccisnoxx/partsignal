#!/bin/sh
set -eu

# 权威资格、维护锁与 supervisor 均在已冻结的 Production owner 内。
script_dir=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
exec python3 "$script_dir/prepare-production-data.py" routine-production "$@"
