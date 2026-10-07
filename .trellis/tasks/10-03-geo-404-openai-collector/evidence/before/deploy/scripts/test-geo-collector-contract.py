#!/usr/bin/env python3
"""本地 Collector 套件 CI 入口：输出前扫描日志和测试产物，泄漏时非零退出。"""

from __future__ import annotations

import argparse
import io
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import pytest  # noqa: E402

from tests.geo_collector_contract import (  # noqa: E402
    TEST_SECRETS,
    CollectorContractViolation,
    assert_secrets_absent,
)


def scan_files(roots: list[Path]) -> None:
    for root in roots:
        if not root.is_dir():
            raise ValueError("GEO 产物目录不存在")
        for path in root.rglob("*"):
            if path.is_file():
                assert_secrets_absent([path.read_bytes()], TEST_SECRETS)


def main() -> int:
    parser = argparse.ArgumentParser(description="GEO 本地合同自测及 secret scan")
    parser.add_argument("--scan-root", type=Path, action="append", default=[])
    args = parser.parse_args()
    output = io.StringIO()
    with tempfile.TemporaryDirectory(prefix="partsignal-geo-contract-") as temporary:
        artifacts = Path(temporary)
        with redirect_stdout(output), redirect_stderr(output):
            status = pytest.main(
                [
                    str(ROOT / "backend/tests/unit/test_geo_fake_provider.py"),
                    str(ROOT / "backend/tests/unit/test_geo_collector_suite.py"),
                    "--basetemp",
                    str(artifacts / "pytest"),
                    "-o",
                    f"cache_dir={artifacts / 'cache'}",
                ]
            )
        try:
            assert_secrets_absent([output.getvalue()], TEST_SECRETS)
            scan_files([artifacts, *args.scan_root])
        except (CollectorContractViolation, OSError, ValueError):
            print(
                "GEO 合同验证失败：日志/产物 secret scan 未通过；内容未输出",
                file=sys.stderr,
            )
            return 1
        print(output.getvalue(), end="")
    print(
        f"GEO_CONTRACT_RESULT tests={int(status)} secret_scan=0 external_network=blocked"
    )
    return int(status)


if __name__ == "__main__":
    raise SystemExit(main())
