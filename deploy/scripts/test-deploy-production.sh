#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
temporary_root=
test_dir=

cleanup() {
  if test -z "$test_dir"; then
    return 0
  fi
  cleanup_target=$test_dir
  if test -n "${PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE:-}"; then
    cleanup_target=${PARTSIGNAL_PRODUCTION_HARNESS_TEST_CLEANUP_TARGET:-$test_dir}
  fi

  cleanup_parent=$(dirname "$cleanup_target")
  cleanup_name=$(basename "$cleanup_target")
  if test "$cleanup_target" != "$test_dir" || \
      test "$cleanup_parent" != "$temporary_root"; then
    printf '%s\n' "拒绝清理不属于 Production harness 的目录：$cleanup_target" >&2
    return 1
  fi
  case "$cleanup_name" in
    partsignal-production-test.*) ;;
    *)
      printf '%s\n' "拒绝清理不符合 Production harness owner 约束的目录：$cleanup_target" >&2
      return 1
      ;;
  esac

  if ! rm -rf "$cleanup_target"; then
    printf '%s\n' "清理 Production harness 临时目录失败：$cleanup_target" >&2
    return 1
  fi
  if test -e "$cleanup_target" || test -L "$cleanup_target"; then
    printf '%s\n' "Production harness 临时目录删除后仍然存在：$cleanup_target" >&2
    return 1
  fi
}

handle_exit() {
  main_status=$?
  trap - 0 INT TERM
  cleanup_status=0
  cleanup || cleanup_status=$?
  if test "$main_status" -ne 0; then
    exit "$main_status"
  fi
  exit "$cleanup_status"
}

handle_signal() {
  exit "$1"
}
trap handle_exit 0
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

temporary_root=$(python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "${TMPDIR:-/tmp}")
if ! test -d "$temporary_root"; then
  printf '%s\n' "Production harness 临时根不存在：$temporary_root" >&2
  exit 2
fi
test_dir=$(mktemp -d "$temporary_root/partsignal-production-test.XXXXXX")
# 部署脚本 mock 仍使用明确的 production runtime；不借开发 env 绕过生产入口。
python3 - "$root/.env.example" "$test_dir/deployment-runtime.env" \
  "$root/.env.production.example" "$test_dir/compose-runtime.env" <<'PYCONFIG'
from pathlib import Path
import sys
allowed = {line.split("=", 1)[0] for line in Path(sys.argv[3]).read_text().splitlines()
           if line and not line.startswith("#") and "=" in line}
source = "\n".join(line for line in Path(sys.argv[1]).read_text().splitlines()
                   if "=" in line and line.split("=", 1)[0] in allowed)
source = source.replace("APP_ENV=development", "APP_ENV=production") + "\n"
target = Path(sys.argv[2])
target.write_text(source)
target.chmod(0o600)
# Compose 各版本保留 env_file 的 JSON 形态不同；用本次独有的公开 cookie 名检查实际绑定。
probe = Path(sys.argv[4])
lines = source.splitlines()
assert sum(line.startswith("SESSION_COOKIE_NAME=") for line in lines) == 1
probe.write_text("\n".join(
    "SESSION_COOKIE_NAME=" + probe.parent.name if line.startswith("SESSION_COOKIE_NAME=") else line
    for line in lines
) + "\n")
probe.chmod(0o600)
PYCONFIG
candidate_release=production-20260829-120000-0123456789ab
next_release=production-20260829-130000-fedcba987654

case "${PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE:-}" in
  "") ;;
  network-identity | network-compatibility) ;;
  success) exit 0 ;;
  failure) exit "${PARTSIGNAL_PRODUCTION_HARNESS_TEST_FAILURE_STATUS:-23}" ;;
  initialization-failure) exit 24 ;;
  wait-for-signal)
    while :; do
      sleep 1
    done
    ;;
  *)
    printf '%s\n' "未知的 Production harness lifecycle 回归模式" >&2
    exit 2
    ;;
esac

node "$root/deploy/scripts/check-nginx-security.mjs"
mkdir -p "$test_dir/live/postgres" "$test_dir/live/redis" "$test_dir/live/objects"
printf '%s\n' old-postgres >"$test_dir/live/postgres/marker"
printf '%s\n' old-redis >"$test_dir/live/redis/marker"
printf '%s\n' old-object >"$test_dir/live/objects/marker"

PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
PARTSIGNAL_VERSION=test \
PARTSIGNAL_RUNTIME_ENV_FILE="$test_dir/compose-runtime.env" \
PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  docker compose --env-file "$root/.env.example" -f "$root/deploy/compose.prod.yaml" \
  config --format json >"$test_dir/compose.json"
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
PARTSIGNAL_VERSION=test \
PARTSIGNAL_RUNTIME_ENV_FILE="$test_dir/compose-runtime.env" \
PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  docker compose --profile production-async --env-file "$root/.env.example" \
  -f "$root/deploy/compose.prod.yaml" \
  config --format json >"$test_dir/compose-async.json"
PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
PARTSIGNAL_MIGRATION_IMAGE=partsignal-migration:frozen-failed \
PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
PARTSIGNAL_VERSION=test \
PARTSIGNAL_RUNTIME_ENV_FILE="$test_dir/compose-runtime.env" \
PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  docker compose --env-file "$root/.env.example" -f "$root/deploy/compose.prod.yaml" \
  config --format json >"$test_dir/compose-frozen-migration.json"

if test "${PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE:-}" != network-compatibility; then
python3 - "$test_dir/compose.json" "$test_dir/live" "$test_dir/compose-runtime.env" \
  "$test_dir/compose-async.json" "$root/deploy/compose.prod.yaml" \
  "$test_dir/compose-frozen-migration.json" <<'PY'
import json
from pathlib import Path
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    config = json.load(config_file)

assert config["name"] == "partsignal-staging"
services = config["services"]
assert "frontend" in services
assert "fake-oss" not in services
frontend = services["frontend"]
assert frontend["image"] == "partsignal-frontend-v2:test"
assert "build" not in frontend
assert frontend["ports"] == [{
    "mode": "ingress",
    "target": 80,
    "published": "19080",
    "protocol": "tcp",
    "host_ip": "127.0.0.1",
}]
assert services["postgres"]["volumes"][0]["source"] == f"{sys.argv[2]}/postgres"
assert services["redis"]["volumes"][0]["source"] == f"{sys.argv[2]}/redis"
expected_environment = dict(line.split("=", 1) for line in Path(sys.argv[3]).read_text().splitlines())
assert expected_environment["SESSION_COOKIE_NAME"] == Path(sys.argv[3]).parent.name
for name in ("migrate", "api", "postgres"):
    assert services[name]["environment"] == expected_environment, name
assert services["frontend"]["networks"] == {"partsignal-staging-edge": None}
assert "worker" not in services
assert "scheduler" not in services
assert services["migrate"]["image"] == services["api"]["image"] == "partsignal-backend:test"
with open(sys.argv[6], encoding="utf-8") as config_file:
    frozen_services = json.load(config_file)["services"]
assert frozen_services["api"]["image"] == "partsignal-backend:test"
assert frozen_services["migrate"]["image"] == "partsignal-migration:frozen-failed"
assert frozen_services["migrate"]["command"] == ["alembic", "upgrade", "head"]
for name in ("migrate", "api", "postgres"):
    assert frozen_services[name]["environment"] == expected_environment, name
with open(sys.argv[4], encoding="utf-8") as config_file:
    async_config = json.load(config_file)
expected_networks = {"partsignal-staging-" + suffix for suffix in ("internal", "egress", "edge")}
assert set(config["networks"]) == set(async_config["networks"]) == expected_networks
for key, network in async_config["networks"].items():
    assert network["name"] == key
    assert network.get("external", False) is False
    assert network.get("internal", False) is (key == "partsignal-staging-internal")
backend_networks = {"partsignal-staging-internal", "partsignal-staging-egress"}
expected_services = {
    "migrate": backend_networks, "api": backend_networks,
    "worker": backend_networks, "scheduler": backend_networks,
    "postgres": {"partsignal-staging-internal"},
    "redis": {"partsignal-staging-internal"},
    "frontend": {"partsignal-staging-edge"},
}
assert set(async_config["services"]) == set(expected_services)
assert set(services) == set(expected_services) - {"worker", "scheduler"}
for name, networks in expected_services.items():
    assert set(async_config["services"][name]["networks"]) == networks, name
    if name in services:
        assert set(services[name]["networks"]) == networks, name
for name in ("migrate", "api", "worker", "scheduler", "postgres"):
    assert async_config["services"][name]["environment"] == expected_environment, name
for name in ("postgres", "redis"):
    assert not async_config["services"][name].get("ports"), name
with open(sys.argv[5], encoding="utf-8") as source:
    text = source.read()
assert all("partsignal-" + suffix not in text for suffix in ("internal", "egress", "edge"))
assert "19001" not in text and "/object-storage/" not in text
print("Production network identity static: 3 networks / 7 services passed")
print("Production migration binding: frozen migration image / repaired backend / fixed command passed")
PY
fi

if test "${PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE:-}" = network-identity; then
  exit 0
fi

# 真实本地 Engine，直接使用权威 Production Compose；禁止复用未知网络或运行项目。
python3 - "$root" "$test_dir" <<'PY'
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import uuid

root, test_dir = map(Path, sys.argv[1:])
owner = "production-network-compat-" + uuid.uuid4().hex
owner_key = "com.partsignal.test-owner"
owner_filter = "label=" + owner_key + "=" + owner
project = "partsignal-staging"
keys = [project + "-" + suffix for suffix in ("internal", "egress", "edge")]
environment = {
    **os.environ,
    "COMPOSE_PROJECT_NAME": project,
    "PARTSIGNAL_BACKEND_IMAGE": "partsignal-backend",
    "PARTSIGNAL_FRONTEND_IMAGE": "partsignal-frontend-v2",
    "PARTSIGNAL_VERSION": "test",
    "PARTSIGNAL_FRONTEND_VERSION": "test",
    "PARTSIGNAL_RUNTIME_ENV_FILE": str(root / ".env.example"),
    "PARTSIGNAL_DATA_ROOT": str(test_dir / "engine-data"),
}

def docker(*args, check=True):
    return subprocess.run(["docker", *args], env=environment, text=True,
                          capture_output=True, check=check)

context = os.environ.get("DOCKER_CONTEXT")
endpoint = (docker("context", "inspect", context, "--format",
                   '{{(index .Endpoints "docker").Host}}').stdout.strip() if context
            else os.environ.get("DOCKER_HOST") or docker(
                "context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}'
            ).stdout.strip())
assert endpoint.startswith("unix://"), "network 回归只允许本地 Unix socket Engine"
docker("info", "--format", "{{.ID}}")
assert not docker("ps", "-aq", "--filter", "label=com.docker.compose.project=" + project).stdout.strip(), "固定项目已被占用"
existing = set(docker("network", "ls", "--format", "{{.Name}}").stdout.splitlines())
assert not existing.intersection(keys), "固定测试网络已被占用，拒绝接管"
config = json.loads((test_dir / "compose-async.json").read_text())
for service in config["services"].values():
    docker("image", "inspect", service["image"], "--format", "{{.Id}}")
for leaf in ("postgres", "redis"):
    (test_dir / "engine-data" / leaf).mkdir(parents=True)
compose = ["compose", "--profile", "production-async", "--env-file",
           str(root / ".env.example"), "-f", str(root / "deploy/compose.prod.yaml")]

