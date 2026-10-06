#!/usr/bin/env python3
"""验证失败执行缓存策略的持久证明，拒绝事后补造历史。"""

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "recovery_fixture", Path(__file__).with_name("test-upgrade-recovery.py")
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
owner = fixture.owner


class CachePolicyTests(unittest.TestCase):
    def setUp(self):
        # 复用已有真实文件/manifest/state 夹具，不重复发现其测试。
        self.data = fixture.UpgradeRecoveryTests("runTest")
        self.data.setUp()

    def tearDown(self):
        self.data.tearDown()

    def inspect(self, values):
        image = {"Id": self.data.failed["backend_image_id"], "Config": {"Env": values}}
        return patch.object(owner.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps([image])))

    def test_first_entry_records_candidate_bound_proof_atomically(self):
        self.data.cache_policy.stop()
        with self.inspect(["PATH=/opt/venv/bin", "PYTHONPYCACHEPREFIX="]):
            self.data.deploying()
        self.assertEqual(owner.read_state(self.data.live)["upgrade_migration_cache_policy"], {
            "policy": "DEFAULT_PYTHON_CACHE_V1", "candidate": self.data.failed,
        })

    def test_image_prefix_or_unknown_inspection_preserves_initialized(self):
        self.data.cache_policy.stop()
        before = owner.read_state(self.data.live)
        for values in (["PYTHONPYCACHEPREFIX=/opt/cache"], None):
            with self.inspect(values), self.assertRaises(owner.DataStateError):
                self.data.deploying()
            self.assertEqual(owner.read_state(self.data.live), before)

    def test_failed_entry_boundary_does_not_record_proof(self):
        self.data.cache_policy.stop()
        before = owner.read_state(self.data.live)
        with patch.object(owner, "validate_recovery_boundary", side_effect=owner.DataStateError("runtime cache prefix")):
            with self.assertRaises(owner.DataStateError):
                self.data.deploying()
        self.assertEqual(owner.read_state(self.data.live), before)

    def test_historical_missing_wrong_or_unknown_policy_cannot_rebind(self):
        self.data.deploying()
        state = owner.read_state(self.data.live)
        for policy in (None, {"policy": "UNKNOWN", "candidate": self.data.failed},
                       {"policy": "DEFAULT_PYTHON_CACHE_V1", "candidate": self.data.fixed}):
            state["upgrade_migration_cache_policy"] = policy
            owner.atomic_write_state(self.data.live, state)
            self.data.assert_rejected("失败执行缺少绑定候选的迁移缓存策略证明")

    def test_same_candidate_reentry_cannot_forge_historical_proof(self):
        self.data.deploying()
        state = owner.read_state(self.data.live)
        del state["upgrade_migration_cache_policy"]
        owner.atomic_write_state(self.data.live, state)
        owner.begin_upgrade(self.data.failed)
        self.assertNotIn("upgrade_migration_cache_policy", owner.read_state(self.data.live))
        record = self.data.observed_failure(self.data.failed)
        self.data.args.failure_id = record["failure_id"]
        self.data.assert_rejected("失败执行缺少绑定候选的迁移缓存策略证明")

    def test_recovery_binds_new_policy_and_keeps_failed_policy_in_receipt(self):
        self.data.deploying()
        old = owner.read_state(self.data.live)["upgrade_migration_cache_policy"]
        self.data.recover()
        state = owner.read_state(self.data.live)
        self.assertEqual(state["upgrade_recoveries"][-1]["failed_cache_policy"], old)
        self.assertEqual(state["upgrade_migration_cache_policy"]["candidate"], self.data.fixed)
        self.data.recover()
        self.assertEqual(owner.read_state(self.data.live), state)


if __name__ == "__main__":
    unittest.main()
