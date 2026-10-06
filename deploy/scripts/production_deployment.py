"""固定 Production 部署编排；由状态所有者监督并观察真实退出。"""

from __future__ import annotations

import os
import subprocess
from collections.abc import Callable
from pathlib import Path
from typing import Any


def execute(owner: Any, publish: Callable[[dict[str, Any]], None]) -> int:
    """不接受 stage/退出码输入，只有执行本身能产生失败。"""
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
    if mode not in {"clean-init", "upgrade"}:
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
    run_id = required("PARTSIGNAL_CUTOVER_RUN_ID") if mode == "clean-init" else None
    if mode == "clean-init":
        owner.begin_clean_init(owner.require_run_id(run_id), candidate)
    else:
        owner.upgrade_entry_state(candidate)
    compose = ["docker", "compose", "--env-file", runtime, "-f", str(compose_path)]

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
                "--retry",
                "12",
                "--retry-delay",
                "2",
                url,
            ],
            quiet=True,
        )
    publish({"stage": "prepared_proof"})
    if mode == "clean-init":
        owner.transition_candidate(
            owner.require_run_id(run_id),
            "CLEAN_INIT_DEPLOYING",
            "PRODUCTION_PREPARED",
            candidate,
        )
    else:
        owner.transition_upgrade("UPGRADE_DEPLOYING", "UPGRADE_PREPARED", candidate)
    print(
        f"PartSignal {version} Production V2 已准备（{mode}）；Worker/Scheduler 尚未激活"
    )
    return 0
