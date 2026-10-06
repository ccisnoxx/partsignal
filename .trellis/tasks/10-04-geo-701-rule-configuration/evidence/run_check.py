"""记录实际命令、退出码和完整输出，不预写通过状态。"""
import datetime
import json
import pathlib
import subprocess
import sys
import time

name, *command = sys.argv[1:]
base = pathlib.Path(__file__).resolve().parent
started = datetime.datetime.now(datetime.UTC).isoformat()
begin = time.perf_counter()
with (base / (name + ".log")).open("w") as output:
    result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
record = {"command": command, "started_at": started, "duration_seconds": time.perf_counter()-begin, "exit_code": result.returncode}
(base / (name + ".json")).write_text(json.dumps(record, ensure_ascii=False, indent=2)+"\n")
print(json.dumps(record, ensure_ascii=False))
sys.exit(result.returncode)
