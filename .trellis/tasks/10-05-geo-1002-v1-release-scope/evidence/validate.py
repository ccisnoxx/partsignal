"""GEO-1002 离线文档、依赖与授权范围检查；不连接业务服务。"""
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote, urlsplit
import yaml

ROOT = Path(__file__).resolve().parents[4]
EV = Path(__file__).resolve().parent
DOCS = ROOT / 'docs/geo-monitoring'
BEFORE = EV / 'before'


def original(path):
    snap = BEFORE / path.relative_to(ROOT)
    return snap.read_text() if snap.is_file() else path.read_text()


def anchors(text):
    text = re.sub(r'(?ms)^(`{3,}|~{3,}).*?^\1[^\n]*$', '', text)
    result = set(re.findall(r'<[a-z]+\s+[^>]*?(?:id|name)=[\"\']([^\"\']+)', text))
    counts = {}
    for title in re.findall(r'(?m)^#{1,6}\s+(.+?)\s*#*\s*$', text):
        title = re.sub(r'<[^>]*>|[*`~]', '', title).lower()
        slug = re.sub(r'[^\w\- ]', '', title).replace(' ', '-')
        count = counts.get(slug, 0)
        counts[slug] = count + 1
        result.add(slug + (f'-{count}' if count else ''))
    return result


def links(baseline=False):
    paths = sorted((BEFORE / 'docs/geo-monitoring' if baseline else DOCS).rglob('*.md'))
    if baseline:
        paths = [ROOT / p.relative_to(BEFORE) for p in paths]
    if not baseline:
        paths += sorted(EV.parent.glob('*.md'))
    checked, broken, cache = 0, [], {}
    for p in paths:
        text = original(p) if baseline else p.read_text()
        text = re.sub(r'(?ms)^(`{3,}|~{3,}).*?^\1[^\n]*$', '', text)
        targets = re.findall(r'!?\[[^\]\n]+\]\((<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)', text)
        targets += re.findall(r'(?m)^\[[^\]]+\]:\s*(\S+)', text)
        for target in targets:
            parts = urlsplit(target.strip('<>'))
            if parts.scheme or parts.netloc:
                continue
            checked += 1
            raw = re.sub(r':\d+$', '', unquote(parts.path))
            dest = (p.parent / raw).resolve() if raw else p
            error = None
            if not dest.exists() or not dest.is_relative_to(ROOT):
                error = 'missing_path'
            elif parts.fragment and dest.suffix == '.md':
                if dest not in cache:
                    cache[dest] = anchors(original(dest) if baseline else dest.read_text())
                if unquote(parts.fragment) not in cache[dest]:
                    error = 'missing_anchor'
            if error:
                broken.append(dict(file=str(p.relative_to(ROOT)), target=target, error=error))
    return dict(checked=checked, broken=broken)


def manifest():
    p = DOCS / '04-delivery/task-manifest.yaml'
    raw = p.read_text()
    oldraw = original(p)
    data, old = yaml.safe_load(raw), yaml.safe_load(oldraw)
    assert raw.startswith(oldraw), 'R0—R8 原始任务字节被修改'
    assert data['tasks'][:len(old['tasks'])] == old['tasks']
    rows = {t['id']: t for t in data['tasks']}
    assert len(rows) == len(data['tasks'])
    expected = {f'GEO-{n}' for n in range(1002, 1011)}
    assert set(rows) - {t['id'] for t in old['tasks']} == expected
    assert data['status_values'] == old['status_values']
    for row in rows.values():
        assert row['status'] in data['status_values'], row['id']
        assert len(row['dependencies']) == len(set(row['dependencies']))
        assert all(d in rows and d != row['id'] for d in row['dependencies'])
        assert all((DOCS / name).is_file() for name in row['required_docs'])
    visited, active = set(), set()
    def visit(task):
        assert task not in active, f'依赖环：{task}'
        if task in visited:
            return
        active.add(task)
        for dep in rows[task]['dependencies']:
            visit(dep)
        active.remove(task)
        visited.add(task)
    for task in rows:
        visit(task)
    wbs = (DOCS / '04-delivery/02-work-breakdown-structure.md').read_text()
    for task in expected:
        row = rows[task]
        assert row['phase'] == 'R9A' and row['release'] == 'V1.0-manual-first'
        assert row['status'] == ('review' if task == 'GEO-1002' else 'planned')
        for field in ('deliverables', 'tests', 'acceptance'):
            assert row[field] and row[field] in wbs, (task, field)
        pending, seen = [task], set()
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            assert rows[current]['phase'] != 'R7', (task, current)
            assert rows[current]['status'] != 'deferred', (task, current)
            pending.extend(rows[current]['dependencies'])
    record = json.loads((EV.parent / 'task.json').read_text())
    assert record['status'] == 'review' and record['completedAt'] is None
    return dict(tasks=len(rows), original_tasks_unchanged=len(old['tasks']), new_tasks=len(expected), acyclic=True, geo1002='review', following_tasks='planned', r7_dependency=False)


def protection():
    hashes = json.loads((EV / 'protected-sha256.json').read_text())
    changed = [name for name, digest in hashes.items() if not (ROOT / name).is_file() or hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest]
    assert not changed, changed
    for name in ('docs/geo-monitoring/05-decisions/ADR-005-staged-collector-rollout.md', 'docs/geo-monitoring/05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md', 'docs/geo-monitoring/06-reviews/GEO-1001-release-readiness-audit.md', '.trellis/tasks/10-05-geo-906-rollout/evidence/production-readiness.yaml'):
        assert (ROOT / name).read_bytes() == (BEFORE / name).read_bytes(), name
    return dict(unchanged_protected_files=len(hashes), audit_and_original_readiness_unchanged=True, production_verified=False)


oldlinks, newlinks = links(True), links()
previous = {tuple(sorted(x.items())) for x in oldlinks['broken']}
added = [x for x in newlinks['broken'] if tuple(sorted(x.items())) not in previous]
remaining = {tuple(sorted(x.items())) for x in newlinks['broken']}
fixed = [x for x in oldlinks['broken'] if tuple(sorted(x.items())) not in remaining]
report = dict(manifest=manifest(), links=dict(checked=newlinks['checked'], baseline_broken=oldlinks['broken'], current_broken=newlinks['broken'], fixed=fixed, new_broken=added), protected=protection())
(EV / 'validation-results.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
print(json.dumps(dict(manifest=report['manifest'], links={k:(len(v) if isinstance(v,list) else v) for k,v in report['links'].items()}, protected=report['protected']), ensure_ascii=False, indent=2))
assert not added, added
assert not newlinks['broken'], '已有链接问题详见 validation-results.json'
