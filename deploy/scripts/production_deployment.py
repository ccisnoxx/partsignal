"""固定 Production 部署编排；由状态所有者监督并观察真实退出。"""

from __future__ import annotations

import json
import os
import re
import signal
import stat
import subprocess
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlsplit

from production_upgrade_recovery import verify_archives


def deployment_inputs(owner: Any) -> tuple[dict[str, Any], str, str, list[str]]:
    """部署与日常入口共用唯一的候选、配置及 Compose 边界。"""
    env = os.environ

    def required(key: str) -> str:
        if not env.get(key):
            raise owner.DataStateError(f"必须指定 {key}")
        return env[key]

    runtime = required("ENV_FILE")
    version = required("PARTSIGNAL_VERSION")
    backend = required("PARTSIGNAL_BACKEND_IMAGE")
    frontend = required("PARTSIGNAL_FRONTEND_IMAGE")
    required("PARTSIGNAL_DATA_ROOT")
    manifest = required("PARTSIGNAL_RELEASE_MANIFEST")
    mode = env.get("PARTSIGNAL_DEPLOY_MODE") or "upgrade"
    delivery = env.get("PARTSIGNAL_IMAGE_DELIVERY_MODE", "registry")
    if mode not in {"clean-init", "fresh-init", "upgrade"}:
        raise owner.DataStateError(f"无效的 Production 部署模式：{mode}")
    if delivery not in {"registry", "local"}:
        raise owner.DataStateError(
            f"无效的 Production 镜像交付模式：{delivery}（仅支持 registry 或 local）"
        )
    if (
        env.get("COMPOSE_PROJECT_NAME", owner.PRODUCTION_COMPOSE_PROJECT)
        != owner.PRODUCTION_COMPOSE_PROJECT
    ):
        raise owner.DataStateError(
            "Production Compose project 必须是固定的 partsignal-staging"
        )
    if env.get("PARTSIGNAL_FRONTEND_VERSION") not in {None, "", version}:
        raise owner.DataStateError("Production deploy 不允许覆盖 frontend version")
    if owner.V1_REPOSITORY_PATTERN.search(
        backend
    ) or owner.V1_REPOSITORY_PATTERN.search(frontend):
        raise owner.DataStateError("Production 不允许使用 V1 镜像仓库")
    compose_path = owner.REPOSITORY_ROOT / "deploy/compose.prod.yaml"
    if Path(env.get("COMPOSE_FILE") or str(compose_path)).resolve(
        strict=True
    ) != compose_path.resolve(strict=True):
        raise owner.DataStateError("Production 只允许仓库权威 Compose")
    if not Path(runtime).is_file():
        raise owner.DataStateError("缺少 Production 环境文件")
    env.update(
        COMPOSE_PROJECT_NAME=owner.PRODUCTION_COMPOSE_PROJECT,
        PARTSIGNAL_FRONTEND_VERSION=version,
        PARTSIGNAL_RUNTIME_ENV_FILE=runtime,
    )
    owner.validate_recovery_boundary()
    candidate = owner.candidate_from_manifest(manifest)
    compose = ["docker", "compose", "--env-file", runtime, "-f", str(compose_path)]
    return candidate, mode, delivery, compose


