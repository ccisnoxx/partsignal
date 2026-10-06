#!/usr/bin/env python3
"""验证运行时证明在迁移前冻结，旧状态不能在恢复时补造证明。"""

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("recovery_fixture", Path(__file__).with_name("test-upgrade-recovery.py"))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
owner = fixture.owner


class RuntimePolicyTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture.UpgradeRecoveryTests("runTest")
        self.data.setUp()

    def tearDown(self):
        self.data.tearDown()

    def test_runtime_loader_overrides_rejected_before_migration(self):
        boundary_spec = importlib.util.spec_from_file_location(
            "production_boundary", Path(__file__).with_name("check-production-inputs.py")
        )
        boundary = importlib.util.module_from_spec(boundary_spec)
        boundary_spec.loader.exec_module(boundary)
        boundary.check_deployment_boundary({"APP_ENV": "production"}, {})
        # 模板中以注释形式声明的可选预算也是公开生产配置。
        boundary.check_deployment_boundary({"APP_ENV": "production", "GEO_DAILY_BUDGET_LIMIT": "100.000000"}, {})
        for key in ("PATH", "PYTHONPATH", "PYTHONHOME", "PYTHONOPTIMIZE", "LD_PRELOAD", "LD_LIBRARY_PATH", "HOME"):
            with self.subTest(key=key), self.assertRaisesRegex(boundary.InputError, "ENV_KEY_SET_MISMATCH"):
                boundary.check_deployment_boundary({"APP_ENV": "production", key: "/unproved"}, {})

    def test_first_entry_freezes_actual_runtime_before_attempt(self):
        self.data.runtime_proof.stop()
        self.data.image_probe.stop()
        with patch.object(owner, "image_runtime_fingerprint", return_value=self.data.failed["migration_runtime"]):
            owner.begin_upgrade(self.data.failed)
        state = owner.read_state(self.data.live)
        self.assertEqual(state["upgrade_migration_runtime"], {
            "candidate": self.data.failed, "fingerprint": self.data.failed["migration_runtime"]
        })
        self.assertEqual(state["upgrade_attempt"]["status"], "RUNNING")

    def test_mutable_template_cannot_authorize_runtime_loader(self):
        boundary_spec = importlib.util.spec_from_file_location(
            "production_boundary_template", Path(__file__).with_name("check-production-inputs.py")
        )
        boundary = importlib.util.module_from_spec(boundary_spec)
        boundary_spec.loader.exec_module(boundary)
        template_root = self.data.root / "template-checkout"
        template_root.mkdir()
        (template_root / ".env.production.example").write_text("APP_ENV=production\nLD_PRELOAD=\n")
        with patch.object(boundary, "ROOT", template_root):
            with self.assertRaisesRegex(boundary.InputError, "ENV_KEY_SET_MISMATCH"):
                boundary.check_deployment_boundary({"APP_ENV": "production", "LD_PRELOAD": "/tmp/loader.so"}, {})

    def test_actual_runtime_mismatch_does_not_begin_upgrade(self):
        self.data.runtime_proof.stop()
        self.data.image_probe.stop()
        before = owner.read_state(self.data.live)
        changed = {**self.data.failed["migration_runtime"], "environment_sha256": "0" * 64}
        with patch.object(owner, "image_runtime_fingerprint", return_value=changed):
            with self.assertRaisesRegex(owner.DataStateError, "运行时与 manifest"):
                owner.begin_upgrade(self.data.failed)
        self.assertEqual(owner.read_state(self.data.live), before)

    def test_missing_historical_runtime_proof_cannot_reenter_or_recover(self):
        self.data.deploying()
        state = owner.read_state(self.data.live)
        del state["upgrade_migration_runtime"]
        owner.atomic_write_state(self.data.live, state)
        with self.assertRaisesRegex(owner.DataStateError, "历史补造"):
            owner.begin_upgrade(self.data.failed)
        self.data.assert_rejected("迁移运行时冻结证明")

    def test_different_dependency_runtime_cannot_take_over(self):
        from production_migration_runtime import _fingerprint
        self.data.deploying()
        payload = json.loads(self.data.fixed_manifest.read_text())
        payload["migration_runtime"] = _fingerprint(payload["migration_runtime"]["source_sha256"], "d" * 64)
        self.data.fixed_manifest.write_text(json.dumps(payload))
        self.data.assert_rejected("运行时与失败执行不一致")

    def test_migration_identity_cannot_be_replaced_even_with_matching_fingerprint(self):
        self.data.deploying()
        payload = json.loads(self.data.fixed_manifest.read_text())
        payload["images"]["migration"]["image_id"] = "sha256:" + "c" * 64
        self.data.fixed_manifest.write_text(json.dumps(payload))
        self.data.assert_rejected("冻结迁移镜像身份")


if __name__ == "__main__":
    unittest.main()
