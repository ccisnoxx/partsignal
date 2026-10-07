"""textfile实际失败回路：撤销旧up=1，隐藏部分输出和stderr，保留权限。"""

import importlib.util
import stat
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "deploy/scripts/export-geo-metrics.py"
spec = importlib.util.spec_from_file_location("geo_export", SCRIPT)
assert spec and spec.loader
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


def test_atomic_export_success_then_failure_does_not_leave_stale_success(tmp_path):
    output = tmp_path / "geo.prom"
    assert (
        exporter.export([sys.executable, "-c", "print('geo_observability_up 1')"], output, 2) == 0
    )
    assert "geo_observability_up 1" in output.read_text()
    failed = (
        "print('GEO902-secret-body'); import sys; sys.stderr.write('GEO902-secret-cookie'); exit(1)"
    )
    assert exporter.export([sys.executable, "-c", failed], output, 2) == 1
    assert output.read_text() == exporter.FAILURE
    assert stat.S_IMODE(output.stat().st_mode) == 0o600
    assert list(tmp_path.iterdir()) == [output]


@pytest.mark.parametrize(
    "command",
    [["/geo902-command-does-not-exist"], [sys.executable, "-c", "import time; time.sleep(5)"]],
)
def test_export_unavailable_or_timeout_is_explicit_not_empty(command, tmp_path):
    output = tmp_path / "geo.prom"
    assert exporter.export(command, output, 1) == 1
    assert "geo_observability_up 0" in output.read_text()
