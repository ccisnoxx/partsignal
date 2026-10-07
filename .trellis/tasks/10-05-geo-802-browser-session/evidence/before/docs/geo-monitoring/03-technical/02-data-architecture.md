# GEO-607 / R5 访问路径补充

`0057_geo_insight_indexes`在Run追加`ix_geo_runs_insight_created(created_at DESC,id ASC)`。
日期读取与keyset排序无需status/profile前缀；其他索引与全部业务守卫保留。
没有业务回填、指标结果表或可写缓存，指标仍可从Run/current Analysis/latest Review重建。
完整冻结Run/Analysis输入仅按内容指纹在同一RR内去重解码；每个Run的事实和身份仍独立。
对象/产品SQL交集直接读取Run冻结JSON的同一binding，不读取当前Catalog或批次其他对象。
迁移为事务内DDL，锁等待5秒、语句120秒；需停写窗口，超时整体回滚。撤销仅drop索引。
本地100k/P95/EXPLAIN/N+1及R5门禁证据见
[GEO-607验收记录](../04-delivery/06-r5-insight-performance-acceptance.md)。

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

GEO-303 增量 `0049_geo_batch_creation` 增加不可变 `geo_batch_creation_requests` 和 `geo_batch_subjects`，精确表/索引/守卫、幂等与回填以 [批次创建数据库合同](../../../contracts/database.md#geo-批次创建合同geo-303--r2) 为权威。手工身份按用户作用域保存key/request摘要；主体历史每批次一组关系，FK防止身份删除。0048非空快照只回填引用，不重写JSON。创建先PLANNED，完整矩阵后QUEUED；Prompt/Surface首次引用锁存与全部数据同事务提交。

## 5.2 `geo_observation_runs`

- cell 为稳定 `prompt_variant_id × collection_profile_id × repeat_index(1..10)`，数据库生成 `run_cell_key`；唯一 `(batch_id, run_cell_key, attempt_no)`。
- 新 Run 从 PENDING/revision0/NOT_STARTED 创建。输入快照、身份、时间与 attempt 链不可改；后继必须恰好 +1，沿用同 Batch/cell/完整输入，前序是采集阶段 FAILED/BUDGET_BLOCKED；前序不存在即拒绝，每前序最多一个后继。
- 四个终态 COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED 全行冻结；同值更新不递增 revision，实际可变更新恰好 +1。分析失败不创建重采集 attempt，重分析由独立 AnalysisRevision 承载。
- 记录 `external_call_state`、内部 `lease_token/lease_expires_at`、dispatch 计数/时间、阶段/闭合错误码/非敏感摘要、provider request ID、bigint 耗时、有限非负可空费用/币种、独立可空 token 用量与生命周期时间。
- RUNNING/ANALYZING 必须有成对 lease；其他状态无 lease。公共组件隐藏 token。已发送/未知外部调用不能回到 NOT_STARTED。
- PENDING due、RUNNING/ANALYZING lease、Batch/status、Profile/created、Prompt、status/created 等索引支持后续稳定 ID 扫描。Batch/Prompt/Profile/previous FK 均 RESTRICT，不级联或置空历史。
- GEO-301 只定义模型与公共数据组件；状态投影和命令属 GEO-302，原子快照生产/资格/锁存属 GEO-303，答案属 GEO-304。0048 不修改或迁移旧 GeoObservation，也不接入 Worker/Collector/分析/指标。

## 5.3 `geo_answer_snapshots`

GEO-304 / R2 由 `0050_geo_answer_evidence` 实现；精确 schema、约束、锁与错误以 [数据库合同](../../../contracts/database.md#geo-answersnapshot--citation-合同geo-304--r2) 为权威。每个 Run 唯一一份原始回答；保留正文空格/换行，`answer_sha256` 由数据库对完整 UTF-8 正文生成。`prompt_text` 必须等于冻结输入；未知 source_product/model/version 和 web_search_observed 保留 NULL。

| 字段 | 类型 | 约束 |
|---|---|---|
| id / run_id | UUID | PK / UNIQUE，FK Run RESTRICT |
| prompt_text / answer_text | text | 非空；回答最多 1,048,576 字符 |
| answer_sha256 | varchar(64) | GENERATED ALWAYS，UTF-8 SHA-256 |
| answer_format | varchar(16) | TEXT/MARKDOWN/HTML_TEXT |
| source_product / source_model / source_version | nullable varchar | 160 / 200 / 200 字符 |
| web_search_observed | nullable boolean | unknown 为 NULL |
| raw_payload_summary | JSONB | 闭合 v1：schema_version、payload_format、payload_bytes、finish_reason |
| raw_payload_file_id / screenshot_file_id | nullable UUID | FK file_records RESTRICT，不允许同一文件 |
| citation_count | integer | 0..1000，完整集合计数 |
| collected_at / created_at | timestamptz | 非空 |

回答、引用及其关系禁止 UPDATE/DELETE；同一事务完整提交回答、引用与 Run 采集事实，不能事后追加原始证据。大载荷使用已验证的 INTERNAL/RESTRICTED FileRecord：raw 为 EVIDENCE/text/plain ≤50MiB，截图为 OPERATION_SCREENSHOT/image/png、jpeg、webp ≤10MiB。应用边界重验上传者与真实 HEAD；数据库重验资格并锁文件，GC 识别两类引用。该任务不提供提交命令，不增加 draft，也不执行外部采集。

## 5.4 `geo_answer_citations`

| 字段 | 类型 | 约束 |
|---|---|---|
| id / answer_snapshot_id | UUID | PK / FK AnswerSnapshot RESTRICT |
| position | integer | 1..1000，首次实际位置 |
| occurrences | integer[] | 非空、严格递增、首项等于 position |
| original_url / normalized_url | text | 1..2083，安全 HTTP(S) |
| hostname | varchar(253) | 小写规范 host；IDNA 或 IP |
| title | nullable text | 最多 2000 字符 |
| extraction_source | varchar(24) | STRUCTURED/DOM/TEXT/MANUAL |
| created_at | timestamptz | 非空 |

唯一：`(answer_snapshot_id, normalized_url)` 和 `(answer_snapshot_id, position)`。按原回答位置排序后去重；保留第一条原 URL/标题/来源以及全部实际位置。规范化去 fragment、默认端口、host 大小写并处理 IDNA；没有获批追踪参数清单时保留全部 query，禁止 URL 凭据、反斜线、空白/控制字符，且不访问引用目标。

依据 Accepted ADR-003，source_category、Subject 和 Article 匹配是后续 AnalysisRevision 的派生事实，不写入原始 Citation。原始摘要只保存限定结构事实，未知字段、任意字符串、Header/Cookie/Authorization 均拒绝；raw 文件内容与截图清理由后续提交/采集信任边界负责。

## 5.5 人工草稿和提交身份（GEO-305 / R2）

`0051_geo_manual_collection` 仅新增 `geo_manual_drafts` 与 `geo_manual_submissions` 及数据库守卫，不回填或修改0050以前的历史回答。精确列、约束、索引和锁序见 [数据库合同](../../../contracts/database.md#geo-manual-草稿与提交合同geo-305--r2)。

草稿按Run单行保存闭合临时观测JSON，独立draft_revision与更新人；typed截图/raw外键参与既有实时GC。保存实际修改恰好+1，同值保持原样；只允许MANUAL PENDING且无答案。解绑文件只有最后真实引用解除才安排七天清理。

提交身份保存actor命名空间内的key摘要、完整请求摘要、同Run的唯一Answer、提交时Run/Draft版本和时间，禁止更新/删除。正式Snapshot、全部引用及文件、COLLECTED、Batch缓存与身份/审计同事务；成功删除草稿，失败全部回滚。0050原始证据继续不可变。

分析占位由COLLECTED稳定ID和NOT_IMPLEMENTED回执表示；不新增outbox、Worker、AnalysisRevision或队列消息。降级55000安全停止，恢复依赖前向修复或备份，不删除提交历史。

## 6. Analysis 表

## 6.1 GEO-501 分析与复核数据合同

R4 的精确表、闭合输入、强事实引用、不可变触发器、指针/选择及锁规则由 [根数据库合同](../../../contracts/database.md#geo-analysisrevision--子结果--runreview-合同geo-501--r4) 和 `0054_geo_analysis_contract` 拥有。此节早期 CASCADE/SET NULL、单一事实及可选指针草稿按 Accepted ADR-003 统一替换。

- `geo_analysis_revisions`：同 Run 单调 revision；PENDING 执行外壳一次终结；完整输入冻结，终态不可修改或删除；成功输入摘要唯一。
- `geo_analysis_fact_versions`：每个自有产品分别绑定非空 APPROVED 同产品事实；输入 manifest 与强引用原子一致；全部 RESTRICT，旧事实退休后历史仍可复现。
- `geo_entity_mentions`、`geo_recommendations`、`geo_claim_assessments`：独立不可变子结果，只在成功终结事务装配；未知事实保持 UNJUDGEABLE；枚举遵循方法论。
- Run 显式 `current_analysis_revision_id`：只独立发布更高且最新成功结果，不改原始采集状态/字段。失败保留旧 pointer，较旧完成不覆盖较新结果。
- `geo_run_reviews`：只对当前成功分析追加闭合修正；不可 UPDATE/DELETE。当前 review 限 pointer 对应 analysis，按服务端 created_at DESC,id DESC 选择；旧 review 保留历史。

GEO-501 没有实现算法、Worker、分析读写 API、Review UI 或统计；原始引用分类归属仍由后续 GEO-504 接入分析层，不写回原始 Citation。

## 7. Opportunity 表

## 7.1 `geo_opportunities`

| 字段 | 类型 | 约束 |
|---|---|---|
| id | UUID | PK |
| identity_key | varchar(64) | 确定性 SHA-256 |
| rule_code | varchar(100) | 非空 |
| priority | varchar(16) | LOW/MEDIUM/HIGH/CRITICAL |
| status | varchar(20) | OPEN/ACKNOWLEDGED/IN_PROGRESS/RESOLVED/DISMISSED |
| subject_id/query_topic_id/prompt_variant_id/collection_profile_id/engine_surface_id/batch_id | UUID nullable | 对应 FK RESTRICT，保留历史身份 |
| trigger_snapshot | JSONB | 不可变规则和值 |
| source_date_from/source_date_to | timestamptz | UTC 半开窗口 |
| revision | integer | 初始1，实际更新严格+1 |
| last_seen_at | timestamptz | 追加评估时间，不覆盖首次触发 |
| created_at/acknowledged_at/resolved_at | timestamptz nullable | |
| acknowledged_by/resolved_by | UUID nullable | users |
| resolution_code | varchar(40) nullable | |
| resolution_comment | text nullable | |

开放状态 partial unique：`identity_key WHERE status IN ('OPEN','ACKNOWLEDGED','IN_PROGRESS')`。

GEO-702当前实现以 actions 追加表保存多个行动，未增加主要链接字段；行动写入/目标归属由704交付，复测关系由705交付。身份、锁序、快照和不可变约束以根 `contracts/database.md` 的GEO-702合同为准；旧设计的SET NULL不能解绑实际历史。

## 7.2 `geo_opportunity_sources`

- `opportunity_id`
- `run_id`
- `analysis_revision_id` nullable
- `review_id` nullable
- `source_role`：TRIGGER/SUPPORTING/BASELINE/RETEST
- 独立 UUID PK；`(opportunity_id,run_id,analysis_revision_id,review_id,source_role)` unique NULLS NOT DISTINCT。分析与复核必须属于该Run。

## 7.3 `geo_opportunity_actions`

用于一个机会需要多个行动时保留追加式历史：

- `id`
- `opportunity_id`
- `action_type`：FACT_REVISION/CONTENT_TASK/PUBLICATION_REPAIR/ADDITIONAL_MONITORING/OTHER
- `target_type/target_id`
- `status_snapshot`
- `created_by/created_at`

702已建立该追加式表及不可变防线，不提供创建行动服务，也不声称多态target已有跨域参照完整性；704必须在行动所有者边界验证目标。

## 7.4 `geo_opportunity_evaluations`（702）

追加保存每条规则的实际配置revision、作用域、周期、值、阈值、分子/分母、稳定来源身份和不可用原因。`evaluation_key`为规范结果内容SHA，`identity_key`为业务身份；不可用/未触发没有Opportunity FK，已触发记录按创建/更新/关闭后抑制区分。相同输入重放不增长Opportunity revision；首次trigger与既有来源不修改。

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


### GEO-506：执行元数据与引用分类

0055在0054之上新增`geo_analysis_jobs`和`geo_citation_classifications`，不修改历史输入、
原始引用或current pointer，不回填旧revision。Job只有lease/claim/dispatch元数据，
AnalysisRevision.status仍是唯一执行业务状态；引用分类归revision，并强引用原始Citation。
首次Run/Joblease及终结、全部分类与COMPLETED受延迟约束保护；不可变与RESTRICT保留历史。
精确列、索引、锁序、PG hash、幂等与迁移停止合同见
[根数据库合同](../../../contracts/database.md#geo-506-analysis-worker--revision-生命周期r4)，不在本层维护第二套规则。

### GEO-507：追加复核与当前选择

0056只扩展受控Run复核发布guard，不新增表/列、不回填历史；Answer、机器子结果和旧Review保持不可变。review追加与Run revision、首次NEEDS_REVIEW完成和受控audit同事务；当前选择和四栏修正都由根合同拥有。

详情始终同时返回原机器历史与当前reviewed投影；latest Review不累计旧修正，新成功pointer自动使旧review仅作历史。精确锁序、scope、并发、门禁和前向恢复规则见[根数据库合同](../../../contracts/database.md#geo-507-人工复核命令与当前结果r4)。


## 当前 R6：GEO-704 行动持久化

`0060_geo_opportunity_actions`只向既有Action增加来源快照、actor/key和完整请求SHA-256、首次提交后的机会revision；旧行四列为NULL，不回填业务历史。actor/key部分唯一索引和不可变守卫保留；INSERT最终验证机会版本、真实来源及目标产品/主题/事实/平台/Article/Issue归属。API服务先取目标领域原锁，最后Opportunity CAS，目标、Action、状态与低敏审计同一事务提交；失败整体回滚。

普通删除保护行动目标及发布来源；成果删除预检同时计入旧null快照的Issue/Article直接行动引用，按Action去重。唯一历史删除例外仍为既有管理员对已归档ContentTask aggregate的永久删除，保留行动稳定ID与来源并显式投影缺失。新列无目标跨域cascade FK，不能让永久删除抹去行动历史。downgrade明确拒绝销毁历史；发布前滚、失败事务回滚或前向修复，生产迁移不属于704本地实施。

## 当前 R6：GEO-705 严格复测持久化

`0061_geo_retests` 新增不可变 `geo_retest_baselines` 与 `geo_retest_requests`。前者保存首次机会触发证据、显式来源批次和完整根矩阵/输入/版本，按机会与来源批次唯一；后者保存 actor/key 请求摘要、唯一 RETEST Batch 身份和首次成功机会 revision。客户端不提供 snapshot，原始幂等键不入库。来源核验、完整复制、不可变及延迟提交守卫以[根数据库合同](../../../contracts/database.md#geo-705-严格复测基线与幂等合同r6)为权威。

只做加法 DDL，不回填机会、旧观测、旧 RETEST 或历史版本。迁移预检发现旧无严格回执的 RETEST 即保留原数据并停止；事务失败原子回滚，禁止破坏性 downgrade，恢复采用迁移前备份或前向修复。基线与复测创建共享一次业务提交；只读预览不持久化。结果指标比较、恢复判断和机会解决属于 GEO-706，未在本迁移加入。


## GEO-706 比较处理持久化

0062追加不可变机会decision历史，精确列、FK/约束、revision和deferred解决依据守卫以[根数据库合同](../../../contracts/database.md#geo-706-比较与显式处理合同r6)为权威。所选比较快照绑定真实705 baseline/retest回执并保存服务端指纹，人工解决不伪造复测恢复结论。无历史回填、旧已解决数据重写或生产迁移；处理失败与审计失败整体回滚，downgrade拒绝销毁历史。
