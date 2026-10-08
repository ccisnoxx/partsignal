#!/usr/bin/env python3
"""配置移交的真实 CLI/state 合同；合成 Docker 不代表真实 AI/OSS Gate。"""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from production_migration_runtime import _fingerprint

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
spec = importlib.util.spec_from_file_location(
    "ai_handoff_test_owner", SCRIPTS / "prepare-production-data.py"
)
assert spec is not None and spec.loader is not None
owner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = owner
spec.loader.exec_module(owner)


class AIHandoffTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="partsignal-ai-handoff-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.live = self.root / "data"
        self.quarantine = self.root / "quarantine"
        self.run_id = "prr_20261007_120000"
        self.live.mkdir()
        (self.quarantine / self.run_id).mkdir(parents=True)
        for leaf in owner.LEAVES:
            (self.live / leaf).mkdir()
        self.release = "production-20261007-120000-0123456789ab"
        self.manifest = self.root / "manifest.json"
        self.payload = {
            "release_id": self.release,
            "commit": "e" * 40,
            "schema_head": "0066_geo_manual_evaluation",
            "migration_runtime": _fingerprint("a" * 64, "b" * 64),
            "images": {
                role: {
                    "reference": f"partsignal-{name}:{self.release}",
                    "image_id": "sha256:" + digit * 64,
                    "repo_digests": [f"example/{role}@sha256:" + digit * 64],
                }
                for role, name, digit in (
                    ("backend", "backend", "a"),
                    ("migration", "backend", "a"),
                    ("frontend", "frontend-v2", "b"),
                    ("rollback_frontend", "frontend-v2", "c"),
                )
            },
            "tracked_files": {
                name: owner.file_sha256(ROOT / name)
                for name in sorted(owner.REQUIRED_TRACKED_FILES)
            },
        }
        self.payload["images"]["migration"] = dict(self.payload["images"]["backend"])
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.log = self.root / "docker.jsonl"
        self.runtime = self.root / "runtime.env"
        allowed = {
            line.partition("=")[0]
            for line in (ROOT / ".env.production.example").read_text().splitlines()
            if line and not line.startswith("#") and "=" in line
        }
        self.runtime.write_text("\n".join(
            line.replace("APP_ENV=development", "APP_ENV=production")
            for line in (ROOT / ".env.example").read_text().splitlines()
            if "=" in line and line.partition("=")[0] in allowed
        ) + "\n")
        self.runtime.chmod(0o600)
        docker = self.bin / "docker"
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
with Path(os.environ['COMMAND_LOG']).open('a') as output:
    output.write(json.dumps(args) + '\\n')
if args[0] == 'ps':
    print('d' * 64)
elif args[0] == 'inspect':
    values = ['d' * 64, 'sha256:' + 'a' * 64, 'running', 'true',
              'partsignal-staging', 'api', '[]']
    changes = json.loads(os.environ.get('HANDOFF_TEST_API_CHANGES', '{}'))
    for position, value in changes.items(): values[int(position)] = value
    print('|'.join(values))
elif args[:2] == ['image', 'inspect']:
    manifest = json.loads(Path(os.environ['PARTSIGNAL_RELEASE_MANIFEST']).read_text())
    image = next(value for value in manifest['images'].values()
                 if value.get('reference') == args[2])
    print(json.dumps([{'Id': image['image_id'], 'RepoDigests': image['repo_digests']}]))
elif args[0] == 'exec':
    assert args[1:4] == ['d' * 64, 'python', '-c'], args
    compile(args[4], '<ai-empty-probe>', 'exec')
    assert 'SET TRANSACTION READ ONLY' in args[4]
    assert all(table in args[4] for table in ('ai_channels', 'ai_models', 'ai_channel_headers'))
    print(os.environ.get('HANDOFF_TEST_AI_CONFIGURATION', 'EMPTY'))
    print('private-database-error-must-not-leak', file=sys.stderr)
    raise SystemExit(int(os.environ.get('HANDOFF_TEST_PROBE_EXIT', '0')))
