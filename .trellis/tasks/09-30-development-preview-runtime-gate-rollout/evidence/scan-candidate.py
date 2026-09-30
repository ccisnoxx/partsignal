import json
from pathlib import Path
import re
import subprocess

root = Path.cwd()
output = root / '.trellis/tasks/09-30-development-preview-runtime-gate-rollout/evidence/tracked-secret-scan.json'
def git(*args):
    return subprocess.check_output(['git', *args], cwd=root)
tracked = set(git('ls-files', '-z').decode().split('\0')) - {''}
changed = set(git('diff', '--name-only', 'HEAD', '-z').decode().split('\0')) - {''}
untracked = set(git('ls-files', '--others', '--exclude-standard', '-z').decode().split('\0')) - {''}
patterns = [
    re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    re.compile(rb'\b(?:sk-(?:proj-)?|sk_live_)[A-Za-z0-9_-]{20,}'),
    re.compile(rb'\bAKIA[A-Z0-9]{16}\b'),
    re.compile(rb'Bearer [A-Za-z0-9._-]{20,}'),
    re.compile(rb'\b(?:ghp_|github_pat_)[A-Za-z0-9_]{30,}'),
]
findings = []
for name in sorted(tracked | untracked):
    path = root / name
    if not path.is_file():
        continue
    data = path.read_bytes()
    for index, pattern in enumerate(patterns):
        if pattern.search(data):
            prior = subprocess.run(['git', 'show', 'HEAD:' + name], cwd=root, capture_output=True)
            findings.append({'path': name, 'pattern_index': index, 'unchanged_from_HEAD': prior.returncode == 0 and prior.stdout == data, 'candidate_path': name in changed | untracked})
protected = sorted(tracked & {'.env', '.env.staging', '.env.production', '.env.production.ai.json'})
parsed = []
for task in ['09-30-development-preview-runtime-gate-rollout']:
    for path in sorted((root / '.trellis/tasks' / task).rglob('*')):
        if path.suffix == '.json':
            json.loads(path.read_text())
            parsed.append(str(path.relative_to(root)))
        elif path.suffix == '.jsonl':
            for line in path.read_text().splitlines():
                if line.strip():
                    json.loads(line)
            parsed.append(str(path.relative_to(root)))
passed = not protected and all(x['unchanged_from_HEAD'] and not x['candidate_path'] for x in findings)
receipt = {'tracked_files_scanned': len(tracked), 'additional_untracked_candidates': len(untracked), 'findings': findings, 'protected_tracked': protected, 'parsed_task_json_jsonl': parsed, 'passed': passed}
output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'passed': passed, 'tracked_files_scanned': len(tracked), 'findings': len(findings), 'candidate_hits': sum(x['candidate_path'] for x in findings), 'protected_tracked': protected, 'json_jsonl_parsed': len(parsed)}))
raise SystemExit(0 if passed else 1)
