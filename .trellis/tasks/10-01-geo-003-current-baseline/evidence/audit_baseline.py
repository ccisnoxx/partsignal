"""核对 GEO-003 文档交付；只写任务审计文件和独立临时 Git index。"""

import ast
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import unquote

import yaml


root = Path.cwd()
task = root / ".trellis/tasks/10-01-geo-003-current-baseline"
docs = root / "docs/geo-monitoring"
baseline = docs / "04-delivery/geo-003-baseline"
initial = task / "evidence"
sources = json.loads((baseline / "sources.json").read_text())
head = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
assert head == sources["head"]
for name, digest in sources["files"].items():
    assert hashlib.sha256((root / name).read_bytes()).hexdigest() == digest, name

protected = ["contracts", "backend", "frontend", "deploy", "Makefile",
             "AGENTS.md", "README.md", ".trellis/spec"]
changed = subprocess.check_output(["git", "diff", "HEAD", "--name-only", "--", *protected], text=True)
assert not changed, changed

original = yaml.safe_load((initial / "initial-manifest.yaml").read_text())
current = yaml.safe_load((docs / "04-delivery/task-manifest.yaml").read_text())
old_tasks = {t["id"]: t for t in original["tasks"]}
new_tasks = {t["id"]: t for t in current["tasks"]}
assert old_tasks.keys() == new_tasks.keys()
for name, value in old_tasks.items():
    if name != "GEO-003":
        assert value == new_tasks[name], name
assert new_tasks["GEO-003"]["status"] == "review"
assert new_tasks["GEO-003"]["dependencies"] == ["GEO-001", "GEO-002"]
assert all(new_tasks[n]["status"] == "done" for n in ["GEO-001", "GEO-002"])
assert {k: v for k, v in old_tasks["GEO-003"].items() if k != "status"} == {
    k: v for k, v in new_tasks["GEO-003"].items()
    if k not in {"status", "baseline_record", "validation_record", "trellis_task", "review_note"}
}
assert {k: v for k, v in original.items() if k != "tasks"} == {
    k: v for k, v in current.items() if k != "tasks"
}
assert json.loads((task / "task.json").read_text())["status"] == "review"

allowed_existing = {"./README.md", "./CHANGELOG.md", "./04-delivery/task-manifest.yaml"}
for line in (initial / "initial-document-sha256sums.txt").read_text().splitlines():
    digest, name = line.split("  ", 1)
    if name not in allowed_existing:
        assert hashlib.sha256((docs / name).read_bytes()).hexdigest() == digest, name

parsed = {p.name: json.loads(p.read_text()) for p in baseline.glob("*.json")}
api = parsed["openapi.json"]
contract = yaml.safe_load((root / "contracts/openapi.yaml").read_text())
assert api["paths"] == {p: v for p, v in contract["paths"].items()
                        if p.startswith(("/api/v1/geo-", "/api/v1/query-topics"))}
for group, values in api["components"].items():
    for name, value in values.items():
        assert value == contract["components"][group][name], (group, name)


def check_references(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "$ref":
                assert item.startswith("#/"), item
                target = api
                for part in item[2:].split("/"):
                    target = target[part.replace("~1", "/").replace("~0", "~")]
            else:
                check_references(item)
    elif isinstance(value, list):
        for item in value:
            check_references(item)


check_references(api)
migrations = parsed["migrations.json"]["revisions"]
revisions = {m["revision"] for m in migrations}
assert len(revisions) == len(migrations) == 43
assert all(m["down_revision"] is None or m["down_revision"] in revisions for m in migrations)
assert revisions - {m["down_revision"] for m in migrations} == {"0043_geo_platform_identity"}

link_count = 0
for path in [*docs.rglob("*.md"), *task.glob("*.md")]:
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", path.read_text()):
        if target.startswith(("https:", "http:", "#")):
            continue
        target = unquote(target.split("#", 1)[0].strip("<>"))
        assert (path.parent / target).resolve().exists(), (str(path), target)
        link_count += 1
for path in task.glob("*.jsonl"):
    for line in path.read_text().splitlines():
        entry = json.loads(line)
        assert (root / entry["file"]).exists(), entry
for path in (task / "evidence").glob("*.py"):
    ast.parse(path.read_text(), filename=str(path))

checksums = {}
for line in (docs / "SHA256SUMS").read_text().splitlines():
    digest, name = line.split("  ", 1)
    checksums[name.removeprefix("./")] = digest
files = {str(p.relative_to(docs)) for p in docs.rglob("*") if p.is_file() and p.name != "SHA256SUMS"}
assert checksums.keys() == files
assert all(hashlib.sha256((docs / p).read_bytes()).hexdigest() == d for p, d in checksums.items())

paths = [str(p.relative_to(root)) for p in task.rglob("*") if p.is_file()]
paths += ["docs/geo-monitoring/README.md", "docs/geo-monitoring/CHANGELOG.md",
          "docs/geo-monitoring/SHA256SUMS", "docs/geo-monitoring/04-delivery/task-manifest.yaml",
          "docs/geo-monitoring/04-delivery/06-current-geo-baseline.md"]
paths += [str(p.relative_to(root)) for p in baseline.rglob("*") if p.is_file()]
with tempfile.TemporaryDirectory(prefix="partsignal-geo-003-index-") as directory:
    env = dict(os.environ, GIT_INDEX_FILE=str(Path(directory) / "index"))
    subprocess.run(["git", "read-tree", "HEAD"], env=env, check=True)
    subprocess.run(["git", "add", "--intent-to-add", "--", *paths], env=env, check=True)
    raw_check = subprocess.run(["git", "diff", "--check"], env=env, text=True, capture_output=True)
    # 工具日志逐字保留；其中 Vite 尾随空格和命令输出空行不作源码修改。
    check = subprocess.run(
        ["git", "diff", "--check", "--", ".",
         ":(glob,exclude).trellis/tasks/10-01-geo-003-current-baseline/evidence/checks/*.log"],
        env=env, text=True, capture_output=True,
    )
    assert check.returncode == 0, check.stdout + check.stderr

result = {
    "task": "GEO-003", "status": "review", "date": "2026-10-01", "head": head,
    "source_hashes_verified": len(sources["files"]),
    "protected_tracked_changes": [], "existing_target_docs_preserved": True,
    "non_geo_003_manifest_entries_unchanged": True, "dependencies": {"GEO-001": "done", "GEO-002": "done"},
    "snapshot_contract_and_refs_valid": True, "migration_source_graph_valid": True,
    "markdown_local_links_verified": link_count, "docs_checksum_files_verified": len(checksums),
    "temporary_index_git_diff_check_exit_code": check.returncode,
    "temporary_index_scope": "本任务文档、任务源码及结构化快照；排除逐字保留的原始 *.log",
    "verbatim_log_diff_check_exit_code": raw_check.returncode,
    "verbatim_log_whitespace_diagnostics": raw_check.stdout + raw_check.stderr,
    "user_index_modified": False, "live_database_verified": False,
    "verify_completed": False, "verify_blocker": "/var/run/docker.sock 不存在",
    "command": "UV_CACHE_DIR=.cache/uv uv run --project backend python .trellis/tasks/10-01-geo-003-current-baseline/evidence/audit_baseline.py",
}
(task / "evidence/final-audit.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(result, ensure_ascii=False))