else:
    assert args[0] == 'compose', args
    assert os.environ['COMPOSE_PROJECT_NAME'] == 'partsignal-staging'
    if 'up' in args:
        assert args[-2:] == ['worker', 'scheduler'], args
''')
        docker.chmod(0o700)
        curl = self.bin / "curl"
        curl.write_text("#!/bin/sh\nexit 0\n")
        curl.chmod(0o700)
        self.env = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "COMMAND_LOG": str(self.log),
            "PARTSIGNAL_ALLOW_NONSTANDARD_DATA_ROOT_FOR_TESTS": "1",
            "PARTSIGNAL_DATA_ROOT": str(self.live),
            "PARTSIGNAL_QUARANTINE_ROOT": str(self.quarantine),
            "PARTSIGNAL_MAINTENANCE_LOCK_FILE": str(self.root / "maintenance.lock"),
            "PARTSIGNAL_VERSION": self.release,
            "PARTSIGNAL_BACKEND_IMAGE": "partsignal-backend",
            "PARTSIGNAL_FRONTEND_IMAGE": "partsignal-frontend-v2",
            "PARTSIGNAL_RELEASE_MANIFEST": str(self.manifest),
            "PARTSIGNAL_CUTOVER_RUN_ID": self.run_id,
            "PARTSIGNAL_DEPLOY_MODE": "clean-init",
            "PARTSIGNAL_IMAGE_DELIVERY_MODE": "local",
            "PARTSIGNAL_EXTERNAL_SERVICES_GATE": "OSS_MET_AI_PENDING",
            "ENV_FILE": str(self.runtime),
            "COMPOSE_FILE": str(ROOT / "deploy/compose.prod.yaml"),
        }
        self.write_prepared()

    def write_prepared(self, *, fresh=False):
        if fresh:
            self.payload["recovery_strategy"] = "fresh-rebuild"
            self.payload["images"]["rollback_frontend"] = {"status": "NOT_APPLICABLE"}
            self.env["PARTSIGNAL_DEPLOY_MODE"] = "fresh-init"
        self.manifest.write_text(json.dumps(self.payload, sort_keys=True))
        candidate = {
            "manifest_sha256": owner.file_sha256(self.manifest),
            **{key: self.payload[key] for key in (
                "release_id", "commit", "schema_head", "migration_runtime"
            )},
        }
        for role, image in self.payload["images"].items():
            if "reference" in image:
                candidate.update({f"{role}_{key}": value for key, value in image.items()})
        if fresh:
            candidate["recovery_strategy"] = "fresh-rebuild"
        state = {
            "schema_version": 1, "phase": "PRODUCTION_PREPARED",
            "run_id": self.run_id, "data_root": str(self.live),
            "candidate": candidate,
        }
        if fresh:
            state["fresh_reset"] = {
                "root": {"device": self.live.stat().st_dev, "inode": self.live.stat().st_ino},
                "leaves": {
                    leaf: {
                        "status": "EMPTY",
                        "identity": {
                            "device": (self.live / leaf).stat().st_dev,
                            "inode": (self.live / leaf).stat().st_ino,
                        },
                    } for leaf in owner.LEAVES
                },
            }
        else:
            state.update({
                "quarantine_target": str(self.quarantine / self.run_id),
                "device": self.live.stat().st_dev,
            })
        self.write_state(state)

    @property
    def state_path(self):
        return self.live / owner.STATE_FILE_NAME

    def read_state(self):
        return json.loads(self.state_path.read_text())

    def write_state(self, state):
        self.state_path.write_text(json.dumps(state, sort_keys=True))

    def command(self, name, *, run_id=None):
        args = [sys.executable, str(SCRIPTS / "prepare-production-data.py"), name]
        if name in {"defer-ai-configuration", "verify-prepared", "mark-initialized"}:
            args.append(self.run_id if run_id is None else run_id)
        return [*args, str(self.manifest)]

    def run_command(self, command, **changes):
        return subprocess.run(command, env={**self.env, **changes}, capture_output=True,
                              check=False, timeout=10)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def assert_rejected(self, command, message, **changes):
        original = self.state_path.read_bytes()
        self.log.unlink(missing_ok=True)
        result = self.run_command(command, **changes)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn(message.encode(), result.stderr)
        self.assertNotIn(b"private-database-error-must-not-leak", result.stdout + result.stderr)
        self.assertEqual(self.state_path.read_bytes(), original)
        self.assertFalse(any("up" in call for call in self.calls()), self.calls())
        return self.calls()

    def handoff(self):
        result = self.run_command(self.command("defer-ai-configuration"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("真实 AI Gate 尚未通过".encode(), result.stdout)

    def test_clean_and_fresh_handoff_activate_without_bootstrap_or_secret(self):
        for fresh in (False, True):
            with self.subTest(fresh=fresh):
                self.write_prepared(fresh=fresh)
                self.handoff()
                state = self.read_state()
                self.assertEqual(state["ai_configuration_handoff"], {
                    "mode": "admin-ui", "run_id": self.run_id,
                    "manifest_sha256": owner.file_sha256(self.manifest),
                })
                self.assertNotIn("ai_bootstrap_attempt", state)
                result = self.run_command([str(SCRIPTS / "activate-production.sh")])
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn("真实 AI Gate 尚未通过".encode(), result.stdout)
                self.assertEqual(self.read_state()["phase"], "PRODUCTION_INITIALIZED")
                self.assertNotIn("ai_bootstrap_attempt", self.read_state())
                up = [call for call in self.calls() if "up" in call]
                self.assertTrue(up)
                self.assertIn("--pull", up[-1])
                self.assertEqual(up[-1][-2:], ["worker", "scheduler"])
                self.assertFalse(any(".Config.Env" in " ".join(call) for call in self.calls()))
                self.assertNotIn("private-database-error-must-not-leak", json.dumps(self.read_state()))

    def test_no_handoff_and_unconfirmed_oss_cannot_activate(self):
        activate = [str(SCRIPTS / "activate-production.sh")]
        self.assert_rejected(activate, "尚未显式移交管理界面 AI 初始化")
        self.handoff()
        for gate, message in (
            ("NOT_MET", "OSS Gate 未确认"),
            ("AI_PENDING", "OSS Gate 未确认"),
            ("MET", "不能声明真实 AI Gate MET"),
        ):
            with self.subTest(gate=gate):
                self.assert_rejected(activate, message, PARTSIGNAL_EXTERNAL_SERVICES_GATE=gate)

    def test_any_attempt_including_partial_or_malformed_cannot_handoff(self):
        for attempt in (
            None, [], {},
            {"request_id": "invalid", "status": "SUCCEEDED"},
            *({"request_id": "production-bootstrap-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
               "status": status} for status in ("STARTED", "FAILED", "SUCCEEDED")),
        ):
            with self.subTest(attempt=attempt):
                self.write_prepared()
                state = self.read_state()
                state["ai_bootstrap_attempt"] = attempt
                self.write_state(state)
                message = "attempt 已存在" if isinstance(attempt, dict) and attempt.get("status") in {
                    "STARTED", "FAILED", "SUCCEEDED"
                } and attempt.get("request_id", "").startswith("production-bootstrap-") else "attempt 状态无效"
                self.assertEqual(self.assert_rejected(self.command("defer-ai-configuration"), message), [])

    def test_nonempty_or_unknown_probe_cannot_handoff(self):
        for changes, message in (
            ({"HANDOFF_TEST_AI_CONFIGURATION": "PRESENT"}, "配置非空"),
            ({"HANDOFF_TEST_AI_CONFIGURATION": "unexpected"}, "结果无法确认"),
            ({"HANDOFF_TEST_PROBE_EXIT": "1"}, "结果无法确认"),
        ):
            with self.subTest(changes=changes):
                self.assert_rejected(self.command("defer-ai-configuration"), message, **changes)

    def test_run_candidate_and_phase_must_match_before_probe(self):
        self.assertEqual(self.assert_rejected(
            self.command("defer-ai-configuration", run_id="prr_20261007_120001"),
            "run ID 或隔离目标与状态文件不一致",
        ), [])
        for update, message in (
            ({"candidate": {}}, "当前候选与 Production 数据状态绑定的候选不一致"),
            ({"phase": "UPGRADE_PREPARED"}, "当前数据阶段不允许该操作"),
        ):
            self.write_prepared()
            state = self.read_state()
            state.update(update)
            self.write_state(state)
            self.assertEqual(self.assert_rejected(self.command("defer-ai-configuration"), message), [])

    def test_api_identity_rejected_on_handoff_and_activation(self):
        for changes, message in (
            ({"1": "sha256:" + "f" * 64}, "镜像不是当前 candidate backend"),
            ({"4": "wrong-project"}, "Compose label 不匹配"),
            ({"5": "worker"}, "Compose label 不匹配"),
            ({"2": "exited", "3": "false"}, "不是 running 状态"),
            ({"6": json.dumps([{"Type": "bind", "Destination": "/app/app"}])}, "覆盖应用代码"),
        ):
            with self.subTest(changes=changes):
                self.write_prepared()
                env = {"HANDOFF_TEST_API_CHANGES": json.dumps(changes)}
                calls = self.assert_rejected(self.command("defer-ai-configuration"), message, **env)
                self.assertFalse(any(call[0] == "exec" for call in calls))
                self.handoff()
                self.assert_rejected([str(SCRIPTS / "activate-production.sh")], message, **env)

    def test_malformed_conflicting_or_other_candidate_handoff_rejected(self):
        self.handoff()
        prepared = self.read_state()
        for handoff, message in (
            (None, "配置移交状态无效"),
            ({}, "配置移交状态无效"),
            ({**prepared["ai_configuration_handoff"], "extra": True}, "配置移交状态无效"),
            ({**prepared["ai_configuration_handoff"], "run_id": "prr_20261007_120001"}, "配置移交状态无效"),
            ({**prepared["ai_configuration_handoff"], "manifest_sha256": "f" * 64}, "配置移交与当前候选不一致"),
        ):
            with self.subTest(handoff=handoff):
                self.write_state({**prepared, "ai_configuration_handoff": handoff})
                self.assert_rejected([str(SCRIPTS / "activate-production.sh")], message)
        for status in ("STARTED", "FAILED", "SUCCEEDED"):
            self.write_state({**prepared, "ai_bootstrap_attempt": {
                "request_id": "production-bootstrap-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "status": status,
            }})
            self.assert_rejected(self.command("mark-initialized"), "bootstrap 与配置移交状态冲突")

    def test_existing_handoff_cannot_reenter_or_start_bootstrap(self):
        self.handoff()
        self.assertEqual(self.assert_rejected(self.command("defer-ai-configuration"), "配置移交已存在"), [])
        bootstrap = [sys.executable, str(SCRIPTS / "prepare-production-data.py"),
                     "bootstrap-ai", self.run_id, str(self.manifest),
                     "--channel-name", "test", "--channel-description", "test",
                     "--protocol-type", "openai-compatible-chat-completions",
                     "--provider-brand", "CUSTOM", "--base-url", "https://provider.example/v1",
                     "--timeout-seconds", "30", "--model-display-name", "test",
                     "--model-id", "test", "--request-parameters-json", "{}"]
        self.assertEqual(self.assert_rejected(bootstrap, "已移交管理界面，拒绝 bootstrap"), [])

    def test_upgrade_cannot_consume_oss_only_gate(self):
        self.handoff()
        state = self.read_state()
        state["phase"] = "UPGRADE_PREPARED"
        self.write_state(state)
        for command in (
            [str(SCRIPTS / "activate-production.sh")],
            self.command("verify-upgrade-prepared"),
            self.command("mark-upgrade-initialized"),
        ):
            with self.subTest(command=command):
                self.assertEqual(self.assert_rejected(
                    command, "upgrade 必须通过真实 AI/OSS Gate MET",
                    PARTSIGNAL_DEPLOY_MODE="upgrade",
                ), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