def execute(owner: Any, publish: Callable[[dict[str, Any]], None]) -> int:
    """不接受 stage/退出码输入，只有执行本身能产生失败。"""
    candidate, mode, delivery, compose = deployment_inputs(owner)
    version = candidate["release_id"]
    def required(key: str) -> str:
        if not os.environ.get(key):
            raise owner.DataStateError(f"必须指定 {key}")
        return os.environ[key]
    run_id = required("PARTSIGNAL_CUTOVER_RUN_ID") if mode in {"clean-init", "fresh-init"} else None
    if mode == "clean-init":
        owner.begin_clean_init(owner.require_run_id(run_id), candidate)
    elif mode == "fresh-init":
        # 先只读认证清空证明，实际开始必须晚于镜像身份核验。
        state = owner.verify_phase(owner.require_run_id(run_id), {"RESET_READY", "FRESH_INIT_DEPLOYING", "PRODUCTION_PREPARED"})
        owner.require_candidate(state, candidate)
        owner.fresh_reset.require_fresh_candidate(owner, candidate)
    else:
        owner.upgrade_entry_state(candidate)

    def command(stage: str, args: list[str], *, quiet: bool = False) -> None:
        publish({"stage": stage})
        subprocess.run(args, check=True, stdout=subprocess.DEVNULL if quiet else None)

    def operation(action: str, args: list[str]) -> list[str]:
        return [
            *compose,
            action,
            *(["--pull", "never"] if delivery == "local" else []),
            *args,
        ]

    subprocess.run([*compose, "config", "--quiet"], check=True)
    if delivery == "registry":
        subprocess.run(
            [*compose, "pull", "api", "worker", "scheduler", "frontend", "migrate"],
            check=True,
        )
    try:
        owner.verify_candidate_images(candidate)
    except subprocess.CalledProcessError as error:
        # 入场身份探针失败保留原 validation exit2，尚未创建部署 attempt。
        raise owner.DataStateError(f"Production 镜像身份检查失败：{error.cmd[-1]}") from error
    if mode == "upgrade":
        owner.begin_upgrade(candidate)
        data_root, _ = owner.configured_roots()
        attempt = owner.read_state(data_root)["upgrade_attempt"]
        publish({"attempt_id": attempt["attempt_id"]})
    elif mode == "fresh-init":
        owner.fresh_reset.begin_fresh_init(owner, owner.require_run_id(run_id), candidate)
    command("data_services", operation("up", ["-d", "--wait", "postgres", "redis"]))
    command(
        "configuration_preflight",
        operation(
            "run",
            ["--rm", "api", "python", "-m", "app.cli", "preflight-production-config"],
        ),
    )
    if mode == "upgrade":
        command(
            "integrity_preflight",
            operation(
                "run", ["--rm", "api", "python", "-m", "app.cli", "preflight-integrity"]
            ),
        )
        command("stop_application", [*compose, "stop", "api", "worker", "scheduler"])
    command("migration", operation("run", ["--rm", "migrate"]))
    command(
        "integrity_post_migration",
        operation(
            "run",
            [
                "--rm",
                "api",
                "python",
                "-m",
                "app.cli",
                "preflight-integrity",
                "--require-schema",
            ],
        ),
    )
    command(
        "account_initialization",
        operation(
            "run", ["--rm", "api", "python", "-m", "app.cli", "initialize-accounts"]
        ),
    )
    command("application_start", operation("up", ["-d", "--wait", "api", "frontend"]))
    command("status", [*compose, "ps"])
    for stage, url in (
        ("api_readiness", "http://127.0.0.1:19000/api/health/ready"),
        ("frontend_readiness", "http://127.0.0.1:19080/"),
    ):
        command(
            stage,
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--connect-timeout",
                "5",
                "--max-time",
                "10",
                "--retry",
                "12",
                "--retry-delay",
                "2",
                url,
            ],
            quiet=True,
        )
    publish({"stage": "prepared_proof"})
    if mode in {"clean-init", "fresh-init"}:
        owner.transition_candidate(
            owner.require_run_id(run_id),
            "CLEAN_INIT_DEPLOYING" if mode == "clean-init" else "FRESH_INIT_DEPLOYING",
            "PRODUCTION_PREPARED",
            candidate,
        )
    else:
        owner.transition_upgrade("UPGRADE_DEPLOYING", "UPGRADE_PREPARED", candidate)
    print(
        f"PartSignal {version} Production V2 已准备（{mode}）；Worker/Scheduler 尚未激活"
    )
    return 0


def initialized_state(owner: Any) -> dict[str, Any]:
    """阶段必须有完成的 upgrade 或首次激活证明，不能把 prepared 当成 initialized。"""
    data_root, _ = owner.configured_roots()
    state = owner.read_state(data_root)
    current = state.get("candidate")
    if state.get("phase") != "PRODUCTION_INITIALIZED" or not isinstance(current, dict):
        raise owner.DataStateError("日常操作要求已完成的 PRODUCTION_INITIALIZED；请使用完整 Runbook")
    if not all(isinstance(current.get(key), str) and current[key] for key in (
        "manifest_sha256", "release_id", "schema_head", "backend_image_id", "backend_reference",
        "frontend_image_id", "frontend_reference",
    )):
        raise owner.DataStateError("当前 initialized 候选身份记录不完整；请使用完整 Runbook")
    if state.get("active_frontend") or state.get("current_upgrade_failure_id"):
        raise owner.DataStateError("当前版本存在回滚或失败记录；请使用完整 Runbook")
    attempt = state.get("upgrade_attempt")
    if attempt is not None:
        owner.require_upgrade_attempt(state, current, "INITIALIZED")
    else:
        owner.verify_phase(owner.require_run_id(state.get("run_id", "")), {"PRODUCTION_INITIALIZED"})
        handoff = owner.ai_configuration_handoff(state)
        status = owner._attempt_status(state)
        if handoff is not None:
            if status is not None or handoff["manifest_sha256"] != current.get("manifest_sha256"):
                raise owner.DataStateError("initialized AI 配置移交证明不匹配")
        elif status != "SUCCEEDED":
            raise owner.DataStateError("缺少首次激活证明；请使用完整 Runbook")
    return state


