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

## 3.1～3.3 Subject / Alias / Domain（GEO-101 合同 / GEO-102 ORM / GEO-103 策略 / GEO-104 服务）

这三张表的唯一详细权威是 [根数据库合同的 GEO Catalog 章节](../../../contracts/database.md)。GEO-101 已被人工接受；GEO-102 已实现 ORM 注册与新迁移 `0044_geo_catalog`，并在隔离 PostgreSQL 16 验证前滚、metadata 和 SQL 约束。实际证据见 [GEO-102 实施记录](../../../.trellis/tasks/10-01-geo-102-catalog-orm/implement.md)。GEO-103 已实现 Schema、规范化、真实父子/歧义与无 I/O 的动作/删除投影，见 [GEO-103 实施记录](../../../.trellis/tasks/10-01-geo-103-catalog-policy/implement.md)；GEO-104 已实现 CRUD Application Service/Router、聚合锁及原子审计，见 [GEO-104 实施记录](../../../.trellis/tasks/10-02-geo-104-catalog-api/implement.md)。无新 revision、历史回填或生产迁移。

- `geo_subjects`：五种 subject_type；OWN_PRODUCT 仅绑定 Product，canonical_name/normalized_name/display_name 持久化为 NULL，公共名称从当前 Product 投影。其他类型保存监测身份，不能承载公司产品事实。
- Product 活动身份由 `uq_geo_subjects_active_own_product` partial unique 仲裁；停用历史可保留，enable 必须复核唯一性。不对非自有名称增加猜测性全局唯一。
- 父级可空；OWN_PRODUCT→OWN_BRAND、COMPETITOR_PRODUCT→COMPETITOR_BRAND；品牌及 REFERENCE_PART 无父级。内部 parent_subject_type 加 CHECK、MATCH FULL 复合 RESTRICT FK 保证真实父级类型，不暴露给客户端。
- `geo_subject_aliases`：NFKC/空白规范化后 casefold，保留标点与型号后缀；同 Subject normalized_alias 唯一（含停用），alias_kind=NAME/PART_NUMBER/ABBREVIATION/LEGACY，language_code 可空。跨对象重复保留为歧义，不能静默任选匹配。
- `geo_subject_domains`：IDNA2008/UTS #46 non-transitional + STD3 的 lowercase ASCII hostname，精确匹配、不执行网络调用；同 Subject hostname 唯一，跨对象共享保留歧义。relation_type=OWNED/OFFICIAL/DISTRIBUTOR/OTHER；当前只有 create/delete，is_active 恒 true。
- Subject 是两类子实体的 revision owner；子命令提交父 expected_revision，成功返回完整父投影。只有 Subject 聚合内 Alias/Domain 可 CASCADE；Product、父子与未来业务引用 RESTRICT，历史使用完整当时字典快照。
- 命名约束/索引已由 GEO-102 实施；GEO-103 的 Schema/领域策略建立规范化及投影，引用计数全部由调用方显式提供、不猜零。锁序、真实引用批量查询、写入/精确 HTTP 映射和 Product/User 生命周期接入由 GEO-104 按根合同实现。列表/详情采用一致快照与批量查询；当前只有子 Subject 引用表，后续域必须同时接入真实 FK、锁及查询。ORM 不自动递增 revision 或 updated_at；downgrade 明确拒绝删除三表，恢复使用前滚修复或迁移前备份。本任务不修改后续 EngineSurface/Profile 等目标合同。

## 3.4 `geo_engine_surfaces`