def owned_ids(kind):
    command = ("ps", "-aq", "--no-trunc") if kind == "container" else ("network", "ls", "-q", "--no-trunc")
    return docker(*command, "--filter", owner_filter).stdout.split()

def cleanup():
    for kind in ("container", "network"):
        for identifier in owned_ids(kind):
            metadata = json.loads(docker(kind, "inspect", identifier).stdout)[0]
            labels = metadata["Config"]["Labels"] if kind == "container" else metadata["Labels"]
            assert labels[owner_key] == owner, "cleanup ownership 不匹配"
            docker(kind, "rm", *( ["-f", "-v"] if kind == "container" else []), identifier)
    assert not owned_ids("container") and not owned_ids("network"), "Engine 回归资源未归零"

def create_networks(wrong_key=None):
    for key in keys:
        logical = key.replace("partsignal-staging-", "partsignal-") if key == wrong_key else key
        args = ["network", "create", "--label", owner_key + "=" + owner,
                "--label", "com.docker.compose.project=" + project,
                "--label", "com.docker.compose.network=" + logical]
        if key.endswith("-internal"):
            args.append("--internal")
        docker(*args, key)
        network = json.loads(docker("network", "inspect", key).stdout)[0]
        assert network["Name"] == key and network["Labels"]["com.docker.compose.network"] == logical
        assert network["Internal"] is key.endswith("-internal")

def probe(service):
    return docker(*compose, "run", "--rm", "--pull", "never", "--no-deps",
                  "--name", owner + "-" + service, "--label", owner_key + "=" + owner,
                  "--entrypoint", "/bin/sh", service, "-c", "printf '%s\\n' network-compatible",
                  check=False)

def interrupted(signum, frame):
    raise KeyboardInterrupt("Engine 回归被 signal 中断")

signal.signal(signal.SIGTERM, interrupted)
try:
    create_networks()
    before = {key: docker("network", "inspect", "--format", "{{.Id}}", key).stdout.strip() for key in keys}
    for service in ("api", "migrate", "postgres", "redis", "worker", "scheduler", "frontend"):
        result = probe(service)
        assert result.returncode == 0, (service, result.returncode, result.stdout, result.stderr)
        assert result.stdout.strip() == "network-compatible", result.stdout
        assert not owned_ids("container"), "run --rm 未清理 one-off"
        print("Engine existing-label reuse: " + service + " passed", flush=True)
    after = {key: docker("network", "inspect", "--format", "{{.Id}}", key).stdout.strip() for key in keys}
    assert before == after, "Compose 不得重建已存在网络"
    cleanup()
    for key in keys:
        create_networks(wrong_key=key)
        result = probe("frontend" if key.endswith("-edge") else "api")
        expected_label = key.replace("partsignal-staging-", "partsignal-")
        assert result.returncode != 0
        assert 'incorrect label com.docker.compose.network' in result.stderr, result.stderr
        assert key in result.stderr and '"' + expected_label + '"' in result.stderr, result.stderr
        assert '(expected: "' + key + '")' in result.stderr, result.stderr
        assert not owned_ids("container"), "label mismatch 不应创建容器"
        print("Engine old-label rejection: " + key + " passed", flush=True)
        cleanup()
finally:
    cleanup()
print("Production Engine network compatibility: 7 positive / 3 negative; containers=0 networks=0")
PY

if test "${PARTSIGNAL_PRODUCTION_HARNESS_TEST_MODE:-}" = network-compatibility; then
  exit 0
fi

uv run --offline --no-sync --project "$root/backend" python - "$root" "$test_dir" <<'PY'
import base64
import json
import os
from pathlib import Path
import subprocess
import sys

root, owner = map(Path, sys.argv[1:])
checker = root / "deploy/scripts/check-production-inputs.py"
runtime = owner / "input-runtime.env"
ai_path = owner / "input-ai.json"
template = (root / ".env.production.example").read_text()
values = dict(line.split("=", 1) for line in template.splitlines() if line and not line.startswith("#"))
values.update({
    "POSTGRES_PASSWORD": "p" * 48, "SESSION_SECRET": "s" * 64,
    "UPLOAD_SIGNING_SECRET": "u" * 64,
    "PARTSIGNAL_SEED_ADMIN_PASSWORD": "a" * 48,
    "PARTSIGNAL_SEED_ENGINEER_PASSWORD": "e" * 48,
    "AI_CREDENTIAL_ENCRYPTION_KEY": base64.b64encode(bytes(range(32))).decode(),
    "DATABASE_URL": "postgresql+psycopg://partsignal:" + "p" * 48 + "@postgres:5432/partsignal",
    "OSS_ENDPOINT": "https://oss-cn-hangzhou.aliyuncs.com",
    "OSS_BUCKET": "synthetic-input-check", "OSS_ACCESS_KEY_ID": "synthetic-access-id",
    "OSS_ACCESS_KEY_SECRET": "synthetic-access-secret",
})
ai = json.loads((root / "deploy/production-ai.example.json").read_text())
ai.update(provider_brand="CUSTOM", base_url="https://synthetic-provider.example/v1",
          model_display_name="Synthetic Model", model_id="synthetic-model",
          credential_owner="synthetic-owner", credential_ready=True,
          credential_json_bytes_upper_bound=1024,
          chat_completions_compatibility_confirmed=True,
          credential_owner_tty_handoff_confirmed=True)

def render(current):
    return "".join(f"{key}={value}\n" for key, value in current.items())

counts = {"positive": 0, "negative": 0}

def run(text, ai_value=ai, *, mode=0o600, expected=0, code=None):
    runtime.write_text(text)
    runtime.chmod(mode)
    ai_path.write_text(ai_value if isinstance(ai_value, str) else json.dumps(ai_value, ensure_ascii=False))
    ai_path.chmod(0o600)
    result = subprocess.run(
        [sys.executable, str(checker), str(runtime), "--ai-inputs", str(ai_path)],
        cwd=owner, env={**os.environ, "APP_ENV": "development", "SESSION_SECRET": "inherited-not-used"},
        capture_output=True, text=True,
    )
    assert result.returncode == expected, result.stdout
    counts["positive" if expected == 0 else "negative"] += 1
    assert not result.stderr
    assert all(secret not in result.stdout for secret in [values["POSTGRES_PASSWORD"],
               values["SESSION_SECRET"], values["OSS_ACCESS_KEY_SECRET"], "CONFIG_REVIEW_UNSET"])
    summary = json.loads(result.stdout)
    if code:
        assert summary["code"] == code
    return summary

