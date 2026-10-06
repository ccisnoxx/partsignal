"""保存本任务验证的精确argv、退出码与日志；不吞掉失败。"""

import json
from datetime import UTC, datetime
from pathlib import Path
import subprocess
import sys

name, *argv = sys.argv[1:]
directory = Path(__file__).resolve().parent
started = datetime.now(UTC).isoformat()
with (directory / f"{name}.log").open("w") as log:
    result = subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT)
record = {"argv": argv, "cwd": str(Path.cwd()), "exit_code": result.returncode,
    "started_at": started, "finished_at": datetime.now(UTC).isoformat()}
(directory / f"{name}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(record, ensure_ascii=False))
sys.exit(result.returncode)
