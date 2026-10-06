from pathlib import Path
import yaml
from app.schemas.geo_reports import GeoReportPreview
p=Path('contracts/openapi.yaml');doc=yaml.safe_load(p.read_text()); schema=GeoReportPreview.model_json_schema(ref_template='#/components/schemas/{model}',mode='serialization'); defs=schema.pop('$defs');defs['GeoReportPreview']=schema
for k,v in defs.items():
 if k in ['GeoReportPreview','GeoReportFormula','GeoReportExport']:doc['components']['schemas'][k]=v
base=doc['paths']['/api/v1/geo/insights']['get']
import copy
for suffix,operation in [('preview','getGeoReportPreview'),('print','getGeoPrintReport'),('runs.csv','exportGeoRunsCsv'),('citations.csv','exportGeoCitationsCsv'),('claims.csv','exportGeoClaimsCsv'),('opportunities.csv','exportGeoOpportunitiesCsv')]:
 op=copy.deepcopy(base);op['operationId']=operation;op['tags']=['geo-reports'];op['summary']=operation
 if suffix in ['preview','print']:
  op['responses']['200']['content']={'application/json':{'schema':{'$ref':'#/components/schemas/GeoReportPreview'}}}
 else:
  op['responses']['200']['content']={'text/csv':{'schema':{'type':'string'}}}
  op['responses']['200']['headers'].update({'Content-Disposition':{'schema':{'type':'string'}},'X-Report-As-Of':{'schema':{'type':'string'}}})
  op['responses']['501']=copy.deepcopy(op['responses']['409'])
 doc['paths']['/api/v1/geo/reports/'+suffix] = {'get': op}
p.write_text(yaml.safe_dump(doc,allow_unicode=True,sort_keys=False,width=1000))