def runtime_identity(owner: Any, candidate: dict[str, Any], *, healthy: bool = False) -> dict[str, str]:
    """仅检查安全 metadata；服务引用与实际 image ID 同时绑定 manifest。"""
    containers = {}
    for service in ("api", "frontend", "worker", "scheduler"):
        role = "frontend" if service == "frontend" else "backend"
        identifiers = subprocess.run([
            "docker", "ps", "-aq", "--no-trunc", "--filter",
            f"label=com.docker.compose.project={owner.PRODUCTION_COMPOSE_PROJECT}",
            "--filter", f"label=com.docker.compose.service={service}",
        ], check=True, capture_output=True, text=True, timeout=30).stdout.split()
        if len(identifiers) != 1 or not re.fullmatch(r"[0-9a-f]{64}", identifiers[0]):
            raise owner.DataStateError(f"Production {service} 必须恰有一个完整 ID 容器")
        safe_format = "|".join((
            "{{.Id}}", "{{.Image}}", "{{.Config.Image}}", "{{.State.Running}}",
            '{{index .Config.Labels "com.docker.compose.project"}}',
            '{{index .Config.Labels "com.docker.compose.service"}}',
            "{{json .Mounts}}", "{{if .State.Health}}{{.State.Health.Status}}{{end}}",
        ))
        fields = subprocess.run([
            "docker", "inspect", "--format", safe_format, identifiers[0],
        ], check=True, capture_output=True, text=True, timeout=30).stdout.rstrip("\n").split("|", 7)
        if len(fields) != 8 or fields[:6] != [
            identifiers[0], candidate[f"{role}_image_id"], candidate[f"{role}_reference"],
            "true", owner.PRODUCTION_COMPOSE_PROJECT, service,
        ]:
            raise owner.DataStateError(f"Production {service} 容器身份或运行状态漂移")
        mounts = json.loads(fields[6])
        roots = (PurePosixPath("/usr/share/nginx/html"), PurePosixPath("/etc/nginx")) if service == "frontend" else (PurePosixPath("/app"),)
        if not isinstance(mounts, list) or any(not isinstance(mount, dict) or not isinstance(mount.get("Destination"), str) for mount in mounts):
            raise owner.DataStateError(f"Production {service} 挂载 metadata 无效")
        if any(target == root or target in root.parents or root in target.parents
               for mount in mounts for target in (PurePosixPath(mount["Destination"]),) for root in roots):
            raise owner.DataStateError(f"Production {service} 容器存在覆盖应用内容的挂载")
        if healthy and service != "frontend" and fields[7] != "healthy":
            raise owner.DataStateError(f"Production {service} 尚未 healthy")
        containers[service] = identifiers[0]
    return containers


def database_revision(owner: Any, candidate: dict[str, Any], api: str) -> None:
    """真实 API 容器内只读 PostgreSQL；不运行 migration 或初始化账号。"""
    probe = (
        "import json\nfrom app.db import engine\nfrom sqlalchemy import text\n"
        "with engine.connect() as connection:\n"
        "    with connection.begin():\n"
        "        connection.execute(text('SET TRANSACTION READ ONLY'))\n"
        "        connection.execute(text(\"SET LOCAL statement_timeout = '10s'\"))\n"
        "        print(json.dumps(list(connection.execute(text('SELECT version_num FROM alembic_version')).scalars())))\n"
        "engine.dispose()\n"
    )
    result = subprocess.run(["docker", "exec", api, "python", "-c", probe],
                            capture_output=True, timeout=30)
    try:
        revision = json.loads(result.stdout) if result.returncode == 0 else None
    except ValueError:
        revision = None
    if revision != [candidate.get("schema_head")]:
        raise owner.DataStateError("真实数据库 revision 与已部署候选不一致；请使用完整 Runbook")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def http_get(owner: Any, url: str, *, cookie: str | None = None) -> tuple[int, Any, bytes]:
    """限制请求与响应，不跟随重定向，不透传响应或含凭据异常。"""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(url, headers={"Cookie": cookie} if cookie else {})
    def deadline(_signum: int, _frame: Any) -> None:
        raise TimeoutError()
    previous = signal.signal(signal.SIGALRM, deadline)
    timer = signal.setitimer(signal.ITIMER_REAL, 10)
    try:
        try:
            response = opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(65537)
            if len(body) > 65536:
                raise owner.DataStateError("Production HTTP 响应超出冒烟检查限制")
            return response.code, response.headers, body
    except (OSError, urllib.error.URLError, ValueError):
        raise owner.DataStateError("Production HTTP 请求失败或超时；未记录响应内容") from None
    finally:
        signal.setitimer(signal.ITIMER_REAL, *timer)
        signal.signal(signal.SIGALRM, previous)


