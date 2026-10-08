#!/usr/bin/env python3
"""root bind mount 边界回归：真实删除与合成 mountinfo，不声称执行真实 bind。"""

from __future__ import annotations

import importlib.util
import os
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "fresh_reset_fixture", Path(__file__).with_name("test-production-fresh-reset.py")
)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)
owner = fixture.owner


class FreshRootMountTests(unittest.TestCase):
    def setUp(self):
        self.data = fixture.FreshResetTests("runTest")
        self.data.setUp()
        self.addCleanup(self.data.doCleanups)

    def test_same_device_root_bind_rejected_before_state_or_delete(self):
        self.assertFalse(self.data.live.is_mount())
        self.assertEqual(
            self.data.live.stat().st_dev,
            (self.data.live / "postgres").stat().st_dev,
        )
        with patch.object(
            owner.fresh_reset, "mount_points", return_value={self.data.live}
        ):
            self.assertEqual(self.data.reset(), 2)
        self.data.assert_old_data()
        snapshots = iter((set(), {self.data.live}, {self.data.live}))
        with patch.object(
            owner.fresh_reset, "mount_points", side_effect=lambda: next(snapshots)
        ):
            self.assertEqual(self.data.reset(), 2)
        self.data.assert_old_data()

    def test_root_mount_after_one_real_delete_stops_and_blocks_resume(self):
        boundary_changed = self.data.root / "root-boundary-changed"
        unlink = os.unlink

        def mount_after_delete(path, *, dir_fd=None):
            result = unlink(path, dir_fd=dir_fd)
            if dir_fd is not None:
                boundary_changed.touch()
            return result

        with patch.object(
            owner.fresh_reset,
            "mount_points",
            side_effect=lambda: (
                {self.data.live} if boundary_changed.exists() else set()
            ),
        ):
            with patch.object(os, "unlink", mount_after_delete):
                self.assertEqual(self.data.reset(), 2)
            self.assertEqual(self.data.state()["phase"], "RESETTING")
            self.assertFalse((self.data.live / "postgres/nested/old-data").exists())
            self.assertTrue((self.data.live / "redis/nested/old-data").exists())
            before = (self.data.live / owner.STATE_FILE_NAME).read_bytes()
            self.assertEqual(self.data.reset(), 2)
            self.assertEqual(
                (self.data.live / owner.STATE_FILE_NAME).read_bytes(), before
            )
            boundary_changed.unlink()
            self.assertEqual(self.data.reset(), 0)
        self.assertEqual(self.data.state()["phase"], "RESET_READY")

    def test_ready_fresh_init_rejects_new_root_bind_without_transition(self):
        self.assertEqual(self.data.reset(), 0)
        before = (self.data.live / owner.STATE_FILE_NAME).read_bytes()
        with (
            owner.maintenance_lock(),
            patch.object(
                owner.fresh_reset, "mount_points", return_value={self.data.live}
            ),
            self.assertRaisesRegex(owner.DataStateError, "活动数据根.*挂载点"),
        ):
            owner.fresh_reset.begin_fresh_init(
                owner, "prr_20261007_120000", self.data.candidate
            )
        self.assertEqual((self.data.live / owner.STATE_FILE_NAME).read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