summary = run(render(values))
assert summary["ai_inputs"] == "PASSED" and summary["external_services_gate"] == "NOT_RUN"
summary = run(template, json.loads((root / "deploy/production-ai.example.json").read_text()), expected=2)
assert summary["status"] == "NOT_READY" and len(summary["missing_runtime"]) == 11
assert len(summary["missing_ai"]) == 9
cases = [
    ({"POSTGRES_PASSWORD": "synthetic-safe-prefix${CONFIG_REVIEW_UNSET}",
      "DATABASE_URL": "postgresql+psycopg://partsignal:synthetic-safe-prefix%24%7BCONFIG_REVIEW_UNSET%7D@postgres:5432/partsignal"}, "ENV_INTERPOLATION_OR_QUOTING"),
    ({"POSTGRES_PASSWORD": "p" * 48 + "$PLAIN"}, "ENV_INTERPOLATION_OR_QUOTING"),
    ({"POSTGRES_PASSWORD": "p" * 48 + "$(command)"}, "ENV_INTERPOLATION_OR_QUOTING"),
    ({"POSTGRES_PASSWORD": "p" * 48 + "`command`"}, "ENV_INTERPOLATION_OR_QUOTING"),
    ({"POSTGRES_PASSWORD": "quoted-password'"}, "ENV_INTERPOLATION_OR_QUOTING"),
    ({"POSTGRES_USER": "different-user"}, "DATABASE_IDENTITY_MISMATCH"),
    ({"POSTGRES_DB": "different-db"}, "DATABASE_IDENTITY_MISMATCH"),
    ({"POSTGRES_PASSWORD": "short"}, "URL_SAFE_SECRET_REQUIRED:POSTGRES_PASSWORD"),
    ({"GENERATION_EAGER": "true"}, "PRODUCTION_FIXED_VALUE_REQUIRED:GENERATION_EAGER"),
    ({"VITE_API_BASE_URL": "https://cross-origin.example"}, "PRODUCTION_FIXED_VALUE_REQUIRED:VITE_API_BASE_URL"),
    ({"AI_CREDENTIAL_ENCRYPTION_KEY": "invalid-base64"}, "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
]
for changes, code in cases:
    run(render({**values, **changes}), expected=2, code=code)
for text, code in [
    (render(values).replace("\n", "\r\n"), "ENV_CONTROL_CHARACTER"),
    (render(values) + "source another-file\n", "ENV_LITERAL_SYNTAX_REQUIRED"),
    (render(values) + "include another-file\n", "ENV_LITERAL_SYNTAX_REQUIRED"),
    (render(values) + "SESSION_SECRET=duplicate\n", "ENV_DUPLICATE_KEY"),
    (render(values) + "UNKNOWN_CONFIG=value\n", "ENV_KEY_SET_MISMATCH"),
]:
    run(text, expected=2, code=code)
for changes, code in [
    ({"provider_brand": "NOT_A_BRAND"}, "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
    ({"timeout_seconds": 9}, "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
    ({"model_id": " synthetic-model"}, "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
    ({"request_parameters": {"model": "forbidden"}}, "BACKEND_CONFIG_OR_AI_SCHEMA_INVALID"),
    ({"custom_headers_required": True}, "AI_CUSTOM_HEADERS_UNSUPPORTED"),
    ({"request_parameters": {"large": "x" * 70000}}, "AI_BOOTSTRAP_ENVELOPE_TOO_LARGE"),
    ({"request_parameters": {"large": "中" * 22000}}, "AI_BOOTSTRAP_ENVELOPE_TOO_LARGE"),
    ({"credential_json_bytes_upper_bound": 70000}, "AI_BOOTSTRAP_ENVELOPE_TOO_LARGE"),
    ({"credential_json_bytes_upper_bound": True}, "AI_CREDENTIAL_BUDGET_INVALID"),
    ({"base_url": "https://127.0.0.1/v1"}, "AI_PUBLIC_ADDRESS_REQUIRED"),
    ({"base_url": "https://localhost/v1"}, "AI_PUBLIC_ADDRESS_REQUIRED"),
    ({"base_url": "https://127.1/v1"}, "AI_PUBLIC_ADDRESS_REQUIRED"),
    ({"base_url": "https://0x7f000001/v1"}, "AI_PUBLIC_ADDRESS_REQUIRED"),
    ({"base_url": "https://2130706433/v1"}, "AI_PUBLIC_ADDRESS_REQUIRED"),
    ({"base_url": "https://localhost./v1"}, "AI_PUBLIC_ADDRESS_REQUIRED"),
]:
    run(render(values), {**ai, **changes}, expected=2, code=code)
summary = run(render(values), {**ai, "credential_ready": False}, expected=2)
assert summary["missing_ai"] == ["credential_ready"]
summary = run(render(values), {**ai, "credential_json_bytes_upper_bound": 0}, expected=2)
assert summary["missing_ai"] == ["credential_json_bytes_upper_bound"]
run(render(values), mode=0o644, expected=2, code="INPUT_FILE_METADATA_INVALID")
run(render(values), '{"channel_name":"first","channel_name":"second"}',
    expected=2, code="AI_DUPLICATE_KEY")
runtime.unlink()
runtime.symlink_to(ai_path)
result = subprocess.run([sys.executable, str(checker), str(runtime)], capture_output=True, text=True)
assert result.returncode == 2 and not result.stderr
assert json.loads(result.stdout)["code"] == "INPUT_CHECK_FAILED"
counts["negative"] += 1
# 当前 Hostdzire runtime 已有有效文件；此模式不要求读回其 secret 或填本地空 runtime。
ai_path.write_text(json.dumps(ai, ensure_ascii=False))
result = subprocess.run([sys.executable, str(checker), "--ai-only", "--ai-inputs", str(ai_path)],
                        capture_output=True, text=True)
assert result.returncode == 0 and not result.stderr
summary = json.loads(result.stdout)
assert summary["runtime"] == "NOT_CHECKED" and summary["ai_inputs"] == "PASSED"
assert summary["external_services_gate"] == "NOT_RUN"
counts["positive"] += 1
print(f"Production input readiness: {counts['positive']} positive / {counts['negative']} negative; "
      "substitution rejected before deployment; secrets not echoed")
PY

python3 - "$test_dir/compose-async.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as config_file:
    services = json.load(config_file)["services"]

assert services["worker"]["profiles"] == ["production-async"]
assert services["scheduler"]["profiles"] == ["production-async"]
PY

grep -q 'server 127.0.0.1:19080;' "$root/deploy/nginx/partsignal.conf.template"
grep -q 'proxy_pass http://partsignal_frontend;' "$root/deploy/nginx/partsignal.conf.template"
! grep -q '/var/www/partsignal-frontend/current' "$root/deploy/nginx/partsignal.conf.template"
! grep -q '/object-storage/' "$root/deploy/nginx/partsignal.conf.template"

maintenance_template="$root/deploy/nginx/partsignal-maintenance.conf.template"
grep -q 'listen <HOSTDZIRE_WG_ADDRESS>:80 proxy_protocol;' "$maintenance_template"
grep -q 'listen <HOSTDZIRE_WG_ADDRESS>:443 ssl proxy_protocol;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/acme-challenge.conf;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/cert-962850.xyz.conf;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/ssl-common.conf;' "$maintenance_template"
grep -q 'include /etc/nginx/snippets/partsignal-security-headers.conf;' "$maintenance_template"
grep -q 'add_header_inherit merge;' "$maintenance_template"
grep -q 'default_type text/plain;' "$maintenance_template"
grep -q 'add_header Cache-Control "no-store" always;' "$maintenance_template"
grep -q 'add_header Retry-After "3600" always;' "$maintenance_template"
grep -q 'return 503 "PartSignal maintenance\\n";' "$maintenance_template"
! grep -Eq '^[[:space:]]*upstream[[:space:]]' "$maintenance_template"
! grep -q 'proxy_pass' "$maintenance_template"
! grep -Eq '^[[:space:]]*root[[:space:]]' "$maintenance_template"
! grep -Eq '(^|[^0-9])19000([^0-9]|$)' "$maintenance_template"
! grep -Eq '(^|[^0-9])19001([^0-9]|$)' "$maintenance_template"
! grep -Eq '(^|[^0-9])19080([^0-9]|$)' "$maintenance_template"
! grep -q '/object-storage/' "$maintenance_template"

mkdir "$test_dir/bin"
export PARTSIGNAL_TEST_RUNTIME_BACKEND="$root/backend"
export PARTSIGNAL_TEST_RUNTIME_ADAPTER="$root/deploy/scripts/test-migration-runtime-docker.py"
export PARTSIGNAL_TEST_RUNTIME_STATE="$test_dir/runtime-fixtures"
printf '%s\n' \
  '#!/bin/sh' \
  'case "$1" in create | export | container) exec python3 "$PARTSIGNAL_TEST_RUNTIME_ADAPTER" "$PARTSIGNAL_TEST_RUNTIME_BACKEND" "$PARTSIGNAL_TEST_RUNTIME_STATE" "$@" ;; esac' \
  'case "$*" in' \
  '  "image inspect "*)' \
  '    printf "docker %s\n" "$*" >>"${COMMAND_LOG:-/dev/null}"' \
  '    case "$*" in *"${MISSING_IMAGE_REFERENCE:-__never__}"*) exit 1 ;; esac' \
  '    printf '\''[{"Id":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","RepoDigests":["example@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"Config":{"Env":[],"WorkingDir":"/app","Entrypoint":null}}]\n'\''' \
  '    ;;' \
  '  "ps -q --filter label=com.docker.compose.project="*) printf "%s\n" "${DOCKER_PROJECT_IDS:-}" ;;' \
  '  "ps -q") printf "%s\n" "${DOCKER_RUNNING_IDS:-}" ;;' \
  '  "inspect "*) printf "%s\n" "${DOCKER_INSPECT_JSON:-[]}" ;;' \
  '  *)' \
  '    if test "$1" = compose; then test "${COMPOSE_PROJECT_NAME:-}" = partsignal-staging || exit 92; fi' \
  '    printf "docker %s\n" "$*" >>"${COMMAND_LOG:-/dev/null}" ;;' \
  'esac' \
  >"$test_dir/bin/docker"
printf '%s\n' \
  '#!/bin/sh' \
  'printf "curl %s\n" "$*" >>"${COMMAND_LOG:-/dev/null}"' \
  >"$test_dir/bin/curl"
chmod +x "$test_dir/bin/docker" "$test_dir/bin/curl"

python3 - "$root/deploy/scripts/prepare-production-data.py" <<'PY'
import getpass
import importlib.util
import io
import json
import os
import pty
import select
import subprocess
import sys
import tempfile
import time
import warnings
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace


script_path = sys.argv[1]
sys.path.insert(0, str(Path(script_path).parent))
spec = importlib.util.spec_from_file_location("prepare_production_data", script_path)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


class TTY:
    def __init__(self, enabled=True):
        self.enabled = enabled

    def isatty(self):
        return self.enabled


def expect_data_error(callback):
    try:
        callback()
    except module.DataStateError:
        return
    raise AssertionError("expected DataStateError")


tty = TTY()
assert module.read_bootstrap_credential(
    reader=lambda prompt: "injected-secret", stdin=tty, stderr=tty
) == "injected-secret"
expect_data_error(
    lambda: module.read_bootstrap_credential(
        reader=lambda prompt: "must-not-be-read", stdin=TTY(False), stderr=tty
    )
)


def fallback_reader(_prompt):
    warnings.warn("echo fallback", getpass.GetPassWarning)
    return "fallback-secret"


expect_data_error(
    lambda: module.read_bootstrap_credential(
        reader=fallback_reader, stdin=tty, stderr=tty
    )
)
for failure in (EOFError, KeyboardInterrupt, OSError):
    def failed_reader(_prompt, error_type=failure):
        raise error_type()

    expect_data_error(
        lambda reader=failed_reader: module.read_bootstrap_credential(
            reader=reader, stdin=tty, stderr=tty
        )
    )

# 真实 PTY 回归：正常 getpass 路径不得把输入回显到控制终端。
pid, descriptor = pty.fork()
if pid == 0:
    try:
        assert module.read_bootstrap_credential() == "pty-secret-must-not-echo"
        print("PTY_BOOTSTRAP_OK", flush=True)
    except BaseException:
        os._exit(1)
    os._exit(0)

transcript = b""
sent = False
deadline = time.monotonic() + 5
child_status = None
while time.monotonic() < deadline:
    readable, _, _ = select.select([descriptor], [], [], 0.1)
    if readable:
        try:
            transcript += os.read(descriptor, 4096)
        except OSError:
            pass
    if b"AI API Key:" in transcript and not sent:
        os.write(descriptor, b"pty-secret-must-not-echo\n")
        sent = True
    waited_pid, status = os.waitpid(pid, os.WNOHANG)
    if waited_pid == pid:
        child_status = status
        break
if child_status is None:
    os.kill(pid, 9)
    _, child_status = os.waitpid(pid, 0)
os.close(descriptor)
assert os.waitstatus_to_exitcode(child_status) == 0, transcript
assert b"PTY_BOOTSTRAP_OK" in transcript
assert b"pty-secret-must-not-echo" not in transcript

container_id = "b" * 64
candidate = {"backend_image_id": "sha256:" + "a" * 64}


def container_runner(*, ids=container_id, metadata=None):
    calls = []
    if metadata is None:
        metadata = "|".join(
            (
                container_id,
                candidate["backend_image_id"],
                "running",
                "true",
                "partsignal-staging",
                "api",
                "[]",
            )
        )

    def run(command, **kwargs):
        calls.append((command, kwargs))
        if command[1] == "ps":
            return subprocess.CompletedProcess(command, 0, stdout=ids + "\n")
        return subprocess.CompletedProcess(command, 0, stdout=metadata + "\n")

    return run, calls


runner, docker_calls = container_runner()
assert module.running_api_container_id(candidate, runner=runner) == container_id
assert len(docker_calls) == 2
assert ".Config.Env" not in " ".join(docker_calls[1][0])
for ids, metadata in (
    ("", None),
    (container_id + "\n" + "c" * 64, None),
    (
        container_id,
        "|".join(
            (
                container_id,
                candidate["backend_image_id"],
                "running",
                "true",
                "wrong-project",
                "api",
                "[]",
            )
        ),
    ),
    (
        container_id,
        "|".join(
            (
                container_id,
                "sha256:" + "c" * 64,
                "running",
                "true",
                "partsignal-staging",
                "api",
                "[]",
            )
        ),
    ),
    (
        container_id,
        "|".join(
            (
                container_id,
                candidate["backend_image_id"],
                "exited",
                "false",
                "partsignal-staging",
                "api",
                "[]",
            )
        ),
    ),
    (
        container_id,
        "|".join(
            (
                container_id,
                candidate["backend_image_id"],
                "running",
                "true",
                "partsignal-staging",
                "api",
                json.dumps([{"Type": "bind", "Destination": "/app/app"}]),
            )
        ),
    ),
):
    rejected_runner, _ = container_runner(ids=ids, metadata=metadata)
    expect_data_error(
        lambda current=rejected_runner: module.running_api_container_id(
            candidate, runner=current
        )
    )

request_id = "production-bootstrap-123e4567-e89b-42d3-a456-426614174000"
full_result = {
    "status": "SUCCEEDED",
    "request_id": request_id,
    "channel_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "channel_revision": 1,
    "channel_enabled": True,
    "channel_configured": True,
    "model_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    "model_revision": 2,
    "model_test_status": "PASSED",
    "model_enabled": True,
    "model_configured": True,
}
envelope = {"request_id": request_id, "credential": "pipe-secret"}


def backend_runner(returncode, result):
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        raw = result if isinstance(result, bytes) else json.dumps(result).encode()
        return subprocess.CompletedProcess(command, returncode, stdout=raw)

    return run, calls


runner, exec_calls = backend_runner(0, full_result)
assert module._backend_bootstrap_result(
    container_id=container_id,
    envelope=envelope,
    request_id=request_id,
    runner=runner,
)["status"] == "SUCCEEDED"
command, options = exec_calls[0]
assert command[:3] == ["docker", "exec", "-i"]
assert "pipe-secret" not in " ".join(command)
assert options["shell"] is False
assert options["stderr"] is subprocess.DEVNULL

full_failed = {
    **full_result,
    "status": "FAILED",
    "channel_enabled": False,
    "model_enabled": False,
    "model_test_status": "FAILED",
}
accepted_runner, _ = backend_runner(1, full_failed)
assert module._backend_bootstrap_result(
    container_id=container_id,
    envelope=envelope,
    request_id=request_id,
    runner=accepted_runner,
)["status"] == "FAILED"

