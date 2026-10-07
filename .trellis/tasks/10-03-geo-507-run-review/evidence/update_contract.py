"""定向写入本任务的根合同组件与操作，保留其他 YAML 字节。"""
import re
from pathlib import Path

import yaml
from pydantic import TypeAdapter

from app.schemas.geo_read_models import GeoRunDetail
from app.schemas.geo_reviews import GeoRunReviewCreated, GeoRunReviewRequest

path = Path('contracts/openapi.yaml')
source = Path('.trellis/tasks/10-03-geo-507-run-review/evidence/before/contracts/openapi.yaml').read_text()

def semantic(value):
    if isinstance(value, dict):
        return {k: semantic(v) for k,v in value.items() if k not in {'title','description'}}
    if isinstance(value, list):
        return [semantic(v) for v in value]
    return value
for model in (GeoRunDetail, GeoRunReviewRequest, GeoRunReviewCreated):
    schema = TypeAdapter(model).json_schema(ref_template='#/components/schemas/{model}')
    definitions = schema.pop('$defs', {})
    for name, value in {model.__name__: schema, **definitions}.items():
        block = yaml.safe_dump({name: value},allow_unicode=True,sort_keys=False,width=1000)
        block = ''.join('    '+line if line.strip() else line for line in block.splitlines(True))
        pattern = re.compile(r'^    '+re.escape(name)+r':[^\n]*\n.*?(?=^    [A-Za-z][A-Za-z0-9_]*:|\Z)',re.M|re.S)
        match = pattern.search(source)
        if match is None:
            source = source.rstrip()+'\n'+block
        else:
            # 只更新实质不同的组件，保留此前排序与空行。
            current = yaml.safe_load(source)['components']['schemas'][name]
            if semantic(current) != semantic(value):
                source = source[:match.start()]+block+'\n'+source[match.end():]
operation = {'post': {
    'tags':['geo-run-reviews'], 'summary':'Review Run', 'operationId':'reviewGeoObservationRun',
    'security':[{'sessionCookie':[]}], 'x-required-account-types':['ADMIN','ENGINEER'],
    'description':'复核只追加到当前成功分析；expected_run_revision 必填。CONFIRMED 无修正，CORRECTED 有说明与四栏结构化修正。latest Review 整体替换旧修正，原始证据与机器结果保留。',
    'x-error-codes':{'401':['AUTH_REQUIRED'], '403':['PASSWORD_CHANGE_REQUIRED','PERMISSION_DENIED','CSRF_INVALID'], '404':['NOT_FOUND'], '409':['REVISION_CONFLICT','GEO_REVIEW_STALE_ANALYSIS','GEO_ANALYSIS_NOT_AVAILABLE','INVALID_STATE_TRANSITION'], '422':['VALIDATION_ERROR']},
    'parameters':[
        {'name':'run_id','in':'path','required':True,'schema':{'type':'string','format':'uuid','title':'Run Id'}},
        {'name':'X-CSRF-Token','in':'header','required':True,'schema':{'type':'string','minLength':32,'title':'X-Csrf-Token'}},
        {'$ref':'#/components/parameters/RequestIdHeader'}],
    'requestBody':{'required':True,'content':{'application/json':{'schema':{'$ref':'#/components/schemas/GeoRunReviewRequest'}}}},
    'responses':{'201':{'description':'Successful Response', 'content':{'application/json':{'schema':{'$ref':'#/components/schemas/GeoRunReviewCreated'}}},'headers':{'X-Request-ID':{'$ref':'#/components/headers/RequestIdResponseHeader'}}},
        **{str(code):{'$ref':'#/components/responses/ErrorResponse'} for code in (400,401,403,404,409,422)}}}}
key = '/api/v1/geo/observation-runs/{run_id}/review'
if key not in yaml.safe_load(source)['paths']:
    block = yaml.safe_dump({key:operation},allow_unicode=True,sort_keys=False,width=1000)
    source = source.replace('\ncomponents:\n','\n'+''.join('  '+line for line in block.splitlines(True))+'\ncomponents:\n',1)
path.write_text(source)