def response_object(owner: Any, body: bytes) -> dict[str, Any]:
    try:
        payload = json.loads(body)
    except (ValueError, UnicodeError):
        raise owner.DataStateError("Production HTTP JSON 响应格式无效；未记录响应内容") from None
    if not isinstance(payload, dict):
        raise owner.DataStateError("Production HTTP JSON 响应必须为对象；未记录响应内容")
    return payload


def public_base(owner: Any, value: str | None) -> str:
    try:
        parsed = urlsplit(value or "")
        port = parsed.port
    except ValueError:
        raise owner.DataStateError("public-url 格式无效；未记录输入内容") from None
    test_loopback = (os.getenv("PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS") == "1"
                     and parsed.scheme == "http" and parsed.hostname == "127.0.0.1")
    production_origin = parsed.scheme == "https" and parsed.hostname == "geo.962850.xyz" and port in {None, 443}
    if not (production_origin or test_loopback) or not parsed.hostname or (
        parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}
    ):
        raise owner.DataStateError("--public-url 必须是 https://geo.962850.xyz（默认 443，无凭据或路径）")
    return value.rstrip("/")


def maintenance_guard(owner: Any, value: str | None) -> None:
    status, headers, body = http_get(owner, public_base(owner, value) + "/")
    if (status != 503 or body != b"PartSignal maintenance\n"
            or headers.get_content_type() != "text/plain"
            or headers.get("Cache-Control") != "no-store" or headers.get("Retry-After") != "3600"):
        raise owner.DataStateError("公网未确认 503 PartSignal maintenance；保持服务不变")


def smoke(owner: Any, candidate: dict[str, Any], args: Any) -> None:
    containers = runtime_identity(owner, candidate, healthy=True)
    database_revision(owner, candidate, containers["api"])
    base = public_base(owner, args.public_url) if args.public_url else None
    api_base, frontend_base = base or "http://127.0.0.1:19000", base or "http://127.0.0.1:19080"
    for endpoint in ("live", "ready"):
        status, headers, body = http_get(owner, api_base + "/api/health/" + endpoint)
        payload = response_object(owner, body)
        if status != 200 or headers.get_content_type() != "application/json" or payload.get("status") != "ok":
            raise owner.DataStateError(f"Production API {endpoint} 响应未通过")
        if endpoint == "ready" and payload.get("checks") != {"postgresql": "ok", "redis": "ok"}:
            raise owner.DataStateError("Production API ready 依赖响应未通过")
    status, headers, body = http_get(owner, frontend_base + "/login")
    if status != 200 or headers.get_content_type() != "text/html" or not all(
        fragment in body for fragment in (b'<div id="root">', b'PartSignal', b'<script type="module"')
    ):
        raise owner.DataStateError("Production login 页面未返回 PartSignal 应用入口")
    status, headers, body = http_get(owner, api_base + "/api/v1/users?page_size=1")
    payload = response_object(owner, body)
    if (status != 401 or headers.get_content_type() != "application/json"
            or not isinstance(payload.get("error"), dict) or payload["error"].get("code") != "AUTH_REQUIRED"):
        raise owner.DataStateError("Production 匿名管理 API 未返回 AUTH_REQUIRED 401")
    if args.session_file:
        path = Path(args.session_file)
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_uid != os.geteuid():
                raise owner.DataStateError("session-file 必须是当前用户拥有的 0600 普通文件")
            with os.fdopen(descriptor, "rb", closefd=False) as source:
                value = source.read(4097).removesuffix(b"\n")
            if len(value) > 4096 or not re.fullmatch(rb"[A-Za-z0-9_.-]+=[A-Za-z0-9_-]+", value):
                raise owner.DataStateError("session-file 必须仅包含一个现有会话 Cookie name=value")
        finally:
            os.close(descriptor)
        status, headers, body = http_get(owner, api_base + "/api/v1/users?page_size=1", cookie=value.decode("ascii"))
        if status != 200 or headers.get_content_type() != "application/json" or not isinstance(response_object(owner, body).get("items"), list):
            raise owner.DataStateError("既有管理员会话只读业务检查未通过；未记录响应内容")
        print("既有管理员会话只读用户列表检查通过。")
    print(f"Production {candidate['release_id']} 身份、数据库、健康、login 入口及匿名管理 API 冒烟通过。")
    print("此检查不代表真实 AI/OSS Gate 或完整业务流程通过。")


