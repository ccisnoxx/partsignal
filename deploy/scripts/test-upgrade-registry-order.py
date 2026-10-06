#!/usr/bin/env python3
"""真实 shell/状态所有者：registry 未缓存候选须先认证再交付、最后绑定。"""

import importlib.util
import json
import os
import subprocess
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
    print(json.dumps([{'Id':'sha256:'+'b'*64,'Config':{'Env':[]},'RepoDigests':['test/backend@sha256:'+'b'*64,'test/frontend@sha256:'+'b'*64]}]))
elif args[0] == 'compose' and 'pull' in args:
    assert state()['phase'] == 'PRODUCTION_INITIALIZED'
    marker.touch()
elif args[0] == 'compose' and any(c in args for c in ('run','up')):
    current=state()
    assert marker.exists() and current['phase'] == 'UPGRADE_DEPLOYING'
    assert current['upgrade_migration_cache_policy']['candidate'] == current['candidate']
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
        )
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


if __name__ == '__main__':
    unittest.main()
