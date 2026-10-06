"""只追加705合同，不重排其他任务的既有声明。"""
from copy import deepcopy
from pathlib import Path
import runpy
import yaml

path=Path('contracts/openapi.yaml');s=path.read_text();doc=yaml.safe_load(s)
models=runpy.run_path('.trellis/tasks/10-04-geo-705-retest-planner/evidence/schema_draft.py')
new={}
for name in ['GeoRetestRequest','GeoRetestPreview','GeoRetestCreated']:
 schema=models[name].model_json_schema(ref_template='#/components/schemas/{model}')
 new.update(schema.pop('$defs',{}));new[name]=schema
for name,value in new.items():
 if name in doc['components']['schemas']: continue
 block=yaml.safe_dump({name:value},sort_keys=False,allow_unicode=True,width=10000)
 s+=''.join('    '+line for line in block.splitlines(keepends=True))
base='/api/v1/geo/opportunities/{opportunity_id}'
post=deepcopy(doc['paths'][base+'/acknowledge']['post'])
post['operationId']='createGeoOpportunityRetest';post['summary']='Create Retest'
post['requestBody']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoRetestRequest'}
post['responses']['201']=post['responses'].pop('200')
post['responses']['201']['description']='Successful Response'
post['responses']['201']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoRetestCreated'}
post['parameters'].insert(-1,{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':8,'maxLength':128,'pattern':r'^[\x21-\x7E]+$','title':'Idempotency-Key'}})
get=deepcopy(doc['paths'][base]['get'])
get['operationId']='previewGeoOpportunityRetest';get['summary']='Preview Retest'
get['responses'].pop('503',None)
get['responses']['200']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoRetestPreview'}
get['parameters']=[p for p in get['parameters'] if p.get('in')=='path' or '$ref' in p]
get['parameters'].insert(-1,{'name':'baseline_batch_id','in':'query','required':True,'schema':{'type':'string','format':'uuid','title':'Baseline Batch Id'}})
block=yaml.safe_dump({base+'/retest-preview':{'get':get},base+'/retest':{'post':post}},sort_keys=False,allow_unicode=True,width=10000)
s=s.replace('\ncomponents:\n','\n'+''.join('  '+line for line in block.splitlines(keepends=True))+'components:\n',1)
path.write_text(s)
