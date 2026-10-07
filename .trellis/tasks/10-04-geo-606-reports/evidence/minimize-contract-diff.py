from pathlib import Path
import yaml
p=Path('contracts/openapi.yaml');old=Path('.trellis/tasks/10-04-geo-606-reports/evidence/before/contracts/openapi.yaml').read_text();current=yaml.safe_load(p.read_text());base=yaml.safe_load(old)
new_paths={k:v for k,v in current['paths'].items() if k not in base['paths']}
new_schemas={k:v for k,v in current['components']['schemas'].items() if k not in base['components']['schemas']}
assert set(new_paths)=={'/api/v1/geo/reports/'+x for x in ['preview','print','runs.csv','citations.csv','claims.csv','opportunities.csv']}
assert set(new_schemas)=={'GeoReportPreview','GeoReportFormula','GeoReportExport'}
expected=yaml.safe_load(old);expected['paths'].update(new_paths);expected['components']['schemas'].update(new_schemas)
assert expected==current,'存在报告范围之外的语义变化，拒绝覆写'
paths=yaml.safe_dump(new_paths,allow_unicode=True,sort_keys=False,width=1000)
schemas=yaml.safe_dump(new_schemas,allow_unicode=True,sort_keys=False,width=1000)
result=old.replace('components:\n',''.join('  '+line+'\n' for line in paths.splitlines())+'components:\n',1)
result+= ''.join('    '+line+'\n' for line in schemas.splitlines())
assert yaml.safe_load(result)==current
p.write_text(result)
print('仅追加6个GET路径和3个Schema；其他原文和语义完整保留')