for returncode, result in (
    (1, full_result),
    (0, full_failed),
    (0, {"status": "FAILED", "request_id": request_id}),
    (0, {"status": "REJECTED", "request_id": request_id}),
    (2, {"status": "UNKNOWN", "request_id": request_id}),
    (2, {"status": "FAILED", "request_id": request_id}),
    (2, {"status": "REJECTED", "request_id": request_id}),
    (1, {**full_failed, "model_test_status": "UNTESTED"}),
    (1, {**full_failed, "model_configured": False}),
    (0, b""),
    (0, json.dumps(full_result).encode() + b" trailing"),
):
    unknown_runner, _ = backend_runner(returncode, result)
    try:
        module._backend_bootstrap_result(
            container_id=container_id,
            envelope=envelope,
            request_id=request_id,
            runner=unknown_runner,
        )
    except module.BootstrapResultUnknown:
        pass
    else:
        raise AssertionError("contradictory or incomplete backend result was accepted")

assert module._attempt_status({}) is None
malformed_attempts = (
    None,
    [],
    {},
    {"request_id": request_id},
    {"status": "SUCCEEDED"},
    {"request_id": request_id, "status": []},
    {"request_id": request_id, "status": "UNKNOWN"},
    {
        "request_id": "not-a-production-bootstrap-request-id",
        "status": "SUCCEEDED",
    },
    {"request_id": request_id, "status": "SUCCEEDED", "unexpected": True},
)
for malformed_attempt in malformed_attempts:
    rejected_state = {"ai_bootstrap_attempt": malformed_attempt}
    expect_data_error(lambda current=rejected_state: module._attempt_status(current))
    expect_data_error(
        lambda current=rejected_state: module.require_activation_safe_bootstrap_attempt(
            current
        )
    )
expect_data_error(lambda: module.require_activation_safe_bootstrap_attempt({}))
for status_value in ("STARTED", "FAILED", "SUCCEEDED"):
    valid_state = {
        "ai_bootstrap_attempt": {"request_id": request_id, "status": status_value}
    }
    assert module._attempt_status(valid_state) == status_value
    if status_value == "SUCCEEDED":
        module.require_activation_safe_bootstrap_attempt(valid_state)
    else:
        expect_data_error(
            lambda current=valid_state: module.require_activation_safe_bootstrap_attempt(
                current
            )
        )

candidate_identity = {
    "manifest_sha256": "d" * 64,
    "release_id": "production-20260829-120000-0123456789ab",
    "commit": "e" * 40,
    "schema_head": "0043_geo_platform_identity",
    "backend_reference": "partsignal-backend:production",
    "backend_image_id": candidate["backend_image_id"],
    "backend_repo_digests": ["example@sha256:" + "f" * 64],
    "frontend_reference": "partsignal-frontend-v2:production",
    "frontend_image_id": "sha256:" + "1" * 64,
    "frontend_repo_digests": ["example@sha256:" + "2" * 64],
    "rollback_frontend_reference": "partsignal-frontend-v2:previous",
    "rollback_frontend_image_id": "sha256:" + "3" * 64,
    "rollback_frontend_repo_digests": ["example@sha256:" + "4" * 64],
}
bootstrap_args = SimpleNamespace(
    run_id="prr_20260829_120000",
    manifest="/unused/test-manifest.json",
    channel_name="Production channel",
    channel_description="Production bootstrap",
    protocol_type="openai-compatible-chat-completions",
    provider_brand="CUSTOM",
    base_url="https://provider.example/v1",
    timeout_seconds=30,
    model_display_name="Production model",
    model_id="exact-model-id",
    request_parameters_json='{"temperature":0}',
)


def dynamic_backend_runner(returncode, result_factory):
    def run(command, **kwargs):
        envelope_value = json.loads(kwargs["input"])
        result = result_factory(envelope_value["request_id"])
        raw = result if isinstance(result, bytes) else json.dumps(result).encode()
        return subprocess.CompletedProcess(command, returncode, stdout=raw)

    return run


def exercise_dynamic_attempt(returncode, result_factory, *, assert_reentry=False):
    with tempfile.TemporaryDirectory() as directory:
        data_root = Path(directory)
        quarantine_root = data_root / "quarantine"
        quarantine_root.mkdir()
        module.atomic_write_state(
            data_root,
            {
                "schema_version": 1,
                "phase": "PRODUCTION_PREPARED",
                "run_id": bootstrap_args.run_id,
                "data_root": str(data_root),
                "quarantine_target": str(quarantine_root / bootstrap_args.run_id),
                "candidate": candidate_identity,
            },
        )
        module.configured_roots = lambda: (data_root, quarantine_root)
        module.candidate_from_manifest = lambda _value: candidate_identity

        def verify_phase(_run_id, allowed):
            current = module.read_state(data_root)
            assert current["phase"] in allowed
            return current

        module.verify_phase = verify_phase
        module.running_api_container_id = lambda _candidate, runner: container_id
        output = io.StringIO()
        error = None
        try:
            with redirect_stdout(output):
                module.bootstrap_ai(
                    bootstrap_args,
                    credential_reader=lambda _prompt: "attempt-secret",
                    runner=dynamic_backend_runner(returncode, result_factory),
                    stdin=tty,
                    stderr=tty,
                )
        except module.DataStateError as caught:
            error = caught
        persisted = module.read_state(data_root)
        assert "attempt-secret" not in json.dumps(persisted)
        assert "attempt-secret" not in output.getvalue()
        if assert_reentry:
            expect_data_error(
                lambda: module.bootstrap_ai(
                    bootstrap_args,
                    credential_reader=lambda _prompt: (_ for _ in ()).throw(
                        AssertionError("reentry reached credential reader")
                    ),
                    runner=lambda *_args, **_kwargs: (_ for _ in ()).throw(
                        AssertionError("reentry reached docker")
                    ),
                    stdin=tty,
                    stderr=tty,
                )
            )
        return persisted, output.getvalue(), error


persisted, output, error = exercise_dynamic_attempt(
    0,
    lambda current_request_id: {
        **full_result,
        "request_id": current_request_id,
    },
)
assert error is None
assert persisted["ai_bootstrap_attempt"]["status"] == "SUCCEEDED"
assert json.loads(output)["status"] == "SUCCEEDED"

persisted, _, error = exercise_dynamic_attempt(
    1,
    lambda current_request_id: {
        **full_failed,
        "request_id": current_request_id,
    },
    assert_reentry=True,
)
assert isinstance(error, module.DataStateError)
assert persisted["ai_bootstrap_attempt"]["status"] == "FAILED"

persisted, _, error = exercise_dynamic_attempt(
    0,
    lambda _current_request_id: b"",
    assert_reentry=True,
)
assert isinstance(error, module.BootstrapResultUnknown)
assert persisted["ai_bootstrap_attempt"]["status"] == "STARTED"
PY

# 从真实 parser/main 进入 host bootstrap；只用临时状态、候选和 fake Docker I/O，
# 不替换 maintenance lock、candidate/phase owner、credential reader 或 attempt owner。
python3 - "$root" "$test_dir" <<'PY'
from __future__ import annotations

import fcntl
import hashlib
import json
import os
import pty
import select
import subprocess
import sys
import termios
import time
from pathlib import Path


root = Path(sys.argv[1]).resolve()
suite_root = Path(sys.argv[2]).resolve() / "bootstrap-cli-subprocess"
suite_root.mkdir()
script = root / "deploy/scripts/prepare-production-data.py"
fake_bin = suite_root / "bin"
fake_bin.mkdir()
docker_log = suite_root / "docker.jsonl"
container_id = "b" * 64
backend_image_id = "sha256:" + "a" * 64
release_id = "production-20260829-120000-0123456789ab"
backend_image = "registry.example/partsignal-backend"
frontend_image = "registry.example/partsignal-frontend-v2"
run_id = "prr_20260829_120000"
credential = "pty-bootstrap-secret-must-not-echo"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


tracked_names = {
    "deploy/compose.prod.yaml",
    "deploy/nginx/partsignal-maintenance.conf.template",
    "deploy/nginx/partsignal-security-headers.conf",
    "deploy/nginx/partsignal.conf.template",
    "deploy/scripts/activate-production.sh",
    "deploy/scripts/check-production-inputs.py",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/prepare-production-data.py",
    "deploy/scripts/production_upgrade_recovery.py",
    "deploy/scripts/production_migration_runtime.py",
    "deploy/scripts/production_maintenance_execution.py",
    "deploy/scripts/production_deployment.py",
    "deploy/scripts/rollback-production-frontend.sh",
}
manifest = suite_root / "release-manifest.json"
sys.path.insert(0, str(root / "deploy/scripts"))
from production_migration_runtime import _fingerprint
manifest_payload = {
    "migration_runtime": _fingerprint("a" * 64, "b" * 64),
    "release_id": release_id,
    "commit": "e" * 40,
    "schema_head": "0043_geo_platform_identity",
    "images": {
        "backend": {
            "reference": f"{backend_image}:{release_id}",
            "image_id": backend_image_id,
            "repo_digests": ["registry.example/backend@sha256:" + "1" * 64],
        },
        "frontend": {
            "reference": f"{frontend_image}:{release_id}",
            "image_id": "sha256:" + "2" * 64,
            "repo_digests": ["registry.example/frontend@sha256:" + "3" * 64],
        },
        "rollback_frontend": {
            "reference": f"{frontend_image}:previous",
            "image_id": "sha256:" + "4" * 64,
            "repo_digests": ["registry.example/frontend@sha256:" + "5" * 64],
        },
    },
    "tracked_files": {name: sha256(root / name) for name in sorted(tracked_names)},
}
manifest_payload["images"]["migration"] = dict(manifest_payload["images"]["backend"])
manifest.write_text(json.dumps(manifest_payload, sort_keys=True), encoding="utf-8")
candidate = {
    "manifest_sha256": sha256(manifest),
    "migration_runtime": manifest_payload["migration_runtime"],
    "release_id": release_id,
    "commit": "e" * 40,
    "schema_head": "0043_geo_platform_identity",
    "backend_reference": f"{backend_image}:{release_id}",
    "backend_image_id": backend_image_id,
    "backend_repo_digests": ["registry.example/backend@sha256:" + "1" * 64],
    "frontend_reference": f"{frontend_image}:{release_id}",
    "frontend_image_id": "sha256:" + "2" * 64,
    "frontend_repo_digests": ["registry.example/frontend@sha256:" + "3" * 64],
    "rollback_frontend_reference": f"{frontend_image}:previous",
    "rollback_frontend_image_id": "sha256:" + "4" * 64,
    "rollback_frontend_repo_digests": [
        "registry.example/frontend@sha256:" + "5" * 64
    ],
}

candidate.update({"migration_reference": candidate["backend_reference"], "migration_image_id": candidate["backend_image_id"], "migration_repo_digests": candidate["backend_repo_digests"]})

