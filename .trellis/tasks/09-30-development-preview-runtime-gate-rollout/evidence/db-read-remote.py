
import json,urllib.parse
from sqlalchemy import text
from app.db import SessionLocal
from app.config import settings
queries={
 "channels":"SELECT id,is_enabled,protocol_type,provider_brand,revision,base_url LIKE 'https://%' AS https FROM ai_channels ORDER BY id",
 "models":"SELECT id,channel_id,model_id,is_enabled,test_status,revision,last_tested_at FROM ai_models ORDER BY id",
 "counts":"SELECT (SELECT count(*) FROM products WHERE status='ACTIVE') AS active_products,(SELECT count(*) FROM fact_versions WHERE status='APPROVED' AND classification='PUBLIC') AS public_approved_facts,(SELECT count(*) FROM platform_profiles WHERE is_active=true AND platform_prompt_id IS NOT NULL) AS active_platforms_with_prompt,(SELECT count(*) FROM platform_prompts) AS platform_prompts,(SELECT count(*) FROM content_tasks WHERE status='OPEN' AND current_content_version_id IS NULL) AS open_empty_content_tasks,(SELECT count(*) FROM generation_jobs) AS generation_jobs,(SELECT count(*) FROM generation_jobs WHERE status IN ('PENDING','RUNNING')) AS active_jobs",
 "lineage":"SELECT j.id AS job_id,t.id AS task_id,t.current_content_version_id,t.revision AS task_revision,t.status AS task_status,c.id AS version_id,c.source_job_id,c.source_type,c.status AS version_status,c.version,c.revision AS version_revision,c.content_hash,c.fact_version_id,c.created_at,c.updated_at,j.input_snapshot->>'contract_version' AS contract_version,j.input_snapshot->'platform_prompt'->>'id' AS prompt_id,j.input_snapshot->'platform_prompt'->>'revision' AS prompt_revision,j.input_snapshot->'channel'->>'id' AS snapshot_channel_id,j.input_snapshot->'model'->>'id' AS snapshot_model_id,j.input_snapshot->'model'->>'model_id' AS snapshot_model_id_exact,j.input_snapshot->'fact_version'->>'classification' AS fact_classification,(j.input_snapshot->>'system_message'=p.template_markdown) AS prompt_body_matches,(j.input_snapshot->>'user_message'=f.body_markdown) AS fact_body_matches FROM generation_jobs j JOIN content_tasks t ON t.id=j.content_task_id JOIN content_versions c ON c.id=j.content_version_id JOIN platform_prompts p ON p.id=(j.input_snapshot->'platform_prompt'->>'id')::uuid JOIN fact_versions f ON f.id=c.fact_version_id WHERE j.id='01f4506d-9975-4779-9d81-ac5663f79511'",
 "audits":"SELECT id,business_module,action,target_type,target_id,outcome,created_at,error_code FROM audit_logs WHERE target_id IN ('01f4506d-9975-4779-9d81-ac5663f79511','1f313697-2062-43ec-9d40-24492bf1f964','d6e8f8b9-a5b2-4b35-b175-ac20598526af','ac74a39e-5d40-4171-b22c-34f9e57c2d75') ORDER BY created_at DESC",
 "history_counts":"SELECT (SELECT count(*) FROM content_review_records) AS content_reviews,(SELECT count(*) FROM publication_works) AS publication_works,(SELECT count(*) FROM content_versions) AS content_versions",
 "jobs":"SELECT id,status,job_type,adapter_name,ai_channel_id,ai_model_id,content_task_id,content_version_id,attempt_count,started_at,finished_at,response_duration_ms,prompt_tokens,completion_tokens,total_tokens,error_code FROM generation_jobs ORDER BY created_at DESC LIMIT 5"
}
try:
 with SessionLocal() as db:
  db.execute(text('SET TRANSACTION READ ONLY'))
  data={k:[dict(r) for r in db.execute(text(q)).mappings()] for k,q in queries.items()}
  data['generator_env_openai_compatible']=settings.content_generator=='openai-compatible'
  data['generation_eager']=settings.generation_eager
  data['schema']=[dict(r) for r in db.execute(text('SELECT version_num FROM alembic_version')).mappings()]
  data['credential_state']=[dict(r) for r in db.execute(text("SELECT id,api_key_ciphertext IS NOT NULL AND api_key_ciphertext<>'' AS configured,api_key_updated_at FROM ai_channels")).mappings()]
  data['header_state']=[dict(r) for r in db.execute(text('SELECT id,channel_id,is_sensitive FROM ai_channel_headers ORDER BY id')).mappings()]
  data['users']=[dict(r) for r in db.execute(text('SELECT id,username,account_type FROM users ORDER BY id')).mappings()]
  print(json.dumps(data,default=str))
except Exception as e:
 print(json.dumps({'safe_error_type':type(e).__name__}));raise SystemExit(1)
