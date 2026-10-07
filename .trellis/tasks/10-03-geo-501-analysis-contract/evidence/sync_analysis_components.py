"""本任务一次性组件同步；根合同仍是人工维护的权威源。"""
from pathlib import Path
import re
import yaml
from pydantic import TypeAdapter
from app.schemas import geo_analysis

p = Path('contracts/openapi.yaml')
s = p.read_text()
components = {}
for name in ['GeoAnalysisRevisionOut','GeoAnalysisFactBinding','GeoEntityMentionOut','GeoRecommendationOut','GeoClaimAssessmentOut','GeoRunReviewOut','GeoAnalysisSelection']:
    schema = TypeAdapter(getattr(geo_analysis,name)).json_schema(ref_template='#/components/schemas/{model}')
    components.update(schema.pop('$defs',{}))
    components[name] = schema
for name, value in components.items():
    if getattr(geo_analysis,name,None) is None:
        continue
    pattern = r'^    ' + re.escape(name) + r':\n.*?(?=^    [A-Za-z]|\Z)'
    replacement = '\n'.join('    '+line if line else '' for line in yaml.safe_dump({name:value},sort_keys=False,allow_unicode=True).splitlines())+'\n\n'
    s, count = re.subn(pattern,lambda m:replacement,s,flags=re.M|re.S)
    assert count == 1,name
p.write_text(s.rstrip()+'\n')
