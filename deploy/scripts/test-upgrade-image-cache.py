#!/usr/bin/env python3
"""用真实离线镜像验证迁移源码相同、缓存不同的拒绝反例。"""

import hashlib
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location(
    "owner", SCRIPTS / "prepare-production-data.py"
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


def main():
    endpoint = subprocess.run(
        [
            "docker",
            "context",
            "inspect",
            "--format",
            '{{(index .Endpoints "docker").Host}}',
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if not endpoint.startswith("unix://"):
        raise RuntimeError("镜像反例只允许本地 Engine")
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    refs = [
        "geo1007-cache-" + uuid.uuid4().hex + suffix
        for suffix in (":clean", ":poison", ":outside", ":historical")
    ]
    boundary_spec = importlib.util.spec_from_file_location(
        "boundary", SCRIPTS / "check-production-inputs.py"
    )
    boundary = importlib.util.module_from_spec(boundary_spec)
    boundary_spec.loader.exec_module(boundary)
    for runtime, environment in (
        ({"APP_ENV": "production", "PYTHONPYCACHEPREFIX": "/opt/cache"}, {}),
        ({"APP_ENV": "production"}, {"PYTHONPYCACHEPREFIX": "/opt/cache"}),
    ):
        try:
            boundary.check_deployment_boundary(runtime, environment)
        except boundary.InputError as error:
            assert str(error) == "PRODUCTION_MIGRATION_CACHE_PREFIX_FORBIDDEN"
        else:
            raise AssertionError("runtime/宿主机树外缓存设置被接受")
    files = {
        "backend/alembic.ini": hashlib.sha256(
            (ROOT / "backend/alembic.ini").read_bytes()
        ).hexdigest()
    }
    files.update(
        {
            p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (ROOT / "backend/alembic").rglob("*")
            if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
        }
    )
    expected = hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    with tempfile.TemporaryDirectory(prefix="geo1007-cache-", dir=cache) as temporary:
        build = Path(temporary)
        shutil.copytree(
            ROOT / "backend/alembic",
            build / "alembic",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
        shutil.copy2(ROOT / "backend/alembic.ini", build / "alembic.ini")
        try:
            (build / "Dockerfile").write_text(
                "FROM partsignal-backend:test\nCOPY . /app\nRUN find alembic -type f \\( -name '*.pyc' -o -name '*.pyo' \\) -delete\n"
            )
            subprocess.run(
                ["docker", "build", "--pull=false", "-t", refs[0], str(build)],
                check=True,
                capture_output=True,
            )
            clean = json.loads(
                subprocess.run(
                    ["docker", "image", "inspect", refs[0]],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
            )[0]["Id"]
            owner.verify_migration_image({"backend_image_id": clean}, expected)
            (build / "poison.py").write_text("""import importlib.util, marshal
from pathlib import Path
source=Path('/app/alembic/versions/0066_geo_manual_evaluation.py')
cache=Path(importlib.util.cache_from_source(str(source)))
cache.parent.mkdir(exist_ok=True)
# unchecked-hash 缓存保持同 revision，却省掉不可变触发器。
code=compile("revision='0066_geo_manual_evaluation'\\ndef upgrade(): pass\\n", str(source), 'exec')
cache.write_bytes(importlib.util.MAGIC_NUMBER + (1).to_bytes(4,'little') + b'0'*8 + marshal.dumps(code))
""")
            (build / "Dockerfile").write_text(
                f"FROM {refs[0]}\nCOPY poison.py /tmp/poison.py\nRUN python /tmp/poison.py\n"
            )
            subprocess.run(
                ["docker", "build", "--pull=false", "-t", refs[1], str(build)],
                check=True,
                capture_output=True,
            )
            poison = json.loads(
                subprocess.run(
                    ["docker", "image", "inspect", refs[1]],
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout
            )[0]["Id"]
            try:
                owner.verify_migration_image({"backend_image_id": poison}, expected)
            except owner.DataStateError as error:
                assert "编译缓存" in str(error)
            else:
                raise AssertionError("源码相同但缓存不同的镜像被接受")
            (build / "poison.py").write_text("""import importlib.util, marshal
from pathlib import Path
source=Path('/app/alembic/versions/0066_geo_manual_evaluation.py')
cache=Path(importlib.util.cache_from_source(str(source)))
cache.parent.mkdir(parents=True, exist_ok=True)
code=compile("revision='0066_geo_manual_evaluation'\\ndef upgrade(): return 'CACHE_EXECUTED'\\n", str(source), 'exec')
cache.write_bytes(importlib.util.MAGIC_NUMBER + (1).to_bytes(4,'little') + b'0'*8 + marshal.dumps(code))
""")
            (build / "Dockerfile").write_text(
                f"FROM {refs[0]}\nENV PYTHONPYCACHEPREFIX=/opt/cache\nCOPY poison.py /tmp/poison.py\nRUN python /tmp/poison.py\n"
            )
            subprocess.run(
                ["docker", "build", "--pull=false", "-t", refs[2], str(build)],
                check=True, capture_output=True,
            )
            outside = json.loads(subprocess.run(
                ["docker", "image", "inspect", refs[2]],
                check=True, capture_output=True, text=True,
            ).stdout)[0]["Id"]
            loader = """from importlib.machinery import SourceFileLoader
from pathlib import Path
assert not list(Path('/app/alembic').rglob('*.pyc'))
module=SourceFileLoader('revision_probe', '/app/alembic/versions/0066_geo_manual_evaluation.py').load_module()
assert module.upgrade() == 'CACHE_EXECUTED'
print('真实 SourceFileLoader 读取树外 unchecked-hash 缓存')
"""
            subprocess.run(
                ["docker", "run", "--rm", "--network", "none", "--read-only",
                 "--entrypoint", "python", outside, "-c", loader], check=True,
            )
            try:
                owner.verify_migration_image({"backend_image_id": outside}, expected)
            except owner.DataStateError as error:
                assert "树外迁移编译缓存" in str(error)
            else:
                raise AssertionError("源码树无缓存、树外缓存不同的镜像被接受")
            (build / "Dockerfile").write_text(
                f"FROM {refs[0]}\nCOPY poison.py /tmp/poison.py\nRUN PYTHONPYCACHEPREFIX=/opt/cache python /tmp/poison.py\n"
            )
            subprocess.run(
                ["docker", "build", "--pull=false", "-t", refs[3], str(build)],
                check=True, capture_output=True,
            )
            historical = json.loads(subprocess.run(
                ["docker", "image", "inspect", refs[3]],
                check=True, capture_output=True, text=True,
            ).stdout)[0]
            assert not any(value.startswith("PYTHONPYCACHEPREFIX=") for value in historical["Config"]["Env"])
            subprocess.run(
                ["docker", "run", "--rm", "--network", "none", "--read-only",
                 "-e", "PYTHONPYCACHEPREFIX=/opt/cache", "--entrypoint", "python",
                 historical["Id"], "-c", loader], check=True,
            )
            # 清除当前 runtime 后，镜像探针单独不能证明历史执行策略。
            owner.verify_migration_image({"backend_image_id": historical["Id"]}, expected)
            fixture_spec = importlib.util.spec_from_file_location(
                "policy_fixture", SCRIPTS / "test-upgrade-recovery.py"
            )
            fixture = importlib.util.module_from_spec(fixture_spec)
            fixture_spec.loader.exec_module(fixture)
            data = fixture.UpgradeRecoveryTests("runTest")
            data.setUp()
            try:
                data.deploying()
                state = fixture.owner.read_state(data.live)
                del state["upgrade_migration_cache_policy"]
                fixture.owner.atomic_write_state(data.live, state)
                data.assert_rejected("失败执行缺少绑定候选的迁移缓存策略证明")
            finally:
                data.tearDown()
            print(
                "真实镜像：树内/树外缓存拒绝；历史runtime清除反例要求失败时策略证明，CAS前拒绝且状态/数据保持；不访问数据库"
            )
        finally:
            for reference in reversed(refs):
                subprocess.run(
                    ["docker", "image", "rm", reference],
                    check=True,
                    capture_output=True,
                )
    print("镜像/temp资源已精确清理")


if __name__ == "__main__":
    main()
