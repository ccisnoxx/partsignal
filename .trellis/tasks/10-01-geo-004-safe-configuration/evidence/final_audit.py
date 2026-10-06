"""GEO-004 最终范围与文档证据审计；不修改真实 Git index。"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

import yaml

ROOT = Path(__file__).resolve().parents[4]
TASK = Path(__file__).resolve().parents[1]
EVIDENCE = TASK / "evidence"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    records = json.loads((EVIDENCE / "initial-source-hashes.json").read_text())
    protected = [
        name for name in records
        if name.startswith("contracts/") or name in {
            "backend/app/main.py", "backend/app/worker.py",
            "deploy/compose.dev.yaml", "deploy/compose.staging.yaml",
            "deploy/compose.prod.yaml",
        }
    ]
    assert all(digest(ROOT / name) == records[name] for name in protected)
    before = yaml.safe_load((EVIDENCE / "initial-manifest.yaml").read_text())
    manifest_path = ROOT / "docs/geo-monitoring/04-delivery/task-manifest.yaml"
    after = yaml.safe_load(manifest_path.read_text())
    before_tasks = {item["id"]: item for item in before["tasks"]}
    after_tasks = {item["id"]: item for item in after["tasks"]}
    assert before.keys() == after.keys()
    assert before_tasks.keys() == after_tasks.keys()
    assert all(before[key] == after[key] for key in before if key != "tasks")
    assert all(before_tasks[key] == after_tasks[key] for key in before_tasks if key != "GEO-004")
    assert before_tasks["GEO-004"]["status"] == "planned"
    assert after_tasks["GEO-004"]["status"] == "review"
    added = {"trellis_task", "validation_record", "review_note"}
    assert after_tasks["GEO-004"].keys() - before_tasks["GEO-004"].keys() == added
    assert all(
        before_tasks["GEO-004"][key] == after_tasks["GEO-004"][key]
        for key in before_tasks["GEO-004"] if key != "status"
    )
    assert after_tasks["GEO-003"]["status"] == "done"
    task_record = json.loads((TASK / "task.json").read_text())
    assert task_record["status"] == task_record["meta"]["manifest_status"] == "review"
    assert task_record["completedAt"] is None
    owned = task_record["relatedFiles"]
    geo = ROOT / "docs/geo-monitoring"
    hash_count = 0
    for line in (geo / "SHA256SUMS").read_text().splitlines():
        expected, name = line.split("  ", 1)
        assert digest(geo / name) == expected, name
        hash_count += 1
    linked = [ROOT / name for name in owned if name.endswith(".md")]
    linked.extend([TASK / "prd.md", TASK / "implement.md", EVIDENCE / "independent-review.md"])
    link_count = 0
    for path in linked:
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text()):
            if "://" in target or target.startswith("#"):
                continue
            destination = target.split("#", 1)[0]
            assert (path.parent / destination).exists(), (path, target)
            link_count += 1
    check = subprocess.run(["git", "diff", "--check"], cwd=ROOT, capture_output=True, text=True)
    assert check.returncode == 0, check.stdout
    changed = subprocess.check_output(["git", "diff", "--name-only"], cwd=ROOT, text=True).splitlines()
    assert set(changed) <= set(owned), changed
    metadata = [str(path.relative_to(ROOT)) for path in TASK.glob("*.md")]
    metadata += [str(path.relative_to(ROOT)) for path in TASK.glob("*.json*")]
    metadata.append(str((EVIDENCE / "independent-review.md").relative_to(ROOT)))
    selected = sorted(set(owned + metadata))
    with tempfile.TemporaryDirectory(prefix="partsignal-geo-final-index-") as temporary:
        environment = {**os.environ, "GIT_INDEX_FILE": str(Path(temporary) / "index")}
        subprocess.run(["git", "read-tree", "HEAD"], cwd=ROOT, env=environment, check=True)
        subprocess.run(["git", "add", "--", *selected], cwd=ROOT, env=environment, check=True)
        staged = subprocess.run(
            ["git", "diff", "--cached", "--check"], cwd=ROOT,
            env=environment, capture_output=True, text=True,
        )
        assert staged.returncode == 0, staged.stdout
    migration_diff = subprocess.check_output(
        ["git", "diff", "--name-only", "--", "backend/alembic", "frontend", "contracts"],
        cwd=ROOT, text=True,
    ).splitlines()
    assert not migration_diff
    audit = {
        "status": "passed", "task": "GEO-004", "manifest_status": "review",
        "manifest_changes": ["GEO-004.status", *[f"GEO-004.{key}" for key in sorted(added)]],
        "other_tasks_unchanged": True, "protected_paths_unchanged": protected,
        "contract_migration_frontend_diff": migration_diff,
        "geo_document_hashes_checked": hash_count, "changed_document_links_checked": link_count,
        "tracked_diff_check_exit": check.returncode, "new_files_diff_check_exit": staged.returncode,
        "real_git_index_modified": False, "selected_owned_paths": selected,
        "limits": ["此审计不取代人工差异检查或测试；不读取真实生产 env。"],
    }
    (EVIDENCE / "final-audit.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    print(f"最终审计通过：{hash_count} 项文档哈希、{link_count} 条修改文档链接，保护文件与其他任务未改变。")


if __name__ == "__main__":
    main()
