# PartSignal GEO 数据架构

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 目标设计 |
| 数据库 | PostgreSQL 16 |
| 迁移 | 仅 Alembic 前滚 |
| 原始大对象 | 对象存储，PostgreSQL 保存元数据、哈希和引用 |

## 1. 数据设计原则

1. UUID 主键、UTC 带时区时间；
2. 可变聚合带整数 `revision`；
3. 不可变历史禁止原地更新；
4. JSONB 仅用于不可变快照、受控分析摘要和审计，不把可查询核心关系藏入 JSON；
5. 指标从原始运行和分析计算，不保存为可编辑第二事实源；
6. 所有外部调用输入冻结快照；
7. 所有敏感凭据只保存密文或引用，不进入运行快照；
8. 删除采用明确业务命令，不依赖通用 ORM cascade；
9. 数据库约束是并发和旁路 writer 的最终防线；
10. 错误映射只识别精确 SQLSTATE 和约束名。

## 2. 表集合

### 2.1 Catalog

```text
geo_subjects
geo_subject_aliases
geo_subject_domains
geo_engine_surfaces
geo_collection_profiles
```

### 2.2 Planning

```text
geo_prompt_variants
geo_monitoring_plans
geo_monitoring_plan_subjects
geo_monitoring_plan_prompts
geo_monitoring_plan_profiles
```

### 2.3 Collection

```text
geo_observation_batches
geo_observation_runs
geo_answer_snapshots
geo_answer_citations
```

### 2.4 Analysis

```text
geo_analysis_revisions
geo_entity_mentions
geo_recommendations
geo_claim_assessments
geo_run_reviews
```

### 2.5 Opportunities

```text
geo_opportunities
geo_opportunity_sources
geo_opportunity_actions
```

## 3. Catalog 表

## 3.1～3.3 Subject / Alias / Domain（GEO-101 合同）

这三张目标表的唯一详细权威是 [根数据库合同的 GEO Catalog 章节](../../../contracts/database.md)。GEO-101 仅交付合同，尚无 ORM/Alembic/Service/Router，不把本节当作数据库已迁移证据。

- `geo_subjects`：五种 subject_type；OWN_PRODUCT 仅绑定 Product，canonical_name/normalized_name/display_name 持久化为 NULL，公共名称从当前 Product 投影。其他类型保存监测身份，不能承载公司产品事实。
- Product 活动身份由 `uq_geo_subjects_active_own_product` partial unique 仲裁；停用历史可保留，enable 必须复核唯一性。不对非自有名称增加猜测性全局唯一。
- 父级可空；OWN_PRODUCT→OWN_BRAND、COMPETITOR_PRODUCT→COMPETITOR_BRAND；品牌及 REFERENCE_PART 无父级。内部 parent_subject_type 加 CHECK、MATCH FULL 复合 RESTRICT FK 保证真实父级类型，不暴露给客户端。
- `geo_subject_aliases`：NFKC/空白规范化后 casefold，保留标点与型号后缀；同 Subject normalized_alias 唯一（含停用），alias_kind=NAME/PART_NUMBER/ABBREVIATION/LEGACY，language_code 可空。跨对象重复保留为歧义，不能静默任选匹配。
- `geo_subject_domains`：IDNA2008/UTS #46 non-transitional + STD3 的 lowercase ASCII hostname，精确匹配、不执行网络调用；同 Subject hostname 唯一，跨对象共享保留歧义。relation_type=OWNED/OFFICIAL/DISTRIBUTOR/OTHER；当前只有 create/delete，is_active 恒 true。
- Subject 是两类子实体的 revision owner；子命令提交父 expected_revision，成功返回完整父投影。只有 Subject 聚合内 Alias/Domain 可 CASCADE；Product、父子与未来业务引用 RESTRICT，历史使用完整当时字典快照。
- 命名约束/索引、锁序、删除计数、精确 SQLSTATE 映射和 Product/User 生命周期接入义务均以根合同为准，GEO-102～104 实施并取得数据库运行证据。本任务不修改后续 EngineSurface/Profile 等目标合同。

