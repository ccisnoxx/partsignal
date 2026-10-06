"""保存本任务命令、退出码及完整输出；不推断跳过项通过。"""
import json
import shlex
import subprocess
import sys
import time
from pathlib import Path

name, *command = sys.argv[1:]
evidence = Path(__file__).resolve().parent
started = time.monotonic()
with (evidence / f"{name}.log").open("w") as output:
    result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=False)
record = {"command": shlex.join(command), "exit_code": result.returncode,
          "duration_seconds": round(time.monotonic() - started, 2), "log": f"{name}.log"}
(evidence / f"{name}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(record, ensure_ascii=False))
print((evidence / f"{name}.log").read_text()[-7000:])
sys.exit(result.returncode)
