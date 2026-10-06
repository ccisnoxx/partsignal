"""独立迁移镜像完整程序与归档树的唯一指纹所有者；从不启动容器。"""

from __future__ import annotations

import hashlib
import json
import re
import signal
import subprocess
import tarfile
import tempfile
import uuid
from pathlib import Path, PurePosixPath
from typing import Any

VERSION = "MIGRATION_RUNTIME_V1"
_HASH = re.compile(r"[0-9a-f]{64}\Z")
_IMAGE_ID = re.compile(r"sha256:[0-9a-f]{64}\Z")


def _json_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"),
                                     ensure_ascii=True).encode()).hexdigest()


def files_digest(files: dict[str, str]) -> str:
    """路径使用 backend 相对形式；归档、checkout 与镜像共用相同摘要。"""
    return _json_digest(files)


def validate_fingerprint(value: Any) -> dict[str, str]:
    keys = {"version", "source_sha256", "environment_sha256", "migration_runtime_sha256"}
    if (not isinstance(value, dict) or set(value) != keys or value["version"] != VERSION
            or any(not isinstance(value[key], str) or not _HASH.fullmatch(value[key])
                   for key in keys - {"version"})):
        raise ValueError("迁移 runtime fingerprint 结构或版本无效")
    expected = _json_digest({key: value[key] for key in keys - {"migration_runtime_sha256"}})
    if value["migration_runtime_sha256"] != expected:
        raise ValueError("迁移 runtime fingerprint 组合摘要不一致")
    return dict(value)


def _fingerprint(source: str, environment: str) -> dict[str, str]:
    result = {"version": VERSION, "source_sha256": source, "environment_sha256": environment}
    result["migration_runtime_sha256"] = _json_digest(result)
    return validate_fingerprint(result)


def canonical_path(name: str, *, directory: bool = False) -> str:
    if name.endswith("/") and (not directory or name.endswith("//")):
        raise ValueError("迁移材料包含路径别名")
    name = name.removesuffix("/")
    if (not name or name == "." or name.startswith("/") or ".." in PurePosixPath(name).parts
            or str(PurePosixPath(name)) != name):
        raise ValueError("迁移材料包含路径别名")
    return name


def source_files(inventory: dict[str, bytes]) -> dict[str, str]:
    """归档源码只证明 Alembic 树；完整运行时由独立迁移镜像全 rootfs 证明。"""
    selected = {name for name in inventory if name == "alembic.ini" or name.startswith("alembic/")}
    if not {"alembic.ini", "alembic/env.py"} <= selected or not any(
            name.startswith("alembic/versions/") and name.endswith(".py") for name in selected):
        raise ValueError("迁移材料缺少完整 Alembic 树")
    for name in selected:
        canonical_path(name)
        if name.endswith((".pyc", ".pyo")):
            raise ValueError("迁移材料包含迁移编译缓存")
    return {name: hashlib.sha256(inventory[name]).hexdigest() for name in sorted(selected)}


def checkout_source_files(root: Path) -> dict[str, str]:
    """只读 checkout 的维护源码；本地测试缓存不属于镜像交付内容。"""
    root = root.resolve(strict=True)
    inventory: dict[str, bytes] = {}
    for path in [root / "alembic.ini", *(root / "alembic").rglob("*")]:
        if path.is_symlink():
            raise ValueError("当前 Alembic 树不能包含符号链接")
        if path.is_file() and not path.name.endswith((".pyc", ".pyo")):
            inventory[path.relative_to(root).as_posix()] = path.read_bytes()
    return source_files(inventory)


def source_digest(root: Path) -> str:
    return files_digest(checkout_source_files(root))


def _image_configuration(image: dict[str, Any]) -> dict[str, Any]:
    config = image.get("Config")
    if not isinstance(config, dict) or config.get("Volumes"):
        raise ValueError("迁移镜像配置无效或声明了隐式数据挂载")
    if config.get("Entrypoint") or config.get("WorkingDir") != "/app":
        raise ValueError("迁移镜像必须使用 /app 工作目录且无自定义 Entrypoint")
    environment = config.get("Env")
    if not isinstance(environment, list) or any(not isinstance(item, str) for item in environment):
        raise ValueError("迁移镜像环境配置无效")
    names: set[str] = set()
    for item in environment:
        name, separator, value = item.partition("=")
        if not name or not separator or name in names:
            raise ValueError("迁移镜像环境配置包含别名或重复项")
        names.add(name)
        if name == "PYTHONPYCACHEPREFIX" and value:
            raise ValueError("迁移镜像指定树外迁移编译缓存目录")
    # Compose 固定迁移 command；其他镜像执行配置必须相同。
    excluded = {"Cmd", "Labels", "Hostname", "Domainname", "AttachStdin", "AttachStdout",
                "AttachStderr", "Tty", "OpenStdin", "StdinOnce", "Image"}
    return {"configuration": {key: value for key, value in config.items() if key not in excluded},
            "os": image.get("Os"), "architecture": image.get("Architecture"),
            "variant": image.get("Variant")}


