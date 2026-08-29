#!/bin/sh
set -eu

image=${PARTSIGNAL_FRONTEND_TEST_IMAGE:-partsignal-frontend-v2:test}
container="partsignal-frontend-test-$$"
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-frontend-test.XXXXXX")

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  case "$test_dir" in
    "${TMPDIR:-/tmp}"/partsignal-frontend-test.*) rm -rf "$test_dir" ;;
  esac
}
trap cleanup 0 INT TERM

docker run -d --name "$container" --read-only \
  --tmpfs /var/cache/nginx:size=16m,noexec,nosuid \
  --tmpfs /var/run:size=4m,noexec,nosuid \
  -p 127.0.0.1::80 "$image" >/dev/null
port=$(docker port "$container" 80/tcp | sed -n 's/^127\.0\.0\.1://p')
test -n "$port"
base_url="http://127.0.0.1:${port}"

ready=false
attempt=0
while [ "$attempt" -lt 30 ]; do
  if curl --fail --silent --show-error -D "$test_dir/root.headers" \
    "$base_url/" -o "$test_dir/index.html"; then
    ready=true
    break
  fi
  attempt=$((attempt + 1))
  sleep 1
done
test "$ready" = true
grep -Eiq '^Cache-Control:[[:space:]]*no-cache\r?$' "$test_dir/root.headers"

curl --fail --silent --show-error -D "$test_dir/index.headers" \
  "$base_url/index.html" -o "$test_dir/direct-index.html"
cmp "$test_dir/index.html" "$test_dir/direct-index.html"
grep -Eiq '^Cache-Control:[[:space:]]*no-cache\r?$' "$test_dir/index.headers"

curl --fail --silent --show-error -D "$test_dir/login.headers" \
  "$base_url/login" -o "$test_dir/login.html"
cmp "$test_dir/index.html" "$test_dir/login.html"
grep -Eiq '^Cache-Control:[[:space:]]*no-cache\r?$' "$test_dir/login.headers"

asset_path=$(sed -n 's#.*src="\(/assets/[^\"]*\.js\)".*#\1#p' "$test_dir/index.html" | head -n 1)
test -n "$asset_path"
curl --fail --silent --show-error --compressed -D "$test_dir/asset.headers" \
  "$base_url$asset_path" -o "$test_dir/asset.js"
grep -Eiq '^Cache-Control:[[:space:]]*public, max-age=31536000, immutable\r?$' \
  "$test_dir/asset.headers"
grep -Eiq '^Vary:.*Accept-Encoding' "$test_dir/asset.headers"
! grep -q 'sourceMappingURL' "$test_dir/asset.js"

test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$base_url/assets/partsignal-missing.js")" = 404
test "$(curl --silent --output /dev/null --write-out '%{http_code}' \
  "$base_url${asset_path}.map")" = 404
test -z "$(docker exec "$container" find /usr/share/nginx/html -type f -name '*.map' -print -quit)"

printf '%s\n' "canonical Frontend 容器 fallback、缓存和 source map 自检通过"
