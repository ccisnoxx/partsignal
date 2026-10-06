"""保存本任务精确命令、退出码与日志。"""
import json
import subprocess
import sys
import time
from pathlib import Path

name, *argv = sys.argv[1:]
evidence = Path(__file__).resolve().parent
start = time.monotonic()
with (evidence / f'{name}.log').open('w') as log:
    result = subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT)
record = {'argv': argv, 'exit_code': result.returncode, 'elapsed_seconds': round(time.monotonic()-start, 3)}
(evidence / f'{name}.json').write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(record, ensure_ascii=False))
print((evidence / f'{name}.log').read_text()[-3000:])
sys.exit(result.returncode)
