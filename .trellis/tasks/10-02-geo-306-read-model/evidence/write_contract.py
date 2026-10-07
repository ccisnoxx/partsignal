from pathlib import Path
import yaml
from pydantic import TypeAdapter
import read_schema_draft as read
import filter_schema_draft as filters

p=Path('contracts/openapi.yaml');text=p.read_text();contract=yaml.safe_load(text)
models=[read.GeoBatchListPage,read.GeoBatchDetail,read.GeoRunListPage,read.GeoRunDetail]
new={}
for model in models:
 value=TypeAdapter(model).json_schema(ref_template='#/components/schemas/{model}',mode='serialization');defs=value.pop('$defs',{});defs[model.__name__]=value
 new.update({n:v for n,v in defs.items() if n not in contract['components']['schemas']})

def operation(identity,model,filter_model=None,path_id=None):
 params=[]
 if path_id:
  params.append({'name':path_id,'in':'path','required':True,'schema':{'type':'string','format':'uuid','title':path_id.replace('_',' ').title()}})
 if filter_model:
  props=TypeAdapter(filter_model).json_schema(ref_template='#/components/schemas/{model}')['properties']
  for name,schema in props.items():
   if schema.get('default','') is None: schema.pop('default')
   params.append({'name':name,'in':'query','required':False,'schema':schema})
 params.append({'$ref':'#/components/parameters/RequestIdHeader'})
 responses={'200':{'description':'Successful Response','headers':{'X-Request-ID':{'$ref':'#/components/headers/RequestIdResponseHeader'}},'content':{'application/json':{'schema':{'$ref':f'#/components/schemas/{model}'}}}}}
 for code in [400,401,403,404,409,422]:responses[str(code)]={'$ref':'#/components/responses/ErrorResponse'}
 return {'tags':['geo-reads'],'summary':identity,'operationId':identity,'security':[{'sessionCookie':[]}],'parameters':params,'responses':responses,'x-required-account-types':['ADMIN','ENGINEER']}
operations={
 '/api/v1/geo/observation-batches':{'get':operation('listGeoObservationBatches','GeoBatchListPage',filters.GeoBatchFilters)},
 '/api/v1/geo/observation-batches/{batch_id}':{'get':operation('getGeoObservationBatch','GeoBatchDetail',path_id='batch_id')},
 '/api/v1/geo/observation-batches/{batch_id}/runs':{'get':operation('listGeoObservationBatchRuns','GeoRunListPage',filters.GeoRunFilters,path_id='batch_id')},
 '/api/v1/geo/observation-runs':{'get':operation('listGeoObservationRuns','GeoRunListPage',filters.GeoRunFilters)},
 '/api/v1/geo/observation-runs/{run_id}':{'get':operation('getGeoObservationRun','GeoRunDetail',path_id='run_id')},
}
# 批次内runs的batch_id只能取path；query中省略同名参数。
operations['/api/v1/geo/observation-batches/{batch_id}/runs']['get']['parameters']=[v for v in operations['/api/v1/geo/observation-batches/{batch_id}/runs']['get']['parameters'] if not(v.get('name')=='batch_id' and v.get('in')=='query')]
first=operations.pop('/api/v1/geo/observation-batches')
addition=yaml.safe_dump(first,sort_keys=False,allow_unicode=True)
text=text.replace('  /api/v1/geo/observation-batches:\n','  /api/v1/geo/observation-batches:\n'+''.join('    '+line+'\n' for line in addition.splitlines()),1)
addition=yaml.safe_dump(operations,sort_keys=False,allow_unicode=True)
anchor='  /api/v1/geo/observation-runs/{run_id}/manual-entry:\n'
text=text.replace(anchor,''.join('  '+line+'\n' for line in addition.splitlines())+anchor,1)
text+=''.join('    '+line+'\n' for line in yaml.safe_dump(new,sort_keys=False,allow_unicode=True).splitlines())
p.write_text(text)
print(f'已先写入5个GET、{len(new)}个读组件，未改动既有operation/components')
