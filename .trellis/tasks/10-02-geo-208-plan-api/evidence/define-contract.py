from pathlib import Path
from copy import deepcopy
import yaml
p=Path('contracts/openapi.yaml'); raw=p.read_text(); c=yaml.safe_load(raw)
def ref(name): return {'$ref':'#/components/schemas/'+name}
def field(t, **kw): return dict(type=t, **kw)
def obj(name,props,required=None): return {'additionalProperties':False,'properties':props,'required':required or list(props),'title':name,'type':'object'}
schemas={}
for name,values in {
 'GeoPlanAction':['UPDATE','PREVIEW','ACTIVATE','PAUSE','RESUME','ARCHIVE','COPY','CREATE_REVISION','DELETE'],
 'GeoPlanWorkflowStage':['CONFIGURATION_REQUIRED','READY','ACTIVE','PAUSED','ARCHIVED'],
 'GeoPlanPrimaryTask':['COMPLETE_CONFIGURATION','ACTIVATE','VIEW_RUNTIME','RESUME','VIEW_HISTORY'],
}.items(): schemas[name]={'enum':values,'title':name,'type':'string'}
schemas['GeoPlanDeletion']=obj('GeoPlanDeletion',{'blockers':field('array',items={'enum':['PLAN_NOT_DISABLED','ARCHIVED'],'type':'string'},title='Blockers')})
schemas['GeoPlanRunEntry']=obj('GeoPlanRunEntry',{'available':{'const':False,'title':'Available','type':'boolean'},'reason_code':{'const':'NOT_IMPLEMENTED','title':'Reason Code','type':'string'}})
schemas['GeoMonitoringPlanCopy']=obj('GeoMonitoringPlanCopy',{'expected_revision':field('integer',minimum=0,title='Expected Revision'),'name':deepcopy(c['components']['schemas']['GeoMonitoringPlanCreate']['properties']['name'])})
detail=deepcopy(c['components']['schemas']['GeoMonitoringPlanOut']);detail.pop('description',None);detail['title']='GeoMonitoringPlanDetail'
props={'preview':ref('GeoMonitoringPlanPreview'),'workflow_stage':ref('GeoPlanWorkflowStage'),'primary_task':ref('GeoPlanPrimaryTask'),'available_actions':field('array',items=ref('GeoPlanAction'),title='Available Actions'),'deletion':ref('GeoPlanDeletion'),'run_entry':ref('GeoPlanRunEntry')}
detail['properties'].update(props);detail['required']+=list(props);schemas['GeoMonitoringPlanDetail']=detail
schemas['GeoMonitoringPlanListPage']=obj('GeoMonitoringPlanListPage',{'items':field('array',items=ref('GeoMonitoringPlanDetail'),title='Items'),'total':field('integer',minimum=0,title='Total'),'page':field('integer',minimum=1,title='Page'),'page_size':field('integer',enum=[10,20,50],title='Page Size')})
def param(name,where,schema,required=False): return {'name':name,'in':where,'required':required,'schema':schema}
request_id={'$ref':'#/components/parameters/RequestIdHeader'}
csrf=param('X-CSRF-Token','header',{'type':'string','minLength':32,'title':'X-Csrf-Token'},True)
plan_id=param('plan_id','path',{'type':'string','format':'uuid','title':'Plan Id'},True)
def operation(id,method,*,body=None,out=None,status=200,path=False,extra=None,errors=(401,403,404,409,422)):
 params=([plan_id] if path else [])+(extra or [])+([csrf] if method not in ('get',) else [])+[request_id]
 responses={str(status):{'description':'Successful Response','headers':{'X-Request-ID':{'$ref':'#/components/headers/RequestIdResponseHeader'}}}}
 if out:responses[str(status)]['content']={'application/json':{'schema':ref(out)}}
 for code in [400,*errors]: responses[str(code)]={'$ref':'#/components/responses/ErrorResponse'}
 if status==501:responses['501']={'$ref':'#/components/responses/ErrorResponse'}
 op={'tags':['geo-plans'],'operationId':id,'parameters':params,'responses':responses,'security':[{'sessionCookie':[]}]}
 if body: op['requestBody']={'required':True,'content':{'application/json':{'schema':ref(body)}}}
 return op
base='/api/v1/geo/monitoring-plans'
filters=[param('q','query',{'anyOf':[{'type':'string','maxLength':200,'pattern':r'^[^\x00]*$'},{'type':'null'}],'title':'Q'}),param('status','query',{'anyOf':[ref('GeoMonitoringPlanStatus'),{'type':'null'}],'title':'Status'}),param('schedule_kind','query',{'anyOf':[ref('GeoPlanScheduleKind'),{'type':'null'}],'title':'Schedule Kind'}),param('sort','query',{'type':'string','enum':['UPDATED_DESC','NAME_ASC'],'default':'UPDATED_DESC','title':'Sort'}),param('page','query',{'type':'integer','minimum':1,'default':1,'title':'Page'}),param('page_size','query',{'type':'integer','enum':[10,20,50],'default':20,'title':'Page Size'})]
paths={base:{'get':operation('listGeoMonitoringPlans','get',out='GeoMonitoringPlanListPage',extra=filters,errors=(401,403,422)),'post':operation('createGeoMonitoringPlan','post',body='GeoMonitoringPlanCreate',out='GeoMonitoringPlanDetail',status=201,errors=(401,403,409,422))},base+'/preview':{'post':operation('previewGeoMonitoringPlan','post',body='GeoMonitoringPlanCreate',out='GeoMonitoringPlanPreview',errors=(401,403,422))},base+'/{plan_id}':{'get':operation('getGeoMonitoringPlan','get',path=True,out='GeoMonitoringPlanDetail',errors=(401,403,404,422)),'patch':operation('updateGeoMonitoringPlan','patch',path=True,body='GeoMonitoringPlanUpdate',out='GeoMonitoringPlanDetail'),'delete':operation('deleteGeoMonitoringPlan','delete',path=True,status=204,extra=[param('expected_revision','query',{'type':'integer','minimum':0,'title':'Expected Revision'},True)])}}
for verb in ('activate','pause','resume','archive'):
 paths[base+'/{plan_id}/'+verb]={'post':operation(verb+'GeoMonitoringPlan','post',path=True,body='GeoMonitoringPlanRevisionRequest',out='GeoMonitoringPlanDetail')}
paths[base+'/{plan_id}/copy']={'post':operation('copyGeoMonitoringPlan','post',path=True,body='GeoMonitoringPlanCopy',out='GeoMonitoringPlanDetail',status=201)}
paths[base+'/{plan_id}/run']={'post':operation('runGeoMonitoringPlanNow','post',path=True,body='GeoMonitoringPlanRevisionRequest',status=501,extra=[param('Idempotency-Key','header',{'type':'string','minLength':1,'maxLength':160,'pattern':r'^[\x21-\x7E]+$','title':'Idempotency-Key'},True)])}
path_text=yaml.safe_dump(paths,sort_keys=False,allow_unicode=True,width=1000)
raw=raw.replace('\ncomponents:', '\n'+''.join('  '+line+'\n' for line in path_text.splitlines())+'components:',1)
raw+='\n'+''.join('    '+line+'\n' for line in yaml.safe_dump(schemas,sort_keys=False,allow_unicode=True,width=1000).splitlines())
p.write_text(raw)
