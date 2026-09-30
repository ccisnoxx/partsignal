"""从worktree向精确Hostdzire阶段送入冻结脚本；仅保存其安全stdout。"""
import hashlib,json,os,subprocess,sys
from datetime import datetime,timezone
from pathlib import Path
root=Path(__file__).resolve().parent
stage=sys.argv[1]
started=datetime.now(timezone.utc).isoformat()
p=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15','hostdzire','python3','-',stage],input=(root/'rollout-remote.py').read_bytes(),capture_output=True,timeout=1200)
# stdout仅为冻结脚本固定JSON；stderr不保存，避免第三方原始输出。
doc=[json.loads(line) for line in p.stdout.decode().splitlines() if line]
result={'stage':stage,'started_utc':started,'finished_utc':datetime.now(timezone.utc).isoformat(),'exit_code':p.returncode,'records':doc,'stderr_bytes':len(p.stderr)}
path=root/(stage+'-result.json');assert not path.exists();path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');os.chmod(path,0o600)
print(json.dumps({'stage':stage,'exit_code':p.returncode,'result_bytes':path.stat().st_size,'result_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'last':doc[-1] if doc else None}))
raise SystemExit(p.returncode)
