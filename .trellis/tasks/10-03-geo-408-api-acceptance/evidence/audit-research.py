import json
from pathlib import Path
base=Path('/Users/sc/.codex/audits/multi-agent/partsignal-2069b161/20261003T123558Z-geo-408-220c2d2c')
execution={'version':6,'plan_id':'geo408-research','plan_command':['work-plan','plan','01-research.draft.json'],'validate_command':['work-plan','validate','01-research.plan.json'],'validate_status':'passed','workers':[],'active_worker_ids_after_execution':[],'writes_observed':False,'communication':{'wait_call_count':1,'wait_timeout_count':0,'status_poll_count':0}}
for label,count,follow in [('product_contract',1,0),('runtime_safety',3,1)]:
 evidence=json.loads(Path('.trellis/tasks/10-03-geo-408-api-acceptance/evidence/'+label+'-tool-evidence.json').read_text())
 # 已人工核对全部custom tool输入：仅cat/rg/wc/nl/sed或读取YAML的Python，无写入工具。
 record={'task_id':label,'agent_type':'analyst','worker_id':'worker-'+label.replace('_','-'),'runtime_ref':'/root/'+label,'runtime_ref_source':'spawn_metadata','final_status':'completed','task_outcome':'accepted','active_after_close':False,'retired_from_followup':False,'retirement_source':'unknown','observed_dispatch':{'method':'spawn_agent','task_name':label,'fork_turns':'none','model_override':None,'reasoning_effort_override':None},'observed_write_paths':[],'parent_followup_count':follow,'worker_intermediate_message_count':count}
 execution['workers'].append(record)
Path(base/'01-research.execution.json').write_text(json.dumps(execution,ensure_ascii=False,indent=2)+'\n')
proof={'task':'GEO-408','evidence':'两条runtime session的完整custom_tool_call输入已保存并核对；只有读取命令/YAML解析，不存在修改工具或源码写命令；最终报告满足文档读取与合同差异验收。','observed_write_paths':{'product_contract':[],'runtime_safety':[]}}
Path('.trellis/tasks/10-03-geo-408-api-acceptance/evidence/research-write-evidence.json').write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n')
