from pathlib import Path
from copy import deepcopy
import yaml
from app.schemas import geo_browser_sessions as s
p=Path('contracts/openapi.yaml');text=p.read_text();doc=yaml.safe_load(text)
models=[s.GeoBrowserSessionImport,s.GeoBrowserSessionCommand,s.GeoBrowserSessionPurge,s.GeoBrowserSessionMetadata,s.GeoBrowserSessionContext,s.GeoBrowserSessionAccessRequest,s.GeoBrowserSessionEnvelope]
schemas={}
for model in models:
 definition=model.model_json_schema(ref_template='#/components/schemas/{model}')
 schemas.update(definition.pop('$defs',{})); schemas[model.__name__]=definition
base='/api/v1/geo/collection-profiles/{profile_id}/browser-session'
template=doc['paths']['/api/v1/geo/collection-profiles/{profile_id}/test']['post']
get_template=doc['paths']['/api/v1/geo/collection-profiles/{profile_id}']['get']
paths={}
for suffix,operation,summary,body in [('', 'getGeoBrowserSession','Get Session',None),('/import','importGeoBrowserSession','Import Session','GeoBrowserSessionImport'),('/health','checkGeoBrowserSessionHealth','Check Health','GeoBrowserSessionCommand'),('/revoke','revokeGeoBrowserSession','Revoke Session','GeoBrowserSessionCommand'),('/purge','purgeGeoBrowserSessions','Purge Sessions','GeoBrowserSessionPurge')]:
 method='get' if body is None else 'post'; o=deepcopy(get_template if body is None else template)
 o['tags']=['geo-browser-sessions'];o['summary']=summary;o['operationId']=operation
 if body:o['requestBody']['content']['application/json']['schema']={'$ref':'#/components/schemas/'+body};o['responses']['503']={'$ref':'#/components/responses/ErrorResponse'}
 o['responses']['200']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoBrowserSessionContext'}
 if body is None:o['responses']['409']={'$ref':'#/components/responses/ErrorResponse'}
 o['x-required-account-types']=['ADMIN'];o['x-error-codes']={'401':['AUTH_REQUIRED'],'403':['PASSWORD_CHANGE_REQUIRED','PERMISSION_DENIED','CSRF_INVALID'],'404':['NOT_FOUND'],'409':['REVISION_CONFLICT','GEO_BROWSER_PROFILE_REQUIRED','GEO_BROWSER_SESSION_IMPORT_FORBIDDEN','GEO_BROWSER_SESSION_REVOKED'],'422':['VALIDATION_ERROR','GEO_BROWSER_SESSION_INVALID']}
 if body:o['x-error-codes']['503']=['DEPENDENCY_UNAVAILABLE']
 paths[base+suffix]={method:o}
o=deepcopy(template);o['tags']=['geo-browser-sessions'];o['summary']='Access Session';o['operationId']='accessGeoBrowserSession';o['security']=[{'geoBrowserServiceKey':[]}]
o['parameters']=[{'name':'session_reference','in':'path','required':True,'schema':{'type':'string','format':'uuid','title':'Session Reference'}},{'$ref':'#/components/parameters/RequestIdHeader'}]
o['requestBody']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoBrowserSessionAccessRequest'}
o['responses']['200']['content']['application/json']['schema']={'$ref':'#/components/schemas/GeoBrowserSessionEnvelope'}
o['responses']['503']={'$ref':'#/components/responses/ErrorResponse'}
o.pop('x-required-account-types',None);o['x-error-codes']={'403':['PERMISSION_DENIED'],'409':['COLLECTOR_DISABLED','GEO_PROFILE_INELIGIBLE','GEO_BROWSER_SESSION_REVOKED','PROFILE_NEEDS_REAUTH','GEO_BROWSER_SESSION_MISSING','GEO_BROWSER_SESSION_UNREADABLE'],'503':['DEPENDENCY_UNAVAILABLE']}
paths['/api/internal/geo/browser-sessions/{session_reference}/access']={'post':o}
# 只追加新操作/组件，保留前序合同格式与内容。
def indent_dump(value,spaces):return ''.join(' '*spaces+line+'\n' for line in yaml.safe_dump(value,sort_keys=False,allow_unicode=True).splitlines())
text=text.replace('components:\n',indent_dump(paths,2)+'components:\n',1)
text=text.replace('  securitySchemes:\n','  securitySchemes:\n    geoBrowserServiceKey:\n      type: apiKey\n      in: header\n      name: X-GEO-Browser-Service-Key\n',1)
text += indent_dump(schemas,4)
p.write_text(text)
print('新增6个operation和',len(schemas),'components')
