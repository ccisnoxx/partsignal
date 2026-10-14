#!/usr/bin/env python3
"""真实 CLI/state + 隔离 Docker 合同与 HTTP 响应；不代表现场发布或真实外部 Gate。"""

from __future__ import annotations

import base64
import importlib.util
import io
import json
import os
import signal
import subprocess
import tarfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from production_migration_runtime import _export_fingerprint, _image_configuration, source_digest

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parents[1]
spec = importlib.util.spec_from_file_location("routine_fixture", SCRIPTS / "test-production-ai-handoff.py")
fixture = importlib.util.module_from_spec(spec)
assert spec is not None and spec.loader is not None
spec.loader.exec_module(fixture)
owner = fixture.owner


class HTTPFixture(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def do_GET(self):
        scenario = self.server.scenario
        cookie = self.headers.get("Cookie")
        scenario.setdefault("requests", []).append((self.path, bool(cookie)))
        status, content_type = 200, "application/json"
        if self.path == "/":
            if "guard_started" in scenario:
                scenario["guard_started"].set()
                scenario["guard_release"].wait(5)
            status, content_type = scenario.get("maintenance_status", 503), "text/plain"
            payload = scenario.get("maintenance_body", b"PartSignal maintenance\n")
        elif self.path == "/login":
            content_type = "text/html"
            payload = scenario.get("login", b'<html><title>PartSignal</title><div id="root"></div><script type="module" src="/assets/app.js"></script></html>')
        elif self.path.endswith("/live"):
            payload = scenario.get("live", {"status": "ok"})
        elif self.path.endswith("/ready"):
            payload = scenario.get("ready", {"status": "ok", "checks": {"postgresql": "ok", "redis": "ok"}})
        elif self.path.startswith("/api/v1/users"):
            if cookie:
                payload = {"items": [], "page": 1, "page_size": 1, "total": 0}
            else:
                status = scenario.get("anonymous_status", 401)
                payload = scenario.get("anonymous", {"error": {"code": "AUTH_REQUIRED"}})
        else:
            status, payload = 404, {}
        if not isinstance(payload, bytes):
            payload = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        if self.path == "/":
            self.send_header("Cache-Control", "no-store")
            self.send_header("Retry-After", "3600")
        self.end_headers()
        self.wfile.write(payload)


DOCKER = '''#!/usr/bin/env python3
import json, os, shutil, sys, time
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ['ROUTINE_ROOT'])
with Path(os.environ['COMMAND_LOG']).open('a') as output: output.write(json.dumps(args) + '\\n')
manifest = json.loads(Path(os.environ['PARTSIGNAL_RELEASE_MANIFEST']).read_text())
active = json.loads(Path((root / 'active').read_text()).read_text())
ids = {'api': 'd'*64, 'frontend': 'e'*64, 'worker': 'f'*64, 'scheduler': 'a'*64}
if args[:2] == ['image', 'inspect']:
    image = next((value for value in manifest['images'].values()
                  if value.get('reference') == args[2] or value.get('image_id') == args[2]), None)
    if image is None: raise SystemExit(1)
    value = {'Id': image['image_id'], 'RepoDigests': image['repo_digests'],
             'Config': {'Env': [], 'WorkingDir': '/app', 'Entrypoint': None},
             'Os': 'linux', 'Architecture': 'amd64'}
    if os.environ.get('FAKE_IMAGE_DRIFT'): value['Id'] = 'sha256:' + '9'*64
    print(json.dumps([value]))
elif args[0] == 'ps':
    service = args[-1].split('=')[-1]
    if os.environ.get('FAKE_MISSING_SERVICE') != service: print(ids[service])
elif args[0] == 'inspect':
    service = next(key for key, value in ids.items() if value == args[-1])
    role = 'frontend' if service == 'frontend' else 'backend'
    image = active['images'][role]
    fields = [ids[service], image['image_id'], image['reference'], 'true',
              'partsignal-staging', service, '[{"Type":"tmpfs","Destination":"/tmp"}]', 'healthy']
    changes = json.loads(os.environ.get('FAKE_CONTAINER_CHANGES', '{}')).get(service, {})
    for index, value in changes.items(): fields[int(index)] = value
    if '{{.State.Status}}' in args[2]:
        fields = [fields[0], fields[1], 'running', fields[3], fields[4], fields[5], fields[6]]
    print('|'.join(fields))
elif args[0] == 'exec':
    if args[1] == '-i':
        document = json.load(sys.stdin)
        actual = {key: value for key, value in os.environ.items() if key not in document['keys']}
        actual.update(json.loads((root / 'active-runtime.json').read_text()))
        result = __import__('subprocess').run([sys.executable, '-c', args[5]],
            input=json.dumps(document), capture_output=True, text=True, env=actual)
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    (root / 'worker.pid').write_text(str(os.getppid()))
    assert args[2:4] == ['python', '-c'], args
    compile(args[4], '<database-probe>', 'exec')
    assert 'SET TRANSACTION READ ONLY' in args[4]
    print(json.dumps([os.environ.get('FAKE_DB_REVISION', active['schema_head'])]))
    print('private-database-response-must-not-leak', file=sys.stderr)
    raise SystemExit(int(os.environ.get('FAKE_DB_EXIT', '0')))
elif args[0] == 'create':
    token = args[args.index('--label')+1].split('=')[-1]
    (root / 'probe.json').write_text(json.dumps({'Id': 'b'*64, 'Image': args[-1],
        'State': {'Status': 'created'}, 'Mounts': [], 'HostConfig': {'NetworkMode': 'none'},
        'Config': {'Labels': {'partsignal.migration-fingerprint': token}}}))
elif args[:2] == ['container', 'inspect']:
    print('[' + (root / 'probe.json').read_text() + ']')
elif args[0] == 'export':
    shutil.copyfile(root / 'rootfs.tar', args[args.index('--output')+1])
elif args[:2] == ['container', 'rm']:
    (root / 'probe.json').unlink()
else:
    assert args[0] == 'compose', args
    if 'up' in args and os.environ.get('FAKE_HOLD_UP'):
        (root / 'up.pid').write_text(str(os.getpid()))
        while True: time.sleep(1)
    if 'migrate' in args and os.environ.get('FAKE_MIGRATION_EXIT'):
        raise SystemExit(int(os.environ['FAKE_MIGRATION_EXIT']))
    if 'up' in args and 'api' in args:
        (root / 'active').write_text(os.environ['PARTSIGNAL_RELEASE_MANIFEST'])
    if 'up' in args and os.environ.get('FAKE_UP_EXIT'):
        raise SystemExit(int(os.environ['FAKE_UP_EXIT']))
'''


class RoutineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.servers = []
        try:
            for port in (19000, 19080, 0):
                server = ThreadingHTTPServer(("127.0.0.1", port), HTTPFixture)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                cls.servers.append((server, thread))
                thread.start()
        except OSError:
            cls.tearDownClass()
            raise RuntimeError("隔离 HTTP 合同测试需要空闲的 loopback 19000/19080；未访问或接管已有服务") from None

    @classmethod
    def tearDownClass(cls):
        for server, thread in cls.servers:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)

    def setUp(self):
        self.data = fixture.AIHandoffTests("runTest")
        self.data.setUp()
        self.addCleanup(self.data.doCleanups)
        self.root, self.env = self.data.root, self.data.env
        self.runtime_values = dict(line.split('=', 1) for line in (ROOT / '.env.production.example').read_text().splitlines()
                                   if line and not line.startswith('#'))
        for index, key in enumerate(('POSTGRES_PASSWORD', 'SESSION_SECRET', 'UPLOAD_SIGNING_SECRET',
                                    'PARTSIGNAL_SEED_ADMIN_PASSWORD', 'PARTSIGNAL_SEED_ENGINEER_PASSWORD')):
            self.runtime_values[key] = chr(65 + index) * 43
        self.runtime_values.update(DATABASE_URL='postgresql+psycopg://partsignal:' + 'A'*43 + '@postgres:5432/partsignal',
            AI_CREDENTIAL_ENCRYPTION_KEY=base64.b64encode(b'F'*32).decode(), OSS_ENDPOINT='https://oss-cn-hangzhou.aliyuncs.com',
            OSS_BUCKET='test-bucket', OSS_ACCESS_KEY_ID='test-key', OSS_ACCESS_KEY_SECRET='test-secret')
        self.data.runtime.write_text(''.join(f'{key}={value}\n' for key, value in self.runtime_values.items()))
        (self.root / 'active-runtime.json').write_text(json.dumps(self.runtime_values))
        self.env.update(ROUTINE_ROOT=str(self.root))
        (self.data.bin / "docker").write_text(DOCKER)
        self.scenario = {}
        for server, _thread in self.servers:
            server.scenario = self.scenario
        self.public = f"http://127.0.0.1:{self.servers[2][0].server_port}"
        source = {
            path.relative_to(ROOT).as_posix(): path.read_bytes()
            for path in [ROOT / "backend/alembic.ini", *(ROOT / "backend/alembic").rglob("*")]
            if path.is_file() and not path.name.endswith((".pyc", ".pyo"))
        }
        self.archive = self.root / "current.tar.gz"
        self.write_tar(self.archive, source)
        rootfs = self.root / "rootfs.tar"
        self.write_tar(rootfs, {"app/" + name.removeprefix("backend/"): value for name, value in source.items()})
        fingerprint = _export_fingerprint(rootfs, _image_configuration({
            "Config": {"Env": [], "WorkingDir": "/app", "Entrypoint": None},
            "Os": "linux", "Architecture": "amd64",
        }))
        self.assertEqual(fingerprint["source_sha256"], source_digest(ROOT / "backend"))
        self.data.payload["migration_runtime"] = fingerprint
        self.data.payload["source_archive"] = {"name": self.archive.name, "sha256": owner.file_sha256(self.archive)}
        self.initialized()
        self.old_manifest = self.root / "current.json"
        self.old_manifest.write_bytes(self.data.manifest.read_bytes())
        (self.root / "active").write_text(str(self.old_manifest))

    @staticmethod
    def write_tar(path, files):
        with tarfile.open(path, "w:gz" if path.name.endswith("gz") else "w") as archive:
            for name, content in sorted(files.items()):
                member = tarfile.TarInfo(name)
                member.size = len(content)
                archive.addfile(member, io.BytesIO(content))

    def initialized(self, *, fresh=False):
        self.data.write_prepared(fresh=fresh)
        state = self.data.read_state()
        state["phase"] = "PRODUCTION_INITIALIZED"
        state["ai_configuration_handoff"] = {
            "mode": "admin-ui", "run_id": self.data.run_id,
            "manifest_sha256": state["candidate"]["manifest_sha256"],
        }
        self.data.write_state(state)

    def command(self, action, *arguments):
        return [str(SCRIPTS / "redeploy-production.sh"), action, *arguments]

    def run_cli(self, action, *arguments, **changes):
        return self.data.run_command(self.command(action, *arguments), **changes)

    def mutations(self):
        return [call for call in self.data.calls() if call[0] == "compose" and any(
            token in call for token in ("up", "run", "stop", "pull", "build")
        )]

    def rejected(self, action, message, *arguments, **changes):
        before = self.data.state_path.read_bytes()
        self.data.log.unlink(missing_ok=True)
        result = self.run_cli(action, *arguments, **changes)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertIn(message.encode(), result.stderr)
        self.assertNotIn(b"private-database-response-must-not-leak", result.stdout + result.stderr)
        self.assertEqual(self.data.state_path.read_bytes(), before)
        self.assertEqual(self.mutations(), [])
        return result

    def next_candidate(self):
        payload = json.loads(self.old_manifest.read_text())
        payload.pop("recovery_strategy", None)
        payload["images"]["rollback_frontend"] = json.loads(self.old_manifest.read_text())["images"]["frontend"]
        payload["release_id"] = "production-20261008-120000-fedcba987654"
        for role in ("backend", "frontend", "migration"):
            repository = payload["images"][role]["reference"].split(":")[0]
            payload["images"][role]["reference"] = repository + ":" + payload["release_id"]
        self.next_archive = self.root / "next.tar.gz"
        self.next_archive.write_bytes(self.archive.read_bytes())
        payload["source_archive"] = {"name": self.next_archive.name, "sha256": owner.file_sha256(self.next_archive)}
        self.data.manifest.write_text(json.dumps(payload, sort_keys=True))
        self.env.update(PARTSIGNAL_VERSION=payload["release_id"], PARTSIGNAL_EXTERNAL_SERVICES_GATE="MET")
        return ["--current-manifest", str(self.old_manifest), "--current-source-archive", str(self.archive),
                "--source-archive", str(self.next_archive)]

    def test_same_candidate_check_and_fresh_restart_preserve_state_and_handoff(self):
        for fresh in (False, True):
            self.initialized(fresh=fresh)
            self.old_manifest.write_bytes(self.data.manifest.read_bytes())
            before = self.data.state_path.read_bytes()
            self.assertEqual(self.run_cli("check").returncode, 0)
            self.data.log.unlink(missing_ok=True)
            result = self.run_cli("restart", "--public-url", self.public)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(b"AI_PENDING", result.stdout)
            self.assertEqual(self.data.state_path.read_bytes(), before)
            up = self.mutations()
            self.assertEqual(len(up), 1, up)
            self.assertEqual(up[0][-4:], ["api", "frontend", "worker", "scheduler"])
            for option in ("--no-build", "--no-deps", "--force-recreate", "never", "production-async"):
                self.assertIn(option, up[0])

    def test_prepared_failed_unknown_and_fake_initialized_cannot_enter(self):
        original = self.data.read_state()
        for phase in ("PRODUCTION_PREPARED", "UPGRADE_PREPARED", "UPGRADE_DEPLOYING", "UNKNOWN"):
            self.data.write_state({**original, "phase": phase})
            self.rejected("check", "要求已完成的 PRODUCTION_INITIALIZED")
        fake = dict(original)
        fake.pop("ai_configuration_handoff")
        self.data.write_state(fake)
        self.rejected("restart", "缺少首次激活证明", "--public-url", self.public)
        self.data.write_state({**original, "upgrade_attempt": {"candidate": original["candidate"], "status": "FAILED"}})
        self.rejected("check", "INITIALIZED 部署 attempt")

    def test_restart_rejects_other_candidate_image_container_and_schema_drift(self):
        self.rejected("restart", "镜像 ID 与候选清单不一致", "--public-url", self.public, FAKE_IMAGE_DRIFT="1")
        for changes in ({"worker": {"1": "sha256:" + "0"*64}}, {"frontend": {"2": "unexpected:tag"}},
                        {"scheduler": {"4": "other-project"}}, {"api": {"3": "false"}},
                        {"frontend": {"6": '[{"Type":"bind","Destination":"/usr/share/nginx/html"}]'}}):
            self.rejected("restart", "漂移" if "6" not in next(iter(changes.values())) else "覆盖应用内容",
                          "--public-url", self.public, FAKE_CONTAINER_CHANGES=json.dumps(changes))
        self.rejected("restart", "数据库 revision", "--public-url", self.public, FAKE_DB_REVISION="wrong")
        self.next_candidate()
        self.rejected("restart", "当前候选与 Production 数据状态", "--public-url", self.public)

    def test_maintenance_origin_and_response_must_pass_before_mutation(self):
        for action in ("restart", "prepare"):
            proof = self.next_candidate() if action == "prepare" else []
            self.rejected(action, "public-url 必须", *proof)
            self.rejected(action, "public-url 必须", *proof, "--public-url", "https://wrong.example")
            for field, value in (("maintenance_status", 200), ("maintenance_body", b"other maintenance\n")):
                self.scenario[field] = value
                self.rejected(action, "公网未确认 503", *proof, "--public-url", self.public)
                self.scenario.pop(field)

    def test_new_candidate_requires_authentic_unchanged_archive_and_real_db_revision(self):
        proof = self.next_candidate()
        before = self.data.state_path.read_bytes()
        self.assertEqual(self.run_cli("check", *proof).returncode, 0)
        self.assertEqual(self.data.state_path.read_bytes(), before)
        self.rejected("check", "缺少旧/新 manifest")
        self.rejected("check", "数据库 revision", *proof, FAKE_DB_EXIT="1")
        payload = json.loads(self.data.manifest.read_text())
        payload["schema_head"] = "different"
        self.data.manifest.write_text(json.dumps(payload))
        self.rejected("check", "schema 变化", *proof)
        payload["schema_head"] = json.loads(self.old_manifest.read_text())["schema_head"]
        self.data.manifest.write_text(json.dumps(payload))
        self.next_archive.write_bytes(b"tampered")
        self.rejected("check", "source archive 与 manifest 不一致", *proof)

    def test_changed_migration_tree_even_with_same_claimed_head_is_rejected(self):
        proof = self.next_candidate()
        with tarfile.open(self.archive) as archive:
            files = {item.name: archive.extractfile(item).read() for item in archive if item.isfile()}
        files["backend/alembic/versions/extra.py"] = b"revision='unexpected'\n"
        self.write_tar(self.next_archive, files)
        payload = json.loads(self.data.manifest.read_text())
        payload["source_archive"]["sha256"] = owner.file_sha256(self.next_archive)
        self.data.manifest.write_text(json.dumps(payload))
        self.rejected("check", "迁移树与失败候选不一致", *proof)

    def test_prepare_activate_follow_existing_owner_and_real_gate(self):
        proof = self.next_candidate()
        result = self.run_cli("prepare", *proof, "--public-url", self.public)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.data.read_state()["phase"], "UPGRADE_PREPARED")
        self.assertFalse((self.root / "probe.json").exists())
        calls = self.mutations()
        pending = {**self.runtime_values, 'OSS_BUCKET': 'changed-after-prepare'}
        self.data.runtime.write_text(''.join(f'{key}={value}\n' for key, value in pending.items()))
        result = self.rejected('activate', 'Production 维护命令失败', '--public-url', self.public)
        self.assertIn(b'RUNNING_RUNTIME_MISMATCH', result.stdout)
        self.data.runtime.write_text(''.join(f'{key}={value}\n' for key, value in self.runtime_values.items()))
        self.assertTrue(any(call[-1:] == ["migrate"] for call in calls), calls)
        self.assertFalse(any("pull" in call or "build" in call for call in calls))
        for call in calls:
            if "run" in call or "up" in call:
                self.assertIn("never", call)
        self.rejected("activate", "必须通过真实 AI/OSS Gate", "--public-url", self.public,
                      PARTSIGNAL_EXTERNAL_SERVICES_GATE="OSS_MET_AI_PENDING")
        self.rejected("activate", "public-url 必须")
        self.scenario["maintenance_status"] = 200
        self.rejected("activate", "公网未确认 503", "--public-url", self.public)
        self.scenario.clear()
        result = self.run_cli("activate", "--public-url", self.public)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.data.read_state()["phase"], "PRODUCTION_INITIALIZED")
        self.assertIn("冒烟通过".encode(), result.stdout)

    def test_preparation_failure_remains_failed_and_does_not_fallback(self):
        proof = self.next_candidate()
        result = self.run_cli("prepare", *proof, "--public-url", self.public, FAKE_MIGRATION_EXIT="23")
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        state = self.data.read_state()
        self.assertEqual(state["phase"], "UPGRADE_DEPLOYING")
        self.assertEqual(state["upgrade_attempt"]["status"], "FAILED")
        self.assertEqual(state["upgrade_failures"][-1]["exit_code"], 23)
        self.rejected("check", "要求已完成的 PRODUCTION_INITIALIZED", *proof)

    def test_smoke_checks_semantics_and_does_not_leak_session(self):
        for field, value, message in (("live", [], "响应必须为对象"), ("ready", None, "响应必须为对象"),
                                     ("live", b"not-json-private", "响应格式无效"),
                                     ("ready", {"status": "ok"}, "依赖响应未通过"),
                                     ("login", b"other app", "login 页面"),
                                     ("anonymous_status", 200, "匿名管理 API"),
                                     ("anonymous", {"error": []}, "匿名管理 API")):
            self.scenario[field] = value
            self.rejected("smoke", message)
            self.scenario.pop(field)
        self.rejected("smoke", "尚未 healthy", FAKE_CONTAINER_CHANGES=json.dumps({"worker": {"7": "unhealthy"}}))
        session = self.root / "session.cookie"
        secret = "partsignal_session=existing_private_session_123"
        session.write_text(secret + "\n")
        session.chmod(0o600)
        result = self.run_cli("smoke", "--public-url", self.public, "--session-file", str(session))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn(secret.encode(), result.stdout + result.stderr)
        self.assertNotIn(secret, self.data.log.read_text())
        self.assertTrue(any(cookie for _path, cookie in self.scenario["requests"]))
        session.chmod(0o644)
        self.rejected("smoke", "0600 普通文件", "--session-file", str(session))

    def test_restart_signal_and_concurrent_cli_hold_lock_until_children_stop(self):
        before = self.data.state_path.read_bytes()
        process = subprocess.Popen(self.command("restart", "--public-url", self.public),
                                   env={**self.env, "FAKE_HOLD_UP": "1"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        marker = self.root / "up.pid"
        deadline = time.monotonic() + 5
        while not marker.exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        self.assertTrue(marker.exists())
        result = self.run_cli("check")
        self.assertEqual(result.returncode, 2)
        self.assertIn("持有排他锁".encode(), result.stderr)
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 143, stdout + stderr)
        self.assertEqual(self.data.state_path.read_bytes(), before)
        status = subprocess.run(["ps", "-o", "stat=", "-p", marker.read_text()], capture_output=True, text=True).stdout.strip()
        self.assertTrue(not status or status.startswith("Z"), status)
        self.assertEqual(self.run_cli("check").returncode, 0)

    def test_restart_command_or_smoke_failure_preserves_initialized_state(self):
        before = self.data.state_path.read_bytes()
        result = self.run_cli("restart", "--public-url", self.public, FAKE_UP_EXIT="23")
        self.assertEqual(result.returncode, 23, result.stdout + result.stderr)
        self.assertEqual(self.data.state_path.read_bytes(), before)
        self.assertIn("未自动恢复流量".encode(), result.stderr)
        self.scenario["ready"] = {"status": "failed"}
        result = self.run_cli("restart", "--public-url", self.public)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(self.data.state_path.read_bytes(), before)
        self.assertEqual(self.data.read_state()["phase"], "PRODUCTION_INITIALIZED")

    def test_pending_runtime_cannot_switch_database_or_other_configuration(self):
        for key, value in (('DATABASE_URL', self.runtime_values['DATABASE_URL'] + '_other'),
                           ('OSS_BUCKET', 'other-bucket')):
            pending = {**self.runtime_values, key: value}
            if key == 'DATABASE_URL':
                pending['POSTGRES_DB'] = 'partsignal_other'
            self.data.runtime.write_text(''.join(f'{name}={item}\n' for name, item in pending.items()))
            result = self.rejected('restart', 'Production 维护命令失败', '--public-url', self.public)
            self.assertIn(b'RUNNING_RUNTIME_MISMATCH', result.stdout)
            self.assertNotIn(value.encode(), result.stdout + result.stderr)
        # DB URL 与 POSTGRES_DB 单独不一致也须在已有库仍健康时拒绝。
        pending['POSTGRES_DB'] = 'partsignal'
        pending['DATABASE_URL'] = self.runtime_values['DATABASE_URL'] + '_other'
        self.data.runtime.write_text(''.join(f'{name}={item}\n' for name, item in pending.items()))
        result = self.rejected('restart', 'Production 维护命令失败', '--public-url', self.public)
        self.assertIn(b'DATABASE_IDENTITY_MISMATCH', result.stdout)

    def test_cancel_during_maintenance_proof_never_launches_restart(self):
        started, release = threading.Event(), threading.Event()
        self.scenario.update(guard_started=started, guard_release=release)
        process = subprocess.Popen(self.command('restart', '--public-url', self.public), env=self.env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.addCleanup(lambda: process.poll() is None and process.kill())
        self.addCleanup(release.set)
        self.assertTrue(started.wait(5))
        os.kill(int((self.root / 'worker.pid').read_text()), signal.SIGTERM)
        time.sleep(0.1)
        release.set()
        stdout, stderr = process.communicate(timeout=15)
        self.assertEqual(process.returncode, 143, stdout + stderr)
        self.assertEqual(self.mutations(), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
