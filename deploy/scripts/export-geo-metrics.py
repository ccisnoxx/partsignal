"""原子更新受保护textfile；超时/失败撤销旧成功指标，不输出命令或异常。"""

import argparse
import os
import subprocess
import tempfile
from pathlib import Path

FAILURE = "# TYPE geo_observability_up gauge\ngeo_observability_up 0\n"


def export(command: list[str], output: Path, timeout: int) -> int:
    body = FAILURE
    status = 1
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
        if result.returncode == 0 and "\ngeo_observability_up 1\n" in "\n" + result.stdout:
            body = result.stdout
            status = 0
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        pass  # 下面写入显式up=0；原始stderr/命令/环境不进入监控输出。
    descriptor, name = tempfile.mkstemp(prefix=".geo-metrics-", dir=output.parent)
    try:
        with os.fdopen(descriptor, "w") as temporary:
            temporary.write(body)
        os.replace(name, output)
    finally:
        Path(name).unlink(missing_ok=True)
    return status


def main() -> None:
    parser = argparse.ArgumentParser(description="GEO metrics原子textfile导出")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command or args.timeout < 1:
        parser.error("需要导出命令与正整数timeout")
    try:
        raise SystemExit(export(command, args.output, args.timeout))
    except OSError:
        parser.exit(1, "GEO textfile不可写；检查受保护目录权限。\n")


if __name__ == "__main__":
    main()
