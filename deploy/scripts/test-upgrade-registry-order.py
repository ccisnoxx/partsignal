#!/usr/bin/env python3
"""真实 shell/状态所有者：registry 未缓存候选须先认证再交付、最后绑定。"""

import importlib.util
import json
import os
import signal
import subprocess
import time
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'recovery_fixture', Path(__file__).with_name('test-upgrade-recovery.py')
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class RegistryUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture.UpgradeRecoveryTests('runTest')
        self.data.setUp()
        self.runtime = self.data.root / 'runtime.env'
        self.runtime.write_text('APP_ENV=production\n')
        self.runtime.chmod(0o600)
        self.bin = self.data.root / 'bin'
        self.bin.mkdir()
        self.log = self.data.root / 'docker.jsonl'
        self.marker = self.data.root / 'pulled'
        docker = self.bin / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args=sys.argv[1:]
root=Path(os.environ['PARTSIGNAL_DATA_ROOT'])
state=lambda:json.loads((root/'.partsignal-production-cutover.json').read_text())
marker=Path(os.environ['ORDER_PULL_MARKER'])
with open(os.environ['ORDER_LOG'], 'a') as output: output.write(json.dumps(args)+'\\n')
if args[:2] == ['image','inspect']:
    if not marker.exists(): sys.exit(81)
    print(json.dumps([{'Id':'sha256:'+'b'*64,'Config':{'Env':[],'WorkingDir':'/app','Entrypoint':None},'RepoDigests':['test/backend@sha256:'+'b'*64,'test/migration@sha256:'+'b'*64,'test/frontend@sha256:'+'b'*64]}]))
elif args[0] == 'compose' and 'pull' in args:
    assert state()['phase'] == 'PRODUCTION_INITIALIZED'
    marker.touch()
elif args[0] in ('create', 'export', 'container'):
    import subprocess
    subprocess.run([sys.executable, os.environ['RUNTIME_FIXTURE_ADAPTER'],
                    os.environ['RUNTIME_FIXTURE_BACKEND'], os.environ['RUNTIME_FIXTURE_STATE'], *args], check=True)
elif args[0] == 'compose' and any(c in args for c in ('run','up')):
    current=state()
    assert marker.exists() and current['phase'] == 'UPGRADE_DEPLOYING'
    assert current['upgrade_migration_cache_policy']['candidate'] == current['candidate']
    if 'run' in args and 'migrate' in args:
        if os.environ.get('ORDER_FAIL_STAGE') == 'migration':
            sys.exit(23)
        if os.environ.get('ORDER_FAIL_STAGE') == 'signal':
            import signal, time
            signal.signal(signal.SIGTERM, signal.SIG_IGN)
            marker.with_suffix('.running').touch()
            time.sleep(60)