## 3.4 `geo_engine_surfaces`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| name | varchar(160) | 非空 |
| slug | varchar(100) | 唯一 |
| surface_kind | varchar(24) | CONSUMER_UI/MODEL_API/SEARCH_API/MANUAL_SITE |
| provider_brand | varchar(40) | 受控目录或 CUSTOM |
| website_url | text nullable | HttpUrl 边界校验 |
| compliance_status | varchar(24) | NOT_REVIEWED/APPROVED/REJECTED/SUSPENDED |
| capabilities | JSONB | 不可变受控布尔能力集合，更新按 revision |
| is_active | boolean | 默认 true |
| revision | integer | |
| created_by | UUID | |
| created_at/updated_at | timestamptz | |

`capabilities` 初始键：

```json
{
  "answer_text": true,
  "citations": false,
  "web_search_signal": false,
  "model_version": false,
  "usage": false,
  "cost": false
}
```

禁止任意扩展键；Schema 和数据库检查由任务确定。

## 3.5 `geo_collection_profiles`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| engine_surface_id | UUID | FK geo_engine_surfaces.id |
| name | varchar(160) | 非空 |
| collection_mode | varchar(16) | MANUAL/API/BROWSER |
| adapter_key | varchar(100) | 非空 |
| ai_channel_id | UUID nullable | FK ai_channels.id SET NULL |
| ai_model_id | UUID nullable | FK ai_models.id SET NULL |
| language_code | varchar(16) | 非空 |
| region_code | varchar(16) | 非空 |
| login_state | varchar(24) | ANONYMOUS/AUTHENTICATED/NOT_APPLICABLE |
| web_search_policy | varchar(24) | UNKNOWN/REQUESTED/REQUIRED/NOT_APPLICABLE |
| settings_json | JSONB | 受控非敏感 adapter 配置 |
| is_active | boolean | |
| last_test_status | varchar(16) | UNTESTED/PASSED/FAILED |
| last_tested_at | timestamptz nullable | |
| revision | integer | |
| created_by | UUID | |
| created_at/updated_at | timestamptz | |

约束：

- API 模式的模型/adapter 组合满足协议目录；
- MANUAL 模式 `ai_channel_id/ai_model_id` 均为空；
- BROWSER 模式不得绑定 AI 凭据；
- `settings_json` 不含 secret；
- `(engine_surface_id, name)` 唯一；
- ai_model 必须属于 ai_channel（应用服务 + 触发器/复合约束策略在实现任务确认）。

## 4. Planning 表

## 4.1 `geo_prompt_variants`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| query_topic_id | UUID | FK query_topics.id RESTRICT |
| prompt_text | text | 非空 |
| normalized_hash | varchar(64) | SHA-256 |
| mention_mode | varchar(16) | BRANDED/UNBRANDED |
| language_code | varchar(16) | |
| region_code | varchar(16) | |
| priority | varchar(16) | CORE/STANDARD/EXPLORATORY |
| is_active | boolean | |
| revision | integer | |
| created_by | UUID | |
| created_at/updated_at | timestamptz | |

唯一：`(query_topic_id, normalized_hash, mention_mode, language_code, region_code)`。

## 4.2 `geo_monitoring_plans`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| name | varchar(200) | 非空 |
| description | text | 默认空 |
| status | varchar(16) | DISABLED/ACTIVE/PAUSED/ARCHIVED |
| repeat_count | integer | 1..10（初始） |
| schedule_kind | varchar(16) | MANUAL_ONLY/CRON |
| cron_expression | varchar(120) nullable | |
| timezone | varchar(64) | IANA timezone |
| budget_limit | numeric(14,6) nullable | >=0 |
| rule_set_revision | integer | 创建批次时快照 |
| revision | integer | |
| created_by/updated_by | UUID | |
| created_at/updated_at | timestamptz | |

CRON 状态约束：`schedule_kind=CRON` 时 cron 非空。

## 4.3 Join tables

### `geo_monitoring_plan_subjects`

- `plan_id`
- `subject_id`
- `role`：PRIMARY/COMPETITOR/REFERENCE
- PK `(plan_id, subject_id)`

至少一个 PRIMARY。

### `geo_monitoring_plan_prompts`

- `plan_id`
- `prompt_variant_id`
- PK `(plan_id, prompt_variant_id)`

### `geo_monitoring_plan_profiles`

- `plan_id`
- `collection_profile_id`
- PK `(plan_id, collection_profile_id)`

关系表只在 Plan 聚合内允许变更；批次创建后只读 plan snapshot。