def _export_fingerprint(path: Path, configuration: dict[str, Any]) -> dict[str, str]:
    """完整 migration image 程序证明；依赖动态导入的应用文件也被冻结。"""
    environment: dict[str, Any] = {}
    inventory: dict[str, bytes] = {}
    seen: set[str] = set()
    with tarfile.open(path, "r:") as archive:
        for member in archive:
            name = canonical_path(member.name, directory=member.isdir())
            if name in seen:
                raise ValueError("迁移镜像导出包含重复成员")
            seen.add(name)
            if name.startswith("app/") and name.endswith((".pyc", ".pyo")):
                raise ValueError("迁移镜像包含应用或迁移编译缓存")
            metadata: dict[str, Any] = {"type": member.type.decode("ascii"),
                "mode": member.mode, "uid": member.uid, "gid": member.gid,
                "link": member.linkname, "pax": {key: value for key, value in member.pax_headers.items()
                                               if key not in {"mtime", "atime", "ctime"}}}
            if member.isfile():
                if name.endswith((".py", ".pyc", ".pyo")):
                    metadata["mtime"] = member.mtime
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError("迁移镜像环境文件无法读取")
                with source:
                    if name == "app/alembic.ini" or name.startswith("app/alembic/"):
                        content = source.read()
                        inventory[name.removeprefix("app/")] = content
                        metadata["sha256"] = hashlib.sha256(content).hexdigest()
                    else:
                        metadata["sha256"] = hashlib.file_digest(source, "sha256").hexdigest()
            elif member.issym() or member.islnk():
                if name == "app/alembic.ini" or name.startswith("app/alembic/"):
                    raise ValueError("迁移镜像 Alembic 成员必须是普通文件")
            elif not member.isdir():
                metadata.update(devmajor=member.devmajor, devminor=member.devminor)
            environment[name] = metadata
    return _fingerprint(files_digest(source_files(inventory)),
                        _json_digest({"rootfs": environment, **configuration}))


def _docker(arguments: list[str], *, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(["docker", *arguments], check=True, capture_output=True,
                              text=True, timeout=timeout)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        # Docker stderr 可能包含环境数据；只保留动作，不转发原始输出。
        raise ValueError(f"迁移 runtime Docker {arguments[0]} 失败或超时") from error


def image_runtime_fingerprint(image_id: str) -> dict[str, str]:
    """冻结 ID 的 stopped container 静态导出；无 pull/start/网络/数据挂载。"""
    if not isinstance(image_id, str) or not _IMAGE_ID.fullmatch(image_id):
        raise ValueError("迁移 runtime 必须使用冻结 image ID")
    images = json.loads(_docker(["image", "inspect", image_id]).stdout)
    if not isinstance(images, list) or len(images) != 1 or images[0].get("Id") != image_id:
        raise ValueError("迁移 runtime 镜像身份不一致")
    configuration = _image_configuration(images[0])
    token = uuid.uuid4().hex
    name = "partsignal-migration-fingerprint-" + token
    label = "partsignal.migration-fingerprint"
    old_handlers: dict[int, Any] = {}
    cleaning = False

    def interrupted(signum: int, frame: Any) -> None:
        if not cleaning:
            raise KeyboardInterrupt(f"迁移 runtime 指纹被信号 {signum} 中断")

    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            old_handlers[signum] = signal.signal(signum, interrupted)
        with tempfile.TemporaryDirectory(prefix="partsignal-migration-runtime-") as temporary:
            path = Path(temporary)
            try:
                _docker(["create", "--pull", "never", "--network", "none", "--read-only",
                         "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                         "--name", name, "--label", label + "=" + token,
                         "--entrypoint", "/bin/true", image_id], timeout=60)
                container = json.loads(_docker(["container", "inspect", name]).stdout)[0]
                if (container.get("Image") != image_id or container.get("State", {}).get("Status") != "created"
                        or container.get("Mounts") or container.get("HostConfig", {}).get("NetworkMode") != "none"):
                    raise ValueError("迁移 runtime 探针不是无挂载的停止容器")
                _docker(["export", "--output", str(path / "rootfs.tar"), container["Id"]], timeout=180)
                return _export_fingerprint(path / "rootfs.tar", configuration)
            finally:
                cleaning = True
                # 创建响应丢失仍按本次唯一 label 认证，再精确删除；绝不按名称猜测归属。
                lookup = subprocess.run(["docker", "container", "inspect", name],
                                        capture_output=True, text=True, timeout=30)
                if lookup.returncode == 0:
                    container = json.loads(lookup.stdout)[0]
                    if (container.get("Config", {}).get("Labels", {}).get(label) != token
                            or container.get("State", {}).get("Status") != "created"):
                        raise ValueError("迁移 runtime 停止容器清理归属无法证明")
                    _docker(["container", "rm", container["Id"]])
                elif lookup.returncode != 1 or "No such container" not in lookup.stderr:
                    raise ValueError("迁移 runtime 停止容器清理状态无法读取")
    finally:
        for signum, handler in old_handlers.items():
            signal.signal(signum, handler)
