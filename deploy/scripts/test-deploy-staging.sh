#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
test_dir=$(mktemp -d "${TMPDIR:-/tmp}/partsignal-deploy-test.XXXXXX")

cleanup() {
  case "$test_dir" in
    "${TMPDIR:-/tmp}"/partsignal-deploy-test.*) rm -rf "$test_dir" ;;
  esac
}
trap cleanup 0 INT TERM

node "$root/deploy/scripts/check-nginx-security.mjs"

uv run --offline --no-sync --project "$root/backend" python - "$root" "$test_dir" <<'PY'
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit

root, owner = map(Path, sys.argv[1:])
script = root / "deploy/scripts/prepare-preview-env.py"
origin = "https://preview.example"
target = owner / "preview.env"

def invoke(output, *extra, expected=0):
    result = subprocess.run([sys.executable, str(script), "--origin", origin,
                             "--output", str(output), *extra], capture_output=True, text=True)
    assert result.returncode == expected and not result.stderr
    document = json.loads(result.stdout)
    assert document["status"] == ("CREATED" if expected == 0 else "FAILED")
    return result.stdout

output = invoke(target)
assert target.stat().st_mode & 0o777 == 0o600
values = dict(line.split("=", 1) for line in target.read_text().splitlines()
              if line and not line.startswith("#"))
assert len(values) == 38 and values["APP_ENV"] == "staging"
assert values["CONTENT_GENERATOR"] == "deterministic"
assert values["SESSION_COOKIE_SECURE"] == "true" and values["AI_ALLOW_LOCAL_HTTP"] == "false"
assert values["CORS_ALLOWED_ORIGINS"] == origin
assert values["OBJECT_STORAGE_PUBLIC_ENDPOINT"] == origin + "/object-storage"
assert urlsplit(values["DATABASE_URL"]).password == values["POSTGRES_PASSWORD"]
secret_keys = ["POSTGRES_PASSWORD", "SESSION_SECRET", "UPLOAD_SIGNING_SECRET",
               "PARTSIGNAL_SEED_ADMIN_PASSWORD", "PARTSIGNAL_SEED_ENGINEER_PASSWORD",
               "AI_CREDENTIAL_ENCRYPTION_KEY"]
assert len({values[key] for key in secret_keys}) == 6
assert len(base64.b64decode(values["AI_CREDENTIAL_ENCRYPTION_KEY"], validate=True)) == 32
assert all(values[key] not in output for key in secret_keys)
previous = hashlib.sha256(target.read_bytes()).digest()
invoke(target, expected=2)
assert hashlib.sha256(target.read_bytes()).digest() == previous
link = owner / "preview-link.env"
link.symlink_to(target)
invoke(link, expected=2)
assert hashlib.sha256(target.read_bytes()).digest() == previous
for index, invalid in enumerate(["http://preview.example", origin + "/path", origin + "?secret=value"]):
    destination = owner / f"invalid-{index}.env"
    invoke(destination, "--origin", invalid, expected=2)
    assert not destination.exists()
invoke(owner / "missing-parent" / "preview.env", expected=2)
real_ai = owner / "real-ai.env"
invoke(real_ai, "--generator", "openai-compatible")
assert "CONTENT_GENERATOR=openai-compatible\n" in real_ai.read_text()
assert not list(owner.glob(".partsignal-preview-*"))
print("Preview env preparation: 2 positive / 6 negative; automatic secrets, no overwrite/output, staging boundary passed")
source = (root / "deploy/scripts/redeploy-staging-fast.sh").read_text()
start = source.index("bad_entries=$(" )
fragment = source[start:source.index('\n)', start)]
program = fragment.split("awk '\n", 1)[1].rsplit("'", 1)[0]
public = [".env.example", ".env.production.example", ".env.staging.example"]
private = [".env", ".env.production", ".env.staging", ".env.ai.json",
           ".env.production.ai.json", ".env.unknown.example"]
for entry in public + private:
    result = subprocess.run(["awk", program], input=entry + "\n", capture_output=True, text=True)
    assert result.returncode == 0 and not result.stderr
    assert bool(result.stdout.strip()) is (entry in private)
print("Staging archive env allowlist: 3 public templates allowed / 6 private-or-unknown entries rejected")
PY

test "$(grep -c '^[[:space:]]*keepalive_timeout 30s;$' "$root/deploy/nginx/partsignal.conf.template")" -eq 1
test "$(grep -c '^[[:space:]]*keepalive_timeout 30s;$' "$root/deploy/nginx/partsignal.staging.conf.template")" -eq 1
grep -Fqx "    command: [uvicorn, 'app.main:app', --host, 0.0.0.0, --port, '8000', --timeout-keep-alive, '35', --workers, '2']" \
  "$root/deploy/compose.prod.yaml"
grep -Fqx "    command: [uvicorn, 'app.main:app', --host, 0.0.0.0, --port, '8000', --timeout-keep-alive, '35', --workers, '1']" \
  "$root/deploy/compose.staging.yaml"
grep -Fqx '    image: ${PARTSIGNAL_FRONTEND_IMAGE:-partsignal-frontend}:${PARTSIGNAL_VERSION}' \
  "$root/deploy/compose.staging.yaml"
grep -Fqx '      context: ../frontend' "$root/deploy/compose.staging.yaml"
! grep -Fqx '      context: ../frontend-v2' "$root/deploy/compose.staging.yaml"
grep -Fqx '      - 127.0.0.1:19080:80' "$root/deploy/compose.staging.yaml"

