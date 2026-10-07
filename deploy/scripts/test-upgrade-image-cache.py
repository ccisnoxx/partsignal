#!/usr/bin/env python3
"""真实离线镜像证明完整迁移源码、应用缓存与实际执行环境差异。"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
import uuid
from pathlib import Path

from production_migration_runtime import image_runtime_fingerprint, source_digest

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]


def docker(arguments: list[str], *, timeout: int = 60) -> str:
    result = subprocess.run(["docker", *arguments], capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f"Docker {arguments[0]} 失败：{result.stderr[-1500:]}")
    return result.stdout.strip()


def main() -> None:
    endpoint = docker(["context", "inspect", "--format", '{{(index .Endpoints "docker").Host}}'])
    if not endpoint.startswith("unix://"):
        raise RuntimeError("镜像反例只允许本地 Engine")
    # 依赖镜像必须已在本地；不 pull、不启动共享服务。
    base = json.loads(docker(["image", "inspect", "partsignal-backend:test"]))[0]["Id"]
    references: list[str] = []
    source_refs = {base: "partsignal-backend:test"}
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="geo1007-runtime-", dir=cache) as temporary:
        build = Path(temporary)
        for name in ("app", "alembic"):
            shutil.copytree(ROOT / "backend" / name, build / name,
                            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"))
        shutil.copy2(ROOT / "backend/alembic.ini", build / "alembic.ini")

        def create(label: str, instructions: str) -> tuple[str, dict[str, str]]:
            reference = "geo1007-runtime-" + uuid.uuid4().hex + ":" + label
            (build / "Dockerfile").write_text(instructions)
            docker(["build", "--pull=false", "-t", reference, str(build)], timeout=300)
            references.append(reference)
            image_id = json.loads(docker(["image", "inspect", reference]))[0]["Id"]
            source_refs[image_id] = reference
            return image_id, image_runtime_fingerprint(image_id)

        try:
            clean_id, clean = create("clean", f"FROM {source_refs[base]}\nCOPY app /app/app\n"
                                    "COPY alembic /app/alembic\nCOPY alembic.ini /app/alembic.ini\n"
                                    "RUN find /app -type f \\( -name '*.pyc' -o -name '*.pyo' \\) -delete\n")
            assert json.loads(docker(["image", "inspect", "partsignal-backend:test"]))[0]["Id"] == base
            assert clean["source_sha256"] == source_digest(ROOT / "backend")
            # 独立 create/export 的容器身份或时间不能改变相同镜像指纹。
            assert image_runtime_fingerprint(clean_id) == clean
            for label, name in (("schema", "app/migration_schema_v1.py"), ("db", "app/db.py"),
                                ("model", "app/models/base.py"), ("artifact", "app/main.py")):
                _, changed = create(label, f"FROM {source_refs[clean_id]}\nRUN printf '\\n# fixture change\\n' >> /app/{name}\n")
                assert changed["source_sha256"] == clean["source_sha256"], label
                assert changed["environment_sha256"] != clean["environment_sha256"], label
            helper_id, helper = create("helper", f"FROM {source_refs[clean_id]}\n"
                                      "RUN printf '\\nfrom app.runtime_fixture_helper import marker\\n' >> /app/app/db.py "
                                      "&& printf 'marker = 1\\n' > /app/app/runtime_fixture_helper.py\n")
            _, changed_helper = create("helper-changed", f"FROM {source_refs[helper_id]}\n"
                                       "RUN printf 'marker = 2\\n' > /app/app/runtime_fixture_helper.py\n")
            assert changed_helper["environment_sha256"] != helper["environment_sha256"]
            _, command = create("command", f"FROM {source_refs[clean_id]}\n"
                                'CMD ["python", "-c", "raise SystemExit(24)"]\n')
            assert command == clean, "Compose 固定迁移 command；镜像 Cmd 不参与其执行"

            # 改动实际已安装依赖/解释器/base文件，不依赖版本字符串或 LABEL。
            mutations = {
                "dependency": "python -c \"import pathlib,sqlalchemy; p=pathlib.Path(sqlalchemy.__file__); p.write_bytes(p.read_bytes()+b'\\\\n# fixture change\\\\n')\"",
                "python": "printf '\\nfixture-interpreter-change\\n' >> /usr/local/bin/python3.12",
                "base": "python -c \"from pathlib import Path; files=list(Path('/usr/lib').glob('*/libc.so.6')); "
                        "assert len(files)==1; p=files[0]; p.write_bytes(p.read_bytes()+b'fixture-base-library')\"",
            }
            for label, command in mutations.items():
                _, changed = create(label, f"FROM {source_refs[clean_id]}\nRUN {command}\n")
                assert changed["source_sha256"] == clean["source_sha256"], label
                assert changed["environment_sha256"] != clean["environment_sha256"], label

            # 外部 timestamp pyc：源码/缓存字节保持相同，只改源码mtime便改变真实loader结果。
            timestamp_builder = """import os, py_compile
