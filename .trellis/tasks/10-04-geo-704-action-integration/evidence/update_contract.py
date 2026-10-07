"""只替换704拥有的合同组件/操作；不重排既有合同。"""
from copy import deepcopy
from pathlib import Path
import re
import yaml
from pydantic import TypeAdapter
from app.schemas.geo_opportunity_actions import (
    GeoOpportunityFactRevisionRequest, GeoOpportunityContentTaskRequest,
    GeoOpportunityPublicationRepairRequest,
)
from app.schemas.geo_opportunity_workbench import (
    GeoOpportunityActionRecord, GeoOpportunityActionResult, GeoOpportunityDetail,
)

path=Path('contracts/openapi.yaml'); text=path.read_text(); document=yaml.safe_load(text)
schemas={}
for model in [GeoOpportunityFactRevisionRequest,GeoOpportunityContentTaskRequest,
              GeoOpportunityActionRecord,GeoOpportunityActionResult,GeoOpportunityDetail]:
    value=model.model_json_schema(ref_template='#/components/schemas/{model}', mode='serialization' if model in [GeoOpportunityActionRecord,GeoOpportunityActionResult,GeoOpportunityDetail] else 'validation')
    schemas.update(value.pop('$defs',{})); schemas[model.__name__]=value
union=TypeAdapter(GeoOpportunityPublicationRepairRequest).json_schema(ref_template='#/components/schemas/{model}')
schemas.update(union.pop('$defs',{}))
owned={'GeoOpportunityActionRecord','GeoOpportunityDetail'}
for name,schema in schemas.items():
    if name in document['components']['schemas'] and name not in owned: continue
    block=yaml.safe_dump({name:schema},sort_keys=False,allow_unicode=True,width=10000)
    block=''.join('    '+line if line.strip() else line for line in block.splitlines(keepends=True))
    pattern=rf'^    {re.escape(name)}:\n.*?(?=^    [A-Za-z0-9_\-]+:\n|\Z)'
    if name in document['components']['schemas']: text,n=re.subn(pattern,lambda _:block,text,flags=re.M|re.S); assert n==1
    else: text+=block
paths={}
for suffix,op,request in [
 ('fact-revision','startFactRevisionFromGeoOpportunity',{'$ref':'#/components/schemas/GeoOpportunityFactRevisionRequest'}),
 ('content-task','createContentTaskFromGeoOpportunity',{'$ref':'#/components/schemas/GeoOpportunityContentTaskRequest'}),
 ('publication-repair','createPublicationRepairFromGeoOpportunity',union),
]:
    value=deepcopy(document['paths']['/api/v1/geo/opportunities/{opportunity_id}/acknowledge']['post'])
    value['operationId']=op; value['summary']=op
    value['requestBody']['content']['application/json']['schema']=request
    value['responses']['200']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoOpportunityActionResult'}
    value['parameters'].insert(-1,{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':8,'maxLength':128,'pattern':r'^[\x21-\x7E]+$','title':'Idempotency-Key'}})
    paths[f'/api/v1/geo/opportunities/{{opportunity_id}}/actions/{suffix}']={'post':value}
block=yaml.safe_dump(paths,sort_keys=False,allow_unicode=True,width=10000)
text=text.replace('\ncomponents:\n','\n'+''.join('  '+line for line in block.splitlines(keepends=True))+'components:\n',1)
# 新删除阻断只表达实际机会行动关系。
doc=yaml.safe_load(text); blocker=doc['components']['schemas']['DeletionBlockerType']; blocker['enum'].append('GEO_OPPORTUNITY_ACTION')
block=yaml.safe_dump({'DeletionBlockerType':blocker},sort_keys=False,allow_unicode=True,width=10000)
text=re.sub(r'^    DeletionBlockerType:\n.*?(?=^    [A-Za-z0-9_\-]+:\n)',lambda _:''.join('    '+l for l in block.splitlines(keepends=True)),text,flags=re.M|re.S)
path.write_text(text)
print('704 root contract: 3 operations; owned schemas only.')