## 5. Collection 表

## 5.1 `geo_observation_batches`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| plan_id | UUID nullable | FK plans SET NULL |
| trigger_type | varchar(16) | SCHEDULED/MANUAL/RETEST |
| status | varchar(16) | PLANNED/QUEUED/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED |
| schedule_identity | varchar(160) nullable | 调度幂等 identity |
| plan_snapshot | JSONB | 不可变 |
| rule_snapshot | JSONB | 不可变 |
| requested_run_count | integer | >=1 |
| source_opportunity_id | UUID nullable | FK opportunities SET NULL |
| baseline_batch_id | UUID nullable | self FK SET NULL |
| created_by | UUID nullable | Scheduler 可空或系统 actor |
| started_at/finished_at | timestamptz nullable | |
| created_at | timestamptz | |

唯一：`schedule_identity WHERE schedule_identity IS NOT NULL`。

RETEST 约束：source opportunity 和 baseline batch 必填。

## 5.2 `geo_observation_runs`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| batch_id | UUID | FK batches CASCADE 仅未开始聚合删除 |
| prompt_variant_id | UUID nullable | 历史配置删除后 SET NULL |
| collection_profile_id | UUID nullable | SET NULL |
| repeat_index | integer | >=1 |
| attempt_no | integer | >=1 |
| previous_attempt_id | UUID nullable | self FK SET NULL |
| status | varchar(20) | 受控状态 |
| input_snapshot | JSONB | 不可变 |
| external_call_state | varchar(24) | NOT_STARTED/SENT/UNKNOWN/COMPLETED |
| lease_token | UUID nullable | |
| lease_expires_at | timestamptz nullable | |
| dispatch_attempt_count | integer | >=0 |
| last_dispatch_attempt_at | timestamptz nullable | |
| error_stage | varchar(24) nullable | COLLECTION/ANALYSIS/REVIEW |
| error_code | varchar(100) nullable | |
| error_summary | varchar(500) nullable | 非敏感 |
| provider_request_id | varchar(200) nullable | |
| duration_ms | integer nullable | >=0 |
| cost_amount | numeric(14,6) nullable | >=0 |
| cost_currency | varchar(8) nullable | |
| prompt_tokens/completion_tokens/total_tokens | integer nullable | >=0 |
| started_at/collected_at/finished_at | timestamptz nullable | |
| created_at | timestamptz | |

唯一：

- 核心单元：`(batch_id, prompt_variant identity snapshot, collection profile identity snapshot, repeat_index, attempt_no)`；
- 实现时建议保存 `run_cell_key` SHA-256，并唯一 `(batch_id, run_cell_key, attempt_no)`；
- `previous_attempt_id` 最多一个直接后继，可用 partial unique。

索引：

- `(status, created_at, id)`；
- PENDING due-time partial index；
- RUNNING lease partial index；
- `(batch_id, status)`；
- `(collection_profile_id, created_at DESC)`。

## 5.3 `geo_answer_snapshots`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| run_id | UUID | FK runs, UNIQUE |
| prompt_text | text | 非空 |
| answer_text | text | 非空 |
| answer_sha256 | varchar(64) | 非空 |
| answer_format | varchar(16) | TEXT/MARKDOWN/HTML_TEXT |
| source_product | varchar(160) nullable | |
| source_model | varchar(200) nullable | |
| source_version | varchar(200) nullable | |
| web_search_observed | boolean nullable | unknown 允许 null |
| raw_payload_summary | JSONB | 受控非敏感 |
| raw_payload_file_id | UUID nullable | FK file_records SET NULL |
| screenshot_file_id | UUID nullable | FK file_records SET NULL |
| collected_at | timestamptz | 非空 |
| created_at | timestamptz | |

数据库触发器禁止 UPDATE；删除只能随明确 run 聚合删除策略。

## 5.4 `geo_answer_citations`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| answer_snapshot_id | UUID | FK snapshot CASCADE |
| position | integer | >=1 |
| original_url | text | 非空 |
| normalized_url | text | 非空 |
| hostname | varchar(253) | 非空 |
| title | text nullable | |
| source_category | varchar(40) | |
| matched_subject_id | UUID nullable | FK subjects SET NULL |
| extraction_source | varchar(24) | STRUCTURED/DOM/TEXT/MANUAL |
| created_at | timestamptz | |

