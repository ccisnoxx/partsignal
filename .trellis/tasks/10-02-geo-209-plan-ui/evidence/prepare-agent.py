from pathlib import Path
import json,subprocess
cli='/Users/sc/.codex/skills/multi-agent-orchestration/bin/work-plan'
audit=subprocess.check_output([cli,'audit-init','--repo-root',str(Path.cwd()),'--task-name','GEO-209 Plan UI','--risk','high'],text=True).strip()
stage=json.loads(subprocess.check_output([cli,'audit-stage',audit,'--name','wizard-implementation'],text=True))
Path('.trellis/tasks/10-02-geo-209-plan-ui/evidence/audit-stage.json').write_text(json.dumps({'audit':audit,'stage':stage},ensure_ascii=False,indent=2))
print(json.dumps(stage,indent=2))