docker_script = fake_bin / "docker"
docker_script.write_text(
    r'''#!/usr/bin/env python3
import json
import os
import sys
import time
from pathlib import Path

args = sys.argv[1:]
with Path(os.environ["FAKE_DOCKER_LOG"]).open("a", encoding="utf-8") as output:
    output.write(json.dumps(args) + "\n")

container_id = "b" * 64
backend_image_id = "sha256:" + "a" * 64
if args and args[0] == "ps":
    print(container_id)
    raise SystemExit(0)
if args and args[0] == "inspect":
    print(
        "|".join(
            (
                container_id,
                backend_image_id,
                "running",
                "true",
                "partsignal-staging",
                "api",
                "[]",
            )
        )
    )
    raise SystemExit(0)
if args and args[0] == "exec":
    envelope = json.loads(sys.stdin.buffer.read())
    mode = os.environ.get("FAKE_BACKEND_MODE", "success")
    marker = os.environ.get("FAKE_BACKEND_MARKER")
    if marker:
        Path(marker).write_text("backend-entered\n", encoding="utf-8")
    if mode == "hold":
        release = Path(os.environ["FAKE_BACKEND_RELEASE"])
        deadline = time.monotonic() + 10
        while not release.exists():
            if time.monotonic() >= deadline:
                raise SystemExit(91)
            time.sleep(0.02)
    if mode == "unknown-after-commit":
        Path(os.environ["FAKE_COMMIT_MARKER"]).write_text(
            "database-commit-observed\n", encoding="utf-8"
        )
        raise SystemExit(0)
    status = "FAILED" if mode == "provider-failed" else "SUCCEEDED"
    failed = status == "FAILED"
    result = {
        "status": status,
        "request_id": envelope["request_id"],
        "channel_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "channel_revision": 1,
        "channel_enabled": not failed,
        "channel_configured": True,
        "model_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "model_revision": 2,
        "model_test_status": "FAILED" if failed else "PASSED",
        "model_enabled": not failed,
        "model_configured": True,
    }
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(1 if failed else 0)
raise SystemExit(92)
''',
    encoding="utf-8",
)
docker_script.chmod(0o755)

pty_wrapper = suite_root / "pty-wrapper.py"
pty_wrapper.write_text(
    r'''#!/usr/bin/env python3
import signal
import subprocess
import sys
import termios


signal.signal(signal.SIGINT, signal.SIG_IGN)


def restore_sigint() -> None:
    signal.signal(signal.SIGINT, signal.SIG_DFL)


completed = subprocess.run(sys.argv[1:], check=False, preexec_fn=restore_sigint)
if not termios.tcgetattr(0)[3] & termios.ECHO:
    print("PTY_ECHO_RESTORED=0", flush=True)
    raise SystemExit(97)
print("PTY_ECHO_RESTORED=1", flush=True)
raise SystemExit(completed.returncode)
''',
    encoding="utf-8",
)
pty_wrapper.chmod(0o755)


def make_state(
    label: str,
    *,
    phase: str = "PRODUCTION_PREPARED",
    state_run_id: str = run_id,
    state_candidate: dict[str, object] | None = None,
) -> tuple[Path, dict[str, str]]:
    case_root = suite_root / label
    data_root = case_root / "data"
    quarantine_root = case_root / "quarantine"
    target = quarantine_root / state_run_id
    data_root.mkdir(parents=True)
    target.mkdir(parents=True)
    state = {
        "schema_version": 1,
        "phase": phase,
        "run_id": state_run_id,
        "data_root": str(data_root),
        "quarantine_target": str(target),
        "device": data_root.stat().st_dev,
        "candidate": candidate if state_candidate is None else state_candidate,
    }
    (data_root / ".partsignal-production-cutover.json").write_text(
        json.dumps(state, sort_keys=True), encoding="utf-8"
    )
    environment = {
        **os.environ,
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS": "1",
        "PARTSIGNAL_DATA_ROOT": str(data_root),
        "PARTSIGNAL_QUARANTINE_ROOT": str(quarantine_root),
        "PARTSIGNAL_MAINTENANCE_LOCK_FILE": str(case_root / "maintenance.lock"),
        "PARTSIGNAL_VERSION": release_id,
        "PARTSIGNAL_BACKEND_IMAGE": backend_image,
        "PARTSIGNAL_FRONTEND_IMAGE": frontend_image,
        "FAKE_DOCKER_LOG": str(docker_log),
        "FAKE_BACKEND_MODE": "success",
    }
    return data_root, environment


bootstrap_options = [
    "--channel-name",
    "Production channel",
    "--channel-description",
    "Production bootstrap",
    "--protocol-type",
    "openai-compatible-chat-completions",
    "--provider-brand",
    "CUSTOM",
    "--base-url",
    "https://provider.example/v1",
    "--timeout-seconds",
    "30",
    "--model-display-name",
    "Production model",
    "--model-id",
    "exact-model-id",
    "--request-parameters-json",
    '{"temperature":0}',
]


def bootstrap_command(
    *, command_run_id: str = run_id, manifest_value: str | None = None
) -> list[str]:
    return [
        sys.executable,
        str(script),
        "bootstrap-ai",
        command_run_id,
        str(manifest) if manifest_value is None else manifest_value,
        *bootstrap_options,
    ]


def verify_command() -> list[str]:
    return [sys.executable, str(script), "verify-prepared", run_id, str(manifest)]


def mark_initialized_command() -> list[str]:
    return [sys.executable, str(script), "mark-initialized", run_id, str(manifest)]


def read_state(data_root: Path) -> dict[str, object]:
    return json.loads(
        (data_root / ".partsignal-production-cutover.json").read_text(encoding="utf-8")
    )


def docker_calls() -> list[list[str]]:
    if not docker_log.exists():
        return []
    return [json.loads(line) for line in docker_log.read_text(encoding="utf-8").splitlines()]


def reset_docker_log() -> None:
    docker_log.unlink(missing_ok=True)


def assert_early_rejection(
    *,
    label: str,
    command: list[str],
    environment: dict[str, str],
    expected: str,
) -> None:
    reset_docker_log()
    completed = subprocess.run(
        command,
        input=b"early-secret-must-not-be-read\n",
        capture_output=True,
        check=False,
        env=environment,
        cwd=manifest.parent,
    )
    combined = completed.stdout + completed.stderr
    assert completed.returncode == 2, (label, completed.returncode, combined)
    assert expected.encode() in combined, (label, combined)
    assert b"AI API Key:" not in combined
    assert b"early-secret-must-not-be-read" not in combined
    assert not any(call and call[0] == "exec" for call in docker_calls())


# run/manifest/candidate/phase 都必须在 credential reader 与 backend 前拒绝。
_, wrong_run_env = make_state("wrong-run")
assert_early_rejection(
    label="wrong run",
    command=bootstrap_command(command_run_id="prr_20260829_120001"),
    environment=wrong_run_env,
    expected="run ID 或隔离目标与状态文件不一致",
)
_, relative_manifest_env = make_state("relative-manifest")
assert_early_rejection(
    label="relative manifest",
    command=bootstrap_command(manifest_value=manifest.name),
    environment=relative_manifest_env,
    expected="Production 候选清单必须是绝对普通文件",
)
mismatched_candidate = dict(candidate)
mismatched_candidate["backend_image_id"] = "sha256:" + "9" * 64
_, mismatch_env = make_state(
    "candidate-mismatch", state_candidate=mismatched_candidate
)
assert_early_rejection(
    label="candidate mismatch",
    command=bootstrap_command(),
    environment=mismatch_env,
    expected="当前候选与 Production 数据状态绑定的候选不一致",
)
_, phase_env = make_state("phase-mismatch", phase="CLEAN_INIT_DEPLOYING")
assert_early_rejection(
    label="phase mismatch",
    command=bootstrap_command(),
    environment=phase_env,
    expected="当前数据阶段不允许该操作",
)


# attempt 键一旦存在就必须结构合法；畸形值不得触发容器查询、credential 或写回。
attempt_request_id = "production-bootstrap-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
malformed_attempt_cases = (
    ("null", None),
    ("non-object", []),
    ("empty-object", {}),
    ("missing-status", {"request_id": attempt_request_id}),
    ("missing-request-id", {"status": "SUCCEEDED"}),
    ("extra-field", {"request_id": attempt_request_id, "status": "SUCCEEDED", "extra": True}),
    ("invalid-request-id", {"request_id": "invalid", "status": "SUCCEEDED"}),
    ("invalid-status", {"request_id": attempt_request_id, "status": []}),
)
for label, attempt in malformed_attempt_cases:
    malformed_root, malformed_env = make_state(f"attempt-{label}")
    malformed_path = malformed_root / ".partsignal-production-cutover.json"
    malformed_state = read_state(malformed_root)
    malformed_state["ai_bootstrap_attempt"] = attempt
    malformed_path.write_text(
        json.dumps(malformed_state, sort_keys=True), encoding="utf-8"
    )
    original_state = malformed_path.read_bytes()
    assert_early_rejection(
        label=f"malformed attempt {label}",
        command=bootstrap_command(),
        environment=malformed_env,
        expected="Production AI bootstrap attempt 状态无效",
    )
    assert docker_calls() == [], (label, docker_calls())
    assert malformed_path.read_bytes() == original_state, label


# 三种合法状态同样都表示 attempt 已存在，必须在外部 I/O 前拒绝重入。
for status_value in ("STARTED", "FAILED", "SUCCEEDED"):
    reentry_root, reentry_env = make_state(f"attempt-reentry-{status_value.lower()}")
    reentry_path = reentry_root / ".partsignal-production-cutover.json"
    reentry_state = read_state(reentry_root)
    reentry_state["ai_bootstrap_attempt"] = {
        "request_id": attempt_request_id,
        "status": status_value,
    }
    reentry_path.write_text(json.dumps(reentry_state, sort_keys=True), encoding="utf-8")
    original_state = reentry_path.read_bytes()
    assert_early_rejection(
        label=f"attempt reentry {status_value}",
        command=bootstrap_command(),
        environment=reentry_env,
        expected="Production AI bootstrap attempt 已存在，拒绝重入",
    )
    assert docker_calls() == [], (status_value, docker_calls())
    assert reentry_path.read_bytes() == original_state, status_value


