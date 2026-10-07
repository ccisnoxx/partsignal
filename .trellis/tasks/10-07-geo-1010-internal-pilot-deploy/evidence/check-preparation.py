"""只读核对 DEPLOY 准备输入；结果不表示冻结候选或目标部署通过。"""

import ast
import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def tracked_allowlist(relative: str) -> set[str]:
    tree = ast.parse((ROOT / relative).read_text())
    node = next(
        node for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "REQUIRED_TRACKED_FILES"
                for target in node.targets)
    )
    return set(ast.literal_eval(node.value))


def command(*arguments: str) -> dict:
    completed = subprocess.run(
        arguments, cwd=ROOT, capture_output=True, text=True, check=False,
    )
    return {"command": list(arguments), "exit_code": completed.returncode,
            "stdout": completed.stdout.strip(), "stderr": completed.stderr.strip()}


def main() -> None:
    ui_dir = ROOT / ".trellis/tasks/10-07-geo-1010-ui-business-closure"
    ui = json.loads((ui_dir / "acceptance.json").read_text())
    source_errors = []
    for relative, expected in ui["accepted_worktree_sources"].items():
        path = ROOT / relative
        actual = {"exists": path.is_file(),
                  "sha256": digest(path) if path.is_file() else None}
        if actual != expected:
            source_errors.append(relative)
    evidence_errors = [
        relative for relative, expected in ui["evidence_sha256"].items()
        if not (ROOT / relative).is_file() or digest(ROOT / relative) != expected
    ]
    old_gate_dir = ROOT / ".trellis/tasks/10-06-geo-1009-candidate-freeze"
    old_gate = json.loads(
        (old_gate_dir / "evidence/main-business-priority-gate-20261007.json").read_text()
    )
    old_log = Path(old_gate["log_path"])
    producer = tracked_allowlist("deploy/scripts/create-release-manifest.py")
    consumer = tracked_allowlist("deploy/scripts/prepare-production-data.py")
    worker = ast.parse((ROOT / "backend/app/worker.py").read_text())
    beat = next(
        keyword.value for node in ast.walk(worker) if isinstance(node, ast.Call)
        for keyword in node.keywords if keyword.arg == "beat_schedule"
    )
    registered = {
        key.value: next(value.value for field, value in zip(fields.keys, fields.values, strict=True)
                        if field.value == "task")
        for key, fields in zip(beat.keys, beat.values, strict=True)
    }
    allowed = {
        "partsignal.redispatch_pending_geo_analyses",
        "partsignal.recover_expired_geo_analyses",
        "partsignal.recover_expired_generation_jobs",
        "partsignal.redispatch_pending_generation_jobs",
        "partsignal.recover_expired_geo_runs",
        "partsignal.redispatch_pending_geo_runs",
        "partsignal.geo_cleanup_artifacts",
        "partsignal.cleanup_platform_logo_files",
    }
    manifest = yaml.safe_load(
        (ROOT / "docs/geo-monitoring/04-delivery/task-manifest.yaml").read_text()
    )
    dependencies = {row["id"]: row["status"] for row in manifest["tasks"]
                    if row["id"] in {"GEO-1009", "GEO-1010"}}
    dependencies["GEO-1010-UI"] = json.loads((ui_dir / "task.json").read_text())["status"]
    heads = command("backend/.venv/bin/alembic", "-c", "backend/alembic.ini", "heads")
    tools = [command("docker", "version", "--format", "{{.Client.Version}}|{{.Server.Version}}"),
             command("docker", "compose", "version", "--short")]
    checks = {
        "recorded_at_utc": datetime.now(UTC).isoformat(),
        "evidence_scope": "当前未提交工作树的准备核对；不证明新候选完整门禁或现场",
        "dependencies": dependencies,
        "ui_acceptance_source_count": len(ui["accepted_worktree_sources"]),
        "ui_acceptance_source_mismatches": source_errors,
        "ui_acceptance_evidence_count": len(ui["evidence_sha256"]),
        "ui_acceptance_evidence_mismatches": evidence_errors,
        "geo1009_accepted_commit": old_gate["commit"],
        "geo1009_log_hash_matches": old_log.is_file() and digest(old_log) == old_gate["log_sha256"],
        "producer_consumer_tracked_allowlist_match": producer == consumer,
        "tracked_file_count": len(producer),
        "tracked_file_hashes": {relative: digest(ROOT / relative) for relative in sorted(producer)},
        "scheduler_beat_schedule": registered,
        "scheduler_allowed_set_matches": set(registered.values()) == allowed,
        "schema_head_check": heads,
        "local_tool_checks": tools,
        "observed_runtime_flags": None,
        "candidate_full_gate": "NOT_RUN",
        "target_readiness": "NOT_VERIFIED",
        "deployment_performed": False,
    }
    passed = (
        not source_errors and not evidence_errors and checks["geo1009_log_hash_matches"]
        and producer == consumer and len(producer) == 13
        and set(registered.values()) == allowed
        and dependencies["GEO-1009"] == dependencies["GEO-1010-UI"] == "done"
        and heads["exit_code"] == 0 and heads["stdout"] == "0066_geo_manual_evaluation (head)"
        and all(result["exit_code"] == 0 for result in tools)
    )
    checks["preparation_check_passed"] = passed
    (EVIDENCE / "preparation-checks.json").write_text(
        json.dumps(checks, ensure_ascii=False, indent=2) + "\n"
    )
    print(json.dumps({"preparation_check_passed": passed,
                      "ui_sources": checks["ui_acceptance_source_count"],
                      "ui_evidence": checks["ui_acceptance_evidence_count"],
                      "tracked_files": len(producer), "scheduled_tasks": len(registered),
                      "schema_head": heads["stdout"], "candidate_gate": "NOT_RUN"},
                     ensure_ascii=False))
    raise SystemExit(0 if passed else 1)


if __name__ == "__main__":
    main()
