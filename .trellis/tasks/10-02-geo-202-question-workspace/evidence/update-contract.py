"""只更新 GEO-202 拥有的 OpenAPI 片段，不重排其他合同。"""
from pathlib import Path
import yaml
from app.schemas.geo_prompt_variants import GeoPromptVariantOut, GeoPromptVariantListPage
p=Path('contracts/openapi.yaml');source=p.read_text();contract=yaml.safe_load(source)
schemas={}
for cls in [GeoPromptVariantOut,GeoPromptVariantListPage]:
 value=cls.model_json_schema(ref_template='#/components/schemas/{model}')
 schemas.update(value.pop('$defs',{}));schemas[cls.__name__]=value
schemas={k:v for k,v in schemas.items() if k not in contract['components']['schemas'] or k=='GeoPromptVariantOut'}
def clean(v):
 if isinstance(v,dict):return {k:clean(x) for k,x in v.items() if k!='title'}
 if isinstance(v,list):return [clean(x) for x in v]
 return v
start=source.index('    GeoPromptVariantOut:');end=source.index('    GeoPromptVariantErrorCode:',start)
source=source[:start]+source[end:]+yaml.safe_dump({'components':{'schemas':clean(schemas)}},allow_unicode=True,sort_keys=False).split('  schemas:\n',1)[1]
# 上面的组件仍在当前 schemas 映射尾部。
paths={}
def ref(kind,name):return {'$ref':f'#/components/{kind}/{name}'}
def param(name,schema,required=False,where='query'):
 return {'name':name,'in':where,'required':required,'schema':schema}
def nullable(schema):return {'anyOf':[schema,{'type':'null'}]}
def operation(method,path,opid,*,model=None,body=None,status=200,detail=True):
 params=[ref('parameters','RequestIdHeader')]
 if '{variant_id}' in path:params.insert(0,param('variant_id',{'type':'string','format':'uuid'},True,'path'))
 if '{query_topic_id}' in path:params.insert(0,param('query_topic_id',{'type':'string','format':'uuid'},True,'path'))
 if method!='get':params.append(ref('parameters','CsrfHeader'))
 if method=='delete':params.append(param('expected_revision',{'type':'integer','minimum':0},True))
 responses={str(status):{'description':'问题变体结果','headers':{'X-Request-ID':ref('headers','RequestIdResponseHeader')}}}
 if model:responses[str(status)]['content']={'application/json':{'schema':ref('schemas',model)}}
 for code in [400,401,403]+([404] if detail else [])+([409] if method!='get' else [])+[422]:responses[str(code)]=ref('responses','ErrorResponse')
 val={'tags':['geo-questions'],'operationId':opid,'parameters':params,'responses':responses}
 if body:val['requestBody']={'required':True,'content':{'application/json':{'schema':ref('schemas',body)}}}
 paths.setdefault(path,{})[method]=val;return val
lst=operation('get','/api/v1/geo/prompt-variants','listGeoPromptVariants',model='GeoPromptVariantListPage',detail=False)
for name,schema in [
 ('q',{'type':'string','maxLength':240}),('query_topic_id',{'type':'string','format':'uuid'}),
 ('intent_type',ref('schemas','IntentType')),('mention_mode',ref('schemas','GeoPromptMentionMode')),
 ('language_code',{'type':'string','minLength':2,'maxLength':16,'pattern':r'^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$'}),
 ('region_code',{'type':'string','minLength':2,'maxLength':2,'pattern':r'^[A-Za-z]{2}$'}),
 ('priority',ref('schemas','GeoPromptPriority')),('is_active',{'type':'boolean'})]:lst['parameters'].append(param(name,nullable(schema)))
lst['parameters'] += [param('sort',{'type':'string','enum':['UPDATED_DESC','TEXT_ASC'],'default':'UPDATED_DESC'}),param('page',{'type':'integer','minimum':1,'default':1}),param('page_size',{'type':'integer','enum':[10,20,50],'default':20})]
operation('post','/api/v1/geo/query-topics/{query_topic_id}/prompt-variants','createGeoPromptVariant',model='GeoPromptVariantOut',body='GeoPromptVariantCreate',status=201)
operation('get','/api/v1/geo/prompt-variants/{variant_id}','getGeoPromptVariant',model='GeoPromptVariantOut')
operation('patch','/api/v1/geo/prompt-variants/{variant_id}','updateGeoPromptVariant',model='GeoPromptVariantOut',body='GeoPromptVariantUpdate')
operation('delete','/api/v1/geo/prompt-variants/{variant_id}','deleteGeoPromptVariant',status=204)
for verb in ['enable','disable']:operation('post',f'/api/v1/geo/prompt-variants/{{variant_id}}/{verb}',verb+'GeoPromptVariant',model='GeoPromptVariantOut',body='GeoPromptVariantRevisionRequest')
fragment=yaml.safe_dump({'paths':paths},allow_unicode=True,sort_keys=False).split('paths:\n',1)[1]
pos=source.index('\ncomponents:');source=source[:pos]+'\n'+fragment+source[pos:];p.write_text(source)
