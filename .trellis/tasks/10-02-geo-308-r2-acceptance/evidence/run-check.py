"""本任务检查的真实命令、退出码和日志，不保存操作者私有环境。"""
import json
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parent
name, *command = sys.argv[1:]
started = datetime.now(timezone.utc).isoformat()
tick = time.monotonic()
with (root / (name + ".log")).open("w") as log:
    result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
record = {"command": command, "exit_code": result.returncode, "started_at": started,
          "seconds": round(time.monotonic() - tick, 2), "log": name + ".log"}
(root / (name + ".json")).write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(record, ensure_ascii=False))
print("\n".join((root / (name + ".log")).read_text(errors="replace").splitlines()[-22:]))
raise SystemExit(result.returncode)