# 真实 maintenance lock 竞争必须在 parser/main 的 credential/backend 路径之前结束。
_, locked_env = make_state("lock-contention-early")
lock_path = Path(locked_env["PARTSIGNAL_MAINTENANCE_LOCK_FILE"])
lock_path.parent.mkdir(parents=True, exist_ok=True)
with lock_path.open("w", encoding="utf-8") as lock_stream:
    fcntl.flock(lock_stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert_early_rejection(
        label="maintenance lock contention",
        command=bootstrap_command(),
        environment=locked_env,
        expected="已有 PartSignal Production 维护操作持有排他锁",
    )


class PTYProcess:
    def __init__(self, command: list[str], environment: dict[str, str]) -> None:
        self.master, self.slave = pty.openpty()

        def claim_controlling_terminal() -> None:
            os.setsid()
            fcntl.ioctl(0, termios.TIOCSCTTY, 0)

        self.process = subprocess.Popen(
            [sys.executable, str(pty_wrapper), *command],
            stdin=self.slave,
            stdout=self.slave,
            stderr=self.slave,
            env=environment,
            close_fds=True,
            preexec_fn=claim_controlling_terminal,
        )
        self.transcript = b""

    def read_until(self, needle: bytes, timeout: float = 8) -> None:
        deadline = time.monotonic() + timeout
        while needle not in self.transcript:
            assert time.monotonic() < deadline, self.transcript
            readable, _, _ = select.select([self.master], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(self.master, 4096)
                except OSError:
                    pass
                else:
                    self.transcript += chunk
            assert self.process.poll() is None, self.transcript

    def send_credential(self, value: bytes) -> None:
        self.read_until(b"AI API Key:")
        assert termios.tcgetattr(self.slave)[3] & termios.ECHO == 0
        os.write(self.master, value)

    def finish(self, timeout: float = 10) -> int:
        deadline = time.monotonic() + timeout
        while self.process.poll() is None:
            assert time.monotonic() < deadline, self.transcript
            readable, _, _ = select.select([self.master], [], [], 0.05)
            if readable:
                try:
                    chunk = os.read(self.master, 4096)
                except OSError:
                    pass
                else:
                    self.transcript += chunk
        while True:
            readable, _, _ = select.select([self.master], [], [], 0)
            if not readable:
                break
            try:
                chunk = os.read(self.master, 4096)
            except OSError:
                break
            if not chunk:
                break
            self.transcript += chunk
        return_code = self.process.wait()
        assert b"PTY_ECHO_RESTORED=1" in self.transcript, self.transcript
        return return_code

    def close(self) -> None:
        os.close(self.master)
        os.close(self.slave)


# 真 PTY 正常路径：no-echo；backend 未完成前 maintenance lock 不释放。
reset_docker_log()
hold_data_root, hold_env = make_state("hold-lock-until-backend-completes")
backend_marker = suite_root / "backend-entered"
backend_release = suite_root / "backend-release"
hold_env.update(
    {
        "FAKE_BACKEND_MODE": "hold",
        "FAKE_BACKEND_MARKER": str(backend_marker),
        "FAKE_BACKEND_RELEASE": str(backend_release),
    }
)
session = PTYProcess(bootstrap_command(), hold_env)
try:
    session.send_credential((credential + "\n").encode())
    deadline = time.monotonic() + 8
    while not backend_marker.exists():
        assert time.monotonic() < deadline, session.transcript
        time.sleep(0.02)
    assert read_state(hold_data_root)["ai_bootstrap_attempt"]["status"] == "STARTED"
    contender = subprocess.run(
        bootstrap_command(),
        input=b"contender-secret-must-not-be-read\n",
        capture_output=True,
        check=False,
        env=hold_env,
    )
    assert contender.returncode == 2
    assert "已有 PartSignal Production 维护操作持有排他锁" in contender.stderr.decode()
    assert b"AI API Key:" not in contender.stderr
    assert sum(call[0] == "exec" for call in docker_calls()) == 1
    backend_release.write_text("continue\n", encoding="utf-8")
    assert session.finish() == 0, session.transcript
    assert credential.encode() not in session.transcript
    assert read_state(hold_data_root)["ai_bootstrap_attempt"]["status"] == "SUCCEEDED"
finally:
    if session.process.poll() is None:
        session.process.kill()
        session.process.wait()
    session.close()

verified = subprocess.run(
    verify_command(), capture_output=True, check=False, env=hold_env
)
assert verified.returncode == 0, verified.stderr


# 真 PTY SIGINT：getpass 期间 ECHO 关闭，退出后必须恢复，且不得创建 attempt。
reset_docker_log()
sigint_data_root, sigint_env = make_state("sigint-echo-restore")
session = PTYProcess(bootstrap_command(), sigint_env)
try:
    session.send_credential(b"\x03")
    assert session.finish() == 2, session.transcript
    assert b"Production AI credential" in session.transcript
    assert "ai_bootstrap_attempt" not in read_state(sigint_data_root)
    assert not any(call and call[0] == "exec" for call in docker_calls())
finally:
    if session.process.poll() is None:
        session.process.kill()
        session.process.wait()
    session.close()

for command in (verify_command(), mark_initialized_command()):
    missing_attempt = subprocess.run(
        command, capture_output=True, check=False, env=sigint_env
    )
    assert missing_attempt.returncode == 2
    assert "尚未取得可激活的成功结果" in missing_attempt.stderr.decode()
assert read_state(sigint_data_root)["phase"] == "PRODUCTION_PREPARED"


# 等价于 T3 已提交但 stdout 丢失：host 保留 STARTED，verify-prepared fail closed。
reset_docker_log()
unknown_data_root, unknown_env = make_state("unknown-after-commit")
commit_marker = suite_root / "database-commit-observed"
unknown_env.update(
    {
        "FAKE_BACKEND_MODE": "unknown-after-commit",
        "FAKE_COMMIT_MARKER": str(commit_marker),
    }
)
session = PTYProcess(bootstrap_command(), unknown_env)
try:
    session.send_credential((credential + "\n").encode())
    assert session.finish() == 2, session.transcript
    assert commit_marker.is_file()
    assert credential.encode() not in session.transcript
finally:
    if session.process.poll() is None:
        session.process.kill()
        session.process.wait()
    session.close()
assert read_state(unknown_data_root)["ai_bootstrap_attempt"]["status"] == "STARTED"
verify_unknown = subprocess.run(
    verify_command(), capture_output=True, check=False, env=unknown_env
)
assert verify_unknown.returncode == 2
assert "尚未取得可激活的成功结果" in verify_unknown.stderr.decode()
mark_unknown = subprocess.run(
    mark_initialized_command(), capture_output=True, check=False, env=unknown_env
)
assert mark_unknown.returncode == 2
assert "尚未取得可激活的成功结果" in mark_unknown.stderr.decode()
assert read_state(unknown_data_root)["phase"] == "PRODUCTION_PREPARED"
assert credential not in docker_log.read_text(encoding="utf-8")
assert credential not in json.dumps(read_state(unknown_data_root), sort_keys=True)


# 只有完整 provider FAILED envelope 可把 durable attempt 写成 FAILED。
reset_docker_log()
failed_data_root, failed_env = make_state("explicit-provider-failed")
failed_env["FAKE_BACKEND_MODE"] = "provider-failed"
session = PTYProcess(bootstrap_command(), failed_env)
try:
    session.send_credential((credential + "\n").encode())
    assert session.finish() == 2, session.transcript
    assert credential.encode() not in session.transcript
finally:
    if session.process.poll() is None:
        session.process.kill()
        session.process.wait()
    session.close()
assert read_state(failed_data_root)["ai_bootstrap_attempt"]["status"] == "FAILED"
verify_failed = subprocess.run(
    verify_command(), capture_output=True, check=False, env=failed_env
)
assert verify_failed.returncode == 2
assert "尚未取得可激活的成功结果" in verify_failed.stderr.decode()
mark_failed = subprocess.run(
    mark_initialized_command(), capture_output=True, check=False, env=failed_env
)
assert mark_failed.returncode == 2
assert "尚未取得可激活的成功结果" in mark_failed.stderr.decode()
assert read_state(failed_data_root)["phase"] == "PRODUCTION_PREPARED"
PY

printf '%s\n' source >"$test_dir/source.tar.gz"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id production-20260829-110000-unverified \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image partsignal-backend:unverified \
  --frontend-image partsignal-frontend-v2:unverified \
  --rollback-frontend-image partsignal-frontend-v2:previous \
  --schema-head 0043_geo_platform_identity \
  --output "$test_dir/unverified-manifest.json" >/dev/null 2>&1
unverified_source_status=$?
set -e
test "$unverified_source_status" -ne 0
test ! -e "$test_dir/unverified-manifest.json"

set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id production-20260829-110001-unverified \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image partsignal-backend:unverified \
  --frontend-image partsignal-frontend-v2:unverified \
  --rollback-frontend-image partsignal-frontend-v1:previous \
  --schema-head 0043_geo_platform_identity \
  --tracked-file "$root/deploy/compose.prod.yaml" \
  --tracked-file "$root/deploy/nginx/partsignal-maintenance.conf.template" \
  --tracked-file "$root/deploy/nginx/partsignal-security-headers.conf" \
  --tracked-file "$root/deploy/nginx/partsignal.conf.template" \
  --tracked-file "$root/deploy/scripts/activate-production.sh" \
  --tracked-file "$root/deploy/scripts/check-production-inputs.py" \
  --tracked-file "$root/deploy/scripts/deploy.sh" \
  --tracked-file "$root/deploy/scripts/prepare-production-data.py" \
  --tracked-file "$root/deploy/scripts/production_upgrade_recovery.py" \
  --tracked-file "$root/deploy/scripts/production_migration_runtime.py" \
  --tracked-file "$root/deploy/scripts/production_maintenance_execution.py" \
  --tracked-file "$root/deploy/scripts/production_deployment.py" \
  --tracked-file "$root/deploy/scripts/rollback-production-frontend.sh" \
  --output "$test_dir/v1-manifest.json" >/dev/null 2>"$test_dir/v1-manifest.err"
v1_manifest_status=$?
set -e
test "$v1_manifest_status" -ne 0
test ! -e "$test_dir/v1-manifest.json"
grep -q 'V1 镜像仓库' "$test_dir/v1-manifest.err"

PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id "$candidate_release" \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image "partsignal-backend:$candidate_release" \
  --frontend-image "partsignal-frontend-v2:$candidate_release" \
  --rollback-frontend-image partsignal-frontend-v2:previous \
  --schema-head 0043_geo_platform_identity \
  --tracked-file "$root/deploy/compose.prod.yaml" \
  --tracked-file "$root/deploy/nginx/partsignal-maintenance.conf.template" \
  --tracked-file "$root/deploy/nginx/partsignal-security-headers.conf" \
  --tracked-file "$root/deploy/nginx/partsignal.conf.template" \
  --tracked-file "$root/deploy/scripts/activate-production.sh" \
  --tracked-file "$root/deploy/scripts/check-production-inputs.py" \
  --tracked-file "$root/deploy/scripts/deploy.sh" \
  --tracked-file "$root/deploy/scripts/prepare-production-data.py" \
  --tracked-file "$root/deploy/scripts/production_upgrade_recovery.py" \
  --tracked-file "$root/deploy/scripts/production_migration_runtime.py" \
  --tracked-file "$root/deploy/scripts/production_maintenance_execution.py" \
  --tracked-file "$root/deploy/scripts/production_deployment.py" \
  --tracked-file "$root/deploy/scripts/rollback-production-frontend.sh" \
  --output "$test_dir/release-manifest.json" >/dev/null
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  PARTSIGNAL_ALLOW_UNVERIFIED_RELEASE_SOURCE_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id "$next_release" \
  --commit fedcba9876543210fedcba9876543210fedcba98 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image "partsignal-backend:$next_release" \
  --frontend-image "partsignal-frontend-v2:$next_release" \
  --rollback-frontend-image "partsignal-frontend-v2:$candidate_release" \
  --schema-head 0043_geo_platform_identity \
  --tracked-file "$root/deploy/compose.prod.yaml" \
  --tracked-file "$root/deploy/nginx/partsignal-maintenance.conf.template" \
  --tracked-file "$root/deploy/nginx/partsignal-security-headers.conf" \
  --tracked-file "$root/deploy/nginx/partsignal.conf.template" \
  --tracked-file "$root/deploy/scripts/activate-production.sh" \
  --tracked-file "$root/deploy/scripts/check-production-inputs.py" \
  --tracked-file "$root/deploy/scripts/deploy.sh" \
  --tracked-file "$root/deploy/scripts/prepare-production-data.py" \
  --tracked-file "$root/deploy/scripts/production_upgrade_recovery.py" \
  --tracked-file "$root/deploy/scripts/production_migration_runtime.py" \
  --tracked-file "$root/deploy/scripts/production_maintenance_execution.py" \
  --tracked-file "$root/deploy/scripts/production_deployment.py" \
  --tracked-file "$root/deploy/scripts/rollback-production-frontend.sh" \
  --output "$test_dir/release-manifest-next.json" >/dev/null

python3 - "$test_dir/release-manifest.json" "$test_dir/release-manifest-drift.json" \
  "$test_dir/release-manifest-digest-mismatch.json" \
  "$test_dir/release-manifest-v1-rollback.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    manifest = json.load(source)

drifted = json.loads(json.dumps(manifest))
drifted["tracked_files"]["deploy/compose.prod.yaml"] = "0" * 64
with open(sys.argv[2], "w", encoding="utf-8") as output:
    json.dump(drifted, output)

digest_mismatch = json.loads(json.dumps(manifest))
digest_mismatch["images"]["backend"]["repo_digests"] = ["example@sha256:" + "c" * 64]
with open(sys.argv[3], "w", encoding="utf-8") as output:
    json.dump(digest_mismatch, output)

v1_rollback = json.loads(json.dumps(manifest))
v1_rollback["images"]["rollback_frontend"]["reference"] = (
    "partsignal-frontend-v1:previous"
)
with open(sys.argv[4], "w", encoding="utf-8") as output:
    json.dump(v1_rollback, output)
PY
for invalid_manifest in "$test_dir/release-manifest-drift.json" \
  "$test_dir/release-manifest-digest-mismatch.json"; do
  set +e
  PATH="$test_dir/bin:$PATH" PARTSIGNAL_VERSION="$candidate_release" \
    PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
    PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
    PARTSIGNAL_DATA_ROOT="$test_dir/live" \
    PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
    PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/invalid-manifest.lock" \
    PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
    python3 "$root/deploy/scripts/prepare-production-data.py" \
    verify-candidate-images "$invalid_manifest" >/dev/null 2>&1
  invalid_manifest_status=$?
  set -e
  test "$invalid_manifest_status" -eq 2
done

set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-consumer.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  verify-candidate-images "$test_dir/release-manifest-v1-rollback.json" \
  >/dev/null 2>"$test_dir/v1-consumer.err"
v1_consumer_status=$?
set -e
test "$v1_consumer_status" -eq 2
grep -q 'V1 rollback_frontend 镜像仓库' "$test_dir/v1-consumer.err"

data_env() {
  PATH="$test_dir/bin:$PATH" \
  COMMAND_LOG="$test_dir/data.log" \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
    "$@"
}

data_env python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_120000 >/dev/null
data_env python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_120000 >/dev/null
test -f "$test_dir/quarantine/prr_20260829_120000/postgres/marker"
test -f "$test_dir/quarantine/prr_20260829_120000/redis/marker"
test -f "$test_dir/quarantine/prr_20260829_120000/objects/marker"
test -d "$test_dir/live/postgres"
test -d "$test_dir/live/redis"
test ! -e "$test_dir/live/objects"

: >"$test_dir/wrong-compose.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/wrong-compose.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.staging.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null 2>&1
wrong_compose_status=$?
set -e
test "$wrong_compose_status" -eq 2
test ! -s "$test_dir/wrong-compose.log"

: >"$test_dir/wrong-project.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/wrong-project.log" \
  COMPOSE_PROJECT_NAME=wrong-project \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null 2>&1
wrong_project_status=$?
set -e
test "$wrong_project_status" -eq 2
test ! -s "$test_dir/wrong-project.log"

: >"$test_dir/invalid-image-delivery-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/invalid-image-delivery-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=invalid \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/invalid-image-delivery-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/invalid-image-delivery-mode.out" \
  2>"$test_dir/invalid-image-delivery-mode.err"
invalid_image_delivery_mode_status=$?
set -e
test "$invalid_image_delivery_mode_status" -eq 2
test ! -s "$test_dir/invalid-image-delivery-mode.log"
grep -q '无效的 Production 镜像交付模式：invalid' \
  "$test_dir/invalid-image-delivery-mode.err"

: >"$test_dir/empty-image-delivery-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/empty-image-delivery-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE= \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/empty-image-delivery-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/empty-image-delivery-mode.out" \
  2>"$test_dir/empty-image-delivery-mode.err"
empty_image_delivery_mode_status=$?
set -e
test "$empty_image_delivery_mode_status" -eq 2
test ! -s "$test_dir/empty-image-delivery-mode.log"
grep -q '无效的 Production 镜像交付模式：' \
  "$test_dir/empty-image-delivery-mode.err"

: >"$test_dir/v1-deploy.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/v1-deploy.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v1 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-deploy.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null 2>"$test_dir/v1-deploy.err"
v1_deploy_status=$?
set -e
test "$v1_deploy_status" -eq 2
test ! -s "$test_dir/v1-deploy.log"
grep -q 'V1 镜像仓库' "$test_dir/v1-deploy.err"

: >"$test_dir/v1-backend-deploy.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/v1-backend-deploy.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend-v1 \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-backend-deploy.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/v1-backend-deploy.out" \
  2>"$test_dir/v1-backend-deploy.err"
v1_backend_deploy_status=$?
set -e
test "$v1_backend_deploy_status" -eq 2
test ! -s "$test_dir/v1-backend-deploy.log"
grep -q 'V1 镜像仓库' "$test_dir/v1-backend-deploy.err"

: >"$test_dir/missing-image.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/missing-image.log" \
  MISSING_IMAGE_REFERENCE="partsignal-backend:$candidate_release" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/missing-image.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >"$test_dir/missing-image.out" \
  2>"$test_dir/missing-image.err"
missing_image_status=$?
set -e
test "$missing_image_status" -eq 2
grep -q "partsignal-backend:$candidate_release" "$test_dir/missing-image.err"
! grep -q ' compose .*\(run\|up\) ' "$test_dir/missing-image.log"

: >"$test_dir/clean.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/clean.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null

awk '
  /config --quiet/ { config = NR }
  /pull api worker scheduler frontend migrate/ { pull = NR }
  /image inspect/ { verify = NR }
  /up -d --wait postgres redis/ { data = NR }
  /preflight-production-config/ { production = NR }
  /run --rm migrate/ { migrate = NR }
  /preflight-integrity --require-schema$/ { integrity = NR }
  /initialize-accounts/ { accounts = NR }
  /up -d --wait api frontend/ { application = NR }
  / compose .* ps$/ { status = NR }
  /api\/health\/ready/ { ready = NR }
  /127\.0\.0\.1:19080/ { frontend = NR }
  END {
    exit !(config < pull && pull < verify && verify < data && data < production &&
           production < migrate && migrate < integrity && integrity < accounts &&
           accounts < application && application < status && status < ready &&
           ready < frontend)
  }
' "$test_dir/clean.log"
! grep -q 'up -d --wait worker scheduler' "$test_dir/clean.log"
! grep -q -- '--pull never' "$test_dir/clean.log"

: >"$test_dir/local.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/local.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/local.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init \
  PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null
! grep -q ' pull ' "$test_dir/local.log"
grep -q 'up --pull never -d --wait postgres redis' "$test_dir/local.log"
grep -q 'run --pull never --rm api' "$test_dir/local.log"
grep -q 'run --pull never --rm migrate' "$test_dir/local.log"
grep -q 'up --pull never -d --wait api frontend' "$test_dir/local.log"
awk '
  /image inspect/ { verify = NR }
  /up --pull never -d --wait postgres redis/ { first_up = NR }
  END { exit !(verify && first_up && verify < first_up) }
' "$test_dir/local.log"

: >"$test_dir/blocked-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/blocked-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=NOT_MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>&1
blocked_status=$?
set -e
test "$blocked_status" -eq 2
test ! -s "$test_dir/blocked-activation.log"

: >"$test_dir/invalid-activation-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/invalid-activation-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=invalid \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/invalid-activation-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >"$test_dir/invalid-activation-mode.out" \
  2>"$test_dir/invalid-activation-mode.err"
invalid_activation_mode_status=$?
set -e
test "$invalid_activation_mode_status" -eq 2
test ! -s "$test_dir/invalid-activation-mode.log"
grep -q '无效的 Production 镜像交付模式：invalid' \
  "$test_dir/invalid-activation-mode.err"

: >"$test_dir/empty-activation-mode.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/empty-activation-mode.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE= \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/empty-activation-mode.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >"$test_dir/empty-activation-mode.out" \
  2>"$test_dir/empty-activation-mode.err"
empty_activation_mode_status=$?
set -e
test "$empty_activation_mode_status" -eq 2
test ! -s "$test_dir/empty-activation-mode.log"
grep -q '无效的 Production 镜像交付模式：' \
  "$test_dir/empty-activation-mode.err"

: >"$test_dir/v1-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/v1-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v1 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/v1-activation.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>"$test_dir/v1-activation.err"
v1_activation_status=$?
set -e
test "$v1_activation_status" -eq 2
test ! -s "$test_dir/v1-activation.log"
grep -q 'V1 镜像仓库' "$test_dir/v1-activation.err"

: >"$test_dir/missing-bootstrap-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/missing-bootstrap-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" \
  >"$test_dir/missing-bootstrap-activation.out" \
  2>"$test_dir/missing-bootstrap-activation.err"
missing_bootstrap_activation_status=$?
set -e
test "$missing_bootstrap_activation_status" -eq 2
test ! -s "$test_dir/missing-bootstrap-activation.log"
grep -q 'Production AI bootstrap 尚未取得可激活的成功结果' \
  "$test_dir/missing-bootstrap-activation.err"
python3 - "$test_dir/live/.partsignal-production-cutover.json" <<'PY'
import json
import sys

state_path = sys.argv[1]
with open(state_path, encoding="utf-8") as state_file:
    state = json.load(state_file)
assert state["phase"] == "PRODUCTION_PREPARED"
assert "ai_bootstrap_attempt" not in state
state["ai_bootstrap_attempt"] = {
    "request_id": "production-bootstrap-123e4567-e89b-42d3-a456-426614174000",
    "status": "SUCCEEDED",
}
with open(state_path, "w", encoding="utf-8") as state_file:
    json.dump(state, state_file, sort_keys=True)
PY

: >"$test_dir/activate.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/activate.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_IMAGE_DELIVERY_MODE=local \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=clean-init PARTSIGNAL_CUTOVER_RUN_ID=prr_20260829_120000 \
  PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null
grep -q -- '--profile production-async.*up --pull never -d --wait worker scheduler' "$test_dir/activate.log"

: >"$test_dir/rollback-mismatch.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/rollback-mismatch.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_VERSION=wrong \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/rollback-production-frontend.sh" >/dev/null 2>&1
rollback_mismatch_status=$?
set -e
test "$rollback_mismatch_status" -eq 2
test ! -s "$test_dir/rollback-mismatch.log"

: >"$test_dir/rollback.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/rollback.log" \
  PARTSIGNAL_VERSION="$candidate_release" \
  PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_ROLLBACK_FRONTEND_VERSION=previous \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/rollback-production-frontend.sh" >/dev/null
grep -q 'up -d --no-deps --no-build --pull never --force-recreate --wait frontend' \
  "$test_dir/rollback.log"
! grep -Eq 'up .*api|up .*worker|up .*scheduler|up .*postgres|up .*redis' \
  "$test_dir/rollback.log"

python3 - "$root" "$test_dir" <<'PY'
from pathlib import Path
import shlex
import sys

root, test_dir = map(Path, sys.argv[1:])
expected_compose = (root / "deploy/compose.prod.yaml").resolve()
counts = {"local": 6, "activate": 1, "rollback": 1}
for path_name, expected_count in counts.items():
    lines = (test_dir / (path_name + ".log")).read_text().splitlines()
    verifies = [index for index, line in enumerate(lines) if line.startswith("docker image inspect ")]
    operations = []
    for index, line in enumerate(lines):
        args = shlex.split(line)
        if args[:2] != ["docker", "compose"]:
            continue
        assert Path(args[args.index("-f") + 1]).resolve() == expected_compose
        if "run" not in args and "up" not in args:
            continue
        operations.append(index)
        assert args[args.index("--pull") + 1] == "never", (path_name, args)
        if path_name == "rollback":
            assert "--no-deps" in args and "--no-build" in args
            assert args[-1] == "frontend"
    assert len(operations) == expected_count, (path_name, len(operations))
    assert verifies and max(verifies) < min(operations), path_name
appendix = (root / "docs/Hostdzire部署附录.md").read_text()
preflight = appendix.split("## 3. Production env 预检", 1)[1].split("## 4.", 1)[0]
assert 'verify-candidate-images "$manifest_path"' in preflight
assert "run --rm --pull never --no-deps api" in preflight
assert preflight.index("verify-candidate-images") < preflight.index("run --rm")
print("deploy/activate/rollback identity: 3 paths / 8 local operations / manifest-first passed")
PY

python3 - "$test_dir/live/.partsignal-production-cutover.json" <<'PY'
import json
import sys

state_path = sys.argv[1]
with open(state_path, encoding="utf-8") as state_file:
    state = json.load(state_file)
assert state["phase"] == "PRODUCTION_INITIALIZED"
assert state["ai_bootstrap_attempt"]["status"] == "SUCCEEDED"
del state["ai_bootstrap_attempt"]
with open(state_path, "w", encoding="utf-8") as state_file:
    json.dump(state, state_file, sort_keys=True)
PY

: >"$test_dir/unprepared-upgrade-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/unprepared-upgrade-activation.log" \
  PARTSIGNAL_VERSION="$next_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest-next.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>&1
unprepared_upgrade_status=$?
set -e
test "$unprepared_upgrade_status" -eq 2
test ! -s "$test_dir/unprepared-upgrade-activation.log"

: >"$test_dir/upgrade.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/upgrade.log" \
  PARTSIGNAL_VERSION="$next_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest-next.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/deploy.sh" >/dev/null
awk '
  /preflight-integrity$/ { before = NR }
  /preflight-integrity --require-schema$/ { after = NR }
  /stop api worker scheduler/ { stop = NR }
  /run --rm migrate/ { migrate = NR }
  /initialize-accounts/ { accounts = NR }
  END { exit !(before < stop && stop < migrate && migrate < after && after < accounts) }
' "$test_dir/upgrade.log"
! grep -q 'up -d --wait worker scheduler' "$test_dir/upgrade.log"

: >"$test_dir/mismatched-upgrade-activation.log"
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/mismatched-upgrade-activation.log" \
  PARTSIGNAL_VERSION="$candidate_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null 2>&1
mismatched_upgrade_status=$?
set -e
test "$mismatched_upgrade_status" -eq 2
test ! -s "$test_dir/mismatched-upgrade-activation.log"

: >"$test_dir/upgrade-activation.log"
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/upgrade-activation.log" \
  PARTSIGNAL_VERSION="$next_release" PARTSIGNAL_BACKEND_IMAGE=partsignal-backend \
  PARTSIGNAL_FRONTEND_IMAGE=partsignal-frontend-v2 \
  PARTSIGNAL_DATA_ROOT="$test_dir/live" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/maintenance.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_DEPLOY_MODE=upgrade PARTSIGNAL_EXTERNAL_SERVICES_GATE=MET \
  PARTSIGNAL_RELEASE_MANIFEST="$test_dir/release-manifest-next.json" \
  ENV_FILE="$test_dir/deployment-runtime.env" COMPOSE_FILE="$root/deploy/compose.prod.yaml" \
  "$root/deploy/scripts/activate-production.sh" >/dev/null
grep -q -- '--profile production-async.*up -d --wait worker scheduler' \
  "$test_dir/upgrade-activation.log"
python3 - "$test_dir/live/.partsignal-production-cutover.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as state_file:
    state = json.load(state_file)
assert state["phase"] == "PRODUCTION_INITIALIZED"
assert "ai_bootstrap_attempt" not in state
PY

for log_file in "$test_dir/clean.log" "$test_dir/activate.log" "$test_dir/upgrade.log" \
  "$test_dir/upgrade-activation.log"; do
  ! grep -Eq 'fake-oss|remove-orphans|build|frontend-v1|/var/www/partsignal' "$log_file"
done

printf '%s\n' failed-production >"$test_dir/live/postgres/new-marker"
data_env python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_120000 >/dev/null
test -f "$test_dir/live/postgres/marker"
test -f "$test_dir/live/redis/marker"
test -f "$test_dir/live/objects/marker"
test -f "$test_dir/quarantine/prr_20260829_120000/failed-production/postgres/new-marker"

mkdir -p "$test_dir/resume/postgres" "$test_dir/resume/redis" "$test_dir/resume/objects"
printf '%s\n' resume-old >"$test_dir/resume/postgres/marker"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_TEST_FAIL_AFTER_RENAMES=2 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_130000 >/dev/null 2>&1
resume_status=$?
set -e
test "$resume_status" -eq 2
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_130000 >/dev/null
test -f "$test_dir/resume-quarantine/prr_20260829_130000/postgres/marker"

mkdir -p "$test_dir/restore-resume/postgres" "$test_dir/restore-resume/redis" \
  "$test_dir/restore-resume/objects"
printf '%s\n' restore-old >"$test_dir/restore-resume/postgres/marker"
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/restore-resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/restore-resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/restore-resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_133000 >/dev/null
printf '%s\n' restore-new >"$test_dir/restore-resume/postgres/new-marker"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/restore-resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/restore-resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/restore-resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_TEST_FAIL_AFTER_RENAMES=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_133000 >/dev/null 2>&1
restore_resume_status=$?
set -e
test "$restore_resume_status" -eq 2
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/restore-resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/restore-resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/restore-resume.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_133000 >/dev/null
test -f "$test_dir/restore-resume/postgres/marker"
test -f "$test_dir/restore-resume-quarantine/prr_20260829_133000/failed-production/postgres/new-marker"

mkdir -p "$test_dir/tampered-restore/postgres" "$test_dir/tampered-restore/redis" \
  "$test_dir/tampered-restore/objects" "$test_dir/tampered-outside"
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/tampered-restore" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/tampered-restore-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/tampered-restore.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_134000 >/dev/null
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/tampered-restore" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/tampered-restore-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/tampered-restore.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  PARTSIGNAL_TEST_FAIL_AFTER_RENAMES=2 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_134000 >/dev/null 2>&1
tampered_interrupt_status=$?
set -e
test "$tampered_interrupt_status" -eq 2
rmdir "$test_dir/tampered-restore-quarantine/prr_20260829_134000/redis"
ln -s "$test_dir/tampered-outside" \
  "$test_dir/tampered-restore-quarantine/prr_20260829_134000/redis"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/tampered-restore" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/tampered-restore-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/tampered-restore.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_134000 >/dev/null 2>&1
tampered_restore_status=$?
set -e
test "$tampered_restore_status" -eq 2
test ! -L "$test_dir/tampered-restore/redis"

LOCK_READY="$test_dir/lock-ready" \
PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/contention.lock" \
PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" run-locked \
  sh -c 'touch "$LOCK_READY"; sleep 2' &
lock_holder=$!
lock_wait_count=0
while test ! -f "$test_dir/lock-ready"; do
  lock_wait_count=$((lock_wait_count + 1))
  test "$lock_wait_count" -lt 40
  sleep 0.05
done
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/contention.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_130000 >/dev/null 2>&1
contention_status=$?
set -e
test "$contention_status" -eq 2
wait "$lock_holder"

set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/resume/nested-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/nested.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_130000 >/dev/null 2>&1
nested_status=$?
set -e
test "$nested_status" -eq 2

ln -s "$test_dir/resume" "$test_dir/resume-link"
set +e
PATH="$test_dir/bin:$PATH" PARTSIGNAL_DATA_ROOT="$test_dir/resume-link" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/other-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/symlink.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  restore prr_20260829_130000 >/dev/null 2>&1
symlink_status=$?
set -e
test "$symlink_status" -eq 2

mkdir -p "$test_dir/running/postgres" "$test_dir/running/redis" "$test_dir/running/objects"
set +e
PATH="$test_dir/bin:$PATH" DOCKER_PROJECT_IDS=running-container \
  PARTSIGNAL_DATA_ROOT="$test_dir/running" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/running-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/running.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_140000 >/dev/null 2>&1
running_status=$?
set -e
test "$running_status" -eq 2
test -d "$test_dir/running/postgres"
test ! -e "$test_dir/running-quarantine/prr_20260829_140000"

mkdir -p "$test_dir/mounted/postgres" "$test_dir/mounted/redis" \
  "$test_dir/mounted/objects"
mounted_payload=$(printf '[{"Mounts":[{"Source":"%s/postgres/base"}]}]' \
  "$test_dir/mounted")
set +e
PATH="$test_dir/bin:$PATH" DOCKER_RUNNING_IDS=backup-container \
  DOCKER_INSPECT_JSON="$mounted_payload" \
  PARTSIGNAL_DATA_ROOT="$test_dir/mounted" \
  PARTSIGNAL_QUARANTINE_ROOT="$test_dir/mounted-quarantine" \
  PARTSIGNAL_MAINTENANCE_LOCK_FILE="$test_dir/mounted.lock" \
  PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS=1 \
  python3 "$root/deploy/scripts/prepare-production-data.py" \
  quarantine prr_20260829_143000 >/dev/null 2>&1
mounted_status=$?
set -e
test "$mounted_status" -eq 2
test -d "$test_dir/mounted/postgres"
test ! -e "$test_dir/mounted-quarantine/prr_20260829_143000"

python3 - "$test_dir/release-manifest.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)

assert manifest["release_id"] == "production-20260829-120000-0123456789ab"
assert manifest["images"]["frontend"]["image_id"].startswith("sha256:")
assert set(manifest["tracked_files"]) == {
    "deploy/compose.prod.yaml",
    "deploy/nginx/partsignal-maintenance.conf.template",
    "deploy/nginx/partsignal-security-headers.conf",
    "deploy/nginx/partsignal.conf.template",
    "deploy/scripts/activate-production.sh",
    "deploy/scripts/check-production-inputs.py",
    "deploy/scripts/deploy.sh",
    "deploy/scripts/prepare-production-data.py",
    "deploy/scripts/production_upgrade_recovery.py",
    "deploy/scripts/production_migration_runtime.py",
    "deploy/scripts/production_maintenance_execution.py",
    "deploy/scripts/production_deployment.py",
    "deploy/scripts/rollback-production-frontend.sh",
}
PY
set +e
PATH="$test_dir/bin:$PATH" COMMAND_LOG="$test_dir/manifest.log" \
  python3 "$root/deploy/scripts/create-release-manifest.py" \
  --release-id production-20260829-120000-0123456789ab \
  --commit 0123456789abcdef0123456789abcdef01234567 \
  --source-archive "$test_dir/source.tar.gz" \
  --backend-image partsignal-backend:test \
  --frontend-image partsignal-frontend-v2:test \
  --rollback-frontend-image partsignal-frontend-v2:previous \
  --schema-head 0043_geo_platform_identity \
  --output "$test_dir/release-manifest.json" >/dev/null 2>&1
overwrite_status=$?
set -e
test "$overwrite_status" -ne 0

printf '%s\n' "Production V2 编排、两阶段激活、可续跑数据状态机与候选清单合同自检通过"
