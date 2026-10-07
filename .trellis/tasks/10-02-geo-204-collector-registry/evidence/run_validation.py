"""保存本任务的实际命令、完整输出及退出码，不把 skip 当作通过。"""

import json
from pathlib import Path
import subprocess
import sys
import time

name, *command = sys.argv[1:]
destination = Path(__file__).resolve().parent
started = time.time()
with (destination / f"{name}.log").open("w") as output:
    result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=False)
summary = {"command": command, "exit_code": result.returncode, "elapsed_seconds": round(time.time() - started, 2)}
(destination / f"{name}.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(summary, ensure_ascii=False))
print((destination / f"{name}.log").read_text()[-2500:])
sys.exit(result.returncode)
