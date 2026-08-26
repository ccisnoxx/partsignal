# 0043 Snapshot Sanitization Matrix

## 锁定边界

- Alembic revision 必须精确为 `0043_geo_platform_identity`。
- 业务表 catalog signature 必须精确为
  `90070a89da4ede3edd8f66fc1cc42714a9ef778d0f5c2a85f9142e2c20193a4a`。
- 下表覆盖 0043 全部 `varchar`、`text`、`JSON/JSONB`、`text[]` 字段；当前无
  `bytea` 业务字段。完整 catalog signature 同时锁定全部业务列、约束、USER trigger
  及其函数定义，并拒绝新增非文本字段或业务表。
- UUID、外键、布尔、数值、revision、状态、枚举和时间默认保留；表内明确动作优先。
- `sanitize` 仅允许 `QUARANTINE_DATABASE_URL`，`verify` 仅允许一个 quarantine/verify
  URL。database 名必须落在对应受控 namespace。

## 动作语义

| 动作 | 合同 |
| --- | --- |
| `preserve` | 只保留登记的协议、枚举、状态、分类或关系身份字段 |
| `pseudo` / `slug` | 由保留行键生成无原值的稳定伪名；满足唯一约束并保留实际长度桶 |
| `text` | 替换为 `sanitized:` 文本，并保留原 null 与实际长度桶 |
| `url` / `domain_array` | 替换为 `.invalid` 安全值，保留 null、数组形状与实际长度桶 |
| `json` / `array` | 保留容器、key、顺序、数字、布尔和 null；替换字符串叶并保留各自实际长度桶 |
| `clear_json` / `clear` | 清为 `{}` 或 `NULL`，用于阻断真实 provider 信息 |
| `credential` / `password` | 替换为不可解密 ciphertext 或丢弃随机密码的 Argon2id hash |
| `hash` | 替换为 64 位无敏感值摘要；发布工作重新对齐内容版本 hash |
| `filename` / `object_key` | 伪名化 metadata 并保留实际长度桶；不读取、复制或生成 object payload |
| `uuid_or_text` | UUID-shaped audit target 保留关系；其他文本目标伪名化 |
| `delete` | 整表删除；当前仅 `sessions` |

## 完整字段矩阵

| 表 | 动作 | 字段 |
| --- | --- | --- |
| `ai_channel_headers` | `pseudo` | `name`, `normalized_name` |
|  | `credential` | `plain_value`, `encrypted_value` |
| `ai_channels` | `pseudo` | `name` |
|  | `text` | `description` |
|  | `preserve` | `protocol_type`, `provider_brand` |
|  | `url` | `base_url` |
|  | `credential` | `api_key_ciphertext` |
| `ai_models` | `pseudo` | `display_name`, `model_id` |
|  | `clear_json` | `request_parameters` |
|  | `preserve` | `test_status`（sanitize 强制为 `UNTESTED`） |
|  | `clear` | `last_test_error_summary` |
| `audit_logs` | `preserve` | `business_module`, `action`, `target_type`, `outcome`, `error_code` |
|  | `uuid_or_text` | `target_id` |
|  | `text` | `result_message` |
|  | `json` | `details` |
|  | `pseudo` | `request_id` |
| `content_humanization_prompts` | `text` | `template_markdown` |
| `content_review_records` | `preserve` | `action` |
|  | `text` | `comment` |
| `content_task_geo_sources` | `preserve` | `rule_code` |
|  | `text` | `geo_platform` |
|  | `json` | `basis_snapshot` |
| `content_tasks` | `text` | `platform_profile_name_snapshot` |
|  | `url` | `platform_website_url_snapshot` |
|  | `pseudo` | `idempotency_key` |
|  | `preserve` | `status` |
| `content_versions` | `preserve` | `source_type`, `status` |
|  | `text` | `title`, `summary`, `body_markdown`, `change_summary` |
|  | `array` | `tags` |
|  | `hash` | `content_hash` |
|  | `json` | `quality_issues` |
| `fact_review_records` | `preserve` | `action` |
|  | `text` | `comment` |
| `fact_versions` | `preserve` | `status`, `classification` |
|  | `text` | `body_markdown`, `change_summary` |
| `file_records` | `preserve` | `category`, `content_type`, `access_level`, `status` |
|  | `filename` | `original_filename` |
|  | `object_key` | `object_key` |
|  | `hash` | `sha256` |
| `generation_jobs` | `pseudo` | `idempotency_key` |
|  | `preserve` | `job_type`, `status`, `prompt_template_version`, `error_code` |
|  | `json` | `input_snapshot` |
|  | `text` | `adapter_name` |
|  | `hash` | `prompt_hash` |
|  | `clear` | `error_summary`, `provider_request_id` |
| `geo_observation_citations` | `url` | `url` |
|  | `preserve` | `source_type` |
| `geo_observation_publications` | `preserve` | `accuracy` |
| `geo_observations` | `preserve` | `observation_kind`, `recommendation`, `accuracy` |
|  | `text` | `actual_prompt`, `model_name`, `model_version`, `search_platform`, `search_query`, `answer_summary`, `notes` |
| `platform_accounts` | `pseudo` | `label`, `account_identifier` |
| `platform_profiles` | `pseudo` | `name` |
|  | `slug` | `slug` |
|  | `domain_array` | `allowed_domains` |
|  | `url` | `website_url`, `logo_external_url` |
| `platform_prompts` | `pseudo` | `name` |
|  | `text` | `template_markdown` |
| `platform_types` | `pseudo` | `name` |
|  | `slug` | `slug` |
| `products` | `pseudo` | `part_number`, `normalized_part_number`, `brand`, `normalized_brand`, `category` |
|  | `preserve` | `status`, `facts_classification` |
|  | `text` | `facts_body_markdown` |
| `publication_verifications` | `preserve` | `outcome` |
|  | `text` | `actual_title_snapshot`, `comment` |
|  | `url` | `final_url_snapshot` |
| `publication_work_events` | `preserve` | `action`, `from_status`, `to_status` |
|  | `text` | `comment` |
| `publication_works` | `pseudo` | `idempotency_key`, `platform_profile_name_snapshot`, `platform_account_label_snapshot`, `account_identifier_snapshot` |
|  | `hash` | `content_hash` |
|  | `text` | `actual_title`, `close_comment` |
|  | `url` | `final_url` |
|  | `preserve` | `status`, `close_reason` |
| `published_content_issues` | `preserve` | `kind`, `status`, `resolution_outcome` |
|  | `text` | `description`, `resolution_comment` |
| `query_topics` | `text` | `canonical_question` |
|  | `preserve` | `intent_type` |
|  | `array` | `variants` |
| `sessions` | `delete` | `token_hash`, `csrf_hash` |
| `users` | `pseudo` | `username`, `display_name` |
|  | `preserve` | `account_type` |
|  | `password` | `password_hash` |

## 事务与验证

Sanitizer 在一个事务中校验 revision/catalog、取得 advisory lock、临时禁用受影响表的
USER triggers、执行变换、恢复 triggers 并运行硬断言。CHECK、NOT NULL、UNIQUE 和 FK
始终生效；任一异常使触发器状态和数据一起回滚。输出只包含 counts、booleans、schema
signature、脚本/matrix checksum 与 `object_payload_copied=0`，不输出 DSN、原值、正文、
credential、PII hash 或样本。
