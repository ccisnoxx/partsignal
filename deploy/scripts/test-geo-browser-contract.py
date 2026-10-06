#!/usr/bin/env python3
"""完全本地Browser合同入口；打印前扫描，结果复用后端权威值对象校验。"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from pydantic import TypeAdapter  # noqa: E402

from app.collectors.contracts import CollectedAnswer  # noqa: E402
from app.collectors.errors import CollectorFailure  # noqa: E402
from tests.geo_collector_contract import assert_secrets_absent  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--container", action="store_true")
    args = parser.parse_args()
    canaries = [f"geo-canary-{kind}-{uuid4().hex}" for kind in ("account", "payment", "cookie")]
    container_owner = uuid4().hex
    cache = ROOT / ".cache"
    cache.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="geo803-", dir=cache) as temporary:
        owner = Path(temporary)
        output = owner / "values.jsonl"
        command = ["node", "--test", "tests/contracts/local-adapter.test.mjs"]
        env = {**os.environ, "GEO_BROWSER_TEST_CANARIES": json.dumps(canaries),
               "GEO_BROWSER_CONTRACT_OUTPUT": str(output)}
        if args.container:
            # 固定与Collector同版官方runtime；无凭据挂载/端口/公网或业务网络。
            command = [
                "docker", "run", "--rm", "--network", "none", "--read-only",
                "--label", f"partsignal.geo803.owner={container_owner}",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
                "--security-opt", f"seccomp={ROOT / 'deploy/geo-browser-seccomp.json'}",
                "--user", f"{os.getuid()}:{os.getgid()}" if os.getuid() else "pwuser",
                "--tmpfs", "/tmp:rw,nosuid,size=256m,mode=1777", "--shm-size", "128m",
                # 不挂整个仓库，避免.env/密钥/本地业务文件进入测试容器。
                "--mount", f"type=bind,source={ROOT / 'browser-collector'},target=/workspace/browser-collector,readonly",
                "--mount", f"type=bind,source={ROOT / 'tests/browser-fixture'},target=/workspace/tests/browser-fixture,readonly",
                "--mount", f"type=bind,source={owner},target=/results",
                "--workdir", "/workspace/browser-collector", "-e", "HOME=/tmp/collector",
                "-e", "GEO_BROWSER_TEST_CANARIES", "-e", "GEO_BROWSER_CONTRACT_OUTPUT=/results/values.jsonl",
                "mcr.microsoft.com/playwright:v1.61.1-noble", *command,
            ]
            if os.getuid() == 0:
                # CI宿主root时供镜像pwuser写入；目录只有虚构测试输出。
                os.chown(owner, 1000, 1000)
        cleanup_ok = True
        try:
            with subprocess.Popen(command, cwd=ROOT / "browser-collector", env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  start_new_session=True) as process:
                try:
                    stdout, stderr = process.communicate(timeout=120)
                except (subprocess.TimeoutExpired, KeyboardInterrupt):
                    # 先给Node/Playwright正常清理机会，之后仅终止本轮进程组。
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.communicate(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.communicate()
                    raise
                result = subprocess.CompletedProcess(command, process.returncode, stdout, stderr)
        except (OSError, subprocess.TimeoutExpired, KeyboardInterrupt):
            print("BROWSER_CONTRACT_RUNNER_UNAVAILABLE", file=sys.stderr)
            return 1
        finally:
            if args.container:
                try:
                    remaining = subprocess.run(
                        ["docker", "ps", "-aq", "--filter", f"label=partsignal.geo803.owner={container_owner}"],
                        capture_output=True, text=True, timeout=10, check=True,
                    ).stdout.split()
                    for container_id in remaining:
                        if not re.fullmatch(r"[0-9a-f]{12,64}", container_id):
                            raise ValueError("容器身份无效")
                        subprocess.run(["docker", "rm", "--force", container_id],
                                       capture_output=True, timeout=10, check=True)
                except (OSError, ValueError, subprocess.SubprocessError):
                    cleanup_ok = False
                    print("BROWSER_CONTRACT_CLEANUP_FAILED", file=sys.stderr)
        if not cleanup_ok:
            return 1
        try:
            assert_secrets_absent([result.stdout, result.stderr], canaries)
            for path in owner.rglob("*"):
                if path.is_file():
                    assert_secrets_absent([path.read_bytes()], canaries)
        except (AssertionError, ValueError, OSError):
            print("BROWSER_CONTRACT_OUTPUT_INVALID：日志/产物扫描失败；内容未输出", file=sys.stderr)
            return 1
        sys.stdout.buffer.write(result.stdout)
        sys.stderr.buffer.write(result.stderr)
        try:
            rows = [json.loads(line) for line in output.read_text().splitlines()]
            answer_type = TypeAdapter(CollectedAnswer)
            failure_type = TypeAdapter(CollectorFailure)
            for row in rows:
                if row["failure"] is not None:
                    failure_type.validate_python(row["failure"], strict=False)
                else:
                    answer_type.validate_python(row["result"], strict=False)
            if len(rows) != 18:
                raise ValueError("合同结果不完整")
        except (AssertionError, ValueError, OSError):
            # 不能打印ValidationError；它可能携带DOM或秘密值。
            print("BROWSER_CONTRACT_OUTPUT_INVALID：权威类型校验或结果完整性失败", file=sys.stderr)
            return 1
        print(f"BROWSER_CONTRACT_RESULT tests={result.returncode} typed_results={len(rows)} secret_scan=0 external_network=blocked")
        return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