GEO-203 / R1 已在 `0046_geo_surfaces_profiles` 增量建立该表。完整列类型、枚举、CHECK/UNIQUE/FK/index 和 revision/首次引用守卫见 [权威数据库合同](../../../contracts/database.md#geo-enginesurface--collectionprofile-合同geo-203--r1)，避免在技术目标文档维护第二套声明。

Surface 的六项闭合布尔 capabilities 必须齐全，answer_text=true；website_url 不含认证信息/query/fragment；默认 is_active=false、compliance_status=NOT_REVIEWED、revision=0。首次引用锁存不可清除/改写，已引用 Surface 不可删除；未来历史通过不可变快照保存，当前配置没有被伪装成历史 Run。

## 3.5 `geo_collection_profiles`

同一 `0046` 创建 Profile，公共判别联合与闭合 settings 见 [OpenAPI](../../../contracts/openapi.yaml)。`settings_json` 是持久化名称，响应显式转换为 `settings`，不得直接公开 ORM 或 join AI 凭据。

- MANUAL/BROWSER 两个 AI 引用均为空；MANUAL adapter=manual。API 两引用同时空或同时存在，由 MATCH FULL 复合 FK 指向 AIModel(id,channel_id)，数据库验证同渠道归属；AIModel 新增对应复合 UNIQUE，已有渠道 CASCADE 模型删除与 Profile 成对 SET NULL 保持一致。
- Surface 和 User created_by 使用 RESTRICT；(engine_surface_id,name) 唯一；MANUAL/BROWSER 与 API 的 login_state、语言/地区、web_search_policy 和模式专属 settings 均有命名 CHECK，未知键/secret 拒绝。
- 新 Profile is_active=false、UNTESTED；测试状态/时间一致。身份/Surface/模式不可变；有效配置更新 revision 恰好 +1，no-op 保留 revision/updated_at，不自动提交事务。
- 0046 仅 expand，不回填旧 GEO、PromptVariant 或 AI 配置，不创建 Registry、Batch/Run 或 Collector。旧 head 前滚与空库验证在 Task 证据；downgrade 明确拒绝破坏性删除，恢复采用前滚修复或迁移前备份。

## 4. Planning 表

## 4.1 `geo_prompt_variants`

GEO-201 / R1 已实现该表，权威字段、规范化、命名约束和历史锁存见 [数据库合同](../../../contracts/database.md#geo-promptvariant-合同geo-201--r1)。新字段 `first_referenced_at` 为不可逆的内部运行引用标记；已引用后只能停用，不能编辑、重新启用或删除，后续新语义使用新变体。本阶段不创建 Run、不回填旧 QueryTopic.variants。

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

GEO-206 / R1 已实现本表及 4.3 三张关系表。精确默认值、命名 CHECK/PK/FK、索引、提交时完整性和归档守卫见 [数据库合同](../../../contracts/database.md#geo-monitoringplan-合同geo-206--r1)。`0047_geo_monitoring_plans` 只新增配置，不回填或改变既有数据；关系写锁父 Plan 并建立 MVCC 写冲突，提交时至少一个 PRIMARY、prompt、profile，支持同事务替换。关系到资源 RESTRICT，Plan 显式删除只级联自身关系；created_by/updated_by 到 User RESTRICT。没有 Batch/Run、lease、next_run_at 或成本累计列；本次生产迁移未执行，downgrade 安全拒绝，恢复使用前向修复或备份。

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

CRON 配置约束：`schedule_kind=CRON` 时提供有效五字段表达式，`MANUAL_ONLY` 时必须为空。输入解析复用 Celery；数据库 CHECK 保证字段结构，IANA 时区由 PostgreSQL 目录验证。预算为 numeric(14,6) 的有限非负数，NULL 表示未设置上限。

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

关系表只在 Plan 聚合内允许变更，同计划同资源唯一（Subject 换角色也不能重复）；至少一个 PRIMARY、prompt、profile 由可延迟约束触发器最终保证。归档关系只读。未来批次创建后只读 plan snapshot，GEO-206 不创建该快照或批次。

## 5. Collection 表

## 5.1 `geo_observation_batches`

GEO-301 / R2 已建立独立回答级 Batch/Run 两表及 `0048_geo_batches_runs`。精确字段、默认值、命名约束、索引、快照外壳和安全停止路径以 [根数据库合同](../../../contracts/database.md#geo-batch--run-合同geo-301--r2) 为权威。

- Batch 保存不可变计划/规则快照、触发身份、初始 cell 数和创建追溯；`status`、时间与 `revision` 是可从 runs 重建的缓存。
- 初始状态 PLANNED，后续缓存状态 QUEUED/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED/BUDGET_BLOCKED。
- SCHEDULED 保存 `scheduled_for` 和 SHA256 `schedule_identity`；唯一 `(plan_id, scheduled_for)` 不含计划 revision，另有非空摘要 partial unique。
- Plan、基线 Batch、创建 User 的历史 FK 均 RESTRICT。RETEST 必填 source opportunity UUID 和 baseline；机会实体由 GEO-702 引入后追加真实 FK，本阶段没有复测命令。
- `requested_run_count` 计初始 attempt1 的逻辑 cell；deferred CHECK 在创建提交时保证数量相等，不允许空批次或后续扩张根矩阵。

## 5.2 `geo_observation_runs`

- cell 为稳定 `prompt_variant_id × collection_profile_id × repeat_index(1..10)`，数据库生成 `run_cell_key`；唯一 `(batch_id, run_cell_key, attempt_no)`。
- 新 Run 从 PENDING/revision0/NOT_STARTED 创建。输入快照、身份、时间与 attempt 链不可改；后继必须恰好 +1，沿用同 Batch/cell/完整输入，前序是采集阶段 FAILED/BUDGET_BLOCKED；前序不存在即拒绝，每前序最多一个后继。
- 四个终态 COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED 全行冻结；同值更新不递增 revision，实际可变更新恰好 +1。分析失败不创建重采集 attempt，重分析由独立 AnalysisRevision 承载。
- 记录 `external_call_state`、内部 `lease_token/lease_expires_at`、dispatch 计数/时间、阶段/闭合错误码/非敏感摘要、provider request ID、bigint 耗时、有限非负可空费用/币种、独立可空 token 用量与生命周期时间。
- RUNNING/ANALYZING 必须有成对 lease；其他状态无 lease。公共组件隐藏 token。已发送/未知外部调用不能回到 NOT_STARTED。
- PENDING due、RUNNING/ANALYZING lease、Batch/status、Profile/created、Prompt、status/created 等索引支持后续稳定 ID 扫描。Batch/Prompt/Profile/previous FK 均 RESTRICT，不级联或置空历史。
- GEO-301 只定义模型与公共数据组件；状态投影和命令属 GEO-302，原子快照生产/资格/锁存属 GEO-303，答案属 GEO-304。0048 不修改或迁移旧 GeoObservation，也不接入 Worker/Collector/分析/指标。

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
