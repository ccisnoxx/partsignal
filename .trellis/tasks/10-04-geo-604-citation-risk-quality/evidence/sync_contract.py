from pathlib import Path
import re,copy,json,yaml
from app.main import app
p=Path('contracts/openapi.yaml'); text=Path('.trellis/tasks/10-04-geo-604-citation-risk-quality/evidence/before/contracts/openapi.yaml').read_text(); old=yaml.safe_load(text); runtime=app.openapi()
# 只用经Task Brief审查的GEO604组件草案更新authority，不重写其他合同。
changed=[]
for name,value in runtime['components']['schemas'].items():
 if not name.startswith(('GeoInsightCitation','GeoInsightClaim','GeoInsightFactRisk','GeoInsightCost','GeoInsightVersion','GeoInsightQuality','GeoAnswerInsight')):continue
 if old['components']['schemas'].get(name)==value:continue
 block='\n'.join('    '+line for line in yaml.safe_dump({name:value},sort_keys=False,allow_unicode=True,width=1000).rstrip().splitlines())+'\n'
 pattern=r'^    '+re.escape(name)+r':\n.*?(?=^    [A-Za-z_][A-Za-z0-9_]*:|\Z)'
 if name in old['components']['schemas']:
  text,count=re.subn(pattern,lambda m:block,text,flags=re.M|re.S);assert count==1
 else:text=text.rstrip()+'\n'+block
 changed.append(name)
for path in ['/api/v1/geo/insights/runs']:
 block=copy.deepcopy(old['paths'][path]); target=block['get']
 runtime_params=runtime['paths'][path]['get']['parameters']
 for param in target['parameters']:
  if param.get('name')=='metric_code':param['schema']=next(x['schema'] for x in runtime_params if x.get('name')=='metric_code')
 rendered='\n'.join('  '+line for line in yaml.safe_dump({path:block},sort_keys=False,allow_unicode=True,width=1000).rstrip().splitlines())+'\n'
 text,count=re.subn(r'^  '+re.escape(path)+r':\n.*?(?=^  /|^components:)',lambda m:rendered,text,flags=re.M|re.S);assert count==1
newpaths=[]
for path in ['/api/v1/geo/insights/citations','/api/v1/geo/insights/claims','/api/v1/geo/insights/quality/runs']:
 block=copy.deepcopy(runtime['paths'][path]); target=block['get'];target['security']=[{'sessionCookie':[]}]
 target['parameters']=[x for x in target['parameters'] if x.get('name')!='X-Request-ID' and x.get('$ref')!='#/components/parameters/RequestIdHeader']+[{'$ref':'#/components/parameters/RequestIdHeader'}]
 for status,resp in list(target['responses'].items()):
  if status!='200':target['responses'][status]={'$ref':'#/components/responses/ErrorResponse'}
  else:resp['headers']={'X-Request-ID':{'$ref':'#/components/headers/RequestIdResponseHeader'}}
 rendered='\n'.join('  '+line for line in yaml.safe_dump({path:block},sort_keys=False,allow_unicode=True,width=1000).rstrip().splitlines())+'\n'
 assert path not in old['paths']
 text=text.replace('components:\n',rendered+'components:\n',1);newpaths.append(path)
p.write_text(text)
Path('.trellis/tasks/10-04-geo-604-citation-risk-quality/evidence/openapi-changes.json').write_text(json.dumps(dict(schemas=changed,paths=newpaths,modified_paths=['/api/v1/geo/insights','/api/v1/geo/insights/runs']),ensure_ascii=False,indent=2))
print(len(changed),'components',len(newpaths),'new paths')
