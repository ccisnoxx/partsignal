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

test "$(grep -c '^[[:space:]]*keepalive_timeout 30s;$' "$root/deploy/nginx/partsignal.conf.template")" -eq 1
test "$(grep -c '^[[:space:]]*keepalive_timeout 30s;$' "$root/deploy/nginx/partsignal.staging.conf.template")" -eq 1
grep -Fqx "    command: [uvicorn, 'app.main:app', --host, 0.0.0.0, --port, '8000', --timeout-keep-alive, '35', --workers, '2']" \
  "$root/deploy/compose.prod.yaml"
grep -Fqx "    command: [uvicorn, 'app.main:app', --host, 0.0.0.0, --port, '8000', --timeout-keep-alive, '35', --workers, '1']" \
  "$root/deploy/compose.staging.yaml"
grep -Fqx '    image: ${PARTSIGNAL_FRONTEND_IMAGE:-partsignal-frontend}:${PARTSIGNAL_VERSION}' \
  "$root/deploy/compose.staging.yaml"
grep -Fqx '      context: ../frontend-v2' "$root/deploy/compose.staging.yaml"
! grep -Fqx '      context: ../frontend' "$root/deploy/compose.staging.yaml"
grep -Fqx '      - 127.0.0.1:19080:80' "$root/deploy/compose.staging.yaml"

PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v1 PARTSIGNAL_VERSION=test \
  docker compose --env-file /dev/null -f "$root/deploy/compose.staging.yaml" \
  config --no-env-resolution --format json frontend \
  >"$test_dir/frontend-only-config.json"
python3 - "$test_dir/frontend-only-config.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

assert list(config["services"]) == ["frontend"]
frontend = config["services"]["frontend"]
assert frontend["image"] == "partsignal-frontend-v1:test"
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
! grep -q 'seed-demo' "$test_dir/fast.log"
grep -q 'build api frontend' "$test_dir/full.log"
grep -q 'run --rm migrate' "$test_dir/full.log"
grep -q 'seed-demo' "$test_dir/full.log"
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
  /seed-demo/ { seed = NR }
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

python3 - "$root/docs/Hostdzire部署附录.md" <<'PY'
from pathlib import Path
import shlex
import sys

appendix = Path(sys.argv[1]).read_text(encoding="utf-8")


def command_tokens(marker: str) -> list[str]:
    start = f"<!-- {marker}:start -->"
    end = f"<!-- {marker}:end -->"
    assert appendix.count(start) == 1
    assert appendix.count(end) == 1
    block = appendix.split(start, 1)[1].split(end, 1)[0]
    assert block.count("```sh") == 1
    command = block.split("```sh", 1)[1].split("```", 1)[0]
    normalized = " ".join(
        line.removesuffix("\\").strip()
        for line in command.splitlines()
        if line.strip()
    )
    return shlex.split(normalized)


def assert_frontend_only(tokens: list[str], image_assignment: str) -> None:
    assert tokens[:2] == [image_assignment, "PARTSIGNAL_VERSION=$ps_candidate_release"]
    assert tokens.count("docker") == 1
    compose = tokens[tokens.index("docker"):]
    assert compose[:7] == [
        "docker", "compose", "--env-file", "../.env.staging", "-f",
        "compose.staging.yaml", "up",
    ]
    assert compose.count("up") == 1
    assert compose.count("-d") == 1
    assert compose[-1] == "frontend"
    assert compose.count("frontend") == 1
    for flag in ("--no-deps", "--no-build", "--force-recreate", "--wait"):
        assert flag in compose
    assert compose[compose.index("--pull") + 1] == "never"
    assert compose[compose.index("--wait-timeout") + 1] == "60"
    for forbidden in (
        "postgres", "redis", "fake-oss", "api", "worker", "scheduler",
        "migrate", "build", "run", "alembic", "seed", "down", "stop",
        "restart", "rm", "--remove-orphans", "--always-recreate-deps", "current",
    ):
        assert forbidden not in compose


assert_frontend_only(
    command_tokens("frontend-v1-fallback-command"),
    "PARTSIGNAL_FRONTEND_IMAGE=$ps_v1_repo",
)
assert_frontend_only(
    command_tokens("frontend-v2-restore-command"),
    "PARTSIGNAL_FRONTEND_IMAGE=$ps_v2_repo",
)

for required in (
    "docker build --file frontend/Dockerfile --tag \"$ps_v1_image\" frontend",
    "postgres redis fake-oss api worker scheduler",
    "label=com.docker.compose.service=migrate",
    "select version_num from alembic_version",
    "readlink /root/partsignal/current",
    "/etc/nginx/snippets/partsignal-security-headers.conf",
    "cmp \"$ps_audit_dir/before.txt\" \"$ps_audit_dir/after-v1.txt\"",
    "cmp \"$ps_audit_dir/before.txt\" \"$ps_audit_dir/after-v2.txt\"",
):
    assert required in appendix

assert "up -d --wait worker scheduler api frontend fake-oss" not in appendix
assert "恢复 Nginx 模板和 API 镜像" not in appendix
PY

printf '%s\n' "预发布 full/fast 与 frontend-only 回退合同自检通过"
