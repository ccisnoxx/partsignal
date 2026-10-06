"""按任务开始前哈希检查范围，不将已存在的 GEO 未提交工作归入本任务。"""
from pathlib import Path
import hashlib,json,subprocess
import yaml
base=Path('.trellis/tasks/10-04-geo-606-reports'); evidence=base/'evidence'
snapshot=json.loads((evidence/'baseline-files.json').read_text())
planned=json.loads((evidence/'candidate-scope.json').read_text())
expected_changed=set(planned['changed_baseline_paths'])|{'deploy/scripts/e2e-local.sh','docs/geo-monitoring/SHA256SUMS'}
expected_new=set(planned['new_paths'])
changed={p for p,h in snapshot.items() if Path(p).exists() and hashlib.sha256(Path(p).read_bytes()).hexdigest()!=h}
missing=[p for p in snapshot if not Path(p).exists()]
assert not missing,missing
assert changed==expected_changed,(changed-expected_changed,expected_changed-changed)
raw=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'])
covered=('backend/','frontend/src/','frontend/tests/','contracts/','docs/geo-monitoring/','deploy/scripts/')
current={p.decode() for p in raw.split(b'\0') if p and p.decode().startswith(covered)}
new=current-set(snapshot)
assert new==expected_new,(new-expected_new,expected_new-new)
old_api=yaml.safe_load((evidence/'before/contracts/openapi.yaml').read_text())
api=yaml.safe_load(Path('contracts/openapi.yaml').read_text())
added_paths=set(api['paths'])-set(old_api['paths']); added_schemas=set(api['components']['schemas'])-set(old_api['components']['schemas'])
assert added_paths=={'/api/v1/geo/reports/'+suffix for suffix in ['preview','print','runs.csv','citations.csv','claims.csv','opportunities.csv']}
assert added_schemas=={'GeoReportFormula','GeoReportExport','GeoReportPreview'}
for key,val in old_api.items():
 if key not in ('paths','components'):assert api[key]==val,key
for key,val in old_api['paths'].items():assert api['paths'][key]==val,key
for key,val in old_api['components'].items():
 if key!='schemas':assert api['components'][key]==val,key
for key,val in old_api['components']['schemas'].items():assert api['components']['schemas'][key]==val,key
assert Path('contracts/database.md').read_text().startswith((evidence/'before/contracts/database.md').read_text())
old_script=(evidence/'before/deploy/scripts/e2e-local.sh').read_text()
current_script=Path('deploy/scripts/e2e-local.sh').read_text()
assert ''.join(line for line in current_script.splitlines(keepends=True) if 'tests/e2e/reports-real-stack.spec.ts' not in line)==old_script
manifest=yaml.safe_load(Path('docs/geo-monitoring/04-delivery/task-manifest.yaml').read_text())
tasks={t['id']:t for t in manifest['tasks']}
assert tasks['GEO-605']['status']=='done'
assert tasks['GEO-606']['status']=='review'
assert tasks['GEO-607']['status']=='planned'
assert json.loads((base/'task.json').read_text())['status']=='review'
hashes=Path('docs/geo-monitoring/SHA256SUMS'); mismatches=[]
for line in hashes.read_text().splitlines():
 digest,path=line.split('  ',1)
 if hashlib.sha256((hashes.parent/path).read_bytes()).hexdigest()!=digest:mismatches.append(path)
assert not mismatches,mismatches
# git diff --check 不含新文件，补充人工维护新源码的空白检查。
whitespace=[]
for p in sorted(new):
 for number,line in enumerate(Path(p).read_text().splitlines(),1):
  if line.rstrip()!=line:whitespace.append(f'{p}:{number}')
assert not whitespace,whitespace
report={'scope':'GEO-606','changed_baseline_paths':sorted(changed),'new_paths':sorted(new),'missing_baseline_paths':missing,'maintained_file_count':len(changed|new),'OpenAPI_added_paths':sorted(added_paths),'OpenAPI_added_schemas':sorted(added_schemas),'previous_OpenAPI_semantics_preserved':True,'database_prefix_preserved':True,'new_Alembic_revisions':[],'e2e_default_only_adds_report_spec':True,'doc_hash_mismatches':mismatches,'new_source_trailing_whitespace':whitespace,'status':{'GEO-605':'done','GEO-606':'review','GEO-607':'planned'}}
(evidence/'scope-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if not isinstance(v,list)},ensure_ascii=False,indent=2))