唯一：`(answer_snapshot_id, normalized_url)`；保存第一次位置，其他位置可进入 `occurrences` 受控 JSON 或后续子表。核心版优先保持简单。

## 6. Analysis 表

## 6.1 `geo_analysis_revisions`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| run_id | UUID | FK runs CASCADE |
| revision | integer | >=1 |
| status | varchar(16) | PENDING/COMPLETED/FAILED |
| analyzer_type | varchar(40) | DETERMINISTIC/HYBRID/EXTERNAL_MODEL |
| analyzer_version | varchar(100) | 非空 |
| input_sha256 | varchar(64) | 非空 |
| fact_version_id | UUID nullable | FK fact_versions SET NULL |
| confidence_summary | JSONB | 受控 |
| review_required_reasons | JSONB | string array |
| error_code/error_summary | varchar nullable | |
| created_at/finished_at | timestamptz | |

唯一：`(run_id, revision)`；成功 input hash 相同的重复请求可幂等返回已有 revision。

Run 可增加 `current_analysis_revision_id` FK，或由服务确定最新成功 revision。为了复核和并发清晰，建议增加显式当前指针，并由应用服务维护。

## 6.2 `geo_entity_mentions`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| analysis_revision_id | UUID | FK analysis CASCADE |
| subject_id | UUID | FK subject RESTRICT |
| mention_count | integer | >=1 |
| first_character_offset | integer nullable | >=0 |
| matched_aliases | JSONB | string array |
| confidence | numeric(5,4) nullable | 0..1 |

唯一：`(analysis_revision_id, subject_id)`。

## 6.3 `geo_recommendations`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| analysis_revision_id | UUID | FK analysis CASCADE |
| subject_id | UUID | FK subject RESTRICT |
| recommendation | varchar(20) | RECOMMENDED/CONSIDERED/NOT_RECOMMENDED/UNKNOWN |
| rank | integer nullable | >=1 |
| rationale_excerpt | text nullable | 受长度限制 |
| confidence | numeric(5,4) nullable | |

唯一：`(analysis_revision_id, subject_id)`。

只有 `RECOMMENDED` 进入推荐率；`CONSIDERED` 可用于明细但不等同推荐。

## 6.4 `geo_claim_assessments`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| analysis_revision_id | UUID | FK analysis CASCADE |
| subject_id | UUID | FK subject RESTRICT |
| fact_version_id | UUID nullable | FK fact_versions SET NULL |
| claim_kind | varchar(40) | 受控 |
| claim_text | text | 非空 |
| claim_sha256 | varchar(64) | 非空 |
| verdict | varchar(16) | ACCURATE/PARTIAL/INCORRECT/UNJUDGEABLE |
| severity | varchar(16) | LOW/MEDIUM/HIGH/CRITICAL |
| fact_excerpt | text nullable | 受控长度，不复制全部敏感事实 |
| explanation | text | 非空 |
| confidence | numeric(5,4) nullable | |

索引：

- `(subject_id, verdict, severity, id)`；
- `(analysis_revision_id)`；
- `(fact_version_id)`。

## 6.5 `geo_run_reviews`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| run_id | UUID | FK runs CASCADE |
| analysis_revision_id | UUID | FK analysis RESTRICT |
| decision | varchar(16) | CONFIRMED/CORRECTED |
| correction_payload | JSONB | 受控 schema |
| comment | text | CORRECTED 时非空 |
| reviewer_id | UUID | FK users RESTRICT |
| created_at | timestamptz | |

不可 UPDATE/DELETE。当前 review 由 `(created_at DESC, id DESC)` 选择，或 run 保存 current review 指针。

## 7. Opportunity 表

