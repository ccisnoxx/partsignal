"""保存本任务精确argv/退出码/耗时，完整输出留独立日志。"""
import json
import subprocess
import sys
import time
from pathlib import Path

name, *command = sys.argv[1:]
destination = Path(__file__).resolve().parent
started = time.time()
with (destination / f"{name}.log").open("w") as output:
    result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
record = {"argv": command, "exit_code": result.returncode,
          "elapsed_seconds": round(time.time() - started, 3)}
(destination / f"{name}.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(record, ensure_ascii=False))
sys.exit(result.returncode)