def routine(owner: Any, args: Any, publish: Callable[[dict[str, Any]], None], lock_fd: int) -> int:
    """日常入口不持有第二份状态；所有服务写操作复用当前锁与 supervisor。"""
    candidate, _, _, compose = deployment_inputs(owner)
    owner.verify_candidate_images(candidate)
    subprocess.run([*compose, "config", "--quiet"], check=True, timeout=30)
    action = args.action
    if action == "activate":
        os.environ.update(PARTSIGNAL_DEPLOY_MODE="upgrade", PARTSIGNAL_IMAGE_DELIVERY_MODE="local")
        owner.verify_upgrade_prepared(candidate)
        api = owner.running_api_container_id(candidate, runner=lambda *a, **k: subprocess.run(*a, timeout=30, **k))
    else:
        state = initialized_state(owner)
        current = state["candidate"]
        if action in {"restart", "smoke"}:
            owner.require_candidate(state, candidate)
        if action != "smoke":
            containers = runtime_identity(owner, current)
            api = containers["api"]
            database_revision(owner, current, containers["api"])
        if action in {"check", "prepare"} and current != candidate:
            if not all((args.current_manifest, args.current_source_archive, args.source_archive)):
                raise owner.DataStateError("新候选缺少旧/新 manifest 与源码归档证明；请使用完整 Runbook")
            if current.get("schema_head") != candidate["schema_head"]:
                raise owner.DataStateError("新候选 schema 变化；请使用完整 Runbook")
            try:
                proof = verify_archives(current, candidate,
                    failed_manifest=args.current_manifest, manifest=os.environ["PARTSIGNAL_RELEASE_MANIFEST"],
                    failed_archive=args.current_source_archive, archive=args.source_archive,
                    repository=owner.REPOSITORY_ROOT)
            except (ValueError, KeyError, OSError) as error:
                raise owner.DataStateError(f"无迁移归档证明失败：{error}；请使用完整 Runbook") from None
            if any(value.get("migration_runtime", {}).get("source_sha256") != proof for value in (current, candidate)):
                raise owner.DataStateError("迁移源码证明与候选不一致；请使用完整 Runbook")
            owner.upgrade_entry_state(candidate)
        elif action == "prepare":
            raise owner.DataStateError("同候选已 initialized；请使用 restart")
    if action != "smoke":
        # 配置变化走完整 Runbook，不能检查现用旧库后消费另一份新配置。
        subprocess.run(["python3", str(owner.REPOSITORY_ROOT / "deploy/scripts/check-production-inputs.py"),
                        "--runtime-contract", "--against-container", api, os.environ["ENV_FILE"]],
                       check=True, timeout=35)
    publish({"stage": "routine_" + action})
    if action in {"prepare", "restart", "activate"}:
        maintenance_guard(owner, args.public_url)
        publish({"stage": "routine_" + action + "_execute"})
    if action in {"prepare", "activate"}:
        os.environ.update(PARTSIGNAL_DEPLOY_MODE="upgrade", PARTSIGNAL_IMAGE_DELIVERY_MODE="local",
                          PARTSIGNAL_MAINTENANCE_LOCK_FD=str(lock_fd))
        script = "deploy.sh" if action == "prepare" else "activate-production.sh"
        result = subprocess.run([str(owner.REPOSITORY_ROOT / "deploy/scripts" / script)], pass_fds=(lock_fd,))
        if result.returncode:
            return owner.exit_code(result.returncode)
        if action == "activate":
            publish({"stage": "routine_activate_smoke"})
            owner.require_candidate(initialized_state(owner), candidate)
            # Nginx 仍应保持维护；激活后只验证回环。
            args.public_url = None
            smoke(owner, candidate, args)
    elif action == "restart":
        async_compose = [*compose[:2], "--profile", "production-async", *compose[2:]]
        subprocess.run([*async_compose, "up", "-d", "--wait", "--wait-timeout", "180", "--no-build",
                        "--pull", "never", "--no-deps", "--force-recreate", "api", "frontend", "worker", "scheduler"],
                       check=True, timeout=210)
        publish({"stage": "routine_restart_smoke"})
        args.public_url = None
        smoke(owner, candidate, args)
        if owner.ai_configuration_handoff(state) is not None:
            print("保留 admin-ui AI_PENDING 交接事实；未声明真实 AI Gate MET。")
    elif action == "smoke":
        smoke(owner, candidate, args)
    else:
        print("Production 日常候选、配置、运行身份及无迁移资格检查通过。")
    return 0
