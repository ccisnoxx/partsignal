#!/bin/sh
set -eu

base_url=${1:-http://127.0.0.1:19000}
curl --fail --silent --show-error "$base_url/api/health/live"
curl --fail --silent --show-error "$base_url/api/health/ready"
printf '\n%s\n' "PartSignal 冒烟检查通过"
