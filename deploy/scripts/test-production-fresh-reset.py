#!/usr/bin/env python3
"""真实临时目录和公开脚本合同；合成 Docker 不代表生产 AI/OSS Gate。"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from production_migration_runtime import _fingerprint

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))


def load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


owner = load("fresh_reset_test_owner", SCRIPTS / "prepare-production-data.py")
producer = load("fresh_reset_test_producer", SCRIPTS / "create-release-manifest.py")


class FreshResetTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(
            prefix="partsignal-fresh-reset-test-"
        )
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.live = self.root / "live"
        for leaf in owner.LEAVES:
            (self.live / leaf / "nested").mkdir(parents=True)
            (self.live / leaf / "nested/old-data").write_text("将被丢弃的旧数据")
        self.repository = self.root / "repository"
        for name in owner.REQUIRED_TRACKED_FILES:
            path = self.repository / name
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(owner.REPOSITORY_ROOT / name, path)
        shutil.copy2(
            owner.REPOSITORY_ROOT / ".env.production.example",
            self.repository / ".env.production.example",
        )
        self.runtime = self.root / "runtime.env"
        self.runtime.write_text("APP_ENV=production\n")
        self.runtime.chmod(0o600)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "docker.jsonl"
        self.images = self.root / "images.json"
        docker = self.bin / "docker"
        docker.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with open(os.environ['COMMAND_LOG'], 'a') as output: output.write(json.dumps(args)+'\\n')
root = Path(os.environ['PARTSIGNAL_DATA_ROOT'])
if args[:2] == ['image', 'inspect']:
    images = json.loads(Path(os.environ['FRESH_TEST_IMAGES']).read_text())
    if args[2] not in images: sys.exit(1)
    print(json.dumps([images[args[2]]]))
elif args[0] == 'ps':
    if 'label=com.docker.compose.service=api' in args:
        print('b'*64)
    else:
        print(os.environ.get('DOCKER_PROJECT_IDS' if '--filter' in args else 'DOCKER_RUNNING_IDS', ''))
elif args[0] == 'inspect':
    if '--format' in args:
        print('|'.join(('b'*64, 'sha256:'+'a'*64, 'running', 'true', 'partsignal-staging', 'api', '[]')))
    else: print(os.environ.get('DOCKER_INSPECT_JSON', '[]'))
elif args[0] == 'exec':
    envelope = json.loads(sys.stdin.buffer.read())
    print(json.dumps({'status':'SUCCEEDED', 'request_id':envelope['request_id'],
          'channel_id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'channel_revision':1,
          'channel_enabled':True, 'channel_configured':True,
          'model_id':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'model_revision':1,
          'model_test_status':'PASSED', 'model_enabled':True, 'model_configured':True}))
elif args[0] == 'compose' and any(action in args for action in ('run','up')):
    state = json.loads((root/'.partsignal-production-cutover.json').read_text())
    assert state['phase'] in ('FRESH_INIT_DEPLOYING', 'PRODUCTION_PREPARED')
else:
    assert args[0] == 'compose', args
""")
        docker.chmod(0o700)
        (self.bin / "curl").write_text("#!/bin/sh\nexit 0\n")
        (self.bin / "curl").chmod(0o700)
        self.manifest = self.root / "fresh.json"
        self.payload = {
            "release_id": "fresh-test-release",
            "commit": "e" * 40,
            "schema_head": "0066_geo_manual_evaluation",
            "migration_runtime": _fingerprint("a" * 64, "b" * 64),
            "recovery_strategy": "fresh-rebuild",
            "images": {
                role: {
                    "reference": f"test/{role}:fresh-test-release",
                    "image_id": "sha256:" + ("c" if role == "frontend" else "a") * 64,
                    "repo_digests": [f"test/{role}@sha256:" + "d" * 64],
                }
                for role in ("backend", "migration", "frontend")
            },
            "tracked_files": {
                name: owner.file_sha256(self.repository / name)
                for name in owner.REQUIRED_TRACKED_FILES
            },
        }
        self.payload["images"]["rollback_frontend"] = {"status": "NOT_APPLICABLE"}
        self.write_manifest()
        self.images.write_text(
            json.dumps(
                {
                    image["reference"]: {
                        "Id": image["image_id"],
                        "RepoDigests": image["repo_digests"],
                    }
                    for role, image in self.payload["images"].items()
                    if role != "rollback_frontend"
                }
            )
        )
        environment = {
            "PARTSIGNAL_DATA_ROOT": str(self.live),
            "PARTSIGNAL_MAINTENANCE_LOCK_FILE": str(self.root / "lock"),
            "PARTSIGNAL_QUARANTINE_ROOT": str(self.root / "quarantine"),
            "PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS": "1",
            "PARTSIGNAL_VERSION": self.payload["release_id"],
            "PARTSIGNAL_BACKEND_IMAGE": "test/backend",
            "PARTSIGNAL_FRONTEND_IMAGE": "test/frontend",
            "PARTSIGNAL_MIGRATION_IMAGE": self.payload["images"]["migration"][
                "reference"
            ],
            "PARTSIGNAL_RUNTIME_ENV_FILE": str(self.runtime),
            "ENV_FILE": str(self.runtime),
            "PARTSIGNAL_RELEASE_MANIFEST": str(self.manifest),
            "PARTSIGNAL_CUTOVER_RUN_ID": "prr_20261007_120000",
            "PARTSIGNAL_DEPLOY_MODE": "fresh-init",
            "PARTSIGNAL_IMAGE_DELIVERY_MODE": "local",
            "COMMAND_LOG": str(self.log),
            "FRESH_TEST_IMAGES": str(self.images),
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
        }
        self.env = patch.dict(os.environ, environment)
        self.env.start()
        self.addCleanup(self.env.stop)
        for name, value in (
            ("REPOSITORY_ROOT", self.repository),
            ("STANDARD_DATA_ROOT", self.live),
            ("STANDARD_LOCK_FILE", self.root / "lock"),
        ):
            context = patch.object(owner, name, value)
            context.start()
            self.addCleanup(context.stop)
        self.candidate = owner.candidate_from_manifest(str(self.manifest))

    def write_manifest(self):
        self.manifest.write_text(json.dumps(self.payload))

    def reset(self, *, run_id="prr_20261007_120000", discard=True):
        arguments = [
            "prepare-production-data.py",
            "reset-data",
            run_id,
            str(self.manifest),
        ]
        if discard:
            arguments.append("--discard-existing-data")
        with patch.object(sys, "argv", arguments):
            with self.assertRaises(SystemExit) as result:
                owner.main()
        return result.exception.code

    def calls(self):
        return (
            [json.loads(line) for line in self.log.read_text().splitlines()]
            if self.log.exists()
            else []
        )

    def state(self):
        return owner.read_state(self.live)

    def assert_old_data(self):
        self.assertTrue((self.live / "postgres/nested/old-data").is_file())
        self.assertFalse((self.live / owner.STATE_FILE_NAME).exists())

    def test_fixed_scope_real_deletion_and_symlink_not_followed(self):
        outside = self.root / "outside"
        outside.mkdir()
        (outside / "sentinel").write_text("保留")
        (self.live / "postgres/link").symlink_to(outside, target_is_directory=True)
        (self.live / "protected.env").write_text("保留受保护配置")
        (self.live / "unrelated").mkdir()
        before = {
            leaf: owner.fresh_reset.identity((self.live / leaf).stat())
            for leaf in owner.LEAVES
        }
        self.assertEqual(self.reset(), 0)
        self.assertEqual(self.state()["phase"], "RESET_READY")
        for leaf in owner.LEAVES:
            self.assertEqual(list((self.live / leaf).iterdir()), [])
            self.assertEqual(
                owner.fresh_reset.identity((self.live / leaf).stat()), before[leaf]
            )
        self.assertEqual((outside / "sentinel").read_text(), "保留")
        self.assertEqual((self.live / "protected.env").read_text(), "保留受保护配置")
        self.assertTrue((self.live / "unrelated").is_dir())
        self.assertFalse((self.root / "quarantine").exists())
        self.assertEqual(self.reset(), 0)

    def test_permission_root_and_project_fail_before_deletion(self):
        self.assertEqual(self.reset(discard=False), 2)
        self.assertEqual(self.calls(), [])
        with patch.dict(os.environ, {"PARTSIGNAL_DATA_ROOT": str(self.root)}):
            self.assertEqual(self.reset(), 2)
        with patch.dict(os.environ, {"PARTSIGNAL_COMPOSE_PROJECT": "unrelated"}):
            self.assertEqual(self.reset(), 2)
        self.assert_old_data()

    def test_missing_or_drifted_image_does_not_write_state(self):
        self.images.write_text("{}")
        self.assertEqual(self.reset(), 1)
        self.assert_old_data()
        image = self.payload["images"]["backend"]
        self.images.write_text(
            json.dumps(
                {
                    image["reference"]: {
                        "Id": "sha256:" + "f" * 64,
                        "RepoDigests": image["repo_digests"],
                    }
                }
            )
        )
        self.assertEqual(self.reset(), 2)
        self.assert_old_data()

    def test_running_project_and_overlapping_mount_rejected(self):
        with patch.dict(os.environ, {"DOCKER_PROJECT_IDS": "old-api"}):
            self.assertEqual(self.reset(), 2)
        payload = json.dumps(
            [{"Mounts": [{"Source": str(self.live / "postgres/nested")}]}]
        )
        with patch.dict(
            os.environ, {"DOCKER_RUNNING_IDS": "backup", "DOCKER_INSPECT_JSON": payload}
        ):
            self.assertEqual(self.reset(), 2)
        self.assert_old_data()

    def test_canonical_symlink_and_nested_mount_rejected(self):
        leaf = self.live / "objects"
        moved = self.root / "moved-objects"
        leaf.rename(moved)
        leaf.symlink_to(moved, target_is_directory=True)
        self.assertEqual(self.reset(), 2)
        leaf.unlink()
        moved.rename(leaf)
        with patch.object(
            owner.fresh_reset, "mount_points", return_value={self.live / "redis/nested"}
        ):
            self.assertEqual(self.reset(), 2)
        self.assert_old_data()

    def partial_reset(self):
        unlink = os.unlink
        deleted = False

        def interrupt(path, *, dir_fd=None):
            nonlocal deleted
            result = unlink(path, dir_fd=dir_fd)
            if dir_fd is not None and not deleted:
                deleted = True
                raise OSError("实际删除一个目录项后的 I/O 中断")
            return result

        with patch.object(os, "unlink", interrupt):
            self.assertEqual(self.reset(), 2)
        self.assertEqual(self.state()["phase"], "RESETTING")
        self.assertFalse((self.live / "postgres/nested/old-data").exists())
        self.assertTrue((self.live / "redis/nested/old-data").exists())

    def test_partial_deletion_resumes_only_same_run_candidate(self):
        self.partial_reset()
        self.assertEqual(self.reset(run_id="prr_20261007_130000"), 2)
        self.payload["commit"] = "f" * 40
        self.write_manifest()
        self.assertEqual(self.reset(), 2)
        self.assertTrue((self.live / "redis/nested/old-data").exists())
        self.payload["commit"] = "e" * 40
        self.write_manifest()
        self.assertEqual(self.reset(), 0)
        self.assertEqual(self.state()["phase"], "RESET_READY")

    def test_replaced_directory_and_reintroduced_content_rejected(self):
        self.partial_reset()
        (self.live / "redis").rename(self.root / "old-redis")
        (self.live / "redis").mkdir()
        (self.live / "redis/sentinel").write_text("新目录不能被清空")
        self.assertEqual(self.reset(), 2)
        self.assertTrue((self.live / "redis/sentinel").exists())

    def test_completed_reset_never_clears_new_content(self):
        self.assertEqual(self.reset(), 0)
        (self.live / "objects/new").write_text("新写入")
        self.assertEqual(self.reset(), 2)
        self.assertTrue((self.live / "objects/new").exists())

    def test_signal_after_real_deletion_holds_resetting_for_resume(self):
        unlink = os.unlink

        def signal_after_delete(path, *, dir_fd=None):
            result = unlink(path, dir_fd=dir_fd)
            if dir_fd is not None:
                os.kill(os.getppid(), signal.SIGTERM)
                time.sleep(0.2)
            return result

        with patch.object(os, "unlink", signal_after_delete):
            self.assertEqual(self.reset(), 143)
        self.assertEqual(self.state()["phase"], "RESETTING")
        self.assertFalse((self.live / "postgres/nested/old-data").exists())
        self.assertTrue((self.live / "redis/nested/old-data").exists())
        self.assertEqual(self.reset(), 0)

    def run_script(self, name):
        return subprocess.run(
            [str(self.repository / "deploy/scripts" / name)],
            capture_output=True,
            text=True,
        )

    def test_fresh_deploy_rechecks_images_before_start(self):
        self.assertEqual(self.reset(), 0)
        self.images.write_text("{}")
        result = self.run_script("deploy.sh")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(self.state()["phase"], "RESET_READY")
        self.assertFalse(
            any(
                args[0] == "compose" and any(action in args for action in ("run", "up"))
                for args in self.calls()
            )
        )

    def test_public_deploy_bootstrap_activate_and_rollback_boundary(self):
        self.assertEqual(self.reset(), 0)
        result = self.run_script("deploy.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()["phase"], "PRODUCTION_PREPARED")
        calls = self.calls()
        self.assertFalse(any(args[0] == "compose" and "pull" in args for args in calls))
        for args in calls:
            if args[0] == "compose" and any(action in args for action in ("run", "up")):
                self.assertIn("never", args)
        with patch.dict(os.environ, {"PARTSIGNAL_EXTERNAL_SERVICES_GATE": "MET"}):
            blocked = self.run_script("activate-production.sh")
        self.assertEqual(blocked.returncode, 2)
        self.assertEqual(self.state()["phase"], "PRODUCTION_PREPARED")
        args = SimpleNamespace(
            run_id="prr_20261007_120000",
            manifest=str(self.manifest),
            request_parameters_json="{}",
            channel_name="测试",
            channel_description="合成测试",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url="https://example.com/v1",
            timeout_seconds=60,
            model_display_name="测试",
            model_id="test-model",
        )
        tty = SimpleNamespace(isatty=lambda: True)
        with owner.maintenance_lock():
            owner.bootstrap_ai(
                args,
                credential_reader=lambda _: "synthetic-test-credential",
                stdin=tty,
                stderr=tty,
            )
        with patch.dict(os.environ, {"PARTSIGNAL_EXTERNAL_SERVICES_GATE": "MET"}):
            result = self.run_script("activate-production.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()["phase"], "PRODUCTION_INITIALIZED")
        compose_before = [args for args in self.calls() if args[0] == "compose"]
        rollback = self.run_script("rollback-production-frontend.sh")
        self.assertEqual(rollback.returncode, 2)
        self.assertIn("NOT_APPLICABLE", rollback.stderr)
        self.assertEqual(
            [args for args in self.calls() if args[0] == "compose"], compose_before
        )
        self.assertNotIn("synthetic-test-credential", self.log.read_text())
        self.assertNotIn(
            "synthetic-test-credential", (self.live / owner.STATE_FILE_NAME).read_text()
        )

    def test_manifest_fresh_marker_and_legacy_strategy_contract(self):
        self.payload["images"]["rollback_frontend"] = self.payload["images"]["frontend"]
        self.write_manifest()
        with self.assertRaisesRegex(owner.DataStateError, "NOT_APPLICABLE"):
            owner.candidate_from_manifest(str(self.manifest))
        del self.payload["recovery_strategy"]
        self.write_manifest()
        previous = owner.candidate_from_manifest(str(self.manifest))
        self.assertNotIn("recovery_strategy", previous)
        with self.assertRaisesRegex(owner.DataStateError, "fresh-rebuild"):
            owner.fresh_reset.require_fresh_candidate(owner, previous)
        with self.assertRaisesRegex(owner.DataStateError, "fresh-init"):
            owner.begin_clean_init("prr_20261007_120000", self.candidate)
        with self.assertRaisesRegex(owner.DataStateError, "fresh-init"):
            owner.upgrade_entry_state(self.candidate)

    def test_producer_fresh_release_without_previous_image(self):
        archive = self.root / "source.tar.gz"
        archive.write_bytes(b"producer fixture")
        output = self.root / "produced.json"
        arguments = [
            "create-release-manifest.py",
            "--release-id",
            self.payload["release_id"],
            "--commit",
            "e" * 40,
            "--source-archive",
            str(archive),
            "--backend-image",
            self.payload["images"]["backend"]["reference"],
            "--migration-image",
            self.payload["images"]["migration"]["reference"],
            "--frontend-image",
            self.payload["images"]["frontend"]["reference"],
            "--recovery-strategy",
            "fresh-rebuild",
            "--schema-head",
            self.payload["schema_head"],
            "--output",
            str(output),
        ]
        for name in sorted(producer.REQUIRED_TRACKED_FILES):
            arguments.extend(["--tracked-file", str(self.repository / name)])
        fingerprint = self.payload["migration_runtime"]
        with (
            patch.object(sys, "argv", arguments),
            patch.object(producer, "REPOSITORY_ROOT", self.repository),
            patch.object(producer, "verify_release_source"),
            patch.object(
                producer, "image_runtime_fingerprint", return_value=fingerprint
            ),
            patch.object(
                producer, "source_digest", return_value=fingerprint["source_sha256"]
            ),
        ):
            producer.main()
        payload = json.loads(output.read_text())
        self.assertEqual(payload["recovery_strategy"], "fresh-rebuild")
        self.assertEqual(
            payload["images"]["rollback_frontend"], {"status": "NOT_APPLICABLE"}
        )
        self.assertEqual(set(payload["tracked_files"]), owner.REQUIRED_TRACKED_FILES)
        self.assertEqual(
            owner.candidate_from_manifest(str(output))["recovery_strategy"],
            "fresh-rebuild",
        )
        with patch.object(
            sys,
            "argv",
            [*arguments, "--rollback-frontend-image", "test/frontend:previous"],
        ):
            with self.assertRaisesRegex(ValueError, "不允许声明"):
                producer.main()


if __name__ == "__main__":
    unittest.main()
