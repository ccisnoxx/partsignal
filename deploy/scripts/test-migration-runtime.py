#!/usr/bin/env python3
"""独立迁移镜像完整程序、归档树和停止探针生命周期合同。"""

from __future__ import annotations
import io
import json
import signal
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import production_migration_runtime as runtime
from production_upgrade_recovery import archive_migrations


class MigrationRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.files = {
            "alembic.ini": b"[alembic]\n",
            "alembic/env.py": b"from app import models\n",
            "alembic/versions/one.py": b"revision='one'\n",
            "alembic/sql/one.sql": b"SELECT 1;\n",
            "app/db.py": b"import pkgutil; pkgutil.resolve_name('app.main')\n",
            "app/main.py": b"artifact=1\n",
            "app/models/one.py": b"Model=1\n",
        }
        self.configuration = runtime._image_configuration(
            {
                "Config": {
                    "Env": ["PATH=/opt/venv/bin:/usr/bin"],
                    "WorkingDir": "/app",
                    "Entrypoint": None,
                    "User": "",
                    "Cmd": ["api"],
                },
                "Os": "linux",
                "Architecture": "amd64",
            }
        )

    def tearDown(self):
        self.temporary.cleanup()

    def tar(self, files, *, prefix="app/", modes=None, mtimes=None, extra=None):
        path = self.root / "rootfs.tar"
        with tarfile.open(path, "w") as archive:
            for name, content in files.items():
                member = tarfile.TarInfo(prefix + name)
                member.size = len(content)
                member.mode = (modes or {}).get(name, 0o644)
                member.mtime = (mtimes or {}).get(name, 0)
                archive.addfile(member, io.BytesIO(content))
            if extra:
                archive.addfile(extra)
        return path

    def fingerprint(self, files=None, *, modes=None, mtimes=None, extra=None):
        content = {"app/" + name: data for name, data in (files or self.files).items()}
        content.update(
            {
                "usr/local/bin/python3.12": b"interpreter",
                "opt/venv/lib/python3.12/site-packages/sqlalchemy/__init__.py": b"dependency",
                "etc/debian_version": b"base",
            }
        )
        return runtime._export_fingerprint(
            self.tar(content, prefix="", modes=modes, mtimes=mtimes, extra=extra),
            self.configuration,
        )

    def test_archive_checkout_tree_identity_is_separate_from_runtime(self):
        files = runtime.source_files(self.files)
        self.assertNotIn("app/main.py", files)
        self.assertEqual(
            archive_migrations(self.tar(self.files, prefix="backend/")),
            {"backend/" + name: value for name, value in files.items()},
        )
        for name, data in self.files.items():
            path = self.root / "backend" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.assertEqual(
            runtime.source_digest(self.root / "backend"), runtime.files_digest(files)
        )

    def test_whole_program_covers_dynamic_import_and_data_inputs(self):
        original = self.fingerprint()
        for name in (
            "app/main.py",
            "app/db.py",
            "app/models/one.py",
            "app/fixture.sql",
            "app/fixture.so.1",
        ):
            with self.subTest(name=name):
                changed = {**self.files, name: self.files.get(name, b"") + b"changed"}
                proof = self.fingerprint(changed)
                self.assertEqual(proof["source_sha256"], original["source_sha256"])
                self.assertNotEqual(
                    proof["migration_runtime_sha256"],
                    original["migration_runtime_sha256"],
                )

    def test_external_dependency_python_base_startup_and_cache_are_frozen(self):
        original = self.fingerprint()
        files = {"app/" + name: data for name, data in self.files.items()}
        files.update(
            {
                "usr/local/bin/python3.12": b"interpreter",
                "opt/venv/lib/python3.12/site-packages/sqlalchemy/__init__.py": b"dependency",
                "etc/debian_version": b"base",
            }
        )
        for name in (
            "usr/local/bin/python3.12",
            "opt/venv/lib/python3.12/site-packages/sqlalchemy/__init__.py",
            "etc/debian_version",
            "opt/venv/lib/python3.12/site-packages/sitecustomize.py",
            "opt/venv/lib/python3.12/site-packages/__pycache__/_virtualenv.cpython-312.pyc",
        ):
            with self.subTest(name=name):
                proof = runtime._export_fingerprint(
                    self.tar(
                        {**files, name: files.get(name, b"") + b"changed"}, prefix=""
                    ),
                    self.configuration,
                )
                self.assertNotEqual(
                    proof["migration_runtime_sha256"],
                    original["migration_runtime_sha256"],
                )
        self.assertNotEqual(self.fingerprint(mtimes={"app/app/main.py": 12}), original)
        self.assertNotEqual(
            self.fingerprint(modes={"app/app/main.py": 0o600}), original
        )

    def test_shadow_symlink_does_not_hide_mutable_target(self):
        link = tarfile.TarInfo("app/pydantic_settings.py")
        link.type = tarfile.SYMTYPE
        link.linkname = "app/main.py"
        original = self.fingerprint(extra=link)
        changed = self.fingerprint(
            {**self.files, "app/main.py": b"artifact=2\n"}, extra=link
        )
        self.assertNotEqual(original, changed)

    def test_app_compiled_cache_refused(self):
        for name in (
            "app/__pycache__/db.cpython-312.pyc",
            "app/unused.pyo",
            "alembic/env.pyc",
        ):
            with (
                self.subTest(name=name),
                self.assertRaisesRegex(ValueError, "编译缓存"),
            ):
                self.fingerprint({**self.files, name: b"unchecked-hash payload"})

    def test_configuration_and_fingerprint_validation(self):
        for config in (
            {"Volumes": {"/data": {}}},
            {"Env": ["PYTHONPYCACHEPREFIX=/opt/cache"]},
            {"Env": ["PATH=/a", "PATH=/b"]},
            {"Entrypoint": ["/app/loader"]},
            {"WorkingDir": "/tmp"},
        ):
            with self.assertRaises(ValueError):
                runtime._image_configuration(
                    {"Config": {"Env": [], "WorkingDir": "/app", **config}}
                )
        proof = self.fingerprint()
        self.assertEqual(runtime.validate_fingerprint(proof), proof)
        for tamper in (
            {"version": "unknown"},
            {"source_sha256": "0" * 64},
            {"extra": 1},
        ):
            with self.assertRaises(ValueError):
                runtime.validate_fingerprint({**proof, **tamper})

    def test_stopped_container_cleanup_on_export_failure(self):
        image_id = "sha256:" + "a" * 64
        commands = []
        token = "b" * 32
        container = {
            "Id": "c" * 64,
            "Image": image_id,
            "State": {"Status": "created"},
            "Mounts": [],
            "HostConfig": {"NetworkMode": "none"},
            "Config": {"Labels": {"partsignal.migration-fingerprint": token}},
        }

        def docker(arguments, **kwargs):
            commands.append(arguments)
            if arguments[:2] == ["image", "inspect"]:
                return subprocess.CompletedProcess(
                    [],
                    0,
                    json.dumps(
                        [
                            {
                                "Id": image_id,
                                "Config": {
                                    "Env": [],
                                    "Volumes": None,
                                    "WorkingDir": "/app",
                                },
                            }
                        ]
                    ),
                )
            if arguments[:2] == ["container", "inspect"]:
                return subprocess.CompletedProcess([], 0, json.dumps([container]))
            if arguments[0] == "export":
                raise ValueError("export failed")
            return subprocess.CompletedProcess([], 0, "")

        with (
            patch.object(
                runtime.uuid, "uuid4", return_value=type("Token", (), {"hex": token})()
            ),
            patch.object(runtime, "_docker", side_effect=docker),
            patch.object(
                runtime.subprocess,
                "run",
                return_value=subprocess.CompletedProcess(
                    [], 0, json.dumps([container])
                ),
            ),
        ):
            with self.assertRaisesRegex(ValueError, "export failed"):
                runtime.image_runtime_fingerprint(image_id)
        self.assertEqual(commands[-1], ["container", "rm", container["Id"]])
        create = next(command for command in commands if command[0] == "create")
        self.assertIn("--read-only", create)
        self.assertIn("never", create)
        self.assertIn("none", create)
        self.assertFalse(
            any(command[0] in {"run", "start", "pull"} for command in commands)
        )

    def test_sigterm_cleans_stopped_container_and_restores_handler(self):
        image_id = "sha256:" + "a" * 64
        token = "b" * 32
        commands = []
        before = signal.getsignal(signal.SIGTERM)
        container = {
            "Id": "c" * 64,
            "Image": image_id,
            "State": {"Status": "created"},
            "Mounts": [],
            "HostConfig": {"NetworkMode": "none"},
            "Config": {"Labels": {"partsignal.migration-fingerprint": token}},
        }

        def docker(arguments, **kwargs):
            commands.append(arguments)
            if arguments[:2] == ["image", "inspect"]:
                return subprocess.CompletedProcess(
                    [],
                    0,
                    json.dumps(
                        [
                            {
                                "Id": image_id,
                                "Config": {
                                    "Env": [],
                                    "Volumes": None,
                                    "WorkingDir": "/app",
                                },
                            }
                        ]
                    ),
                )
            if arguments[:2] == ["container", "inspect"]:
                return subprocess.CompletedProcess([], 0, json.dumps([container]))
            if arguments[0] == "export":
                signal.raise_signal(signal.SIGTERM)
                self.fail("SIGTERM 必须中断导出")
            return subprocess.CompletedProcess([], 0, "")

        with (
            patch.object(
                runtime.uuid, "uuid4", return_value=type("Token", (), {"hex": token})()
            ),
            patch.object(runtime, "_docker", side_effect=docker),
            patch.object(
                runtime.subprocess,
                "run",
                return_value=subprocess.CompletedProcess(
                    [], 0, json.dumps([container])
                ),
            ),
        ):
            with self.assertRaises(KeyboardInterrupt):
                runtime.image_runtime_fingerprint(image_id)
        self.assertEqual(commands[-1], ["container", "rm", container["Id"]])
        self.assertEqual(signal.getsignal(signal.SIGTERM), before)


if __name__ == "__main__":
    unittest.main()