## 7.1 `geo_opportunities`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| identity_key | varchar(64) | 确定性 SHA-256 |
| rule_code | varchar(100) | 非空 |
| priority | varchar(16) | LOW/MEDIUM/HIGH/CRITICAL |
| status | varchar(20) | OPEN/ACKNOWLEDGED/IN_PROGRESS/RESOLVED/DISMISSED |
| subject_id/query_topic_id/prompt_variant_id/collection_profile_id | UUID nullable | 对应 FK SET NULL |
| trigger_snapshot | JSONB | 不可变规则和值 |
| source_date_from/source_date_to | date/timestamptz | |
| linked_content_task_id | UUID nullable | FK content_tasks SET NULL |
| linked_publication_issue_id | UUID nullable | FK issue SET NULL |
| linked_fact_product_id | UUID nullable | FK products SET NULL |
| retest_batch_id | UUID nullable | FK batches SET NULL |
| revision | integer | |
| created_at/acknowledged_at/resolved_at | timestamptz nullable | |
| acknowledged_by/resolved_by | UUID nullable | users |
| resolution_code | varchar(40) nullable | |
| resolution_comment | text nullable | |

开放状态 partial unique：`identity_key WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`。

## 7.2 `geo_opportunity_sources`

- `opportunity_id`
- `run_id`
- `analysis_revision_id` nullable
- `source_role`：TRIGGER/SUPPORTING/BASELINE/RETEST
- PK 由三者组合或独立 UUID + unique。

## 7.3 `geo_opportunity_actions`

用于一个机会需要多个行动时保留追加式历史：

- `id`
- `opportunity_id`
- `action_type`：FACT_REVISION/CONTENT_TASK/PUBLICATION_REPAIR/ADDITIONAL_MONITORING/OTHER
- `target_type/target_id`
- `status_snapshot`
- `created_by/created_at`

核心版可以先支持主要链接字段，但实现前应确认是否直接建设 actions 表。推荐建设，避免未来字段膨胀。

## 8. 枚举和检查约束

所有枚举同时存在于：

1. Pydantic/StrEnum；
2. OpenAPI；
3. PostgreSQL CHECK；
4. 前端生成类型；
5. 状态机测试。

不使用 PostgreSQL enum type，延续 varchar + CHECK 的迁移策略。

## 9. 不可变数据库防线

建议增加触发器或复用当前不可变防线，禁止：

- UPDATE `geo_answer_snapshots`；
- UPDATE `geo_answer_citations`；
- UPDATE `geo_analysis_revisions` 已完成内容；
- UPDATE/DELETE `geo_run_reviews`；
- 修改 run 的 `input_snapshot`；
- 把终态 run 回退到非终态；
- 修改 opportunity 的 `trigger_snapshot`；
- 删除被报告、机会或任务引用的运行。

应用服务仍需先校验并返回领域错误，数据库用于最终防线。

## 10. 迁移策略

### 10.1 顺序

建议按独立 Alembic revision 切分：

1. Catalog；
2. Prompt variants 和 plans；
3. Batches/runs/answers；
4. Analysis/reviews；
5. Opportunities；
6. 可选当前指针、物化读优化和浏览器会话引用。

### 10.2 前滚原则

- 先加表和可空列；
- 部署可读取但入口关闭的代码；
- 运行结构和迁移测试；
- 启用人工流程；
- 再启用 API Worker；
- 不执行自动历史重分析；
- 旧 `GeoObservation` 不搬入新表，先通过统一读导航并存；
- 如后续需要导入历史回答，使用显式 migration/import command，保存来源类型。

## 11. 保留和清理

初始建议：

| 数据 | 默认策略 |
|---|---|
| 计划/批次/运行元数据 | 长期保留 |
| 回答正文和引用 | 长期保留，按公司政策可归档 |
| 截图 | 长期或至少 24 个月，具体由数据政策决定 |
| raw payload 文件 | 90–180 天后可删除，仅保留摘要和哈希 |
| 分析 revision/review | 长期保留 |
| 机会和行动 | 长期保留 |
| 临时浏览器运行数据 | 任务结束立即清理 |
| 浏览器认证资料 | 独立受控保留，失效或撤销后安全删除 |

实际天数在上线前由公司数据负责人批准，不在代码中写死无文档的值。

## 12. 备份和恢复

数据库备份必须与以下内容成套：

- AI 凭据加密主密钥；
- 对象存储中的截图和 raw payload；
- 浏览器会话密钥/引用（若启用）；
- release manifest 和迁移版本。

恢复验证至少证明：

1. 批次、运行、回答、分析和机会关联完整；
2. 文件引用可读取或明确标记缺失；
3. 凭据在对应主密钥下可解密；
4. Scheduler 不会因恢复重复创建历史调度窗口；
5. PENDING/RUNNING 状态按恢复 runbook 显式处置。
