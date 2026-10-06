"""保存实际命令、结果与完整日志；不重试失败检查。"""
import json
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
name, command = sys.argv[1], sys.argv[2:]
with (root / f"{name}.log").open("w") as output:
    result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=False)
(root / f"{name}.json").write_text(json.dumps({"command": command, "exit_code": result.returncode}, ensure_ascii=False, indent=2) + "\n")
lines = (root / f"{name}.log").read_text(errors="replace").splitlines()
print(json.dumps({"name": name, "exit_code": result.returncode, "log": str(root / f"{name}.log")}, ensure_ascii=False))
print("\n".join(lines[-8:]))
sys.exit(result.returncode)
