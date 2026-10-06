"""保存每条验证命令的实际日志、退出码和耗时。"""
import json
from pathlib import Path
import subprocess
import sys
import time

owner = Path(__file__).resolve().parent / 'checks'
check_id, *command = sys.argv[1:]
started = time.monotonic()
with (owner / f'{check_id}.log').open('w') as log:
    result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, check=False)
record = {'command': command, 'exit_code': result.returncode,
          'seconds': round(time.monotonic() - started, 3), 'log': f'{check_id}.log'}
(owner / f'{check_id}.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(record, ensure_ascii=False))
print('\n'.join((owner / f'{check_id}.log').read_text().splitlines()[-8:]))
sys.exit(result.returncode)
