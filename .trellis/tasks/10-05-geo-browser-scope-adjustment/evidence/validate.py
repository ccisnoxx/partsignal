"""本次治理验收：离线合同、依赖、文档链接及未修改运行源码的证据。"""

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit

import yaml

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parent
DOCS = ROOT / "docs/geo-monitoring"
BEFORE = EVIDENCE / "before"


def content(path, baseline=False):
    snapshot = BEFORE / path.relative_to(ROOT)
    return (snapshot if baseline and snapshot.is_file() else path).read_text()


def anchors(text):
    text = re.sub(r"(?ms)^(`{3,}|~{3,}).*?^\1[^\n]*$", "", text)
    result = set(re.findall(r'<(?:a|[a-z]+)\s+[^>]*?(?:id|name)=[\"\']([^\"\']+)', text))
    counts = {}
    for title in re.findall(r"(?m)^#{1,6}\s+(.+?)\s*#*\s*$", text):
        title = re.sub(r"<[^>]*>|[*`~]", "", title).lower()
        slug = re.sub(r"[^\w\- ]", "", title).replace(" ", "-")
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(slug + (f"-{count}" if count else ""))
    return result


def links(baseline=False):
    paths = sorted((BEFORE / "docs/geo-monitoring" if baseline else DOCS).rglob("*.md"))
    task_root = BEFORE / ".trellis/tasks" if baseline else ROOT / ".trellis/tasks"
    for name in ("10-05-geo-804-approved-browser-adapter", "10-05-geo-browser-scope-adjustment"):
        paths.extend(sorted((task_root / name).glob("*.md")))
    if baseline:
        paths = [ROOT / p.relative_to(BEFORE) for p in paths]
    broken = []
    checked = 0
    cache = {}
    for path in paths:
        text = content(path, baseline)
        targets = re.findall(r"!?\[[^\]\n]+\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)", text)
        targets += re.findall(r"(?m)^\[[^\]]+\]:\s*(\S+)", text)
        for target in targets:
            target = target.strip("<>")
            parts = urlsplit(target)
            if parts.scheme or parts.netloc:
                continue
            checked += 1
            destination = (path.parent / unquote(parts.path)).resolve() if parts.path else path
            error = None
            if not destination.exists() or not destination.is_relative_to(ROOT):
                error = "missing_path"
            elif parts.fragment and destination.suffix == ".md":
                if destination not in cache:
                    cache[destination] = anchors(content(destination, baseline))
                if unquote(parts.fragment) not in cache[destination]:
                    error = "missing_anchor"
            if error:
                broken.append({"file": str(path.relative_to(ROOT)), "target": target, "error": error})
    return {"checked": checked, "broken": broken}


