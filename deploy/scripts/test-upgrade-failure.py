#!/usr/bin/env python3
"""验证部署失败事实由状态所有者记录并且只能消费一次。"""

import importlib.util
import unittest
from pathlib import Path
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location(
    "recovery_fixture", Path(__file__).with_name("test-upgrade-recovery.py")
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
owner = fixture.owner


class UpgradeFailureTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture.UpgradeRecoveryTests("runTest")
        self.data.setUp()

    def tearDown(self):
        self.data.tearDown()

    def failure(self, **changes):
        values = dict(stage="migration", exit_code=23, signal=0,
                      evidence_ref="local-fixture/migration-exit23")
        values.update(changes)
        return owner.record_upgrade_failure(self.data.failed, SimpleNamespace(**values))

    def test_running_candidate_cannot_be_recovered(self):
        owner.begin_upgrade(self.data.failed)
        self.data.assert_rejected("缺少.*失败记录")

    def test_failure_record_matches_attempt_and_receipt(self):
        owner.begin_upgrade(self.data.failed)
        record = self.failure()
        self.data.args.failure_id = record["failure_id"]
        before = owner.read_state(self.data.live)
        self.assertEqual(record["candidate"], self.data.failed)
        self.assertEqual(record["attempt_id"], before["upgrade_attempt"]["attempt_id"])
        self.assertEqual(record["exit_code"], 23)
        self.assertEqual(record["stage"], "migration")
        self.data.recover()
        state = owner.read_state(self.data.live)
        self.assertEqual(state["upgrade_failures"], before["upgrade_failures"])
        self.assertEqual(state["upgrade_recoveries"][-1]["failure_record"], record)
        self.data.recover()
        self.assertEqual(owner.read_state(self.data.live), state)

    def test_retry_invalidates_the_previous_failure(self):
        owner.begin_upgrade(self.data.failed)
        record = self.failure()
        self.data.args.failure_id = record["failure_id"]
        owner.begin_upgrade(self.data.failed)
        self.data.assert_rejected("缺少.*失败记录")
        self.assertEqual(owner.read_state(self.data.live)["upgrade_failures"], [record])

    def test_recovery_receipt_cannot_replay_after_new_deploy_attempt(self):
        self.data.deploying()
        self.data.recover()
        owner.begin_upgrade(self.data.fixed)
        self.data.assert_rejected("冲突")

    def test_zero_exit_or_wrong_candidate_cannot_create_failure(self):
        owner.begin_upgrade(self.data.failed)
        before = owner.read_state(self.data.live)
        with self.assertRaises(owner.DataStateError):
            self.failure(exit_code=0)
        with self.assertRaises(owner.DataStateError):
            owner.record_upgrade_failure(self.data.fixed, SimpleNamespace(
                stage="migration", exit_code=23, signal=0, evidence_ref="local/failure"
            ))
        self.assertEqual(owner.read_state(self.data.live), before)

    def test_prepared_requires_explicit_approved_failure_declaration(self):
        owner.begin_upgrade(self.data.failed)
        owner.transition_upgrade("UPGRADE_DEPLOYING", "UPGRADE_PREPARED", self.data.failed)
        self.data.assert_rejected("缺少.*失败记录")
        record = owner.declare_pre_activation_failure(self.data.failed, SimpleNamespace(
            approval_ref="local/declare-unusable-approval", evidence_ref="local/readiness-failure"
        ))
        self.data.args.failure_id = record["failure_id"]
        with self.assertRaisesRegex(owner.DataStateError, "未失败"):
            owner.verify_upgrade_prepared(self.data.failed)
        with self.assertRaisesRegex(owner.DataStateError, "未失败"):
            owner.transition_upgrade("UPGRADE_PREPARED", "PRODUCTION_INITIALIZED", self.data.failed)
        self.data.recover()
        self.assertEqual(owner.read_state(self.data.live)["upgrade_recoveries"][-1]["failure_record"], record)
        self.assertEqual(record["failure_kind"], "OPERATOR_DECLARED_PRE_ACTIVATION_FAILURE")
        self.assertIsNone(record["exit_code"])


if __name__ == "__main__":
    unittest.main()
