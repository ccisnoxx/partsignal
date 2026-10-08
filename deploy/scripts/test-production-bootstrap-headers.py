#!/usr/bin/env python3
"""验证首次初始化的可选 Header、无回显交接和持久 attempt 边界。"""

from __future__ import annotations

from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import pty
import select
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name("prepare-production-data.py")
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("bootstrap_header_owner", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
owner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(owner)


class BootstrapHeaderTests(unittest.TestCase):
    """不启动 Docker/provider；对 Host owner 的真实输入与状态边界作定向验证。"""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.state = {
            "schema_version": 1,
            "data_root": str(self.root),
            "phase": "PRODUCTION_PREPARED",
            "candidate": {"commit": "synthetic"},
        }
        self.prompts = []
        self.envelopes = []
        self.tty = SimpleNamespace(isatty=lambda: True)
        self.args = SimpleNamespace(
            run_id="prr_20261007_120000",
            manifest="/synthetic/manifest.json",
            channel_name="合成渠道",
            channel_description="可选Header验证",
            protocol_type="openai-compatible-chat-completions",
            provider_brand="CUSTOM",
            base_url="https://provider.example/v1",
            timeout_seconds=30,
            model_display_name="合成模型",
            model_id="synthetic-model",
            request_parameters_json="{}",
            header_name=[],
            sensitive_header_name=[],
        )

    def bootstrap(self, values):
        answers = iter(values)

        def reader(prompt):
            self.prompts.append(prompt)
            value = next(answers)
            if isinstance(value, BaseException):
                raise value
            return value

        def runner(command, **kwargs):
            self.assertEqual(
                command,
                [
                    "docker",
                    "exec",
                    "-i",
                    "synthetic-container",
                    "python",
                    "-m",
                    "app.cli",
                    "bootstrap-production-ai",
                ],
            )
            self.assertFalse(kwargs["shell"])
            self.assertEqual(
                owner.read_state(self.root)["ai_bootstrap_attempt"]["status"], "STARTED"
            )
            envelope = json.loads(kwargs["input"])
            self.envelopes.append(envelope)
            return subprocess.CompletedProcess(
                command,
                0,
                stdout=json.dumps(
                    {
                        "status": "SUCCEEDED",
                        "request_id": envelope["request_id"],
                        "channel_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                        "channel_revision": 3,
                        "channel_enabled": True,
                        "channel_configured": True,
                        "model_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                        "model_revision": 2,
                        "model_test_status": "PASSED",
                        "model_enabled": True,
                        "model_configured": True,
                    }
                ).encode(),
            )

        output = io.StringIO()
        with (
            patch.object(
                owner, "configured_roots", return_value=(self.root, self.root)
            ),
            patch.object(
                owner, "candidate_from_manifest", return_value=self.state["candidate"]
            ),
            patch.object(owner, "verify_phase", return_value=self.state),
            patch.object(owner, "require_candidate"),
            patch.object(
                owner, "running_api_container_id", return_value="synthetic-container"
            ),
            redirect_stdout(output),
        ):
            owner.bootstrap_ai(
                self.args,
                credential_reader=reader,
                runner=runner,
                stdin=self.tty,
                stderr=self.tty,
            )
        return output.getvalue()

    def test_absent_and_empty_headers_only_read_key(self):
        for omitted in (False, True):
            with self.subTest(omitted=omitted):
                self.state.pop("ai_bootstrap_attempt", None)
                self.prompts.clear()
                if omitted:
                    del self.args.header_name
                    del self.args.sensitive_header_name
                self.bootstrap(["synthetic-key"])
                self.assertEqual(self.prompts, ["AI API Key: "])
                self.assertEqual(self.envelopes[-1]["headers"], [])

    def test_optional_plain_and_sensitive_values_only_enter_stdin(self):
        self.args.header_name = ["X-Region"]
        self.args.sensitive_header_name = ["X-Access-Token"]
        output = self.bootstrap(
            ["synthetic-key", "synthetic-region", "synthetic-secret"]
        )
        self.assertEqual(
            self.envelopes[0]["headers"],
            [
                {
                    "name": "X-Region",
                    "is_sensitive": False,
                    "value": "synthetic-region",
                },
                {
                    "name": "X-Access-Token",
                    "is_sensitive": True,
                    "value": "synthetic-secret",
                },
            ],
        )
        persisted = json.dumps(owner.read_state(self.root))
        for value in (
            "synthetic-key",
            "synthetic-region",
            "synthetic-secret",
            "X-Access-Token",
        ):
            self.assertNotIn(value, output + persisted)
        self.assertEqual(len(self.prompts), 3)

    def test_bad_names_rejected_before_prompt_or_attempt(self):
        for name in ("Authorization", "bad name", "X-Region"):
            with self.subTest(name=name):
                self.args.header_name = ["X-Region"]
                self.args.sensitive_header_name = [name]
                with self.assertRaises(owner.DataStateError):
                    self.bootstrap([])
                self.assertEqual(self.prompts, [])
                self.assertNotIn("ai_bootstrap_attempt", self.state)

    def test_name_capacity_rejected_before_values_or_attempt(self):
        self.args.header_name = ["X-" + "a" * 158]
        self.bootstrap(["synthetic-key", "synthetic-value"])
        self.assertEqual(len(self.envelopes[0]["headers"][0]["name"]), 160)
        self.state.pop("ai_bootstrap_attempt")
        (self.root / owner.STATE_FILE_NAME).unlink()
        self.prompts.clear()
        self.envelopes.clear()
        self.args.header_name = ["X-" + "a" * 159]
        with self.assertRaises(owner.DataStateError):
            self.bootstrap([])
        self.assertEqual(self.prompts, [])
        self.assertEqual(self.envelopes, [])
        self.assertNotIn("ai_bootstrap_attempt", self.state)
        self.assertFalse((self.root / owner.STATE_FILE_NAME).exists())

    def test_invalid_interrupted_or_oversized_header_leaves_no_attempt(self):
        self.args.sensitive_header_name = ["X-Token"]
        for value in (
            "bad\nvalue",
            "中文",
            "x" * 65536,
            EOFError(),
            KeyboardInterrupt(),
        ):
            with self.subTest(value_type=type(value).__name__):
                with self.assertRaises(owner.DataStateError):
                    self.bootstrap(["synthetic-key", value])
                self.assertNotIn("ai_bootstrap_attempt", self.state)
                self.assertFalse((self.root / owner.STATE_FILE_NAME).exists())
                self.assertEqual(self.envelopes, [])

    def test_parser_headers_are_optional_and_repeatable(self):
        required = [
            "script",
            "bootstrap-ai",
            self.args.run_id,
            self.args.manifest,
            "--channel-name",
            "synthetic",
            "--channel-description",
            "",
            "--protocol-type",
            self.args.protocol_type,
            "--provider-brand",
            "CUSTOM",
            "--base-url",
            self.args.base_url,
            "--timeout-seconds",
            "30",
            "--model-display-name",
            "synthetic",
            "--model-id",
            "synthetic",
            "--request-parameters-json",
            "{}",
        ]
        with patch.object(sys, "argv", required):
            parsed = owner.parse_args()
        self.assertEqual(owner._bootstrap_header_specs(parsed), [])
        with patch.object(
            sys,
            "argv",
            required
            + [
                "--header-name",
                "X-Region",
                "--header-name",
                "X-Version",
                "--sensitive-header-name",
                "X-Token",
            ],
        ):
            parsed = owner.parse_args()
        self.assertEqual(
            owner._bootstrap_header_specs(parsed),
            [
                ("X-Region", False),
                ("X-Version", False),
                ("X-Token", True),
            ],
        )

    def test_real_tty_header_value_is_not_echoed(self):
        pid, descriptor = pty.fork()
        if pid == 0:
            try:
                value = owner.read_bootstrap_credential(
                    prompt="AI Header value (1/1): "
                )
                os._exit(0 if value == "pty-header-secret" else 1)
            except BaseException:
                os._exit(1)
        transcript = b""
        sent = False
        status = None
        try:
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if select.select([descriptor], [], [], 0.1)[0]:
                    try:
                        transcript += os.read(descriptor, 4096)
                    except OSError:
                        pass
                if b"AI Header value (1/1):" in transcript and not sent:
                    os.write(descriptor, b"pty-header-secret\n")
                    sent = True
                completed, status = os.waitpid(pid, os.WNOHANG)
                if completed:
                    break
            else:
                os.kill(pid, 9)
                _, status = os.waitpid(pid, 0)
                self.fail("Header TTY 输入超时")
        finally:
            os.close(descriptor)
        self.assertTrue(sent)
        self.assertEqual(os.waitstatus_to_exitcode(status), 0)
        self.assertNotIn(b"pty-header-secret", transcript)


if __name__ == "__main__":
    unittest.main()