def manifest(baseline=False):
    path = DOCS / "04-delivery/task-manifest.yaml"
    value = yaml.safe_load(content(path, baseline))
    allowed = value["status_values"]
    assert len(allowed) == len(set(allowed))
    rows = {row["id"]: row for row in value["tasks"]}
    assert len(rows) == len(value["tasks"])
    for row in rows.values():
        assert row["status"] in allowed, row["id"]
        assert len(row["dependencies"]) == len(set(row["dependencies"])), row["id"]
        assert all(dep in rows for dep in row["dependencies"]), row["id"]
        assert all((DOCS / name).is_file() for name in row.get("required_docs", [])), row["id"]
    visited, active = set(), set()

    def visit(task):
        assert task not in active, f"cycle: {task}"
        if task in visited:
            return
        active.add(task)
        for dep in rows[task]["dependencies"]:
            visit(dep)
        active.remove(task)
        visited.add(task)

    for task in rows:
        visit(task)
    if not baseline:
        old = yaml.safe_load(content(path, True))
        oldrows = {row["id"]: row for row in old["tasks"]}
        assert set(allowed) == set(old["status_values"]) | {"deferred"}
        changed = {f"GEO-{n}" for n in (804, 805, 806, 807, 901, 903, 904, 906)}
        assert set(rows) == set(oldrows)
        for task, row in rows.items():
            assert row["dependencies"] == oldrows[task]["dependencies"], task
            if task not in changed:
                assert row == oldrows[task], task
        for n in range(801, 804):
            assert rows[f"GEO-{n}"]["status"] == "done"
        for n in range(804, 808):
            row = rows[f"GEO-{n}"]
            assert row["status"] == "deferred" and row["release"] == "post-core"
            assert row["deferred_reason"] and row["owner"] and row["resume_conditions"]
        for task in rows:
            if rows[task]["phase"] != "R8":
                continue
            pending, seen = [task], set()
            while pending:
                current = pending.pop()
                if current in seen:
                    continue
                seen.add(current)
                assert rows[current]["status"] != "deferred", (task, current)
                pending.extend(rows[current]["dependencies"])
        combined = content(DOCS / "04-delivery/codex-prompts/ALL_PROMPTS.md")
        wbs = content(DOCS / "04-delivery/02-work-breakdown-structure.md")
        for n in (804, 805, 806, 807, 901, 903, 904, 906):
            phase = "R7" if n < 900 else "R8"
            prompt = content(DOCS / f"04-delivery/codex-prompts/{phase}/GEO-{n}.md").strip()
            assert combined.count(prompt) == 1, n
            if n >= 900:
                for field in ("deliverables", "acceptance"):
                    assert rows[f"GEO-{n}"][field] in prompt, (n, field)
                    assert rows[f"GEO-{n}"][field] in wbs, (n, field)
        record = json.loads((ROOT / ".trellis/tasks/10-05-geo-804-approved-browser-adapter/task.json").read_text())
        assert record["status"] == "deferred" and record["completedAt"] is None
        assert record["meta"]["implementation_started"] is False
    return {"tasks": len(rows), "statuses": allowed, "acyclic": True}


def protected():
    original = json.loads((EVIDENCE / "protected-sha256.json").read_text())
    changed = [name for name, digest in original.items()
               if not (ROOT / name).is_file()
               or hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest]
    assert not changed, changed
    current = set()
    for scope in ("backend", "frontend", "browser-collector", "contracts", "deploy", ".github", "tests"):
        for path in (ROOT / scope).rglob("*"):
            if (path.is_file()
                and not any(part in {"node_modules", ".venv", "__pycache__", ".cache", "dist",
                                     "test-results", "playwright-report"} for part in path.parts)
                and path.suffix not in {".pyc", ".log"}):
                current.add(str(path.relative_to(ROOT)))
    assert current <= set(original), sorted(current - set(original))
    for name in (".env.example", ".env.production.example"):
        assert re.search(r"(?m)^GEO_BROWSER_COLLECTION_ENABLED=false$", (ROOT / name).read_text())
    settings = (ROOT / "backend/app/config.py").read_text()
    assert re.search(r'geo_browser_collection_enabled: bool = Field\(\s*False,', settings)
    compose = (ROOT / "deploy/compose.geo-browser.yaml").read_text()
    assert "profiles: [geo-browser]" in compose
    assert "GEO_BROWSER_COLLECTION_ENABLED: ${GEO_BROWSER_COLLECTION_ENABLED-false}" in compose
    service = (ROOT / "browser-collector/src/service.mjs").read_text()
    assert "environment[key] ?? 'false'" in service
    return {"unchanged_existing_source_config_files": len(original), "browser_defaults_false": True,
            "production_runtime_verified": False}


parser = argparse.ArgumentParser()
parser.add_argument("--baseline", action="store_true")
args = parser.parse_args()
report = {"manifest": manifest(args.baseline), "links": links(args.baseline)}
if not args.baseline:
    baseline = json.loads((EVIDENCE / "baseline-validation.json").read_text())
    previous = {tuple(sorted(row.items())) for row in baseline["links"]["broken"]}
    added = [row for row in report["links"]["broken"] if tuple(sorted(row.items())) not in previous]
    assert not added, added
    report["links"]["new_broken"] = added
    report["protected"] = protected()
print(json.dumps(report, ensure_ascii=False, indent=2))