# 干净 runner 没有私有 .env.staging；配置探针只使用原文件副本和本次测试环境。
mkdir "$test_dir/compose"
cp "$root/deploy/compose.staging.yaml" "$root/deploy/compose.geo-browser.yaml" "$test_dir/compose/"
cp "$test_dir/preview.env" "$test_dir/.env.staging"
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend PARTSIGNAL_VERSION=test \
  docker compose --env-file /dev/null -f "$test_dir/compose/compose.staging.yaml" \
  config --no-env-resolution --format json frontend \
  >"$test_dir/frontend-only-config.json"
python3 - "$test_dir/frontend-only-config.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

assert list(config["services"]) == ["frontend"]
frontend = config["services"]["frontend"]
assert frontend["image"] == "partsignal-frontend:test"
assert "depends_on" not in frontend
assert "links" not in frontend
PY

mkdir "$test_dir/bin"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "docker %s\n" "$*" >>"$COMMAND_LOG"' \
  >"$test_dir/bin/docker"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "curl %s\n" "$*" >>"$COMMAND_LOG"' \
  >"$test_dir/bin/curl"
chmod +x "$test_dir/bin/docker" "$test_dir/bin/curl"
: >"$test_dir/env"
: >"$test_dir/full.log"
: >"$test_dir/fast.log"
: >"$test_dir/invalid.log"

unset PARTSIGNAL_DEPLOY_MODE
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/full.log" \
  PARTSIGNAL_VERSION=test ENV_FILE="$test_dir/env" COMPOSE_FILE=compose.staging.yaml \
  "$root/deploy/scripts/deploy-staging.sh" >/dev/null
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/fast.log" \
  PARTSIGNAL_VERSION=test PARTSIGNAL_DEPLOY_MODE=fast \
  ENV_FILE="$test_dir/env" COMPOSE_FILE=compose.staging.yaml \
  "$root/deploy/scripts/deploy-staging.sh" >/dev/null

grep -q 'preflight-integrity' "$test_dir/fast.log"
grep -q 'build api frontend' "$test_dir/fast.log"
grep -q 'up -d --wait worker scheduler' "$test_dir/fast.log"
grep -q '/api/health/ready' "$test_dir/fast.log"
grep -q 'http://127.0.0.1:19080/' "$test_dir/fast.log"
! grep -q 'run --rm migrate' "$test_dir/fast.log"
! grep -q 'initialize-accounts' "$test_dir/fast.log"
grep -q 'build api frontend' "$test_dir/full.log"
grep -q 'run --rm migrate' "$test_dir/full.log"
grep -q 'initialize-accounts' "$test_dir/full.log"
! grep -q 'build api fake-oss frontend' "$test_dir/full.log"

awk '
  /config --quiet/ { config = NR }
  /build api frontend/ { build = NR }
  /up -d postgres redis fake-oss/ { base = NR }
  /preflight-integrity/ { preflight = NR }
  /up -d --wait worker scheduler/ { workers = NR }
  /up -d --wait api frontend/ { application = NR }
  / compose .* ps$/ { status = NR }
  /api\/health\/ready/ { ready = NR }
  /127\.0\.0\.1:19080/ { homepage = NR }
  END {
    exit !(config < build &&
           build < base &&
           base < preflight &&
           preflight < workers &&
           workers < application &&
           application < status &&
           status < ready &&
           ready < homepage)
  }
' "$test_dir/fast.log"

awk '
  /preflight-integrity/ { preflight = NR }
  /run --rm migrate/ { migrate = NR }
  /up -d --wait worker scheduler/ { workers = NR }
  /up -d --wait api frontend/ { application = NR }
  /initialize-accounts/ { seed = NR }
  END {
    exit !(preflight < migrate &&
           migrate < workers &&
           workers < application &&
           application < seed)
  }
' "$test_dir/full.log"

set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/invalid.log" \
  PARTSIGNAL_VERSION=test PARTSIGNAL_DEPLOY_MODE=invalid \
  ENV_FILE="$test_dir/env" COMPOSE_FILE=compose.staging.yaml \
  "$root/deploy/scripts/deploy-staging.sh" >/dev/null 2>&1
invalid_status=$?
set -e
test "$invalid_status" -eq 2
test ! -s "$test_dir/invalid.log"

awk '
  /for critical_path in/ { critical_gate = NR }
  /diff -qr "\$current_dir\/\$critical_path"/ { critical_compare = NR }
  /PARTSIGNAL_DEPLOY_MODE=fast PARTSIGNAL_VERSION/ { deploy = NR }
  /^nginx -t$/ { nginx = NR }
  /probe "\${public_url}\/api\/health\/live"/ { live = NR }
  /probe "\${public_url}\/api\/health\/ready"/ { ready = NR }
  /homepage=\$\(probe "\${public_url}\/"\)/ { homepage = NR }
  /stage "原子切换 current/ { current_switch = NR }
  END {
    exit !(critical_gate < critical_compare &&
           critical_compare < deploy &&
           deploy < nginx &&
           nginx < live &&
           live < ready &&
           ready < homepage &&
           homepage < current_switch)
  }
' "$root/deploy/scripts/redeploy-staging-fast.sh"

grep -q 'deploy/nginx/partsignal-security-headers.conf' \
  "$root/deploy/scripts/redeploy-staging-fast.sh"

grep -q 'V1 不属于 Production 回滚目标' "$root/docs/Hostdzire部署附录.md"
grep -q '上一份已验证 V2' "$root/docs/Hostdzire部署附录.md"
! grep -q 'frontend-v1-fallback-command' "$root/docs/Hostdzire部署附录.md"

printf '%s\n' "预发布 full/fast 与 Production canonical Frontend 边界自检通过"
