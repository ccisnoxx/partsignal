"""验证 SIGKILL 后的 process-group 等待有界且不会再次发信号。"""

from __future__ import annotations

import importlib.util
import signal
from pathlib import Path
from types import ModuleType

import pytest


def load_script() -> ModuleType:
    script_path = Path(__file__).parents[3] / "deploy" / "scripts" / "e2e-process-group.py"
    spec = importlib.util.spec_from_file_location("partsignal_e2e_process_group", script_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class KilledWorker:
    pid = 4242

    def wait(self) -> int:
        return -signal.SIGKILL


@pytest.mark.parametrize("inspection", ["exists", "permission-error"])
def test_supervisor_kill_wait_is_bounded_and_returns_137_without_resignal(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    inspection: str,
) -> None:
    module = load_script()
    clock = iter([0.0, 0.1, 0.2])
    inspections = 0

    def group_exists(_process_group_id: int) -> bool:
        nonlocal inspections
        inspections += 1
        if inspection == "permission-error":
            raise PermissionError
        return True

    monkeypatch.setattr(module.subprocess, "Popen", lambda *_args, **_kwargs: KilledWorker())
    monkeypatch.setattr(module, "process_group_exists", group_exists)
    monkeypatch.setattr(module.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        module.os,
        "killpg",
        lambda *_args: pytest.fail("anchor 回收后不得再向数值 PGID 发信号"),
    )

    assert module.run_supervisor(["unused"], 30.0, 0.2) == 137
    assert inspections == 2
    assert capsys.readouterr().err == (
        "E2E_PROCESS_GROUP status=kill-wait-timeout exit=137\n"
    )


@pytest.mark.parametrize(
    ("inspection", "signum", "expected_status"),
    [
        ("exists", signal.SIGINT, 130),
        ("permission-error", signal.SIGTERM, 143),
    ],
)
def test_signal_after_anchor_wait_only_records_final_status(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    inspection: str,
    signum: int,
    expected_status: int,
) -> None:
    module = load_script()
    clock = iter([0.0, 0.1, 0.2])
    signal_sent = False

    def group_exists(_process_group_id: int) -> bool:
        nonlocal signal_sent
        if not signal_sent:
            signal_sent = True
            signal.raise_signal(signum)
        if inspection == "permission-error":
            raise PermissionError
        return True

    monkeypatch.setattr(module.subprocess, "Popen", lambda *_args, **_kwargs: KilledWorker())
    monkeypatch.setattr(module, "process_group_exists", group_exists)
    monkeypatch.setattr(module.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        module.os,
        "kill",
        lambda *_args: pytest.fail("anchor 回收后不得向数值 PID 发信号"),
    )
    monkeypatch.setattr(
        module.os,
        "killpg",
        lambda *_args: pytest.fail("anchor 回收后不得向数值 PGID 发信号"),
    )

    assert module.run_supervisor(["unused"], 30.0, 0.2) == expected_status
    assert signal_sent is True
    assert capsys.readouterr().err == (
        "E2E_PROCESS_GROUP status=kill-wait-timeout exit=137\n"
    )
