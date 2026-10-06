"""相对开始时的工作区原像验证 GEO-605 范围，不以 HEAD 覆盖其他任务。"""
from pathlib import Path
import hashlib
import json
import subprocess

import yaml

evidence = Path(__file__).resolve().parent
root = evidence.parents[3]
baseline = json.loads((evidence / "baseline-files.json").read_text())


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


raw_paths = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], cwd=root
).decode().split("\0")
paths = sorted({p for p in raw_paths if p and (root / p).is_file()})
changed = sorted(p for p, old in baseline.items() if (root / p).is_file() and digest(root / p) != old)
removed = sorted(p for p in baseline if not (root / p).exists())
new = [p for p in paths if p not in baseline and "/evidence/" not in p]
allowed_existing = {
    "deploy/scripts/e2e-local.sh",
    "docs/geo-monitoring/03-technical/04-frontend-architecture.md",
    "docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md",
    "docs/geo-monitoring/04-delivery/task-manifest.yaml",
    "docs/geo-monitoring/README.md",
    "docs/geo-monitoring/CHANGELOG.md",
    "docs/geo-monitoring/SHA256SUMS",
    "frontend/src/app/navigation.ts",
    "frontend/src/app/navigation.test.ts",
    "frontend/src/app/layout/app-shell.tsx",
    "frontend/src/routeTree.gen.ts",
    "frontend/tests/e2e/plans-real-stack.spec.ts",
}
allowed_new_prefixes = (
    ".trellis/tasks/10-04-geo-605-insights-ui/",
    "frontend/src/domains/geo-insights/",
)
allowed_new_files = {
    "frontend/src/routes/_app/geo/overview.tsx",
    "frontend/src/routes/_app/geo/insights/answers.tsx",
    "frontend/tests/e2e/insights-real-stack.spec.ts",
}
assert not removed, removed
assert not set(changed) - allowed_existing, set(changed) - allowed_existing
assert not [p for p in new if p not in allowed_new_files and not p.startswith(allowed_new_prefixes)]

manifest_path = "docs/geo-monitoring/04-delivery/task-manifest.yaml"
before = yaml.safe_load((evidence / "before" / manifest_path).read_text())
after = yaml.safe_load((root / manifest_path).read_text())
assert {k: v for k, v in before.items() if k != "tasks"} == {k: v for k, v in after.items() if k != "tasks"}
old_tasks = {t["id"]: t for t in before["tasks"]}
new_tasks = {t["id"]: t for t in after["tasks"]}
assert old_tasks.keys() == new_tasks.keys()
for task_id in old_tasks:
    if task_id != "GEO-605":
        assert old_tasks[task_id] == new_tasks[task_id], task_id
    else:
        mutable = {"status", "trellis_task", "execution_note", "review_note"}
        assert {k: v for k, v in old_tasks[task_id].items() if k not in mutable} == {
            k: v for k, v in new_tasks[task_id].items() if k not in mutable
        }
assert new_tasks["GEO-605"]["status"] == "review"
assert all(new_tasks[t]["status"] == "done" for t in ("GEO-602", "GEO-603", "GEO-604"))
assert all(new_tasks[t]["status"] == "planned" for t in ("GEO-606", "GEO-706"))

contracts = ("contracts/openapi.yaml", "contracts/database.md", "frontend/src/shared/api/generated/schema.d.ts")
unchanged = {p: digest(root / p) == baseline[p] for p in contracts}
assert all(unchanged.values()), unchanged
runner = (root / "deploy/scripts/e2e-local.sh").read_bytes()
assert hashlib.sha256(runner.replace(b"    tests/e2e/insights-real-stack.spec.ts \\\n", b"")).hexdigest() == baseline["deploy/scripts/e2e-local.sh"]
for line in (root / "docs/geo-monitoring/SHA256SUMS").read_text().splitlines():
    expected, name = line.split("  ", 1)
    assert digest(root / "docs/geo-monitoring" / name) == expected, name

result = dict(changed_existing=changed, new_maintained=new, removed=removed, contract_unchanged=unchanged)
(evidence / "scope-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(dict(status="passed", changed_existing=len(changed), new_maintained=len(new),
                     other_manifest_tasks_unchanged=True, contract_unchanged=unchanged,
                     document_hashes_valid=True), ensure_ascii=False, indent=2))
