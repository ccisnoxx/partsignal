#!/usr/bin/env python3
"""验证显式升级接管的状态、身份和中断合同。"""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
spec = importlib.util.spec_from_file_location(
    "production_state", SCRIPTS / "prepare-production-data.py"
)
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class UpgradeRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.live = self.root / "live"
        for leaf in ("postgres", "redis"):
            (self.live / leaf).mkdir(parents=True)
            (self.live / leaf / "history").write_text("不可变历史")
        self.env = patch.dict(
            os.environ,
            {
                "PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS": "1",
                "PARTSIGNAL_DATA_ROOT": str(self.live),
                "PARTSIGNAL_QUARANTINE_ROOT": str(self.root / "quarantine"),
                "PARTSIGNAL_MAINTENANCE_LOCK_FILE": str(self.root / "lock"),
            },
        )
        self.env.start()
        self.boundary = patch.object(owner, "validate_recovery_boundary")
        self.boundary.start()
        self.image_probe = patch.object(owner, "verify_migration_image")
        self.image_probe.start()
        self.cache_policy = patch.object(owner, "prove_upgrade_cache_policy", side_effect=lambda candidate: {"policy": "DEFAULT_PYTHON_CACHE_V1", "candidate": candidate})
        self.cache_policy.start()
        self.previous = {"release_id": "previous"}
        self.repository = self.root / "repository"
        for name in owner.REQUIRED_TRACKED_FILES:
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes((owner.REPOSITORY_ROOT / name).read_bytes())
        self.migrations = {
            "backend/alembic.ini": b"[alembic]\n",
            "backend/alembic/env.py": b"# fixture\n",
            "backend/alembic/versions/one.py": b"revision='test_head'\n",
            "backend/alembic/sql/one.sql": b"SELECT 1;\n",
        }
        for name, data in self.migrations.items():
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.repo_patch = patch.object(owner, "REPOSITORY_ROOT", self.repository)
        self.repo_patch.start()
        self.failed_manifest = self.manifest("failed", "a")
        self.fixed_manifest = self.manifest("fixed", "b")
        self.failed = self.candidate(self.failed_manifest)
        self.fixed = self.candidate(self.fixed_manifest)
        self.args = SimpleNamespace(
            manifest=str(self.fixed_manifest),
            failed_manifest=str(self.failed_manifest),
            failed_source_archive=str(self.root / "failed.tar.gz"),
            source_archive=str(self.root / "fixed.tar.gz"),
            failed_release_id=self.failed["release_id"],
            failed_manifest_sha256=self.failed["manifest_sha256"],
            recovery_id="upr_20261005_120000",
            approval_ref="local-test/approval-1",
        )
        owner.atomic_write_state(
            self.live,
            {
                "schema_version": 1,
                "data_root": str(self.live),
                "phase": "PRODUCTION_INITIALIZED",
                "candidate": self.previous,
            },
        )

    def tearDown(self):
        self.cache_policy.stop()
        self.image_probe.stop()
        self.boundary.stop()
        self.repo_patch.stop()
        self.env.stop()
        self.temporary.cleanup()

    def test_original_failure_dead_end(self):
        owner.begin_upgrade(self.failed)
        self.assertEqual(owner.read_state(self.live)["phase"], "UPGRADE_DEPLOYING")
        with self.assertRaisesRegex(owner.DataStateError, "候选不一致"):
            owner.begin_upgrade(self.fixed)
        with self.assertRaisesRegex(
            owner.DataStateError, "要求 PRODUCTION_INITIALIZED"
        ):
            owner.verify_rollback_frontend(self.failed)
        self.assertEqual((self.live / "postgres/history").read_text(), "不可变历史")

    def manifest(self, release, identity):
        archive = self.root / f"{release}.tar.gz"
        self.write_archive(archive, self.migrations)
        payload = {
            "release_id": release,
            "commit": identity * 40,
            "schema_head": "test_head",
            "source_archive": {
                "name": archive.name,
                "sha256": owner.file_sha256(archive),
            },
            "images": {
                role: {
                    "reference": f"test/{role}:{release}",
                    "image_id": f"sha256:{identity * 64}",
                    "repo_digests": [f"test/{role}@sha256:{identity * 64}"],
                }
                for role in ("backend", "frontend", "rollback_frontend")
            },
            "tracked_files": {
                name: owner.file_sha256(self.repository / name)
                for name in owner.REQUIRED_TRACKED_FILES
            },
        }
        path = self.root / f"{release}.json"
        path.write_text(json.dumps(payload))
        return path

    def write_archive(self, path, files):
        with tarfile.open(path, "w:gz") as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))

    def candidate(self, path):
        payload = json.loads(path.read_text())
        os.environ.update(
            PARTSIGNAL_VERSION=payload["release_id"],
            PARTSIGNAL_BACKEND_IMAGE="test/backend",
            PARTSIGNAL_FRONTEND_IMAGE="test/frontend",
        )
        return owner.candidate_from_manifest(str(path))

    def recover(self):
        with (
            patch.object(owner, "ensure_services_stopped"),
            patch.object(owner, "verify_candidate_images"),
        ):
            with owner.maintenance_lock():
                owner.recover_upgrade(self.args)

    def deploying(self, phase="UPGRADE_DEPLOYING"):
        owner.begin_upgrade(self.failed)
        state = owner.read_state(self.live)
        state["phase"] = phase
        owner.atomic_write_state(self.live, state)

    def assert_rejected(self, reason):
        before = (self.live / owner.STATE_FILE_NAME).read_bytes()
        with self.assertRaisesRegex((owner.DataStateError, ValueError), reason):
            self.recover()
        self.assertEqual((self.live / owner.STATE_FILE_NAME).read_bytes(), before)

    def test_recover_binds_fixed_without_initializing_or_changing_data(self):
        for phase in ("UPGRADE_DEPLOYING", "UPGRADE_PREPARED"):
            with self.subTest(phase=phase):
                self.deploying(phase)
                self.recover()
                state = owner.read_state(self.live)
                self.assertEqual(state["phase"], "UPGRADE_DEPLOYING")
                self.assertEqual(state["candidate"], self.fixed)
                self.assertEqual(state["previous_candidate"], self.previous)
                self.assertEqual(
                    state["upgrade_recoveries"][-1]["failed_candidate"], self.failed
                )
                self.assertEqual(
                    (self.live / "postgres/history").read_text(), "不可变历史"
                )
                owner.atomic_write_state(
                    self.live,
                    {
                        "schema_version": 1,
                        "data_root": str(self.live),
                        "phase": "PRODUCTION_INITIALIZED",
                        "candidate": self.previous,
                    },
                )

    def test_repeat_and_conflicting_receipt(self):
        self.deploying()
        self.recover()
        before = (self.live / owner.STATE_FILE_NAME).read_bytes()
        self.recover()
        self.assertEqual((self.live / owner.STATE_FILE_NAME).read_bytes(), before)
        self.args.approval_ref = "different"
        self.assert_rejected("冲突")

    def test_wrong_failed_identity(self):
        for field in ("failed_release_id", "failed_manifest_sha256"):
            with self.subTest(field=field):
                self.deploying()
                original = getattr(self.args, field)
                setattr(self.args, field, "wrong")
                self.assert_rejected("失败候选身份")
                setattr(self.args, field, original)
                state = owner.read_state(self.live)
                state["phase"] = "PRODUCTION_INITIALIZED"
                state["candidate"] = self.previous
                owner.atomic_write_state(self.live, state)

    def test_wrong_phase_and_initialized_replay(self):
        self.assert_rejected("未初始化")
        self.deploying()
        self.recover()
        state = owner.read_state(self.live)
        state["phase"] = "UPGRADE_PREPARED"
        owner.atomic_write_state(self.live, state)
        self.assert_rejected("冲突")
        state["phase"] = "PRODUCTION_INITIALIZED"
        owner.atomic_write_state(self.live, state)
        self.assert_rejected("未初始化")

    def test_wrong_manifest_environment_and_tracked_hash(self):
        self.deploying()
        os.environ["PARTSIGNAL_VERSION"] = "wrong"
        self.assert_rejected("release ID")
        os.environ["PARTSIGNAL_VERSION"] = "fixed"
        (self.repository / "deploy/scripts/deploy.sh").write_text("drift")
        self.assert_rejected("tracked file 校验失败")

    def test_old_manifest_and_archive_tamper(self):
        self.deploying()
        original = self.failed_manifest.read_bytes()
        self.failed_manifest.write_bytes(original + b" ")
        self.assert_rejected("manifest SHA-256")
        self.failed_manifest.write_bytes(original)
        Path(self.args.failed_source_archive).write_bytes(b"tampered")
        self.assert_rejected("source archive")

    def test_schema_and_same_artifact_rejected(self):
        self.deploying()
        payload = json.loads(self.fixed_manifest.read_text())
        payload["schema_head"] = "other_head"
        self.fixed_manifest.write_text(json.dumps(payload))
        self.assert_rejected("相同 schema")
        payload["schema_head"] = "test_head"
        for role in ("backend", "frontend"):
            payload["images"][role]["image_id"] = self.failed[f"{role}_image_id"]
        self.fixed_manifest.write_text(json.dumps(payload))
        self.assert_rejected("修正 artifact")

    def test_changed_migrations_and_local_drift(self):
        self.deploying()
        files = dict(self.migrations)
        files["backend/alembic/sql/one.sql"] = b"DELETE FROM history;"
        self.write_archive(Path(self.args.source_archive), files)
        payload = json.loads(self.fixed_manifest.read_text())
        payload["source_archive"]["sha256"] = owner.file_sha256(
            Path(self.args.source_archive)
        )
        self.fixed_manifest.write_text(json.dumps(payload))
        self.assert_rejected("迁移树与失败")
        self.write_archive(Path(self.args.source_archive), self.migrations)
        payload["source_archive"]["sha256"] = owner.file_sha256(
            Path(self.args.source_archive)
        )
        self.fixed_manifest.write_text(json.dumps(payload))
        (self.repository / "backend/alembic/env.py").write_text("drift")
        self.assert_rejected("当前迁移树")

    def test_running_services_and_image_drift(self):
        self.deploying()
        for boundary, reason in (
            ("ensure_services_stopped", "running"),
            ("verify_candidate_images", "image drift"),
        ):
            before = owner.read_state(self.live)
            with (
                patch.object(owner, "ensure_services_stopped"),
                patch.object(owner, "verify_candidate_images"),
            ):
                with patch.object(
                    owner, boundary, side_effect=owner.DataStateError(reason)
                ):
                    with self.assertRaisesRegex(owner.DataStateError, reason):
                        owner.recover_upgrade(self.args)
            self.assertEqual(owner.read_state(self.live), before)

    def test_interruption_before_and_after_atomic_commit(self):
        self.deploying()
        with patch.object(
            owner, "atomic_write_state", side_effect=OSError("interrupted")
        ):
            with self.assertRaisesRegex(OSError, "interrupted"):
                self.recover()
        self.assertEqual(owner.read_state(self.live)["candidate"], self.failed)
        write = owner.atomic_write_state

        def committed_then_interrupted(root, state):
            write(root, state)
            raise OSError("after commit")

        with patch.object(
            owner, "atomic_write_state", side_effect=committed_then_interrupted
        ):
            with self.assertRaisesRegex(OSError, "after commit"):
                self.recover()
        self.assertEqual(owner.read_state(self.live)["candidate"], self.fixed)
        self.recover()
        self.assertEqual(len(owner.read_state(self.live)["upgrade_recoveries"]), 1)

    def test_prepared_requires_database_proof_and_failure_keeps_deploying(self):
        self.deploying()
        self.recover()
        with patch.object(
            owner,
            "verify_recovery_database",
            side_effect=owner.DataStateError("bad database"),
        ):
            with self.assertRaisesRegex(owner.DataStateError, "bad database"):
                owner.transition_upgrade(
                    "UPGRADE_DEPLOYING", "UPGRADE_PREPARED", self.fixed
                )
        self.assertEqual(owner.read_state(self.live)["phase"], "UPGRADE_DEPLOYING")
        with patch.object(owner, "verify_recovery_database") as proof:
            owner.transition_upgrade(
                "UPGRADE_DEPLOYING", "UPGRADE_PREPARED", self.fixed
            )
            proof.assert_called_once_with(self.fixed)

    def test_unknown_bootstrap_is_not_bypassed(self):
        self.deploying()
        state = owner.read_state(self.live)
        state["ai_bootstrap_attempt"] = {"status": "STARTED"}
        owner.atomic_write_state(self.live, state)
        self.assert_rejected("bootstrap")

    def test_sigterm_parent_holds_lock_until_child_exits(self):
        self.deploying()
        child_script = self.root / "child.py"
        child_script.write_text("""import os, signal, time, subprocess, sys
from pathlib import Path
root=Path(os.environ['PARTSIGNAL_DATA_ROOT']).parent
grand=subprocess.Popen([sys.executable, '-c', "import os,signal,time; from pathlib import Path; r=Path(os.environ['PARTSIGNAL_DATA_ROOT']).parent; signal.signal(signal.SIGTERM, lambda s,f: ((r/'grandterm').touch(),exit(0))); (r/'grandready').touch(); time.sleep(60)"])
while not (root/'grandready').exists(): time.sleep(0.01)
def stop(signum, frame):
    (root/'terminating').touch()
    while not (root/'release').exists(): time.sleep(0.01)
    grand.wait(timeout=3)
    raise SystemExit(143)
signal.signal(signal.SIGTERM, stop)
(root/'ready').touch()
while True: time.sleep(0.01)
""")
        process = subprocess.Popen(
            [
                sys.executable,
                str(SCRIPTS / "prepare-production-data.py"),
                "run-locked",
                sys.executable,
                str(child_script),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

        def await_file(name):
            end = time.monotonic() + 5
            while not (self.root / name).exists():
                if time.monotonic() > end:
                    self.fail(f"missing event: {name}")
                time.sleep(0.01)

        try:
            await_file("ready")
            process.send_signal(signal.SIGTERM)
            await_file("terminating")
            await_file("grandterm")
            with self.assertRaisesRegex(owner.DataStateError, "排他锁"):
                with owner.maintenance_lock():
                    pass
            (self.root / "release").touch()
            process.communicate(timeout=5)
            self.assertEqual(process.returncode, 143)
            with owner.maintenance_lock():
                pass
            self.assertEqual(owner.read_state(self.live)["phase"], "UPGRADE_DEPLOYING")
        finally:
            (self.root / "release").touch()
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                process.communicate(timeout=12)

    def test_duplicate_and_linked_migration_members_rejected(self):
        from production_upgrade_recovery import archive_migrations

        path = self.root / "bad.tar"
        for kind in ("duplicate", "link", "alias"):
            with self.subTest(kind=kind):
                with tarfile.open(path, "w") as archive:
                    name = "backend/alembic/env.py"
                    member = tarfile.TarInfo(name)
                    if kind == "link":
                        member.type = tarfile.SYMTYPE
                        member.linkname = "/etc/passwd"
                    if kind == "alias":
                        member.name = "backend/alembic/../alembic/env.py"
                    archive.addfile(member)
                    if kind == "duplicate":
                        archive.addfile(member)
                with self.assertRaisesRegex(ValueError, "重复|普通文件|路径别名"):
                    archive_migrations(path)

    def test_prior_artifact_cannot_be_retagged_as_forward_fix(self):
        self.deploying()
        state = owner.read_state(self.live)
        state["previous_candidate"] = {**self.fixed, "release_id": "earlier"}
        owner.atomic_write_state(self.live, state)
        self.assert_rejected("旧候选或已失败镜像")

    def test_database_probe_rejects_wrong_head_and_integrity_failure(self):
        runtime = self.root / "runtime.env"
        runtime.write_text("fixture")
        self.boundary.stop()
        with patch.object(
            owner, "validate_recovery_boundary", return_value=str(runtime)
        ):
            with patch.object(owner, "verify_candidate_images"):
                with patch.object(
                    owner.subprocess,
                    "run",
                    side_effect=[
                        subprocess.CompletedProcess([], 0),
                        subprocess.CompletedProcess([], 0, '["wrong_head"]'),
                    ],
                ):
                    with self.assertRaisesRegex(owner.DataStateError, "schema head"):
                        owner.verify_recovery_database(self.fixed)
                with patch.object(
                    owner.subprocess,
                    "run",
                    side_effect=subprocess.CalledProcessError(1, []),
                ):
                    with self.assertRaises(subprocess.CalledProcessError):
                        owner.verify_recovery_database(self.fixed)
        self.boundary.start()

    def test_production_browser_boundary_failure_does_not_rebind(self):
        self.deploying()
        before = owner.read_state(self.live)
        with patch.object(
            owner,
            "validate_recovery_boundary",
            side_effect=subprocess.CalledProcessError(1, []),
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                self.recover()
        self.assertEqual(owner.read_state(self.live), before)

    def test_image_migration_mismatch_preserves_failed_candidate(self):
        self.deploying()
        before = owner.read_state(self.live)
        self.image_probe.stop()
        try:
            def probe(command, **kwargs):
                expected = hashlib.sha256(json.dumps({
                    name: hashlib.sha256(data).hexdigest()
                    for name, data in self.migrations.items()
                }, sort_keys=True).encode()).hexdigest()
                actual = failure if self.failed["backend_image_id"] in command else expected
                return subprocess.CompletedProcess(command, 0, actual)
            for failure, error in (("wrong", "镜像内迁移树"), ("MIGRATION_CACHE_PREFIX_FORBIDDEN", "树外迁移编译缓存")):
                with patch.object(owner.subprocess, "run", side_effect=probe):
                    with self.assertRaisesRegex(owner.DataStateError, error):
                        self.recover()
                self.assertEqual(owner.read_state(self.live), before)
        finally:
            self.image_probe.start()


if __name__ == "__main__":
    unittest.main()