''')
        docker.chmod(0o700)
        curl = self.bin / 'curl'
        curl.write_text('#!/bin/sh\nexit 0\n')
        curl.chmod(0o700)
        os.environ.update(
            ENV_FILE=str(self.runtime), PARTSIGNAL_RUNTIME_ENV_FILE=str(self.runtime),
            PARTSIGNAL_RELEASE_MANIFEST=str(self.data.fixed_manifest),
            PARTSIGNAL_IMAGE_DELIVERY_MODE='registry', PARTSIGNAL_DEPLOY_MODE='upgrade',
            ORDER_LOG=str(self.log), ORDER_PULL_MARKER=str(self.marker),
            PATH=str(self.bin) + os.pathsep + os.environ['PATH'],
            RUNTIME_FIXTURE_ADAPTER=str(Path(__file__).with_name('test-migration-runtime-docker.py')),
            RUNTIME_FIXTURE_BACKEND=str(self.data.repository / 'backend'),
            RUNTIME_FIXTURE_STATE=str(self.data.root / 'runtime-fixtures'),
        )
        from production_migration_runtime import image_runtime_fingerprint
        self.marker.touch()
        for path in (self.data.failed_manifest, self.data.fixed_manifest):
            payload = json.loads(path.read_text())
            payload['images']['migration'] = {'reference': 'test/migration:fixed', 'image_id': 'sha256:'+'b'*64,
                                               'repo_digests':['test/migration@sha256:'+'b'*64]}
            # 合成Engine输出用于真实shell顺序测试，不作为迁移环境等价性的证据。
            payload['migration_runtime'] = image_runtime_fingerprint('sha256:' + 'b' * 64)
            path.write_text(json.dumps(payload))
        self.marker.unlink()
        self.log.unlink()
        self.data.fixed = self.data.candidate(self.data.fixed_manifest)
        self.deploy = self.data.repository / 'deploy/scripts/deploy.sh'
        self.deploy.chmod(0o700)

    def tearDown(self):
        self.data.tearDown()

    def test_uncached_registry_candidate_delivers_before_policy_and_run(self):
        result = subprocess.run([str(self.deploy)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        pulled = next(i for i, args in enumerate(calls) if args[0] == 'compose' and 'pull' in args)
        inspected = next(i for i, args in enumerate(calls) if args[:2] == ['image','inspect'])
        self.assertLess(pulled, inspected)
        self.assertEqual(fixture.owner.read_state(self.data.live)['phase'], 'UPGRADE_PREPARED')

    def test_bad_manifest_does_not_pull_or_mutate_state(self):
        before = fixture.owner.read_state(self.data.live)
        self.data.fixed_manifest.write_text('{}')
        result = subprocess.run([str(self.deploy)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.marker.exists())
        self.assertFalse(self.log.exists())
        self.assertEqual(fixture.owner.read_state(self.data.live), before)

    def test_deploy_owner_observes_signal_and_persists_failure_after_stop(self):
        os.environ['ORDER_FAIL_STAGE'] = 'signal'
        process = subprocess.Popen([str(self.deploy)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            deadline = time.monotonic() + 8
            while not self.marker.with_suffix('.running').exists():
                self.assertIsNone(process.poll(), '真实 deploy 未进入阻塞迁移命令')
                self.assertLess(time.monotonic(), deadline)
                time.sleep(0.01)
            state = fixture.owner.read_state(self.data.live)
            self.assertEqual(state['upgrade_attempt']['status'], 'RUNNING')
            self.assertNotIn('current_upgrade_failure_id', state)
            process.send_signal(signal.SIGTERM)
            output = process.communicate(timeout=13)
            self.assertEqual(process.returncode, 143, output)
            state = fixture.owner.read_state(self.data.live)
            record = state['upgrade_failures'][-1]
            self.assertEqual(state['phase'], 'UPGRADE_DEPLOYING')
            self.assertEqual(state['upgrade_attempt']['status'], 'FAILED')
            self.assertEqual(record['attempt_id'], state['upgrade_attempt']['attempt_id'])
            self.assertEqual(record['candidate'], self.data.fixed)
            self.assertEqual(record['signal'], signal.SIGTERM)
            self.assertEqual(record['exit_code'], 143)
            self.assertEqual(record['worker_exit_code'], 137)
            self.assertEqual(record['failure_kind'], 'DEPLOYMENT_SIGNALLED')
            self.assertEqual(record['stage'], 'migration')
        finally:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                process.communicate(timeout=13)

    def test_real_deploy_exit_records_candidate_bound_failure(self):
        os.environ['ORDER_FAIL_STAGE'] = 'migration'
        result = subprocess.run([str(self.deploy)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 23, result.stderr)
        state = fixture.owner.read_state(self.data.live)
        self.assertEqual(state['phase'], 'UPGRADE_DEPLOYING')
        record = state['upgrade_failures'][-1]
        self.assertEqual(record['candidate'], self.data.fixed)
        self.assertEqual(record['attempt_id'], state['upgrade_attempt']['attempt_id'])
        self.assertEqual(record['failure_id'], state['current_upgrade_failure_id'])
        self.assertEqual(record['exit_code'], 23)
        self.assertEqual(record['stage'], 'migration')


if __name__ == '__main__':
    unittest.main()