from pathlib import Path
source = Path('/opt/venv/lib/python3.12/site-packages/runtime_fingerprint_fixture.py')
source.write_text('marker = 999\\n')
stamp = int(source.stat().st_mtime)
os.utime(source, (stamp, stamp))
py_compile.compile(str(source), doraise=True, invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
source.write_text('marker = 111\\n')
os.utime(source, (stamp, stamp))
"""
            (build / "timestamp.py").write_text(timestamp_builder)
            timestamp_id, timestamp = create("timestamp", f"FROM {source_refs[clean_id]}\n"
                                             "COPY timestamp.py /app/fixture_timestamp.py\n"
                                             "RUN python /app/fixture_timestamp.py && python -c "
                                             "\"import runtime_fingerprint_fixture as f; assert f.marker == 999\"\n")
            _, changed_timestamp = create("timestamp-changed", f"FROM {source_refs[timestamp_id]}\n"
                                           "RUN python -c \"import os; from pathlib import Path; "
                                           "p=Path('/opt/venv/lib/python3.12/site-packages/runtime_fingerprint_fixture.py'); "
                                           "s=p.stat(); os.utime(p,(s.st_atime,s.st_mtime+2))\" "
                                           "&& python -c \"import runtime_fingerprint_fixture as f; assert f.marker == 111\"\n")
            assert changed_timestamp["source_sha256"] == timestamp["source_sha256"]
            assert changed_timestamp["environment_sha256"] != timestamp["environment_sha256"]

            # 源码相同，app helper 的 unchecked-hash 缓存能覆盖其执行内容，必须拒绝。
            poison = """import importlib.util, marshal
from pathlib import Path
source = Path('/app/app/migration_schema_v1.py')
cache = Path(importlib.util.cache_from_source(str(source)))
cache.parent.mkdir(parents=True, exist_ok=True)
code = compile('marker = 999\\n', str(source), 'exec')
cache.write_bytes(importlib.util.MAGIC_NUMBER + (1).to_bytes(4, 'little') + b'0' * 8 + marshal.dumps(code))
"""
            (build / "poison.py").write_text(poison)
            for label, instructions, expected in (
                ("app-cache", f"FROM {source_refs[clean_id]}\nCOPY poison.py /app/fixture_poison.py\n"
                 "RUN python /app/fixture_poison.py && python -c "
                 "\"import app.migration_schema_v1 as h; assert h.marker == 999\"\n", "编译缓存"),
                ("cache-prefix", f"FROM {source_refs[clean_id]}\nENV PYTHONPYCACHEPREFIX=/opt/cache\n", "树外迁移编译缓存"),
                ("volume", f"FROM {source_refs[clean_id]}\nVOLUME /app\n", "隐式数据挂载"),
                ("entrypoint", f"FROM {source_refs[clean_id]}\nENTRYPOINT [\"/app/custom-loader\"]\n", "Entrypoint"),
            ):
                try:
                    create(label, instructions)
                except ValueError as error:
                    assert expected in str(error), (label, str(error))
                else:
                    raise AssertionError(label + " 被错误接受")
            print("真实镜像 PASS：同Alembic而schema/db/models/传递helper变化被识别；app unchecked-hash缓存拒绝；实际依赖/Python/base与timestamp pyc选择变化被识别；同镜像重复导出稳定；完整迁移镜像含app全部artifact；仅Cmd变化通过；不启动探针容器或访问数据库")
        finally:
            for reference in reversed(references):
                docker(["image", "rm", reference])
    remaining = docker(["container", "ls", "-aq", "--filter", "label=partsignal.migration-fingerprint"])
    if remaining:
        raise RuntimeError("迁移 fingerprint 停止容器未清理")
    print("本次镜像、停止探针容器与临时导出已精确清理")


if __name__ == "__main__":
    main()
