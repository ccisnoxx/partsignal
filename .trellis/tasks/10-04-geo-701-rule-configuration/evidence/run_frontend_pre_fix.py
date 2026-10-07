"""只重放修复前effect时机，测试完成必恢复候选，退出码记录真实回归结果。"""
from pathlib import Path
import subprocess
import json
import hashlib
p=Path("frontend/src/domains/geo-rules/geo-rules-page.tsx")
fixed=p.read_bytes()
try:
    p.write_bytes(fixed.replace(b"useLayoutEffect", b"useEffect"))
    result=subprocess.run(["npm","--prefix","frontend","run","test","--","src/domains/geo-rules/geo-rules-page.test.tsx","-t","新 token commit"])
finally:
    p.write_bytes(fixed)
    print(json.dumps({"candidate_restored":p.read_bytes()==fixed,"sha256":hashlib.sha256(fixed).hexdigest()}))
raise SystemExit(result.returncode)
