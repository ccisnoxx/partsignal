from pathlib import Path
import difflib
import json

root = Path('/Users/sc/PycharmProjects/partsignal')
evidence = root / '.trellis/tasks/10-02-geo-209-plan-ui/evidence'
baseline = evidence / 'baseline'
new_files = ['frontend/src/domains/geo-plans/plan-actions.ts', 'frontend/src/domains/geo-plans/plan-controls.tsx', 'frontend/src/domains/geo-plans/plan-detail.tsx', 'frontend/src/domains/geo-plans/plan-list.tsx', 'frontend/src/domains/geo-plans/plan-options.tsx', 'frontend/src/domains/geo-plans/plan-preview.model.test.ts', 'frontend/src/domains/geo-plans/plan-preview.model.ts', 'frontend/src/domains/geo-plans/plan-preview.test.tsx', 'frontend/src/domains/geo-plans/plan-preview.tsx', 'frontend/src/domains/geo-plans/plan-wizard-steps.tsx', 'frontend/src/domains/geo-plans/plan-wizard.test.tsx', 'frontend/src/domains/geo-plans/plan-wizard.tsx', 'frontend/src/domains/geo-plans/plans-page.test.tsx', 'frontend/src/domains/geo-plans/plans-page.tsx', 'frontend/src/domains/geo-plans/plans.api.ts', 'frontend/src/domains/geo-plans/plans.model.test.ts', 'frontend/src/domains/geo-plans/plans.model.ts', 'frontend/src/domains/geo-plans/plans.options.ts', 'frontend/src/domains/geo-plans/plans.test-support.tsx', 'frontend/src/routes/_app/geo/plans.tsx', 'frontend/tests/e2e/plans-real-stack.spec.ts']
paths = sorted({p.relative_to(baseline).as_posix() for p in baseline.rglob('*') if p.is_file()} | set(new_files))
records, patches, whitespace = [], [], []
for name in paths:
    old = (baseline/name).read_text() if (baseline/name).is_file() else ''
    new = (root/name).read_text()
    if old == new:
        continue
    records.append({'path': name, 'kind': 'modified' if (baseline/name).is_file() else 'new', 'lines': len(new.splitlines())})
    patch = ''.join(difflib.unified_diff(old.splitlines(keepends=True), new.splitlines(keepends=True), fromfile='a/'+name if (baseline/name).is_file() else '/dev/null', tofile='b/'+name))
    patches.append(patch)
    for line in patch.splitlines():
        if line.startswith('+') and not line.startswith('+++') and line.rstrip() != line:
            whitespace.append({'path': name, 'line': line})
(evidence/'candidate.diff').write_text(''.join(patches))
(evidence/'changed-files.json').write_text(json.dumps(records, ensure_ascii=False, indent=2)+'\n')
(evidence/'scoped-diff-check.json').write_text(json.dumps(whitespace, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'candidate_files': len(records), 'new_files': sum(r['kind']=='new' for r in records), 'added_whitespace_errors': len(whitespace)}, ensure_ascii=False))
if whitespace:
    raise SystemExit(1)
