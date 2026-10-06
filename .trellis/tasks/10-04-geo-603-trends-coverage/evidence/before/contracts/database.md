# PartSignal Database Contract

## Conventions

- PostgreSQL 16 is the only supported business database.
- Tables and columns use `snake_case`; identifiers are UUID; timestamps are timezone-aware UTC.
- Mutable aggregates carry an integer `revision`; clients must submit `expected_revision`.
- Alembic is the only schema migration entry point. API and Worker never run migrations on startup.
- Revisions `0001` through `0008` use `app.migration_schema_v1` as a frozen metadata snapshot; future runtime model changes must add a new revision and must not edit that snapshot.
- JSONB is limited to immutable generation snapshots, structured generation output, and audit details. Editable product facts use one Markdown body on `products`; platform rules and normalized fact subgraphs no longer exist after `0025`.
- Review records, publication work events, publication verifications, observations, and audit logs cannot be modified in place。`0027` 仅在物理删除停用用户时允许把匹配 `audit_logs.actor_id` 置空；`0029` 允许管理员按完整更正链删除人工 GEO 观测；`0037` 允许普通删除未成功发布的任务聚合，并允许管理员永久删除已归档任务聚合。发布与 GEO 历史在保留期间仍禁止原地改写，删除只能从显式业务命令进入。

## GEO MonitoringPlan 合同（GEO-206 / R1）

`0047_geo_monitoring_plans` 从 `0046_geo_surfaces_profiles` 仅新增四表、完整性/归档守卫和时区目录函数。不回填旧 QueryTopic/GeoObservation，不创建 Batch/Run，不执行调度或外部采集。公司内部单租户共享配置，created_by/updated_by 是服务端追溯，不是用户私有归属。GEO-208 已接线 Plan 命令、权限/CAS/审计；矩阵、当前资源活动和运行资格复用 GEO-207。无新表/列/Alembic revision。

### geo_monitoring_plans

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id | UUID | pk_geo_monitoring_plans |
| name / description | varchar(200) / text 默认空 | 名称非空、无首尾空白；无名称唯一性要求 |
| status | varchar(16) DISABLED | DISABLED / ACTIVE / PAUSED / ARCHIVED；配置生命周期，不是运行状态 |
| repeat_count | integer 3 | 1..10 |
| schedule_kind / cron_expression | varchar(16) MANUAL_ONLY / varchar(120) NULL | MANUAL_ONLY 必须空；CRON 必须五个非空字段，用单空格分隔 |
| timezone | varchar(64) Asia/Shanghai | IANA 名称；Schema ZoneInfo、数据库 pg_timezone_names 精确存在校验 |
| budget_limit | numeric(14,6) NULL | 有限且非负；NULL 表示未设置上限，不表示已知费用为零 |
| rule_set_revision | integer 1 | >=1，配置选择；未来批次冻结，不是分析结果或规则表实现 |
| revision | integer 0 | >=0；Application Service在实际配置/状态变化时CAS并恰好+1，no-op不变 |
| created_by / updated_by | UUID NOT NULL | fk_geo_monitoring_plans_creator / updater → users.id RESTRICT |
| created_at / updated_at | timestamptz now() | 创建追溯不可变，UTC |

CHECK 前缀 `ck_geo_monitoring_plans_`：name/status/repeat/schedule/timezone/budget/revision/rule_revision。索引 `ix_geo_monitoring_plans_status_updated(status,updated_at,id)`、creator(created_by)、updater(updated_by)。无 next_run_at、last_batch、run_count、费用消费、lease、dispatch、成功率或答案列。Cron 在 Schema 完整匹配各字段词法后，复用已安装 Celery 校验数值/范围/步长；数据库只保证结构和调度组合，不构造第二个解析器或执行器。预算 JSON 输入/输出仅十进制字符串或 NULL：非负、最多8位整数/6位小数，无前导零、符号、指数或尾随字符；内部用 Decimal 并保留精度。Schema拒绝不符合此语法/精度的输入，数据库numeric自身可能舍入旁路SQL的超精度输入，正常writer须经过Schema。

### 三种显式关系

| 表 | PK / 资源FK / 反向索引 |
|---|---|
| geo_monitoring_plan_subjects | PK(plan_id,subject_id)；fk_geo_monitoring_plan_subjects_subject → geo_subjects.id RESTRICT；ix_geo_monitoring_plan_subjects_subject(subject_id,plan_id) |
| geo_monitoring_plan_prompts | PK(plan_id,prompt_variant_id)；fk_geo_monitoring_plan_prompts_prompt → geo_prompt_variants.id RESTRICT；ix_geo_monitoring_plan_prompts_prompt(prompt_variant_id,plan_id) |
| geo_monitoring_plan_profiles | PK(plan_id,collection_profile_id)；fk_geo_monitoring_plan_profiles_profile → geo_collection_profiles.id RESTRICT；ix_geo_monitoring_plan_profiles_profile(collection_profile_id,plan_id) |

Subject关系role为PRIMARY/COMPETITOR/REFERENCE，`ck_geo_monitoring_plan_subjects_role`限制枚举。角色独立于Subject类型；同资源在同计划内只能出现一次，即使role不同。三个 `fk_geo_monitoring_plan_<suffix>_plan` 都引用Plan.id，CASCADE仅清理显式删除父聚合的关系，不级联任何被选择资源。配置引用不等于历史运行：不得设置Prompt/Surface first_referenced_at，资源仍可维护或停用，删除被真实关系阻断。已暂停/归档Plan同样计入引用。

### 提交完整性、版本和并发

- `geo_monitoring_plan_complete` 与三个 `<table>_complete` 为 `DEFERRABLE INITIALLY DEFERRED` constraint triggers；事务提交时每个现存Plan必须至少一个PRIMARY、一个prompt、一个profile，分别以 `23514 + ck_geo_monitoring_plans_primary_required / prompt_required / profile_required` 拒绝。创建/替换关系可暂时为空；不允许将未完整草稿提交。`SET CONSTRAINTS ALL IMMEDIATE` 可在同事务提前验收最终集合。
- `<table>_guard` 在关系写前锁父Plan，再执行父行同值UPDATE建立MVCC写冲突；不自动改变逻辑revision/updated_at/审计。这样READ COMMITTED串行后重验最终集合，REPEATABLE READ并发旧快照写入失败为40001，不能写偏斜删除不同最后PRIMARY。GEO-208命令自行持锁、CAS、一次更新聚合revision；本任务没有自动重试或并发成功兜底。
- `geo_monitoring_plan_guard` 要求INSERT为DISABLED/revision0，禁止改id/created_by/created_at；归档行禁止实际UPDATE与DELETE，归档关系任何写入均以 `23514 + ck_geo_monitoring_plans_archived` 拒绝。关系plan_id不可原地改动（membership_identity）；显式删除/新建完成迁移。完整状态转换、资格门禁和no-op判定属于GEO-208，不由该数据守卫推导可用动作。
- 引用写入与现有删除命令通过资源FK KEY SHARE和资源行锁仲裁；GEO-208 Plan命令先锁User，再按现有资源锁序锁旧/新集合并集，最后锁Plan；稳定UUID顺序，资格与配置身份锁后重验。

### 删除投影与错误边界

Subject现有references.monitoring_plan_count改为三表中真实Subject关系的批量计数，MONITORING_PLAN blocker复用既有owner。Prompt新增MONITORING_PLAN删除blocker；计划引用不冻结编辑/启停语义，历史HISTORY_REFERENCE仍独立。Profile ADMIN deletion新增MONITORING_PLAN/count且移除DELETE；ENGINEER继续deletion=null。User批量引用查询计入creator/updater，沿用USER_BUSINESS_HISTORY。没有N+1或秘密读取。

| 真实失败 | 现有命令映射 |
|---|---|
| Subject持锁引用预检；DELETE 23503 + fk_geo_monitoring_plan_subjects_subject | 409 GEO_SUBJECT_IN_USE；预检含真实references，FK回滚后details={} |
| Prompt持锁引用预检；DELETE 23503 + fk_geo_monitoring_plan_prompts_prompt | 409 GEO_PROMPT_VARIANT_IN_USE；不改历史IMMUTABLE语义 |
| Profile持锁引用预检；DELETE 23503 + fk_geo_monitoring_plan_profiles_profile | 409 GEO_PROFILE_IN_USE；预检含blockers，FK回滚后details={} |
| User计划追溯引用 | 409 USER_IN_USE，沿用USER_BUSINESS_HISTORY |

只有上述命令边界/精确约束允许映射；未知SQLSTATE/constraint原样失败，业务/成功审计整体回滚。GEO-208登记下述Plan命令边界。0047 downgrade主动55000拒绝删配置；恢复使用前向修复或迁移前PostgreSQL备份，无破坏性数据迁移。

### GEO-208 命令、快照与审计

ADMIN/ENGINEER 管理内部共享配置，创建/复制强制 DISABLED/revision0，服务器创建与更新身份。PATCH 完整替换配置；忽略集合顺序的 no-op 不改 revision/updated_at/updated_by 或审计。DISABLED/PAUSED 可保存存在且结构完整但当前不可运行的资源选择；ACTIVE 实际修改与 activate/resume 必须通过共享资格。状态转换只允许 DISABLED→ACTIVE、ACTIVE→PAUSED、PAUSED→ACTIVE、非归档→ARCHIVED；重复命令明确拒绝。ACTIVE 归档在同事务内先暂停，无可见中间态、一次 revision 和一条归档审计。ARCHIVED 只读/复制。DELETE 仅 DISABLED，保留审计 tombstone；当前未建 Batch 表，不伪造历史引用。

命令要求 READ COMMITTED，User FOR NO KEY UPDATE→Channel→Model→Product→品牌Subject→Subject→QueryTopic→Variant→Surface→Profile→Plan。资源取旧/新配置并集且各组 UUID 排序；锁后重验 Subject 父身份、Variant 主题、Profile 绑定/revision 与 Plan revision/配置。漂移返回 409 REVISION_CONFLICT，不扩大锁集、不自动重放。运行资格读取非敏感当前列，不加载凭据正文。读请求在认证前建立 REPEATABLE READ、禁 autoflush；详情7次/列表非空页8次应用批量 SELECT，空页2次，与页内Plan数量无关。

业务 flush 后只对四项 Plan 完整性 constraint triggers 执行 SET CONSTRAINTS … IMMEDIATE，再追加最小白名单成功审计并 commit。新增八个 `geo_monitoring_plan.*` 成功动作，CONFIGURATION 模块、GeoMonitoringPlan target；facts 仅 status/revision，不存名称、description、问题、settings 或秘密。审计失败/未知完整性失败整体回滚。精确 `23514 + ck_geo_monitoring_plans_archived` 映射 409 GEO_PLAN_ARCHIVED；三种 required 完整性约束映射 422 GEO_PLAN_EMPTY；三个 membership 资源FK的 `23503` 映射 422 GEO_PLAN_REFERENCE_INVALID；其他异常原样失败。非法转换/资格失败/非DISABLED删除分别409 INVALID_STATE_TRANSITION / GEO_PLAN_PROFILE_INELIGIBLE（明确预算超出为GEO_PLAN_BUDGET_EXCEEDED）/GEO_PLAN_IN_USE。

`/run` 接受 required expected_revision、Idempotency-Key，通过身份/锁/revision/归档边界后501 NOT_IMPLEMENTED；不保存命令或幂等结果、不创建Batch/Run、不写成功审计、不投递Redis。重复相同key仍501。Plan配置更新只写自身四表，配置引用不标记历史首次运行；已创建Batch冻结由GEO-303实现并独立验证，GEO-208不提供伪造快照证明。

## GEO EngineSurface / CollectionProfile 合同（GEO-203 / R1）

`0046_geo_surfaces_profiles` 在 `0045_geo_prompt_variants` 后仅增量创建两表及 AIModel 复合唯一键，无回填、seed、生产迁移或旧 GEO 数据改写。GEO-203 提供数据组件/ORM/Schema，GEO-204 提供 Registry/运行资格；GEO-205 接线管理 API/页面而不增加数据库结构。内部单租户共享配置，created_by 是服务端追溯身份，ADMIN 管理、ENGINEER 仅消费非敏感摘要，不是新增身份体系。

### geo_engine_surfaces

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id | UUID | pk_geo_engine_surfaces |
| name / slug | varchar(160) / varchar(100) | 非空无首尾空白；slug小写连字符标识，uq_geo_engine_surfaces_slug 包含停用行 |
| surface_kind | varchar(24) | CONSUMER_UI / MODEL_API / SEARCH_API / MANUAL_SITE |
| provider_brand | varchar(40) | OPENAI / ANTHROPIC / GOOGLE / AZURE_OPENAI / ZHIPU / QWEN / CUSTOM；展示目录，不猜测adapter协议 |
| website_url | text NULL | 仅信息地址，不发请求；http/https，无userinfo、query、fragment，Schema使用HttpUrl额外验证 |
| compliance_status | varchar(24) | NOT_REVIEWED / APPROVED / REJECTED / SUSPENDED；默认NOT_REVIEWED |
| capabilities | JSONB | 六键全部必填、闭合且布尔：answer_text=true，citations/web_search_signal/model_version/usage/cost；不代表单次结果 |
| is_active / revision | boolean false / integer 0 | 配置合法不表示启用或运行资格 |
| first_referenced_at | timestamptz NULL | 内部首次运行引用锁存，>=created_at；设置后不可清除/改写，已引用不可DELETE，配置更新只影响未来快照 |
| created_by | UUID | fk_geo_engine_surfaces_creator → users.id RESTRICT |
| created_at / updated_at | timestamptz now() | 创建身份不可变，真实变更由命令服务更新 |

CHECK前缀`ck_geo_engine_surfaces_`：name、slug、kind、provider、website、compliance、capabilities、revision、reference_time。索引：`ix_geo_engine_surfaces_active_name(is_active,name,id)`、`ix_geo_engine_surfaces_creator(created_by)`。

### geo_collection_profiles

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id | UUID | pk_geo_collection_profiles |
| engine_surface_id | UUID | fk_geo_collection_profiles_surface → geo_engine_surfaces.id RESTRICT；归属创建后不可变 |
| name | varchar(160) | 非空无首尾空白；uq_geo_collection_profiles_surface_name(engine_surface_id,name)，包含停用行 |
| collection_mode / adapter_key | varchar(16) / varchar(100) | MANUAL/API/BROWSER；adapter为小写标识，MANUAL固定manual；模式创建后不可变 |
| ai_channel_id / ai_model_id | UUID NULL | MANUAL/BROWSER全空；API全空或全非空；MATCH FULL禁止半绑定 |
| language_code / region_code | varchar(16) / varchar(16) | 与PromptVariant相同显式格式；小写语言/两位大写地区，不推断真实注册状态 |
| login_state | varchar(24) | API=NOT_APPLICABLE；MANUAL/BROWSER=ANONYMOUS或AUTHENTICATED |
| web_search_policy | varchar(24) | UNKNOWN / REQUESTED / REQUIRED / NOT_APPLICABLE；配置意图，不是实际搜索事实 |
| settings_json | JSONB DEFAULT '{}' | 按模式闭合非敏感配置，见下表；未知键/嵌套JSON/类型/范围明确拒绝 |
| is_active / revision | boolean false / integer 0 | 无自动启用 |
| last_test_status / last_tested_at | varchar(16) UNTESTED / timestamptz NULL | UNTESTED⇔时间空；PASSED/FAILED必须有时间；GEO-403 固定诊断事实；成功不自动启用 |
| last_test_error_code / last_test_error_summary | varchar(64/500) NULL | 两空或 FAILED 两非空；固定安全代码/摘要，不保存外部消息 |
| test_attempt_id | UUID NULL | 内部诊断预留，非空必须 UNTESTED 且停用；不公开 |
| created_by | UUID | fk_geo_collection_profiles_creator → users.id RESTRICT |
| created_at / updated_at | timestamptz now() | 创建追溯不变 |

`uq_ai_models_id_channel UNIQUE(id,channel_id)` 是同一AIModel权威归属的可引用键，原channel+model_id唯一键不变。`fk_geo_collection_profiles_model_channel (ai_model_id,ai_channel_id) → ai_models(id,channel_id) MATCH FULL ON UPDATE RESTRICT ON DELETE SET NULL` 验证真实模型归属；通过既有AIModel.channel_id FK验证渠道存在。既有channel→models CASCADE保持，删除渠道或模型成对清空两引用，Profile保留，不恢复secret/不猜替代模型。API空绑定可以表示显式adapter配置或解绑后的配置；必须由GEO-204 registry/资格判定可用，不能由数据合法性推断可执行。

| 模式 | settings允许键与默认语义 |
|---|---|
| MANUAL | require_screenshot:boolean，缺省true |
| API | temperature:number/null，0..2；max_output_tokens:integer/null，1..65536；缺省null（无覆盖） |
| BROWSER | require_screenshot:boolean，缺省true；answer_timeout_seconds:integer，10..600，缺省120 |

公共`settings`与持久化`settings_json`显式转换，Out不提供AI key、密文、Cookie、Header、浏览器会话/路径、任意request_parameters或自由JSON。全部叶子是闭合bool/number/null；不能把secret藏入允许值。API空绑定与MANUAL/BROWSER凭据禁止由Pydantic判别联合、OpenAPI oneOf及DB CHECK/MATCH FULL共同覆盖。能力函数`geo_surface_capabilities_valid`和settings函数`geo_profile_settings_valid`是0046冻结的IMMUTABLE合同，不导入运行时Schema。

CHECK前缀`ck_geo_collection_profiles_`：name、mode、adapter、model_mode、language、region、login、search、settings、test、revision。索引：`ix_geo_collection_profiles_surface_active(engine_surface_id,is_active)`、`ix_geo_collection_profiles_model(ai_model_id,ai_channel_id)`、`ix_geo_collection_profiles_creator(created_by)`。

### 版本、生命周期及错误

两资源独立revision owner；创建0，实际配置/测试/历史锁存变化恰好+1，no-op保持revision/updated_at；数据库守卫保护id、creator、created_at与Profile归属/模式，更新时间不倒退。AIModel FK的SET NULL是明确的引用解绑副作用，不自动递增配置revision或变更测试事实；后续运行资格必须重读当前绑定，不以历史PASSED授予执行资格，管理接线负责资格失效投影。Surface的历史锁存仅防止删除，不冻结当前配置，未来真实运行需在持锁同事务设置锁存并保存不可变快照。Profile真实历史RESTRICT FK由未来Run消费方接入，本任务不伪造Run引用。

GEO-205 写命令锁序为User→AIChannel→AIModel→Surface→Profile；服务负责事务、expected_revision CAS 和最小成功审计。测试结果的写入与过期检查由 GEO-403 接入；本阶段无队列或外部调用。User.created_by两表引用接入现有批量删除预检/投影，RESTRICT提供最终防线。

唯一冲突仅`23505 + uq_geo_engine_surfaces_slug / uq_geo_collection_profiles_surface_name`；模型归属由`23503 + fk_geo_collection_profiles_model_channel`保证。GEO-205 在业务 flush 边界映射已登记的唯一键与引用约束；未知异常保持失败，不能按文本或宽泛SQLSTATE猜测。非法结构仍受本节具名`23514`保护。downgrade以55000拒绝删表，恢复用前滚修复或迁移前备份。

### GEO-403 API Profile 诊断与当前资格失效

`0052_geo_profile_tests` 增加可空错误字段和内部预留 UUID、成对错误/预留状态 CHECK。前滚清除旧 API 测试资格并停用，revision 恰好递增一次；不修改 Run、Answer 或历史快照。已停用且 UNTESTED 的配置不生成无意义 revision。迁移保持前向修复策略，55000 拒绝恢复旧测试事实。

管理员 test 锁序 User→Channel→Model→Surface→Profile：预留 UUID、清资格与错误、停用/revision+1 后提交；网络不持有数据库锁；完成重锁重验 Profile revision/token、Surface/Channel/Model revisions 与当前身份/开关/能力，然后写 PASSED 或 FAILED/时间、清 token/revision+1。成功不启用、不创建业务 Batch/Run、不发队列消息。中断保留 UNTESTED/停用，管理员可从最新 revision 显式再次测试；旧请求409，绝不覆盖后来的意图。永久 SUCCESS 审计表示诊断结果命令已提交，`facts.test_status` 如实记录 PASSED/FAILED。

数据库触发器是当前资格失效 owner：Profile 实质配置（含绑定/语言/地区/登录/搜索/settings）、Channel 地址/协议/超时/凭据/启用、Header 变化、Model ID/参数/启用/测试资格/测试时间、Surface 类型/合规/能力/启用变化，使关联 API Profile UNTESTED、清时间/错误/token并停用。依赖批量失效按 Profile UUID 锁定，仅改变确有资格/预留的行，不反向锁上游。删除 Channel/Model 先失效再按旧 FK 成对 SET NULL，解绑不再虚构第二个 revision。配置更新 no-op 不失效；只更新业务历史引用不失效。

### GEO-205 管理命令与安全读模型

两资源各有列表、创建、详情、更新、启用、停用、删除，共14个操作。全部认证，写入 ADMIN + CSRF；Service 锁后重读当前账号资格。ENGINEER 的读模型只有 summary，configuration=null，available_actions=[]，deletion=null；不会取得 adapter、settings、channel/model 引用、网站或创建者配置。管理员 configuration 仍是闭合非敏感 Out，永不读取 AI Key、密文、Header、Cookie、浏览器会话或资料路径。数据组件本身不直接作为角色无差别的HTTP响应。

读请求在认证前建立 REPEATABLE READ 并禁 autoflush，列表使用固定批量查询与稳定排序、total 和 10/20/50 分页；动作/删除/启用阻断由服务端投影，不是授权凭证。当前 Surface 删除检查实际 Profile 引用和 first_referenced_at；GEO-206 起 Profile 删除检查真实 Plan 引用（含暂停/归档），ADMIN 获得 MONITORING_PLAN 阻断，ENGINEER 仍无删除详情。Run 尚未建表，不伪造历史数量；未来 Run 消费方仍须接入真实 FK、锁和删除查询。

写事务从 User FOR NO KEY UPDATE 开始，舍弃认证待写 last_seen_at 活动提示以避开 Session→User 的改密锁环，不修改过期/撤销规则。依次锁定当前与目标 Channel（UUID排序）、Model（UUID排序）、Surface、Profile；初读只决定锁集合，锁后重新比对绑定/revision。CREATE默认停用与 UNTESTED；Profile配置实际变更清除旧测试事实并停用；模式和Surface归属不可变。实际变化revision恰好+1、更新时间单调不减；同值更新/启停不改revision、时间或成功审计。业务与最小白名单成功审计同事务提交，未知错误整体回滚；没有命令自动重放或 Idempotency-Key。

启用 Profile 使用假设active=true的当前快照复用 GEO-204 evaluate_profile。MANUAL受监测总开关与Surface启用要求，API/BROWSER另有子开关、合规、adapter批准、环境、测试及当前模型资格；BROWSER未批准不可启用。Surface是中立目录配置，启用它不会启动任何采集。修改合规状态立即影响当前资格，资格不持久化。GEO-205没有test接口或测试结果生成；连接测试和模型生命周期失效规则由GEO-403提供。

GEO-205沿用0046，无Alembic revision、数据回填、旧观测改写或生产数据库操作。精确HTTP错误映射与对应条件见根OpenAPI及本任务实施记录；业务flush与audit flush边界区分，未知SQLSTATE/约束不能转换成成功或猜测业务冲突。

## GEO PromptVariant 合同（GEO-201 / R1）

`0045_geo_prompt_variants` 在 0044 后仅 expand 一张表。复用 `query_topics`，不迁移或替换其旧 `variants` 数组，不回填历史观测，也不创建 Batch/Run。数据库要求 UTF8。

| 字段 | 类型 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | pk_geo_prompt_variants |
| query_topic_id | UUID NOT NULL | fk_geo_prompt_variants_topic → query_topics.id RESTRICT |
| prompt_text | text NOT NULL | NFKC + Unicode 空白折叠，1..8000 字符，保留大小写、标点含义、连字符与型号后缀；拒绝 NUL |
| normalized_hash | varchar(64) GENERATED ALWAYS STORED NOT NULL | geo_prompt_text_hash(prompt_text)，UTF8 SHA-256 hex；客户端不可写 |
| mention_mode | varchar(16) NOT NULL | BRANDED / UNBRANDED |
| language_code | varchar(16) NOT NULL | 2..16 字符，小写语言标签，^[a-z]{2,8}(-[a-z0-9]{1,8})*$ |
| region_code | varchar(16) NOT NULL | 两位大写 ASCII 代码；只验证格式，不推断注册真实性 |
| priority | varchar(16) NOT NULL | CORE / STANDARD / EXPLORATORY |
| is_active | boolean NOT NULL DEFAULT true | 停用仍占唯一键 |
| revision | integer NOT NULL DEFAULT 0 | 有效变更恰好 +1，no-op 不递增 |
| first_referenced_at | timestamptz NULL | 内部不可逆首次运行引用锁存，>= created_at |
| created_by | UUID NOT NULL | fk_geo_prompt_variants_creator → users.id RESTRICT，来自服务端操作者 |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | 创建追溯不可变；有效变更由 Application Service 写 updated_at，单调不减 |

`uq_geo_prompt_variants_identity UNIQUE(query_topic_id,normalized_hash,mention_mode,language_code,region_code)` 包括停用行，不包括 priority。`ix_geo_prompt_variants_topic_active(query_topic_id,is_active)` 与 `ix_geo_prompt_variants_created_by(created_by)` 支持读取与删除预检。CHECK 名称为 `ck_geo_prompt_variants_` + `prompt` / `mention_mode` / `language` / `region` / `priority` / `revision_nonnegative` / `reference_time`。

`geo_normalize_prompt_text` 冻结 NFKC 与 Python Unicode whitespace 的 29 个码点集合。保存 canonical prompt_text，以 generated hash 防伪；不使用大小写折叠或型号去后缀。NFKC 会规范全角标点。`geo_prompt_text_hash` 固定 UTF8 转换，避免 PostgreSQL convert_to 的 STABLE 属性阻止生成列；函数不会受会话编码参数影响。

`geo_prompt_variant_guard` 保护 INSERT/UPDATE/DELETE：创建必须 revision=0、首次引用空；id/topic/creator/created_at 不可改；首次引用只能在活动且语义未变的行上设置；标记不能清除或改写。已引用后五项语义配置冻结，只允许 active→disabled（重复停用为 no-op），不允许删除或重新启用。新问题必须新建变体。历史门禁采用本任务明确的更严格要求；不是修改历史后仅影响未来。

未来真实运行创建者必须与其真实引用 FK（RESTRICT）一起接入：Application Service 按 User→QueryTopic→PromptVariant（User 使用 FOR NO KEY UPDATE，与审计 FK KEY SHARE 兼容） 顺序锁定，锁后校验角色、归属、活动和 expected_revision，设置 first_referenced_at、revision+1、updated_at 并冻结输入，与运行记录及成功审计同事务提交。后续消费者不得只写 FK 而遗漏锁存；运行引用失败时锁存同事务回滚。首次引用标记自身不是 Run，GEO-201 的测试验证锁存边界，不宣称真实 Run 已实现。

QueryTopic 删除预检/投影包括全部变体（含停用），`GEO_PROMPT_VARIANT` 为公共 deletion blocker；旧引用摘要三个计数字段保持原合同。User 删除计入 created_by 并沿用 USER_BUSINESS_HISTORY。GEO-201 没有新增前端入口；GEO-202 工作区为 /geo/questions，保留旧 /geo/topics。

| 稳定数据库失败 | 后续应用映射义务（GEO-202 接线） |
|---|---|
| 23505 + uq_geo_prompt_variants_identity | 409 GEO_PROMPT_VARIANT_EXISTS |
| 历史删除预检；23514 + ck_geo_prompt_variants_history | DELETE: 409 GEO_PROMPT_VARIANT_IN_USE；编辑/启用: 409 GEO_PROMPT_VARIANT_IMMUTABLE |
| 锁后 expected_revision 不符 | 409 REVISION_CONFLICT，不自动重放 |
| 23503 + fk_geo_prompt_variants_topic / creator | QueryTopic / User 删除冲突，现有 IN_USE 语义 |
| 23514 + initial / identity / revision_step / updated_at | 写入者合同错误，不能吞错或伪装成功 |

未知 SQLSTATE / constraint 保持显式失败。GEO-201 只冻结组件与持久化边界；GEO-202 接线七个变体端点及 geo_prompt_variant.created/updated/enabled/disabled/deleted 成功审计。唯一键仲裁并发创建；行锁与触发器仲裁引用/编辑交错。no-op 不改 updated_at，不凭空递增 revision。降级主动 SQLSTATE 55000 失败，事务 DDL 保留全部数据与 revision；恢复使用前向修复，不允许 DROP 历史表。

### GEO-202 Application Service 接线

沿用公司内部单租户：ADMIN/ENGINEER 均管理问题变体，created_by 仅作追溯，不是用户私有隔离键。主数据配置与既有 Catalog 一致可读写，自动能力仍默认关闭且本任务没有运行端点。创建请求 body.query_topic_id 必须等于路径 ID；不能提交 hash/creator/history/revision/action 等服务端字段。

写入禁 autoflush 后按 User→QueryTopic→PromptVariant 锁序，锁后复核活动账号、首次改密和角色，topic 存在性及 expected_revision。topic_id 不可改，初读只选择锁集合，锁后重新加载权威行。只对实际字段变化递增 revision 和单调 updated_at；语义规范化 no-op 保持全部业务字段及审计不变。历史后 PATCH/enable 拒绝，disable 重复为 no-op。CRUD 没有 Idempotency-Key，唯一键防重复创建，stale 命令不能重放。

同事务 flush 业务变化、最小白名单审计并 commit；审计只含 revision/is_active，无问题正文。只在业务 flush 边界映射上述精确唯一/历史约束；审计 flush/未知完整性错误原样失败并回滚。列表/详情用 REPEATABLE READ 与禁 autoflush，join 当前 QueryTopic 摘要，count/rows 固定查询，无客户端拼接。搜索为规范文本字面子串，LIKE 通配符转义；筛选基于当前主题意图及显式变体维度，稳定排序 tie-break UUID。历史标记提供 HISTORY_REFERENCE；GEO-206 起真实 Plan 引用另提供 MONITORING_PLAN 删除阻断，不冻结配置编辑，也不宣称 Run 已实现。run_entry.available=false/NOT_IMPLEMENTED 是未开放能力，无执行成功含义。

本任务没有 Alembic revision、列/索引/约束或数据回填，head 仍为 0045_geo_prompt_variants。真实 Run 后续需按原锁存/FK/快照同事务义务接入。

GEO-202 命令入口舍弃认证依赖待写的 `SessionRecord.last_seen_at` 活动提示，避免 User→Session 与改密的 Session→User 形成锁环；不修改 expires_at/revoked_at，也不放宽认证或 CSRF。会话有效期按 expires_at、撤销按 revoked_at 裁决，last_seen_at 不参与安全决定。User 的 FOR NO KEY UPDATE 仍阻止资格字段更新与删除；主题/变体继续 FOR UPDATE。真实同账号主题编辑/删除与同 Cookie 改密交错均由 PostgreSQL 回归验证。

## GEO Catalog 合同（GEO-101 / R1；GEO-102 ORM/Alembic；GEO-103 Schema/策略）

本节冻结 GeoSubject/Alias/Domain 合同。GEO-102 已实现三表 ORM、模型注册及 `0044_geo_catalog`，Catalog revision 从 `0043_geo_platform_identity` 前滚（当前 head 为 0047 MonitoringPlan）；这不表示生产数据库已迁移。GEO-103 已实现 Schema、规范化、真实父子/别名歧义与无 I/O 的 stage/actions/deletion/当前 Product 投影；GEO-104 CRUD Application Service/Router 已接线并完成验收。公共 Schema 和标准操作分别见 `contracts/openapi.yaml` 的 `components.schemas.Geo*Subject*` 与 `paths./api/v1/geo/subjects`。既有文章关系 GEO、Product/FactVersion 与历史迁移均保持独立。

### 身份、归属与规范化

这是沿用现有身份系统的公司内部单租户 Catalog；ADMIN 管理，ADMIN/ENGINEER 读取，`created_by` 是操作者追溯字段而非资源隔离键。不得接受客户端 created_by、revision、normalized 字段、actions/blockers 或敏感凭据。Subject 类型和 Product 绑定创建后不可改变。

- `OWN_PRODUCT` 必须引用现有 `products.id`，其他类型 product_id 必须为空。其 canonical_name、normalized_name、display_name 在 GEO 表中必须全部为 NULL；公共 canonical_name 从当前 Product.part_number 投影，display_name 为 Product.brand、单个空格、Product.part_number，product 摘要只读当前 Product identity/revision。不得复制 brand/category/参数/事实 Markdown/FactVersion；description 只作监测用途说明，不是产品事实编辑入口。产品更新不会递增 Subject revision，也不回填 GEO 名称；一致读返回 Product 自身 revision。
- 非 OWN_PRODUCT 保存监测身份 canonical_name/display_name，不保存公司产品事实。原始名称/别名先 Unicode NFKC、去除首尾 Unicode 空白、把连续 Unicode 空白合并为一个 ASCII 空格；保存值 1..240 字符；匹配键再 casefold，长度仍须 1..240。保留连字符、型号后缀及标点，不能折叠不同型号。display_name 使用相同空白/长度规则，不用于 identity 唯一性。description 最大 4000 字符，默认空。
- 品牌（OWN_BRAND、COMPETITOR_BRAND）和 REFERENCE_PART 无父级；OWN_PRODUCT 可无父级或指向 OWN_BRAND；COMPETITOR_PRODUCT 可无父级或指向 COMPETITOR_BRAND。父级不能为自身。parent 是否启用不改变类型合法性；停用品牌不自动修改子 Subject，计划资格由后续任务裁决。
- 每个 Product 最多一个**活动** OWN_PRODUCT；停用身份保留，可存在多个停用历史身份。重新启用必须重新竞争同一 partial unique。非自有名称不设全局/父级唯一，避免错误合并不同实体。
- Alias 的 alias_kind 为 NAME/PART_NUMBER/ABBREVIATION/LEGACY；language_code 可空，采用 2..8 位语言子标签及连字符分隔的 1..8 位字母数字子标签，总长 2..16，保存小写。此标签仅用于匹配语境，不猜测语言。唯一键为 `(subject_id, normalized_alias)`，包括停用条目。跨 Subject 相同别名允许登记为歧义候选；未来匹配必须返回歧义并要求人工复核，不能无条件任选一个对象。
- Domain 输入可为 Unicode，但服务必须执行 IDNA2008 + UTS #46（non-transitional、STD3）转换为 lowercase ASCII，校验 A-label 可回解并满足 DNS 标签 1..63、完整主机名 3..253、至少两个标签。拒绝 IP literal、空白、协议、路径、query、fragment、端口、userinfo、通配符、空标签、尾点和非法 IDNA。不执行 DNS、HTTP、域名所有权验证或子域猜测；这是精确 hostname 匹配。relation_type 为 OWNED/OFFICIAL/DISTRIBUTOR/OTHER，是管理员配置关系，不证明网络所有权。当前 API 只有创建/删除 Domain，is_active 恒 true；修改需按 revision 删除后重建。相同 hostname 可属于多个 Subject，未来归属必须显式保留歧义。

### `geo_subjects`

| 列 | 类型 / 可空 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | PK `pk_geo_subjects` |
| subject_type | varchar(32) NOT NULL | 五种 GeoSubjectType |
| product_id | UUID NULL | FK `fk_geo_subjects_product_id_products` → products.id RESTRICT |
| parent_subject_id | UUID NULL | 与 parent_subject_type 成对为空或非空 |
| parent_subject_type | varchar(32) NULL | 内部 FK 判别列，不接受客户端输入、不输出；从已锁父行取得 |
| canonical_name / normalized_name / display_name | varchar(240) NULL | OWN_PRODUCT 全空，其余全非空且符合规范化边界 |
| description | text NOT NULL DEFAULT '' | 最大 4000 字符，监测用途说明 |
| is_active | boolean NOT NULL DEFAULT true | 当前启停权威 |
| revision | integer NOT NULL DEFAULT 0 | >=0；整个 Subject aggregate 的唯一写版本 |
| created_by | UUID NOT NULL | FK `fk_geo_subjects_created_by_users` → users.id RESTRICT |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | UTC；服务在真实 aggregate 写入时更新 updated_at |

数据库最终约束：

| 稳定名 | 定义 |
|---|---|
| ck_geo_subjects_type | subject_type IN 五种枚举 |
| ck_geo_subjects_product_identity | OWN_PRODUCT: product_id 非空且三个名称列全空；其余: product_id 空且三个名称列全非空 |
| ck_geo_subjects_names | 所有非空名称 trim 后非空且长度 1..240；description 长度 <=4000；Unicode NFKC/casefold 由 Schema/Service 建立，不谎称普通 SQL trim 完全验证 Unicode |
| ck_geo_subjects_revision_nonnegative | revision >=0 |
| ck_geo_subjects_parent_type | 两父列全空，或 OWN_PRODUCT→OWN_BRAND / COMPETITOR_PRODUCT→COMPETITOR_BRAND；品牌与参考型号父列必须全空 |
| ck_geo_subjects_parent_not_self | parent_subject_id IS NULL OR parent_subject_id <> id |
| uq_geo_subjects_id_type | UNIQUE(id, subject_type)，供复合 FK 引用 |
| fk_geo_subjects_parent_identity | (parent_subject_id, parent_subject_type) → geo_subjects(id, subject_type)，MATCH FULL，ON DELETE RESTRICT，ON UPDATE RESTRICT；同时保证存在与真实父级类型 |
| uq_geo_subjects_active_own_product | UNIQUE(product_id) WHERE subject_type='OWN_PRODUCT' AND is_active；这是独立 partial unique index |

父子类型用 CHECK + 复合 FK 提供真实 SQL 最终防线；不能只做 Service 预检。两级合法类型关系天然排除多层循环。`0044_geo_catalog` 的 `geo_subjects_identity_guard` 禁止更新 subject_type/product_id/created_by/created_at（SQLSTATE 55000，后续服务先以字段 validation 拒绝）；不为该未知数据库守卫错误增加宽泛业务映射。

索引：`ix_geo_subjects_type_active_name_id(subject_type,is_active,normalized_name,id)`、`ix_geo_subjects_product_id(product_id) WHERE product_id IS NOT NULL`、`ix_geo_subjects_parent_id(parent_subject_id)`、`ix_geo_subjects_created_by(created_by)`、`ix_geo_subjects_updated_id(updated_at,id)`。OWN_PRODUCT 名称筛选/排序 JOIN 当前 Product，不持久化派生搜索字段。NAME_ASC 按规范名称、id；UPDATED_DESC 按 updated_at DESC、id DESC，列表 total 与 items 应来自同一读取快照。

### `geo_subject_aliases`

| 列 | 类型 / 可空 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | PK pk_geo_subject_aliases |
| subject_id | UUID NOT NULL | fk_geo_subject_aliases_subject_id_subjects → geo_subjects.id，ON DELETE CASCADE，仅显式聚合删除 |
| alias / normalized_alias | varchar(240) NOT NULL | 规范化显示值 / casefold 匹配值 |
| alias_kind | varchar(24) NOT NULL | 四种 GeoSubjectAliasKind |
| language_code | varchar(16) NULL | 受控标签或 NULL |
| is_active | boolean NOT NULL DEFAULT true | 可通过 Alias PATCH 改变 |
| created_at | timestamptz NOT NULL DEFAULT now() | UTC |

`uq_geo_subject_aliases_subject_normalized UNIQUE(subject_id,normalized_alias)` 包括停用行；`ck_geo_subject_aliases_kind` 检查枚举，`ck_geo_subject_aliases_text` 检查 trim 非空及长度，`ck_geo_subject_aliases_language` 检查小写受控标签或 NULL。`ix_geo_subject_aliases_normalized_active(normalized_alias,is_active,subject_id)` 支持跨对象歧义读取。subject_id/id/created_at 不可由 PATCH 改变。

### `geo_subject_domains`

| 列 | 类型 / 可空 / 默认 | 合同 |
|---|---|---|
| id | UUID NOT NULL | PK pk_geo_subject_domains |
| subject_id | UUID NOT NULL | fk_geo_subject_domains_subject_id_subjects → geo_subjects.id，ON DELETE CASCADE，仅显式聚合删除 |
| hostname | varchar(253) NOT NULL | 规范 IDNA ASCII hostname |
| relation_type | varchar(24) NOT NULL | 四种 GeoSubjectDomainRelationType |
| is_active | boolean NOT NULL DEFAULT true | 本轮 API 恒 true，无独立更新/启停命令 |
| created_at | timestamptz NOT NULL DEFAULT now() | UTC |

`uq_geo_subject_domains_subject_hostname UNIQUE(subject_id,hostname)`；`ck_geo_subject_domains_relation` 检查枚举，`ck_geo_subject_domains_hostname` 检查 lowercase ASCII DNS 标签结构、长度及非 IP，完整 IDNA round-trip 校验仍在 Schema/Service；`ck_geo_subject_domains_active` 检查 is_active=true。`ix_geo_subject_domains_hostname(hostname,subject_id)` 支持歧义读取。无 Domain PATCH；不能由客户端写规范化输出或创建信息。

### revision、锁、动作与删除

- Subject/Alias/Domain 是一个可变聚合。Subject 创建 revision=0；Subject PATCH/enable/disable、Alias create/update/delete、Domain create/delete 每次成功改变聚合后父 revision 恰好 +1、updated_at 更新，业务写入与最小成功审计同事务提交。子行无独立 revision；子命令的 expected_revision 是父版本。已处于目标 enable/disable 状态且 revision 当前时返回同一投影，不增版本、不重复成功审计；stale revision 始终先返回 REVISION_CONFLICT。PATCH 的有效字段值全部未变时同样无版本递增。
- GEO-104 Application Service 的统一锁序：涉及 OWN_PRODUCT 先锁 Product；品牌父级（旧、新，去重 UUID 升序）→目标 Subject（品牌目标也属于品牌锁阶段）→目标 Alias/Domain。读到的 parent/type 只用来确定锁集合，取得目标锁后复核 revision 和身份；发生变化拒绝，不自动重放。创建父子关系、品牌删除、子命令及将来新增业务引用必须遵守同一锁序。Router 不拥有事务/行锁/ORM 写入。
- ADMIN 的 stage 为 ACTIVE/DISABLED，primary_task 分别为 MANAGE_SUBJECT/ENABLE_SUBJECT；UPDATE、CREATE_ALIAS、CREATE_DOMAIN 始终可尝试，按启停状态提供 DISABLE 或 ENABLE。ENGINEER 读取同一业务 stage，primary_task=MANAGE_SUBJECT（只读入口），所有资源及子资源 available_actions=[]、deletion=null。不从 primary_task 名称授予编辑权限。ADMIN 删除无直接引用时 deletion.blockers=[] 且有 DELETE；存在引用时去掉 DELETE 并返回非空正整数 blocker。无需为删除先停用未引用 Subject。子资源 ADMIN 动作为 Alias UPDATE/DELETE、Domain DELETE，不因历史运行而冻结当前字典。
- references 是当前直接引用的批量一致读取计数，不是持久化派生状态：CHILD_SUBJECT 对应 child_subject_count（含停用子级）；MONITORING_PLAN 对应 monitoring_plan_count（含暂停/归档计划）；OBSERVATION_RUN 对应 observation_run_count（所有引用过的运行，含失败/取消及历史）；ANALYSIS 对应 analysis_count（去重 analysis revision，不累计其中多条 mention/claim）；OPPORTUNITY 对应 opportunity_count（包括关闭机会）。每类独立去重，不跨类别相加作为总样本。未实施的引用域不存在对应行时计数为 0，不代表已实现该域查询能力。
- 所有新增对 Subject 的业务身份引用必须通过真实 RESTRICT FK/关系表及同一 Subject 行锁接入 deletion owner；不能仅在 JSON snapshot 中保存 UUID 后宣称没有历史引用。后续任务负责新增其实际引用查询、FK 和反例测试，本任务不定义这些域的表。已被历史引用的 Subject 永不物理删除，只停用；相关字典和父级变化只影响未来配置/快照，不更新既有 Run/Analysis/Review。
- Subject 删除只在持锁同事务重新统计上述直接引用后执行；仅 Alias/Domain 可随 Subject 聚合清理，绝不级联 Product、子 Subject、计划、运行、分析、机会或审计历史。Alias/Domain 单独删除只改变当前字典，历史消费者必须保存完整当时字典快照，不建立会阻止当前字典维护的历史子行 FK。
- GEO-104 已将 GEO Subject 直接引用接入 Product 删除服务/投影（包含停用身份），公共 DeletionBlockerType 增加 GEO_SUBJECT，FK RESTRICT 是最终防线。用户删除包含 Subject.created_by 业务引用。审计目标采用稳定 UUID 与受控摘要，删除后保留最小 tombstone，不因 target_id 标量记录而永久冻结无引用 Subject。

### HTTP 与精确错误映射

沿用 ErrorEnvelope、session、CSRF 和 X-Request-ID。404 NOT_FOUND 用于 Product/Subject/父级/子资源不存在；子 ID 不属于 URL Subject 同样 404，不允许跨父级写入。422 VALIDATION_ERROR 覆盖非法 enum、空白/长度/IDNA、只读字段、试图改类型/Product、空 PATCH。409 REVISION_CONFLICT 在锁内先于其他可变业务冲突。无 Idempotency-Key 或外部调用；重复创建不会假成功或自动重放。

| SQLSTATE + 精确 constraint/index 名或业务条件 | HTTP / code | details |
|---|---|---|
| 23505 + uq_geo_subjects_active_own_product；活动 Product 预检或 enable 冲突 | 409 GEO_SUBJECT_PRODUCT_EXISTS | errors 定位 body.product_id；enable 定位当前绑定并给出 subject_id/product_id |
| 23505 + uq_geo_subject_aliases_subject_normalized | 409 GEO_SUBJECT_ALIAS_EXISTS | errors 定位 body.alias |
| 23505 + uq_geo_subject_domains_subject_hostname | 409 GEO_SUBJECT_DOMAIN_EXISTS | errors 定位 body.hostname |
| 已存在父级但类型错误/自引用；23514 + ck_geo_subjects_parent_type / ck_geo_subjects_parent_not_self | 409 GEO_SUBJECT_PARENT_INVALID | errors 定位 body.parent_subject_id |
| Subject 删除预检命中 | 409 GEO_SUBJECT_IN_USE | references=[{type,count}]，与 deletion.blockers 同一 owner |
| Subject DELETE 的 23503 + fk_geo_subjects_parent_identity，或后续已登记直接业务引用 FK | 409 GEO_SUBJECT_IN_USE | {}；rollback 后不重查、不伪造 blocker 数量 |

唯一冲突的 errors 使用 loc/msg/type 结构，type 分别为 geo_subject_product_exists、geo_subject_alias_exists、geo_subject_domain_exists、geo_subject_parent_invalid。未知 SQLSTATE、约束、trigger、commit 或审计失败保持未知错误；事务回滚，无部分子资源写入、revision 或成功审计。不得解析异常文本、全局吞 IntegrityError 或猜测默认计数。新的未来 FK 必须先登记到本合同及具体命令映射再使用，不能把任意 23503 都映射成 GEO_SUBJECT_IN_USE。

### 实施与恢复边界

GEO-101 只冻结合同。GEO-102 新增 `0044_geo_catalog`，仅添加三张表、约束、索引及身份守卫，不修改 0001～0043 或 migration_schema_v1，不回填或改写历史 Product/GEO 数据；迁移冻结自身 DDL，不导入运行时 ORM。隔离 PostgreSQL 16 的空库及含旧记录的 0043 前滚、metadata、直接 SQL 和唯一索引并发验证见 `.trellis/tasks/10-01-geo-102-catalog-orm/implement.md`。downgrade 以 SQLSTATE 55000 明确拒绝删除三表，保留 revision 和数据；恢复使用前滚修复或迁移前 PostgreSQL 备份。GEO-103 的请求/响应声明、Unicode/IDNA 规范化及领域/投影策略按本合同实现，没有新增 revision 或历史回填；实施与机器形状/实例验证见 `.trellis/tasks/10-01-geo-103-catalog-policy/implement.md`。GEO-104 已接线 12 个标准 OpenAPI 操作及 Catalog Application Service，拥有聚合锁、revision、精确映射和同事务成功审计。列表/详情由服务在认证读取前建立 REPEATABLE READ 并关闭 autoflush（认证 last_seen_at 不能在纯读快照中自动写入），请求内批量读取当前 Product、父级、字典及直接引用；GEO-206 起 monitoring_plan_count 来自真实关系的批量计数；Run/Analysis/Opportunity 三个尚不存在的引用域仍显式为零，不能据此声称已实现查询。审计登记十个 Catalog 成功动作，target_type=GeoSubject、target_id=稳定 Subject UUID；facts 仅 revision/is_active，不复制名称、描述、字典或产品事实。搜索在同一快照批量规范当前 Product/显示名称，与 q 统一 NFKC/Unicode 空白/casefold，不写身份副本；匹配 UUID 以单一 ARRAY 参数进入 SQL count/page。删除保留审计 tombstone。实施证据见 `.trellis/tasks/10-02-geo-104-catalog-api/implement.md`；无新 Alembic revision、历史回填或生产迁移。Catalog 页面由 GEO-105 实施。

## Product Detail Read Projection

`GET /api/v1/products/{product_id}/detail` 不持久化第二份业务状态。服务在同一 PostgreSQL `REPEATABLE READ` 请求事务中，从 `products`、`fact_versions`、`content_tasks`、`publication_works`/`published_articles`、当前 GEO correction tails 及各领域追加记录批量形成 compact projection；查询次数不得随关联行数线性增加。GEO rate 沿用现有 GeoMetrics 分母，分母为零时返回 `NULL`。

Product Activity 的权威记录依次来自 `product.created/product.updated` 成功审计、`fact_review_records`、`content_tasks.created_at`、`content_review_records`、`publication_work_events` 与 `geo_observations.created_at`。服务统一按 `timestamp DESC, kind ASC, source id DESC` 排序并截取最近 10 项；不得使用 mutable `updated_at`、Audit target 递归或浏览器合并来补造时间线。`product.created` 与 `product.updated` 作为成功审计和对应业务写入同事务追加，不回填历史记录，也不需要数据库迁移。

## Migration Order

### 0001 Identity And Audit

`users`, `roles`, `user_roles`, `sessions`, `audit_logs`.

This historical revision created six fixed roles. Revision `0009` migrates them to the current two-account-type model and removes `roles` and `user_roles`.

当前认证 snapshot 不增加数据库字段：`sessions.id` 是服务端内部稳定 session identity，`GET /api/v1/auth/session` 以同一次 `SessionRecord` + joined `User` 读取返回 user projection、该 record 验证后的 CSRF Token，以及用部署 `SESSION_SECRET` 对 `partsignal-session-binding-v1:<session UUID>` 做 HMAC-SHA256 得到的公开不透明 `session_binding`。binding 只用于客户端区分 session snapshot，不能用于认证、CSRF、数据库查找或凭据重放；Session UUID、session token、token hash 与 CSRF hash 均不进入响应、日志或审计。

### 0002 Product Facts

`products`, `reference_parts`, `part_parameters`, `replacement_relations`, `evidences`, `parameter_evidence_links`, `replacement_evidence_links`, `fact_claims`, `claim_evidence_links`, `fact_versions`, `fact_review_records`.

这些规范化事实表和 `fact_versions.snapshot_json` 仅描述历史 revision；`0025` 已将当前事实模型收敛为产品 Markdown 工作区和不可变 Markdown 事实版本，并物理删除规范化事实子图。

### 0003 Content Planning

`query_topics`, `platform_profiles`, `platform_profile_versions`, `content_tasks`.

`platform_profile_versions` 仅描述历史 revision，已由 `0025` 物理删除。当前 `content_tasks` 直接绑定具体 `platform_profile_id` 和同产品的非空 `APPROVED fact_version_id`，不会随配置变化静默改绑。Revision `0032` 为普通任务创建增加可空且由 `uq_content_tasks_idempotency_key` 最终保证唯一的 `idempotency_key`：同键同四部分普通 identity（`product_id`、`fact_version_id`、`platform_profile_id` 和不存在 `content_task_geo_sources` 的 ordinary source kind）重放返回原任务，同键异载荷或 GEO 任务冲突，不同键仍允许相同业务输入；历史任务和发布修复任务保持空值。命名 advisory lock 负责正常请求串行化，数据库唯一约束仍是旁路 writer 的最终仲裁；普通创建 caller 只在 PostgreSQL `23505` 且 diagnostics 精确为该约束时 rollback 后按键重查并重验 winner，其他唯一性或完整性错误继续失败。

### 0004 Content Production

`generation_jobs`, `content_versions`.

`generation_jobs.idempotency_key` is unique. Redis carries only the job UUID. A unique `content_versions.source_job_id` prevents duplicate drafts. Worker execution rechecks the current task, product, and approved fact before and after generation; expired `RUNNING` leases are recovered from PostgreSQL by Celery Beat. AI content and every content version that has entered review are immutable. The current unreviewed `HUMAN DRAFT` is the sole payload-update window and is protected by task ownership, revision, review-history, and database-trigger checks.

### 0005 Content Review

`content_review_records` plus immutability and task-version constraints.

Approving a new version and superseding the previous approved version happen in one transaction. Creators may approve their own fact or content versions; all state, evidence, and quality gates still apply.

### 0006 Publication

`platform_accounts`, `publication_records`, `publication_status_events`.

Platform accounts contain an internal business label and operator identifier, never credentials. A concrete platform may own multiple accounts, while one article publication selects exactly one account. A publication permanently binds one approved content version. Reuse of an idempotency key must match content, account, section URL, and attachment IDs; concurrent requests are serialized with PostgreSQL transaction advisory locks. After `PUBLISHED`, URL and content binding cannot change.

Current-state counts come from `publication_records.status`. Period publication metrics and recent activity come from append-only `publication_status_events`, and their shared `as_of` comes from the PostgreSQL clock: a rolling window cohort is the distinct records whose `PUBLISHED` event falls inside `[window_start, as_of)`, verification count is the cohort subset with any later `VERIFIED` event by `as_of`, and exception count is the distinct records receiving `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` inside the same window. A later removal never removes the historical publication from its original cohort.

### 0007 GEO Observation

`geo_observations`, `geo_observation_citations`, `geo_observation_publications`.

Observations are immutable. Corrections create another observation with `supersedes_id`. Metrics are calculated from source observations rather than persisted as a second source of truth. Revision `0029` later adds one guarded exception that permits administrators to delete an entire manual-observation correction chain.

`uq_geo_observations_supersedes_once` is the independent partial unique index on `geo_observations(supersedes_id) WHERE supersedes_id IS NOT NULL`; it has no `pg_constraint` UNIQUE row. `create_geo_observation` retains the Product → eligible Published Article → previous Observation lock order and successor precheck. Both that precheck and only the exact root INSERT diagnostics `sqlstate=23505` plus `diag.constraint_name=uq_geo_observations_supersedes_once` map to `409 GEO_OBSERVATION_HAS_SUCCESSOR`, message `该 GEO 观测已被纠正`, and `details={}`. The exact path performs the command-root rollback before raising and never queries, guesses, or replays a winner. Other integrity failures, relation work, and commit failures remain unknown and must not be classified from database error text.

Concurrency evidence distinguishes the production row-lock path, whose loser reaches the successor precheck after the winner commits, from a test-only lock/precheck bypass that proves real transaction-ID waiting at the partial unique index. Both paths leave exactly one successor; a losing command leaves no observation relation, file association, content/publication mutation, or success audit side effect.

### 0008 Files

`file_records`, `publication_attachments`, `geo_observation_attachments`, plus historical `evidences.file_record_id`.

Only `VERIFIED` files may be linked. Publication attachments additionally require `category=OPERATION_SCREENSHOT` in both candidate creation and `mark-published`; other modules enforce their own category contracts at their service boundaries. `publication_attachments` is one append-only evidence relation used in both publication phases, with no mutable phase or replacement field. Revision `0025` later deletes `evidences` and its file foreign key; the current head therefore has three actual `file_records` references: platform Logo, publication attachment, and GEO observation attachment. Revision `0029` permits only the GEO attachment rows belonging to a declared full-chain manual-observation deletion to be removed.

文件传输由应用后端中转，不新增表、列或状态。接收字节后，服务锁定 `FileRecord` 并重新检查意图创建者、`PENDING` 与上传有效期；持锁执行对象写入，成功仍保持 `PENDING`。complete 的 HEAD 校验与 abort 使用同一行锁，清理器继续 `FOR UPDATE SKIP LOCKED`，防止对象写入与确认、中止或删除声明交错而复活已删除文件。

### 0009 Configuration Center And AI Generation

`users` gains `account_type` (`ADMIN | ENGINEER`) and `must_change_password`. Existing users with `SYSTEM_ADMIN` become `ADMIN`; all other existing users become `ENGINEER`. After the mapping, `roles` and `user_roles` are removed so `users.account_type` is the only permission source. Disabling a user or resetting a password revokes all active sessions. A transaction may not disable or demote the last active `ADMIN`. Revision `0027` later adds a restricted physical-deletion path for disabled, unreferenced users.

新账号默认启用，管理员提供的 `temporary_password` 只保存安全哈希，并固定写入 `must_change_password=true`；新建账号临时密码最少 12 位，重置临时密码和用户自助改密的正式新密码最少 8 位。列表摘要由 PostgreSQL 对全部用户实时聚合，不保存统计快照，也不从审计推测趋势；`admin_total` 统计全部实际 `ADMIN`，不因停用而排除。单个与批量启停共享同一行锁、revision、最后启用管理员保护、会话撤销和逐用户审计不变量；合法批量命令只把写入前的预期业务错误作为逐项失败，任何数据库、编程或审计异常都回滚整批。用户 CSV 只导出批准的非敏感业务列，完整生成后追加 `user.exported` 审计；停用或重新启用只改变当前用户状态，不删除、改绑或改写任何历史业务与审计外键。

`users.username` 在服务端经 `strip().lower()` 后形成账号身份，并由 PostgreSQL 唯一约束 `uq_users_username` 最终裁决。创建预检与该约束的精确 `sqlstate=23505` 路径都返回 `409 USER_USERNAME_EXISTS`、message `用户名已存在` 和 `body.username` 字段错误；其他 SQLSTATE、constraint 或缺失 diagnostics 保持 unknown，不按错误文本或请求字段猜测。唯一约束失败发生在成功审计追加前，并与 User 写入一起回滚。删除用户仍保留两条既有 `USER_IN_USE` 语义：引用预检返回动态摘要和 `details.references`，delete command 内真实 `23503` 的最终防线返回固定 `用户仍有业务历史引用，不能删除` 与空 details；二者不通过失败后的查询合并。

`platform_types` owns a unique category `slug`; `name` is not unique. Name is trimmed by the request schema and limited to 160 characters; slug is an explicitly supplied lowercase letters/digits/hyphens value limited to 100 characters and may be updated. The database constraint `uq_platform_types_slug` is the final uniqueness authority; create/update map only its exact `23505` violation to `PLATFORM_TYPE_SLUG_EXISTS` with `body.slug`, while unknown integrity failures remain visible. The collection read model exposes `platform_count` as the total direct `PlatformProfile` references, including Enabled and Disabled profiles, using the same grouped query as deletion blockers and sorting by `lower(name), id`. Type DELETE requires `expected_revision`; the service locks the type row, rejects stale revision before counting profile references, then returns `PLATFORM_TYPE_IN_USE` when references remain. Revision `0009` initially placed one mutable Markdown system Prompt under each type; revision `0014` replaced that ownership with one current Prompt per concrete platform。`0025` 又删除了任务上的类型快照和可编辑 Prompt；当前任务只直接绑定具体平台，生成输入由平台 Prompt 与事实版本 Markdown 唯一决定。

`ai_channels` owns an encrypted API key, timeout, and connection state. `ai_channel_headers` belongs only to a channel, normalizes names with `casefold()`, and stores exactly one of a plain or encrypted value; `(channel_id, normalized_name)` is uniquely enforced by `uq_ai_channel_headers_channel_id`, whose exact `23505` violation maps to `AI_CHANNEL_HEADER_NAME_EXISTS`. `ai_models` belongs to a channel and stores the provider `model_id`, display name, exact JSON request parameters, and model-level test state; its trimmed, case-sensitive `(channel_id, model_id)` identity is uniquely enforced by `uq_ai_models_channel_id`, whose exact `23505` violation maps to `AI_MODEL_ID_EXISTS`. Other integrity failures remain unknown instead of being guessed as identity conflicts. Channels and models default disabled. Connection, credential, or Header changes disable the channel and invalidate every child model test; model ID or parameter changes disable and invalidate that model.

`generation_jobs` gains nullable `ai_channel_id` and `ai_model_id` foreign keys using `SET NULL`, provider request metadata, and nullable token usage. `input_snapshot` is the authoritative immutable generation input and retains channel/model identity, non-sensitive connection data, model parameters, final system/user messages, platform identity and approved fact version after current configuration is deleted. Credentials and sensitive Header values never enter the snapshot. `content_versions` removes model-reported fact, evidence, and disclosure ID arrays; traceability comes from `fact_version_id`, `source_job_id`, and the job snapshot.

### 0010 Legacy User Cleanup

This irreversible data migration recognizes only `product_editor`, `product_reviewer`, `content_reviewer`, and `analyst`. It locks all matching users and checks every user-owned business or audit foreign key before deleting any row. Any reference aborts the complete migration and reports the username plus referring table and column; ownership is never reassigned and historical data is never deleted. When no references exist, sessions for the four users are removed before the users. An existing `content_editor` keeps its password, account type, active state, and profile but receives `must_change_password=true` with an incremented revision.

After migration, `initialize-accounts` idempotently ensures only `admin` and `content_editor`. Their initial passwords come from `PARTSIGNAL_SEED_ADMIN_PASSWORD` and `PARTSIGNAL_SEED_ENGINEER_PASSWORD`; existing accounts are never overwritten. A newly created `content_editor` has account type `ENGINEER` and must change its initial password. At this revision the cleanup was the only physical user-deletion exception; revision `0027` later adds the restricted application deletion contract.

### 0011 Generation Reliability

`generation_jobs` gains nullable `last_dispatch_attempt_at` and non-negative `dispatch_attempt_count` fields plus a partial due-time index for `PENDING` rows. These fields are diagnostic metadata inside the existing Job aggregate; `generation_jobs.status` remains the only execution authority and Redis continues to carry only the Job UUID.

After the API commits a new Job, Broker dispatch failure leaves it `PENDING`. Celery Beat redispatches only rows whose `COALESCE(last_dispatch_attempt_at, created_at)` is older than the configured threshold, using PostgreSQL row locks and a bounded batch. Only a Worker that atomically changes `PENDING` to `RUNNING` may call the provider, so accepted-but-unrecorded Broker messages and concurrent recovery remain harmless duplicates.

The execution lease is calculated from the immutable snapshot as `started_at + input_snapshot.channel.timeout_seconds + GENERATION_FINALIZE_GRACE_SECONDS`; the grace must be positive. Expired `RUNNING` Jobs become `FAILED/WORKER_LOST` and are never automatically dispatched again. If the provider accepted a request before the Worker lost its result, only an explicit retry may create a new traceable Job.

### 0012 AI Data Classification

该 revision 曾在 `content_tasks` 上引入生成输入分级字段。`0025` 已物理删除这些字段；当前分级只属于产品事实工作区和不可变事实版本，第三方模型出站只接受 `FactVersion.classification=PUBLIC`。PostgreSQL 仍是分级唯一来源，Redis 不保存分级状态。

### 0013 Publication And Review Closure

`publication_attentions` is the authoritative business queue for a publication that reaches `REMOVED` or `VERIFICATION_FAILED`. One publication can create at most one attention. An attention must be inserted as revision-zero `OPEN`, may only become `RESOLVED`, cannot be deleted, and resolution requires an actor, UTC time, and non-blank comment. `content_tasks.source_publication_attention_id` is nullable and unique, so one attention creates at most one repair task without introducing a second task model. Both the attention binding and a non-null repair source are immutable.

Every new `publication_record` must use an active account whose `platform_profile_id` equals the task's direct `platform_profile_id`. The application service validates account activity and platform equality with explicit errors; the PostgreSQL insert trigger is the final protection for the cross-table platform equality. The first related publication that reaches `VERIFIED` changes an `OPEN` task to `COMPLETED` in the same transaction. A later publication loss never reopens or cancels that task; it creates the unique attention instead. A task with `PENDING_MANUAL_PUBLISH`, `PLATFORM_REVIEW`, or `PUBLISHED` publication state cannot be cancelled.

The repair command fixes product and direct platform from the original task. Historical tasks also retain their real query-topic link; product-driven tasks keep that link null. It must explicitly select a non-blank `APPROVED` fact version for the same product. Creating the repair task does not resolve the attention.

Fact and content review records remain append-only. `request-changes` requires a non-blank comment, while submit and approve comments remain optional. Revision `0013` extends both database status guards so `CHANGES_REQUESTED -> PENDING_REVIEW` is valid without changing the immutable version payload. Review contexts are read projections over immutable fact/content versions, deterministic version diff, actor summary, stable review history and, for content only, generation lineage; they do not project Evidence status or persist a second copy.

Before `0013`, `python -m app.cli preflight-integrity` must return an empty JSON array. It reports stable IDs for `COMPLETED_WITHOUT_VERIFIED_PUBLICATION` when a completed task has no append-only `VERIFIED` publication status event, and for non-terminal `PUBLICATION_PLATFORM_MISMATCH`; a publication that was verified and later removed remains valid completion history, while an explicitly `REJECTED`, `REMOVED`, or `VERIFICATION_FAILED` mismatch remains traceable but no longer blocks deployment. The command exits non-zero when any issue exists and never changes history. The migration repeats the critical check so direct Alembic execution cannot bypass the deployment gate. Once any attention or repair source exists, downgrade is refused and deployment must move forward.

### 0014 Platform Prompt Ownership

`platform_prompts.platform_profile_id` is the primary key and references `platform_profiles.id` with `ON DELETE CASCADE`; each concrete platform owns zero or one current Markdown Prompt. The migration creates a replacement table and copies each legacy type Prompt to every existing profile of that type. A legacy Prompt whose type has no concrete platform produces no row. The old table and `platform_type_id` column are removed; there is no dual read, dual write, type-level compatibility endpoint, or fallback Prompt.

The current Prompt row also owns its `revision` and `updated_at`. Platform collection projections expose that exact `updated_at` as nullable `prompt_updated_at`; they do not reuse platform audit time or persist a duplicate field. Prompt update and physical deletion both lock the current row and compare the caller's required `expected_revision`; a stale command returns `REVISION_CONFLICT` without deleting or auditing a false success.

该 revision 曾以不可变 `platform_profile_versions` 管理平台规则。`0025` 已物理删除规则版本表、管理工作台、规则状态机、影响摘要和任务规则引用；当前具体平台只维护一个可选的当前 Markdown Prompt。

Administrators may physically delete a `fact_version` in any status only when neither `content_tasks` nor `content_versions` references it. The service locks the target, reports every non-zero direct reference, explicitly deletes subordinate `fact_review_records`, and deletes the version in the same transaction. Each `fact_review_record` is owned by its exact `fact_version_id`; a version review context must query that parent ID and never aggregate sibling versions through `product_id`. This administrative cleanup is the only exception to normal append-only review history; it never cascades to or rewrites tasks, content, generation, publication, or observation history, and product deletion never implicitly deletes fact versions.

Revision `0016` replaces only the `fact_review_records` append-only trigger. `UPDATE` remains forbidden, and `DELETE` is allowed only when the transaction-local `partsignal.fact_version_delete_id` exactly matches the row's parent version. The service sets that value only after locking the version, proving it has no content references, and recording the safe audit summary. Other append-only tables and the `RESTRICT` foreign key are unchanged; downgrade restores the original generic trigger.

### 0017 Optional Content Humanization

`content_humanization_prompts` is a database-enforced singleton (`id = 1`) containing the only current naturalization Prompt. The migration inserts no row: an administrator must explicitly create the first value, and every row records a real `updated_by` user plus an optimistic-lock `revision`. There is no seed value, environment fallback, platform copy, delete operation, or second runtime source.

`generation_jobs.job_type` is required and limited to `GENERATE | HUMANIZE`; historical rows are backfilled to `GENERATE` before the migration removes the column default. `source_content_version_id` uses `RESTRICT` and is paired with the type: original generation must have no source, while naturalization must have one. A partial unique index on `source_content_version_id` where the type is `HUMANIZE` and status is `PENDING | RUNNING` prevents concurrent active jobs for the same source.

A successful naturalization creates a new immutable `content_versions` row with `source_type = AI`, `source_job_id` pointing to the naturalization job, and `based_on_id` pointing to the frozen source version. It never updates the source. The job snapshot is the authority for the selected model, global Prompt revision and Markdown, complete source article and hash, original approved facts, PUBLIC classification, task requirements, and final messages; credentials remain outside snapshots and Redis still carries only the job UUID.

The API and Worker both require an `OPEN` task, an `AI` source in `DRAFT | CHANGES_REQUESTED`, a non-blank approved `PUBLIC` fact version, and an active product. Worker validation occurs before and after the provider call, including source identity, status, type, task/fact binding, frozen hash, and original generation lineage. Once any `HUMANIZE` job exists, revision `0017` refuses downgrade so immutable AI history cannot become unreadable; deployment must use a forward fix.

New generation snapshots include the concrete platform identity and continue freezing the final system/user messages. Old immutable snapshots may omit the concrete-platform object only for historical reads; new writes must include it. Platform Prompts can diverge after migration, so `0014` does not guess how to merge them on downgrade; rollback requires the pre-migration PostgreSQL backup.

### 0018 Manual GEO Article Observation

`geo_observations.observation_kind` explicitly separates historical `LEGACY_MODEL_RESULT` rows from new `MANUAL_ARTICLE_SEARCH` rows. The migration assigns the legacy discriminator without changing any historical business field. Legacy query/model/answer fields and new `search_platform/search_query` fields are mutually exclusive under a database check; new writes have no target question, model call, web-search flag, answer summary, citation, accuracy, or observation-level recommendation.

At revision `0018`, `geo_observation_publications.recommendation_status` was the authoritative per-article result for manual observations and was limited to `RECOMMENDED | NOT_RECOMMENDED`. Historical associations remained `NULL` and meant “not assessed per article”; the migration never inferred a status from old citations, possible-influence links, or observation-level recommendation. Revision `0029` later removes this field instead of preserving an obsolete compatibility value. The insert trigger continues verifying that every new result belongs to the observation product through `PublicationRecord -> ContentVersion -> ContentTask`, the publication is currently `PUBLISHED | VERIFIED`, and `final_url` is present.

The create service locks the product and all current eligible publication rows, then requires the request to cover that exact publication ID set. Revision `0018` required at least one verified `OPERATION_SCREENSHOT`; revision `0029` makes evidence optional. Article titles, platform identity, links, and publication status remain projections of their existing owners and are not duplicated in GEO storage. Metrics and the default records list use the same filtered set of current correction-chain tails; `include_history=true` is the explicit read path for superseded rows. A row is current only when no `geo_observations.supersedes_id` points to it.

Correction is an append-only service operation over the existing schema: it creates a new `MANUAL_ARTICLE_SEARCH` row whose `supersedes_id` points to the current manual row. The service rejects already-superseded targets and changes to the product, search platform, or search query. No new table, column, index, migration, or duplicated summary field is introduced for the records page.

Frontend V2 Observation Detail 同样不新增持久化字段。`GET /geo-observations/{observation_id}/detail` 在单个 `REPEATABLE READ` 请求中，由 requested node 通过 recursive CTE 找到唯一 root，再读取全部后继并由服务端校验、排列为 root→tail；响应明确给出 selected/root/tail 与原记录、当前查看、链尾标记，浏览器不得遍历 `supersedes_id` 或按时间猜测当前节点。Product、Query Topic、recorder、逐篇 Published Article 事实、Legacy citation 和附件均按完整链 ID 集合批量读取；Article 展示使用 `PublicationWork` 终态平台 snapshot、实际标题与 final URL，证据只从节点直接拥有的 attachment 关系读取 `FileRecord` 并统一签发短期 URL。既有 `attachment_file_ids` 继续表示祖先继承后的可见 ID，但 Detail 的证据归属只以节点内直接 evidence 为准。缺少链、Product、Topic、recorder、Article URL 或可读文件时返回稳定 409，不做跨接口补装或默认值推断。

Manual GEO history is forward-only. Once a `MANUAL_ARTICLE_SEARCH` row exists, revision `0018` refuses downgrade because removing the discriminator, search fields, or article results would destroy immutable business meaning.

### 0019 Product-Driven Content Tasks

`content_tasks.query_topic_id` becomes nullable while retaining its `RESTRICT` foreign key. Existing tasks are not rewritten and keep their real query-topic UUID; new ordinary tasks and repair tasks originating from them store `NULL`. `0025` 后，新普通任务只需产品、同产品非空 `APPROVED` 事实版本和活动具体平台；人工首稿不依赖平台 Prompt，系统 AI 生成才要求当前 Prompt。

`ContentTaskCreate` no longer accepts a query topic. New generation snapshots omit the `query_topic` object entirely rather than storing null, an empty object, or an invented question. Historical tasks still resolve and freeze their real query topic when creating a new generation job. Repair tasks inherit the original task's nullable link, and repair context returns a nullable query-topic projection for explicit new/legacy handling.

`GET /content-tasks/creation-options` 是不持久化的创建表单 read model：用固定次数集合查询返回活动 Product 及其非空 `APPROVED` FactVersion、活动 PlatformProfile，并可返回 handoff Product 的资格原因。它只约束显示范围，不是安全控制。普通任务 POST 在同一事务内按平台、产品、事实版本顺序锁行并重新校验，options 读取后资源变化仍必须由写命令拒绝。

Revision `0019` rewrites no task or immutable job snapshot. It refuses downgrade before restoring `NOT NULL` when any product-driven task exists; rollback after new writes requires a forward fix or the pre-migration PostgreSQL backup, never a placeholder query topic.

### 0020 Platform Branding And Task List Projection

`platform_profiles` gains nullable `website_url`, `logo_file_id`, and `logo_external_url`. The uploaded Logo foreign key uses `RESTRICT`; the referenced `file_record` must be a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` object before the application accepts it. A database check permits at most one Logo source, so an uploaded file and an external URL are never stored together. Signed object-storage URLs are response projections and are never persisted. Revision `0028` later makes `logo_external_url` read-only for legacy rows; new writes only bind `logo_file_id`.

The content-task list remains a read projection and adds no duplicate display columns. It joins each task's direct platform and displays the platform's current name, website, and Logo. The projected AI status is the latest `generation_job` whose `job_type = GENERATE`, ordered deterministically by `created_at DESC, id DESC`; `HUMANIZE` jobs are content-version post-processing and never replace the task's generation status. The projection batches products, platforms, Logo files, publication state, and generation status instead of issuing per-task queries.

Revision `0020` refuses downgrade when any platform branding field is non-null. Removing populated branding requires a forward fix or a pre-migration backup rather than silent data loss.

### 0021 AI Channel And Model Management

`ai_channels` gains required `description`, `protocol_type`, and `provider_brand` fields. Existing rows are migrated with an empty description, the sole implemented protocol `openai-compatible-chat-completions`, and `CUSTOM` brand; the migration never infers a brand from a name or URL. The protocol and brand columns have database checks and no runtime default, so new writes must submit one registered pair. Protocol chooses the real request adapter; brand is controlled display and filtering metadata only. A name, description, or brand-only change preserves connection state, while Base URL, protocol, API Key, or Header changes disable the channel and invalidate all child model tests.

Channel latest-test state remains a deterministic projection over `ai_models`: among models with `last_tested_at`, the row ordered by `last_tested_at DESC, id DESC` is authoritative; a channel without a tested model projects `UNTESTED` and a null time. No channel-level test column or second status state machine is added. Channel collection counts, Header count, enabled-model count, and latest test are read projections rather than persisted summaries.

`generation_jobs(ai_channel_id, created_at)` supports channel usage windows. Usage statistics include both allowed business job types, `GENERATE` and `HUMANIZE`, and never include model tests or discovery because those operations do not create generation jobs. Counts include all selected jobs, success and failure count only terminal states, `last_used_at` is the maximum non-null `started_at`, and durations or token totals aggregate only provider-reported non-null values; an empty aggregate remains null rather than being estimated or replaced with zero. The query never scans snapshots or reconstructs ownership after a deleted channel has set the job foreign key to null.

Channel operation history remains a projection over the append-only `audit_logs` table. New model create, update, enable, disable, delete, and test entries include the non-sensitive `channel_id` in `change_summary`; existing models also relate older entries through their current foreign key. Historical events for already-deleted models without `channel_id` remain only in the global audit log and are not guessed into a channel history. Model discovery and testing record only status, counts, and stable error codes, never credentials, Header values, provider response bodies, or complete sensitive errors.

The provider execution invariant remains `AT_MOST_ONCE`: after any request byte is sent, no automatic provider retry is allowed. An explicit retry creates a new `generation_jobs` row linked through `retry_of_id`, retaining its own immutable, non-sensitive snapshot. The UI therefore exposes the fixed policy “仅手动重试” and no retry-count configuration.

### 0022 GEO Observation Insights

版本 `0022` 紧跟 `0021_ai_channel_model_management`，保证 Alembic 只有一个线性 head；它不修改 AI 渠道数据或约束。

新建 `MANUAL_ARTICLE_SEARCH` 观测必须关联真实 `query_topic_id`。`0022` 之前的人工观测通过 `NOT VALID` 约束保留历史 `NULL`，洞察聚合会明确排除这些记录，不把它们猜测到某个问题主题。首次追加式更正历史空主题记录时必须补充真实主题，后续更正不得改变主题。

`geo_observation_publications` 在 `0022` 新增可空的 `discovered`、`mentioned`、`cited` 和 `accuracy` 事实，既有行保持 `NULL`。该版本曾要求新人工关系提交累计阶段事实；`0029` 随后删除逐篇推荐和引用，只保留相互独立的 `discovered`、`mentioned` 与可空 `accuracy`。旧模型观测关系必须保持全部逐篇事实为空。插入触发器继续校验发布内容归属、可观测状态和非空公开链接。

洞察只聚合更正链当前链尾中的完整人工观测；服务必须先校验同次观测的全部逐篇关系，再应用内容平台、内容主题或发布内容筛选，不能用筛选隐藏缺失事实。`0029` 后，趋势率、平台率和内容排行统一按相互独立的发现、提及、准确事实计算，不再提供阶段漏斗。问题覆盖先按人工观测、问题主题和精确 GEO 平台去重。曾真实发布且仍被历史观测引用的发布记录在下线后继续可筛选追溯。分母为零时保持 `NULL`，历史不完整记录进入数据质量排除计数，迁移与服务均不推断缺失事实。只要已经写入新主题关联或逐篇洞察事实，迁移就拒绝降级；恢复必须使用前向修复或迁移前备份。

### 0023 Platform Management

版本 `0023` 紧跟 `0022_geo_observation_insights`。`platform_profiles.is_active BOOLEAN NOT NULL` 是具体平台启停的唯一业务状态；迁移把所有既有平台显式回填为 `true`，新建平台也显式写入 `true`。平台 `slug` 的全局 identity 由 `uq_platform_profiles_slug` 最终保证，只有该 constraint 的 `23505` 映射为 `PLATFORM_SLUG_EXISTS` 与 `body.slug` 字段错误。`0025` 后，配置完整只表示存在当前具体平台 Prompt，不保存派生列、汇总行或历史快照。

停用平台仍可查看、编辑、重新启用及维护 Prompt，但所有新建 `ContentTask`（包括发布异常修复任务）、`PlatformAccount` 和 `PublicationRecord` 的服务必须先锁定同一平台行并拒绝 `is_active=false`。停用不修改既有账号的 `is_active`，不修改 Prompt、任务、内容、发布、GEO 或审计历史。平台启用、停用与所有受限新建路径遵循“先锁平台，再检查状态并写入”的统一锁顺序，防止并发检查后写入穿透。

平台配置完整性、账号数量和引用次数均为 PostgreSQL 实时投影。平台引用数直接统计 `content_tasks.platform_profile_id` 的唯一 `ContentTask.id`；最近 30 天使用同一 UTC `as_of` 和半开区间 `[as_of - 30 days, as_of)`，历史数不设时间下界。`content_tasks(platform_profile_id, created_at)` 与 `platform_accounts(platform_profile_id, is_active)` 支持聚合；`audit_logs(target_type, target_id, created_at DESC)` 支持平台创建、编辑、启用和停用的真实时间投影。无对应审计时返回 `NULL`，不得使用迁移时间补造。

在 `0023` 的初始合同中，任一内容任务或平台账号都会阻断平台物理删除。`0037` 已把当前规则收缩为“先停用，仅 `OPEN` 任务和非终态发布工作阻断”，并允许清理平台账号但绝不级联任务。`0023` 降级会删除启停状态，只能在业务确认可丢失当前停用事实后执行；旧迁移与冻结的 `migration_schema_v1.py` 保持不变。

平台账号删除必须提交当前 `expected_revision`。服务按 Platform → Account 固定顺序锁行，先比较 revision，再在同一持锁事务实时统计非终态 `PublicationWork`；PublicationWork 创建遵循相同锁序，因此不能穿透删除复核。只有终态历史时允许删除账号，历史继续读取冻结的账号 label/identifier snapshot。同平台账号标识的 `lower(btrim(account_identifier))` 唯一性由 `uq_platform_accounts_profile_identifier_normalized` 权威保证；只有该 constraint 的 `23505` 竞态路径与业务预检统一返回 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS` 与 `body.account_identifier` 字段错误，不得由客户端先 GET 或解析数据库文本替代并发控制。

### 0024 Audit Outcome

版本 `0024` 紧跟 `0023_platform_management`，继续以现有 `audit_logs` 作为唯一业务审计来源。表新增必填 `business_module`、`outcome`、`result_message` 和可空 `error_code`；`outcome` 只允许 `SUCCESS | FAILED | DENIED`，`business_module` 只允许契约声明的九个模块。失败的创建命令尚无真实对象，因此 `target_id` 改为可空；任何读取方都必须显式处理该状态，不得补造 UUID。

历史 action/target 组合必须先通过迁移内的完整分类校验，再回填模块。既有同事务追加记录默认为 `SUCCESS`；只有 `ai_model.tested` 的失败测试和 `ai_channel.models_discovered` 的已记录失败按其稳定字段精确回填为 `FAILED`，其他历史结果不得从自由文本或 HTTP 状态猜测。迁移新增 `audit_logs(created_at DESC, id DESC)` 以保证全局分页稳定；既有目标时间索引保留。

`0024` 当时让九类关键命令在业务回滚后以独立事务追加 `FAILED` 或 `DENIED`。`0037` 已移除该运行时行为并清理对应历史；当前只允许保留白名单内的 `SUCCESS` 与业务状态同事务提交。`details` 只保存按业务模块登记的 `changes/facts`，写入边界与详情读取共用同一字段白名单；值仅允许 null/string/number/boolean 或这些标量的一维列表。列表只投影 metadata，不读取 `details`；详情遇到未知字段或不安全 shape 时整体返回 `AUDIT_PROJECTION_FAILED`，不部分展示或泄漏原始 JSONB。

审计时间按 UTC 存储和传输，查询时间窗采用半开区间 `[created_from, created_to)`。`actor_id` 使用 `SET NULL`，响应中的姓名和账号类型是当前用户目录投影而非历史快照。关键词只匹配当前操作者 username/display name、模块、动作、对象类型/标识、请求 ID、结果说明和错误码，不搜索 JSON details。列表的 count/rows 都 outer join 当前用户且固定为两条 SQL；filter options 固定两条去重排序 SQL。`request_id` 允许重复，只用于关联链路，并限制为 1 至 100 个可打印 ASCII 字符。`0037` 后专用触发器禁止普通 UPDATE，只放行受约束的操作者置空；任务聚合删除可精确删除旧目标审计，但没有通用审计删除 API。本次 read/write 投影收紧没有数据库 schema 或历史重写。

### 0025 Markdown Facts And Direct Platform Tasks

版本 `0025` 紧跟 `0024_audit_outcome`，一次性删除结构化产品事实和平台规则版本两套已废弃业务模型。历史迁移、`migration_schema_v1.py` 和既有不可变生成快照保持冻结；当前 Schema 只由本 revision、运行时 ORM 和本契约表达。

`products` 新增 `facts_body_markdown TEXT NOT NULL` 与 `facts_classification VARCHAR(16) NOT NULL`，后者只允许 `PUBLIC | INTERNAL | RESTRICTED`；既有 `facts_revision` 继续作为事实工作区乐观锁。新产品初态正文为空且分级为 `RESTRICTED`，保存事实命令必须拒绝去除空白后为空的正文并原样保存非空 Markdown。`fact_versions` 以 `body_markdown` 和 `classification` 替换 `snapshot_json`；新版本必须从同一产品工作区冻结非空正文与分级，历史空版本可继续被旧记录引用，但不能创建新内容任务。

迁移使用 revision 文件内冻结的确定性 Markdown 渲染器分别处理当前规范化工作区和每个历史 `snapshot_json`。渲染器只按固定章节、稳定记录顺序和字段顺序输出数据库已有值，不总结、归并、补值或调用 AI。分级取已有 Evidence 中限制最高的值，顺序为 `RESTRICTED > INTERNAL > PUBLIC`；没有可确定 Evidence 分级时写入 `RESTRICTED`。渲染和行数校验完成后删除 `parameter_evidence_links`、`replacement_evidence_links`、`claim_evidence_links`、`part_parameters`、`replacement_relations`、`fact_claims`、`evidences`、`reference_parts`，但不删除独立 `file_records`。

`content_tasks` 新增 `platform_profile_id UUID NOT NULL REFERENCES platform_profiles(id) ON DELETE RESTRICT` 和 `(platform_profile_id, created_at)` 索引。迁移通过原 `platform_profile_version_id -> platform_profile_versions.platform_profile_id` 唯一回填；任一任务无法回填时整个 revision 失败。随后删除 `platform_profile_version_id`、`platform_type_id`、`platform_type_snapshot`、`user_prompt_markdown`、任务分级三字段、受众、角度、转化目标、格式、长度与 `canonical_url`，以及对应检查与索引。`query_topic_id` 和 `source_publication_attention_id` 保持原义。

删除全部 `platform_profile_versions` 数据和表。`PlatformProfile` 是任务与发布的唯一平台身份，`PlatformPrompt` 是系统 AI 的唯一当前 system Prompt，`PlatformProfile.allowed_domains` 是发布 URL 的唯一平台域名规则。平台配置完整只表示已配置当前 Prompt；缺少 Prompt 不阻止创建内容任务或人工首稿，只阻止系统 AI 作业。平台引用数直接统计 `content_tasks.platform_profile_id`，平台物理删除由任务和平台账号直接引用共同阻断。

新普通内容任务请求精确写入 `product_id`、同产品非空 `APPROVED fact_version_id` 和活动 `platform_profile_id`，并固定 `query_topic_id=NULL`。发布异常修复任务继承原任务的平台和可空目标问题，只允许选择同产品非空 `APPROVED fact_version_id`；不复制已删除任务要求。发布平台等值的应用校验与 PostgreSQL 触发器都直接比较 `content_tasks.platform_profile_id` 和 `platform_accounts.platform_profile_id`。

新原始生成快照使用 `contract_version=content-markdown-v2`，冻结非敏感渠道、模型、平台身份、事实版本身份及分级、`system_message` 和 `user_message`。实际供应商请求必须恰好包含两条消息：system 正文逐字等于创建作业时读取的 `PlatformPrompt.template_markdown`，user 正文逐字等于 `FactVersion.body_markdown`；校验空白时不得改写原字符串。只有事实版本分级为 `PUBLIC` 才允许第三方出站。系统不再追加固定前缀、任务 Prompt、任务要求、产品元数据、事实 JSON 或平台规则。

自然化继续复用现有 `generation_jobs`，新快照版本为 `humanization-markdown-v2`，只冻结当前自然化 Prompt、来源文章、来源原始作业、事实版本身份及最终消息，不读取结构化事实、任务要求或平台规则。历史 `chat-json-v1` 与 `humanization-json-v1` 快照不改写且只读；不得从旧快照创建重试。迁移锁定 `generation_jobs` 并在发现任一旧契约 `PENDING | RUNNING` 作业时失败，部署必须先停止新流量并清空或显式终止旧作业。

任务级人工首稿直接创建 `ContentVersion(source_type=HUMAN, source_job_id=NULL, based_on_id=NULL, status=DRAFT)`，不创建生成作业。标题、摘要、Markdown 正文、标签和变更说明仍由现有内容版本契约校验；后续人工修订、审核、唯一批准版本、人工发布、状态事件和内容哈希与 AI 草稿完全共用。

事实与内容审核上下文不再投影 Evidence 状态。质量检查删除平台规则长度/禁用表达、任务受众/角度/格式/长度和结构化参数数字来源检查，只保留严格四字段模型 JSON、标题/摘要/正文非空、Markdown 安全渲染、内容哈希、状态转换、唯一批准版本和发布域名等确定性边界。

该 revision 的 downgrade 明确失败。恢复旧结构化关系或规则版本只能使用迁移前 PostgreSQL 备份，不得根据 Markdown 或历史快照反向猜测数据。

### 0026 Publication Account Deduplication

`platform_accounts` 新增非负 `revision`，业务标签与内部运营账号标识均须在 `btrim` 后非空。同一具体平台内，`lower(btrim(account_identifier))` 必须唯一；停用账号仍占用标识，不同具体平台可以保存相同标识。写入边界去除两侧空白但保留大小写用于内部展示。运营标识可以是平台用户名，也可以是“注册手机号 + 持有人”等内部组合，但不得保存密码、Cookie、令牌，不得进入日志或审计详情。

账号编辑和启停固定按“锁具体平台行、锁账号行、校验 expected revision、写业务与脱敏审计”的顺序执行。停用只影响新发布候选，不删除或改写历史引用；平台归属创建后不可编辑。迁移在创建规范化唯一索引前锁表并检查空值与重复组，发现无法无损处理的数据时以 `55000` 失败，不自动合并或删除账号。

人工发布以 `platform_profile_id + ContentVersion.content_hash` 作为平台内容身份。创建登记和 `mark-published` 都对该身份获取事务 advisory lock，并读取发布记录及追加式状态事件：存在非 `REJECTED` 尝试时禁止重复登记；任一记录曾出现 `PUBLISHED` 或 `VERIFIED` 事件后永久禁止同平台同内容再次登记或公开，后续 `REMOVED` 或 `VERIFICATION_FAILED` 不撤销公开事实。只有全部既有尝试从未公开且已进入 `REJECTED` 时，才允许换另一个启用账号重试。不同具体平台互不阻断，幂等键继续只负责同一请求重放。

### 0027 Guard Audit Actor User Delete

版本 `0027` 紧跟 `0026_publication_account_dedup`，不新增业务表或列，只把 `audit_logs` 的通用追加式触发器替换为操作者置空专用守卫。用户删除服务必须先锁定用户表和目标行，只允许删除 `is_active=false` 的账号；活动账号返回 `USER_ACTIVE`。会话沿既有外键级联清理，任一业务外键引用继续由 `RESTRICT` 阻断并映射为 `USER_IN_USE`。

删除事务先设置事务本地 `partsignal.user_delete_id`，随后仅允许在用户删除触发的外键级联上下文中，把匹配用户的 `audit_logs.actor_id` 从该 UUID 更新为 `NULL`，且 `to_jsonb(NEW) - 'actor_id'` 必须与旧行完全一致。错配用户、未声明事务变量、手工直接更新、把空操作者改为其他值、修改其他审计字段以及所有审计 DELETE 均以 `55000` 失败。用户删除成功后追加新的 `user.deleted` 审计事件，由实际执行删除的管理员作为操作者；历史审计事件保留但被删用户的当前目录投影为空。降级恢复原通用触发器。

本 revision 最初只允许删除没有 `generation_jobs` 或 `content_versions` 的 `CANCELLED` 任务；该旧规则已由 `0033` 的任务自有历史删除契约取代。

### 0028 Platform Logo Lifecycle

版本 `0028` 紧跟 `0027_audit_user_delete_guard`。`file_records` 新增可空 `cleanup_after` 与 `deleted_at`，状态扩展为 `DELETING | DELETED`；允许的新增转换只有 `PENDING | VERIFIED | FAILED | ABORTED -> DELETING -> DELETED`。`DELETED` 必须有 `deleted_at`，其他状态必须没有。对象元数据继续不可变。

管理员显式请求 Icon Horse 单候选时，服务端只访问固定 `https://icon.horse/icon/{规范化域名}`，校验 PNG、JPEG、WebP 或 ICO 后先持久化 `PENDING`，再写入自有对象存储并转为 `VERIFIED`。候选和手工上传完成的 `PLATFORM_LOGO` 设置 `cleanup_after = verified_at + 24 hours`；绑定任一平台时锁定文件并清空该字段。替换、清空或删除平台 Logo 后，仅在最后一个实际外键引用解除时设置 `cleanup_after = now() + 7 days`。

清理器以 PostgreSQL 为唯一权威，使用有限批次和 `FOR UPDATE SKIP LOCKED`。它在声明删除前实时检查 `platform_profiles.logo_file_id`、`publication_attachments.file_id`、`geo_observation_attachments.file_id`；不得查询 `0025` 已删除的 `evidences`，也不维护引用计数。到期 `PENDING`、任意 `FAILED | ABORTED`、到期 `VERIFIED` 和已有 `DELETING` 可被扫描；有引用时不得删除，无引用时先提交 `DELETING`，再幂等删除对象，成功后写 `DELETED/deleted_at`，暂时失败则保留 `DELETING` 供下一轮重试。

平台 Logo 外键触发器最终保证非空 `logo_file_id` 只引用 `VERIFIED`、`PUBLIC`、`PLATFORM_LOGO`。迁移把既有已引用 Logo 的 `cleanup_after` 保持为空，把既有无引用 `VERIFIED PLATFORM_LOGO` 设置为迁移时点后七天。`logo_external_url` 本阶段保留用于旧数据只读展示，创建和更新不再接受新的外链；迁移和 Worker 均不联网批量转换旧外链。存在任一 `DELETING | DELETED` 时禁止降级，因为对象删除不可逆。

### 0029 Manual GEO Independent Facts And Deletion

版本 `0029` 紧跟 `0028_platform_logo_lifecycle`。`geo_observation_publications` 物理删除 `recommendation_status` 与 `cited`，人工逐篇事实只保留相互独立且必须显式提交的 `discovered`、`mentioned`，以及允许为空的 `accuracy`（`ACCURATE | PARTIAL | INCORRECT | UNJUDGEABLE`）。迁移不根据旧阶段字段推断新事实；既有 `discovered`、`mentioned`、`accuracy` 原样保留。新建与更正的 `attachment_file_ids` 都允许为空，每个更正版本只关联当次新增文件；读取链尾时按祖先顺序聚合证据，不复制历史关联。

管理员只可按完整更正链物理删除 `MANUAL_ARTICLE_SEARCH` 观测，不能删除单个版本或 `LEGACY_MODEL_RESULT`。服务按产品、根观测、链节点的固定顺序锁定并验证链连续性，再在同一事务设置当前节点的 `partsignal.geo_observation_delete_id`，依次删除该节点的逐篇发布关系、附件关系及观测，最后写入只含稳定 ID 与数量的审计摘要。专用触发器继续禁止全部 UPDATE，只放行父 ID 与事务声明精确匹配的 DELETE；错配、缺少声明或不完整链均失败。

删除事务提交后，仅把已经没有平台 Logo、发布附件或 GEO 附件引用的文件安排进既有延迟清理状态机；清理器仍以三个实际外键为唯一引用权威，不保存引用计数，也不立即删除对象。通用文件清理不再限定 `PLATFORM_LOGO` 分类。审计不得记录搜索词、备注、回答、文件名或文件内容。该迁移会丢弃旧逐篇推荐与引用字段，降级仅恢复空列而不猜测历史值；恢复业务语义必须使用迁移前备份或前向修复。

### 0030 Controlled Publication Record Deletion

版本 `0030` 紧跟 `0029_geo_evidence_management`，不新增业务表或列。发布记录只有在完整状态事件历史从未出现 `PUBLISHED | VERIFIED`，且没有 `geo_observation_citations`、`geo_observation_publications` 或 `publication_attentions` 引用时才可物理删除；当前状态不是删除资格来源。发布关注事项一旦存在就阻断删除，因此经其关联的修复任务也不会失去来源。

删除服务使用现有的“具体平台 + 内容哈希”事务 advisory lock，再锁定发布记录并重新检查全部阻断引用。事务设置 `partsignal.publication_record_delete_id` 后，只允许删除目标记录的未公开状态事件、发布附件关系和记录本身；任何 `PUBLISHED | VERIFIED` 事件即使目标匹配也由数据库拒绝删除。错配目标、未声明事务变量、普通 UPDATE 和对其他聚合的 DELETE 均以 `55000` 失败。

删除成功只审计稳定目标 ID、状态事件数量和附件数量，不保存标题、URL、说明或文件名。解除附件关系后，只有已无平台 Logo、发布附件或 GEO 附件引用的文件才进入既有清理状态机；共享文件继续保留。发布周期指标仍来自保留的公开状态事件，因此受控删除不会改写任何已公开历史。

### 0031 Reusable Platform Prompts

版本 `0031` 紧跟 `0030_publication_record_deletion`。`platform_prompts` 改为独立模板库，以独立 UUID 为主键并新增全局唯一名称；该 identity 由 `uq_platform_prompt_templates_name` 最终保证，只有该 constraint 的 `23505` 映射为 `PLATFORM_PROMPT_NAME_EXISTS` 与 `body.name` 字段错误。`platform_profiles.platform_prompt_id` 是可空外键并使用 `ON DELETE RESTRICT`。一个平台最多绑定一份当前 Prompt，一份 Prompt 可被多个平台复用；配置完整性、缺失数量和平台投影都只从该外键实时派生。

迁移为每条旧 Prompt 保留原正文、revision、操作者和时间，并使用旧 `platform_profile_id` 作为新 Prompt UUID；名称确定为“平台名称（slug）”。复制和回绑完成后校验行数、正文与绑定关系，任一不一致都中止迁移。降级只允许每份 Prompt 恰好绑定一个平台且不存在未绑定模板，否则以 PostgreSQL `55000` 拒绝；迁移不按正文合并或猜测归属。

Prompt 更新锁定模板行并比较 `expected_revision`；保存前由管理端明确展示全部受影响平台。`0037` 起删除 Prompt 会在同一事务自动解绑全部当前平台并递增其 revision；平台删除仍不删除模板。新原始生成请求同时提交所确认的 Prompt UUID 与 revision，服务端锁定任务、平台及其当前绑定后重新校验，变化时返回 `PLATFORM_PROMPT_CHANGED`，不得使用过期确认。

新原始生成快照只写 `content-markdown-v3`，除既有最终消息、平台、事实、渠道和模型外，还冻结 Prompt 的 UUID、名称与 revision。`content-markdown-v2` 仅作为明确的历史类型继续读取并按原快照重试；后续换绑、更新或删除当前配置都不改变历史作业。自然化继续使用 `humanization-markdown-v2`。

### 0033 Controlled Content Task Owned History Deletion

版本 `0033_task_owned_history_delete` 紧跟 `0032_content_task_idempotency`，不新增业务表或列。只有 `CANCELLED` 任务可物理删除；该任务可以拥有生成作业、内容审核记录以及 `DRAFT | PENDING_REVIEW | CHANGES_REQUESTED` 内容版本。任一 `APPROVED | SUPERSEDED` 内容版本、任一关联发布记录或非空 `source_publication_attention_id` 都返回 `CONTENT_TASK_IN_USE` 并阻断删除。发布记录覆盖其 GEO 引用、文章观测和发布异常历史，修复来源单独阻断，因此任何下游历史都不会被清理。

服务按 UUID 顺序锁定目标任务的生成作业、内容版本和任务行，并在锁内重新检查状态与全部保护关系。事务设置 `partsignal.content_task_delete_id` 后，只允许把匹配任务内容版本的 `source_job_id` 置空，以及删除这些版本的审核记录；普通内容修改、审核记录 UPDATE、未声明或错配任务的 DELETE 继续以 `55000` 失败。服务随后依次删除任务生成作业、审核记录、未批准内容版本和任务，任一步失败都整体回滚。

删除成功只审计任务 UUID 与生成作业、内容版本、审核记录数量，不保存标题、正文、Prompt 或审核说明。产品、事实版本、平台、用户、发布、GEO 和既有审计均保持不变。任务列表与详情用同一批量保护历史投影决定 `DELETE` 动作，服务端仍是最终删除权限和状态权威。

### 0034 Publication Workflow Redesign

版本 `0034_publication_redesign` 紧跟 `0033_task_owned_history_delete`。该 revision 重新建立发布当前态：`publication_works` 保存一次人工发布工作的绑定和阶段，`publication_work_events` 与 `publication_verifications` 保存追加式历史，`published_articles` 保存首次核验成功后形成的只读公开成果，`published_content_issues` 保存发布后的页面问题，`publication_attachments` 只归属于发布工作。

新旧发布状态无法无损映射。迁移必须在替换结构前检查旧发布、关注事项、附件和依赖旧发布身份的 GEO 关系；任一非空时汇总表名与数量并以 PostgreSQL `55000` 中止，不删除、补值或猜测映射。通过预检后删除旧表与旧删除门禁，将 `content_tasks.source_publication_attention_id` 替换为唯一且不可改绑的 `source_published_content_issue_id`，并把 GEO 外键统一替换为 `published_article_id`。downgrade 同样以 `55000` 拒绝，恢复只能使用迁移前备份。

发布工作使用 `PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED | COMPLETED | CLOSED`。失败核验只追加当时标题、URL、发布时间和说明快照，并把工作置为 `ACTION_REQUIRED`；后续结果修正仍发生在同一工作上。首次成功核验原子创建与工作同 ID 的 `PublishedArticle`，并完成工作和来源任务。显式关闭必须保存原因、说明、操作者和时间，并原子取消来源任务。成功成果不再回退；后续问题由 `PublishedContentIssue OPEN -> RESOLVED` 独立表达，创建修复任务不会自动解决问题。

修复任务创建先锁定内容问题并检查既有来源关系；PostgreSQL 的 `uq_content_tasks_source_published_content_issue_id` 是并发竞争的最终权威。只有真实 `23505` 且 diagnostics 的 `constraint_name` 精确等于该名称时，服务才在回滚失败事务后返回既有 `409 REPAIR_TASK_EXISTS`；其他唯一、外键、触发器、缺失 diagnostics 或非 `23505` 的完整性异常保持 unknown 500，不解析数据库错误文本，也不得伪装成 revision 冲突。成功创建、问题/文章/事件历史和 AuditLog 必须保持原子，已知或未知失败都不得留下部分写入。

打开发布后内容问题必须先以 `FOR UPDATE` 锁定同一 `PublishedArticle`，再由既有预检查拒绝已有 `OPEN` 问题或曾以 `RETIRED` 解决的问题。Partial unique index `uq_published_content_issues_one_open` 是“每篇文章至多一个 OPEN Issue”的最终并发权威；只有真实 `sqlstate=23505` 且 diagnostics 的 `constraint_name` 精确等于该名称时，Issue INSERT owner 才在 root rollback 后返回与预检查相同的 `409 PUBLISHED_CONTENT_ISSUE_CONFLICT`、消息 `文章已有开放问题或已退役` 和空 details。识别不得解析数据库错误文本；命中后不查询或重放 winner。`RETIRED` 语义仍只属于既有预检查，数据库直接写入触发的 `23514` 不得归因于该 partial unique mapper。其他 Issue unique、FK、CHECK、NOT NULL、trigger、constraint trigger、非 `23505`、其他约束及缺失 diagnostics 均保持 unknown 500。已知失败 rollback 后 Session 必须可复用；失败不得留下第二个 Issue、Repair Task、状态/revision 变化、GEO 关系或 SUCCESS AuditLog。

工作终态字段、成果、事件、核验和问题历史由触发器冻结或限制为契约允许的状态变化。`0038` 起只有两类精确事务上下文可以删除发布历史：管理员永久删除已归档来源任务，或管理员永久删除一条没有 GEO 下游引用的成果聚合；未声明或错配目标的直接 DELETE 以 PostgreSQL `55000` 拒绝。GEO 新观测只能引用没有 `OPEN` 问题且从未以 `RETIRED` 解决问题的 `PublishedArticle`；打开问题、创建观测和删除成果锁定同一文章，避免资格竞态。

### 0035 Business Workflow Primary Tasks

版本文件 `0035_business_workflow_primary_tasks.py` 紧跟 `0034_publication_redesign`，Alembic revision 为 `0035_business_workflow`。事实版本不再保存可重新提交的 `DRAFT`：事实工作区提交原子冻结一个 `PENDING_REVIEW` 版本，每个产品至多一个待审核版本；既有草稿或多待审核等歧义数据以 PostgreSQL `55000` 阻断迁移，不猜测业务结论。

`content_tasks.current_content_version_id` 是内容单主线的唯一当前指针。迁移只在每个任务的版本历史能确定唯一当前版本时回填；多个候选主线以 `55000` 阻断。当前草稿或退回版本可转为 `ABANDONED`，新修订和自然化结果通过原子更新该指针成为当前版本，旧版本保持不可变历史。数据库触发器校验当前版本必须归属同一任务，每个任务至多一个待审核内容版本。

`publication_works.content_task_id` 固定发布工作的稳定任务身份并取代按内容版本唯一；首次核验成功前，工作可切换到同任务、同平台的当前批准版本。每次切换在事件中冻结前后内容版本，核验记录冻结当次内容版本，成果读取成功核验快照而不是可变工作指针。旧工作、事件和核验只有在归属可唯一确定时才回填，否则以 `55000` 阻断。

开始发布的最终唯一性由 `uq_publication_works_idempotency_key`、`uq_publication_works_content_task_id` 与 partial unique index `uq_publication_works_active_platform_hash` 共同裁决。服务先按 request key、ContentTask 和同平台 active content hash 执行持锁预检；只有真实 `23505` 且 `diag.constraint_name` 精确等于这三个名称之一时，Work INSERT owner才允许在root rollback后恢复。恢复始终先按request key查询winner：`content_version_id/platform_account_id`全等返回canonical replay，任一不同返回既有`409 IDEMPOTENCY_CONFLICT`；没有同key winner时，content-task或active platform/hash冲突返回既有`409 PUBLICATION_IDENTITY_CONFLICT`，idempotency约束却找不到winner则保持unknown。其他unique、PASSED verification、Article、Attachment、FK、CHECK、trigger、缺失或替代位置diagnostics全部原样失败，不解析数据库错误文本，也不得映射为`REVISION_CONFLICT`。合规锁并发与数据库竞争都只能提交一个Work和一条`CREATED`事件；loser不得改变ContentTask status/revision/current pointer，或留下Verification、Article、GEO关系、source与SUCCESS AuditLog。

`content_task_geo_sources` 按内容任务一对一冻结 GEO 异常规则、分析周期、来源文章或问题、GEO 平台和结构化依据。来源行只允许插入，不允许更新或删除；创建服务必须重新计算当前洞察并与内容任务同事务写入。该迁移包含新的不可逆业务历史，downgrade 固定以 `55000` 拒绝，恢复使用迁移前备份或前向修复。

GEO 优化任务与普通任务共享 `content_tasks.idempotency_key` 的全局唯一空间，但 source kind 属于 canonical identity：普通任务必须不存在 `content_task_geo_sources`，GEO 任务必须存在一条形状完整的来源快照。GEO 创建 owner 只恢复 PostgreSQL `23505` 且 `diag.constraint_name` 精确为 `uq_content_tasks_idempotency_key` 的 task INSERT 竞争；命中后先 root rollback，再按 key 重查已提交 winner。完整同 GEO identity（task 的 product/fact/platform 与 source 的 rule/date/article/topic/GEO platform）返回 canonical replay；完整 ordinary winner或任一可证明的异 GEO identity返回既有 `IDEMPOTENCY_CONFLICT`。winner 不存在、task identity 不完整，或来源文章已按 `0037` 的 `ON DELETE SET NULL` 生命周期消失等导致 GEO source identity 不可证明时，必须重新抛出原始 `IntegrityError`，不得猜测 replay 或冲突。task 与 GEO source 继续同一事务提交；source flush、commit 及其他完整性错误不进入该 mapper。

### 0036 Remove Publication Section URL

版本文件 `0036_remove_publication_section_url.py` 紧跟 `0035_business_workflow`，Alembic revision 为 `0036_remove_section_url`。该 revision 删除没有稳定跨平台含义的 `publication_works.section_url`；开始发布只绑定 `content_version_id` 与 `platform_account_id`，准备更新只允许变更账号并提交 revision 和说明。

迁移先以 0035 的当前定义替换 `partsignal_guard_publication_work()`，仅从准备阶段冻结条件移除栏目地址比较，再删除列；账号冻结、身份不可变、结果登记和状态转换规则保持不变。`0037` 后终态历史仍不可原地修改，但可随已归档任务聚合永久删除。真实公开位置只由结果登记的 `final_url` 保存，并继续匹配具体平台允许域名。

既有栏目地址按已确认的无效数据直接丢弃，不转存到影子列、JSON 或历史表。该值无法确定性恢复，downgrade 固定以 PostgreSQL `55000` 拒绝，恢复必须使用迁移前备份。

### 0037 Simplified Deletion Lifecycle

版本文件 `0037_simplify_deletion_lifecycle.py` 紧跟 `0036_remove_section_url`。`content_tasks` 新增正交的可空 `archived_at`、必填平台名称快照与可空网站 URL 快照；`publication_works` 新增必填平台名称、账号标签和账号标识快照。迁移只从升级时仍受强外键保护的当前行确定性回填，任何缺失都以 PostgreSQL `55000` 中止，不猜测历史显示值。

归档只接受未归档 `COMPLETED` 任务；恢复只清空 `archived_at`，两者都校验并递增 revision，不改变业务状态。默认任务列表只返回未归档任务，`archive_status=ARCHIVED|ALL` 才读取归档范围。普通删除校验 `expected_revision`，只接受未归档 `OPEN | CANCELLED` 任务，拒绝运行中生成作业以及任何成功文章或 GEO 文章关系；它删除任务拥有的草稿、审核、生成和未成功发布工作，但不触碰外部页面。

管理员永久删除只接受已归档任务、匹配 revision 和固定确认文本 `永久删除`。服务锁定并重新计算范围，删除任务拥有的内容、发布成果与问题、发布事件和核验；只删除失去全部文章关系的人工 GEO 更正链，共享 GEO 记录与共享文件保留。删除旧目标审计后只写一条 `content_task.permanently_deleted` 空详情墓碑。归档、恢复及永久删除都不验证或删除外部页面。

发布成果永久删除只接受管理员、匹配同 ID `PublicationWork.revision` 和固定确认文本 `永久删除`。`GeoObservationPublication` 与 `GeoObservationCitation` 按去重观测数投影为 `GEO_OBSERVATION`，`ContentTaskGeoSource` 投影为 `GEO_OPTIMIZATION_SOURCE`；任一引用存在都返回结构化 `409 PUBLISHED_ARTICLE_IN_USE`，不得依赖现有 `CASCADE` / `SET NULL` 静默解绑。无阻断时，事务删除成果拥有的工作、事件、核验、附件关系和内容问题，保留修复任务并解除其来源问题，保留批准内容；来源任务仍绑定实时平台时恢复为 `OPEN`，平台已经删除且外键为空时转为 `CANCELLED`，两者都递增 revision。任务若已归档则保留 `archived_at`；恢复归档后，`OPEN` 可重新进入待发布，`CANCELLED` 保持已取消。删除旧目标审计后写入 `published_article.permanently_deleted` 最小墓碑，且不验证或删除外部页面。

`source_published_content_issue_id` 的 current-head 权威删除语义为 nullable `ON DELETE SET NULL`；早期 revision 中的 `RESTRICT` 已由 `0037_simplify_deletion_lifecycle` 替换。删除成果聚合时，SET NULL 只解绑被保留的 Repair Task，不能改变该任务的 status、revision 或 `archived_at`；恢复为 `OPEN` 或转为 `CANCELLED` 并递增 revision 的对象始终是原 Article 的来源 ContentTask。

平台删除仍要求先停用，并在存在 `OPEN` 内容任务或非终态发布工作时拒绝；它绝不级联删除任务。平台账号随平台删除，终态任务与工作把实时平台/账号外键置空后使用标量快照显示。单独账号删除只由非终态发布工作阻断。Prompt 删除通过共享事务 advisory lock 串行化绑定变更，在同一事务自动解绑全部平台、递增平台 revision 后删除模板；历史生成作业继续读取不可变输入快照。

审计写入收缩为 `RETAINED_AUDIT_ACTIONS` 中的成功事件。迁移删除全部 `FAILED | DENIED` 以及白名单外历史，并把审计门禁收窄为禁止 UPDATE；业务层没有通用审计删除 API，只在任务聚合删除时按精确目标清理旧审计。该迁移、历史审计清理和已执行永久删除不可逆，downgrade 固定以 `55000` 拒绝并要求恢复升级前备份。

### 0039 Published Article Delete Missing Platform

版本文件 `0039_published_article_delete_missing_platform.py` 紧跟 `0038_published_article_delete`，不新增列或重写数据。归档状态检查扩展为 `archived_at IS NULL OR status IN ('OPEN', 'COMPLETED', 'CANCELLED')`，使成果删除后因原平台已删除而取消的来源任务继续保留正交归档标记；`OPEN` 仍必须绑定实时平台。若已经存在归档 `CANCELLED` 任务，downgrade 以 PostgreSQL `55000` 拒绝，否则恢复 `0038` 的归档状态集合。

### 0040 Content Draft Management

版本文件 `0040_content_draft_management.py` 紧跟 `0039_article_delete_platform`，不新增业务表或列。当前 `OPEN` 任务指向的人工 `DRAFT` 在没有审核记录时可按 revision 原地保存标题、摘要、Markdown、标签、内容哈希和质量问题；版本号、事实、来源、lineage、变更说明和创建信息保持不变。AI 草稿、历史版本、退回版本以及已进入审核的内容继续不可变。

人工 `DRAFT | ABANDONED` 只有在没有审核、子版本、生成来源/结果、发布工作、发布事件或核验引用时才可彻底删除。当前草稿删除前把任务指针恢复到直接父版本或置空；历史草稿不改变指针。应用层在持锁状态返回结构化引用，事务再设置精确 `partsignal.content_version_delete_id`；数据库 DELETE 守卫与现有 `RESTRICT` 外键负责最终竞态保护。AI 草稿不进入该删除窗口。

删除审计 `content_version.deleted` 只保存任务 UUID 和内容版本号，不保存标题、摘要、正文、标签、Prompt、模型响应或变更说明。草稿旧值与已删除正文无法确定性重建，因此 downgrade 以 PostgreSQL `55000` 拒绝，只允许前滚修复或恢复升级前备份。

### 0041 Content Task List

版本文件 `0041_content_task_list.py` 紧跟 `0040_content_draft_management`。`content_tasks` 新增非空 `updated_at`，历史值确定性回填为 `created_at`；任务自身变更由 ORM 更新该时间，当前人工草稿原地保存显式触碰任务时间。`(archived_at, updated_at, id)` 索引支持默认归档范围与稳定排序。

内容任务列表的“最近更新”不保存第二套业务状态。读投影取任务时间、当前主线版本创建时间、生成作业活动时间、审核记录时间和发布工作时间的最大值，并按 `updated_at DESC, id DESC` 排序。当前内容摘要只能通过 `content_tasks.current_content_version_id` 读取，禁止选择版本号最大值代替主线。

### 0042 Content Version Detail

版本文件 `0042_content_version_detail.py` 紧跟 `0041_content_task_list`。`content_versions` 新增可空 `updated_at`：升级不回填旧行，只为后续 INSERT 设置数据库默认值；ORM 只在既有合同允许的人工草稿保存、审核状态/revision 转换和旧批准版本转 `SUPERSEDED` 时写入真实更新时间。`null` 表示该历史版本没有可证明的更新时间，不得使用迁移时间、任务时间或审核时间补造。

### 0043 GEO Insight Platform Identity

版本文件 `0043_geo_insight_platform_identity.py` 紧跟 `0042_content_version_detail`。`publication_works.platform_profile_id_snapshot UUID NULL` 无外键地冻结创建时的平台 UUID，与既有 `platform_profile_name_snapshot` 共同成为 Published Article、GEO Detail 和 GEO Insights 的历史平台身份 owner；实时 `platform_profile_id` 仍保持 `SET NULL` 删除语义。升级只从尚存在的实时 UUID 确定性回填；任一 Published Article 无法回填时以 PostgreSQL `55000` 原子中止，不按名称、审计或随机值猜测身份。新发布工作必须同时写入与实时平台一致的 snapshot，后续更新守卫禁止修改；列只为已经丢失实时身份的非 Published Article 历史保持可空。若任一发布工作已经失去实时平台 UUID，降级会丢失冻结身份，因此迁移以 `55000` 拒绝降级。

Content Version Detail 是一次 `REPEATABLE READ` 只读投影。它只读取目标版本、任务当前指针、Fact Version identity、创建者、目标祖先链上的生成/自然化 Prompt 与 model snapshot，以及按既有顺序累计的审核记录；不返回完整 Task、Fact Markdown、Diff、无关 GenerationJob、版本列表或动作投影。`review_result` 必须取目标版本自身最后一条真实审核记录，`is_current` 只比较 `content_tasks.current_content_version_id`，两者都不得从版本状态推导。

普通任务删除在行锁内校验调用方必填的 `expected_revision`，不匹配返回 `REVISION_CONFLICT`；删除范围与阻断条件仍由服务端在同一事务最终复核。

### 0044 GEO Catalog

版本文件 `0044_geo_catalog.py` 紧跟 `0043_geo_platform_identity`。新增 `geo_subjects`、`geo_subject_aliases`、`geo_subject_domains`，落实本合同的命名 CHECK/FK/UNIQUE/index 和 Subject 不可改身份触发器。活动 OWN_PRODUCT 的 partial unique 允许多个停用历史身份，并对创建及重新启用提供同一数据库仲裁；父级 MATCH FULL 复合 RESTRICT FK 校验真实品牌类型；子字典只在删除 Subject 时 CASCADE。无历史回填、服务写入、revision 自动递增或 HTTP 错误映射；未来 Application Service 继续拥有聚合事务、锁序、CAS 与成功审计。降级明确失败，不能用删除 Catalog 数据作为恢复方式。

### Content Task Detail 读取快照

`GET /api/v1/content-tasks/{content_task_id}/detail` 不新增表或持久化第二套状态。请求在 PostgreSQL `REPEATABLE READ` 中读取任务及其锁定 Product、FactVersion、Platform identity，并以固定次数批量查询当前内容、生成、审核、发布、真实来源与 Activity；查询次数不得随相关记录数量线性增长。

当前内容只能由 `content_tasks.current_content_version_id` 解析，禁止以最大 `content_versions.version` 代替。latest generation 按 `created_at DESC, id DESC` 确定；review 只属于当前主线内容；source 只投影真实 `query_topic_id`、`content_task_geo_sources` 或 `source_published_content_issue_id` 关系。Activity 由任务、生成、内容版本、审核和发布追加记录联合，按 `timestamp DESC, kind ASC, source_id DESC` 稳定排序并截取最近 10 项，浏览器不得再次合并或排序。

## State Machines

```text
FactVersion: PENDING_REVIEW -> APPROVED -> RETIRED
                            \-> CHANGES_REQUESTED

ContentVersion: DRAFT -> PENDING_REVIEW -> APPROVED -> SUPERSEDED
                    \-> ABANDONED    \-> CHANGES_REQUESTED -> ABANDONED

ContentTask: OPEN -> CANCELLED
             OPEN -- first successful PublicationVerification --> COMPLETED
             COMPLETED -- permanent article delete --> OPEN | CANCELLED
             OPEN | COMPLETED | CANCELLED -- archive/restore --> same status

GenerationJob: PENDING -> RUNNING -> SUCCEEDED | FAILED
               PENDING -> FAILED (pre-execution snapshot/runtime gate rejection)
               (applies to both GENERATE and HUMANIZE)

PublicationWork:
PREPARING -> PLATFORM_REVIEW -> AWAITING_VERIFICATION
PREPARING -> AWAITING_VERIFICATION
AWAITING_VERIFICATION -> ACTION_REQUIRED -> AWAITING_VERIFICATION
AWAITING_VERIFICATION | ACTION_REQUIRED -> COMPLETED
PREPARING | PLATFORM_REVIEW | AWAITING_VERIFICATION | ACTION_REQUIRED -> CLOSED

PublishedContentIssue: OPEN -> RESOLVED

PlatformProfile: ENABLED <-> DISABLED

FileRecord: PENDING -> VERIFIED | FAILED | ABORTED | DELETING
            VERIFIED | FAILED | ABORTED -> DELETING -> DELETED
```

State changes not shown above are invalid. A rejected immutable fact or content version is a terminal historical conclusion; correction creates a new immutable version from the editable fact workspace or current content lineage. Only the current unreviewed `HUMAN DRAFT` may be saved in place; every frozen payload remains immutable.

## Required Constraints

- `products.part_number`、`products.brand` 与 `products.category` 的保存值均须去除两侧空白、非空且不超过 160 字符；产品身份由规范化后的品牌与型号组合唯一确定。
- 非空 `content_tasks.idempotency_key` 全局唯一；普通任务创建先按命名请求键获取 PostgreSQL 事务 advisory lock，再判断重放或执行当前业务校验。三字段业务输入本身不唯一。
- Version numbers are unique within their owner: product fact or content task.
- Product or content-task owner rows are locked while allocating the next version number.
- A product has one Markdown fact workspace protected by `facts_revision`; new fact versions freeze its non-blank Markdown and classification.
- 每个产品至多一个 `PENDING_REVIEW` 事实版本；工作区提交直接创建该不可变版本，不存在版本级草稿或原版本重提。
- Approved fact versions permit status-only transition to `RETIRED`; all other columns are immutable.
- 内容版本只允许有效状态转换。当前、未审核的人工 `DRAFT` 可按 revision 保存可编辑载荷；AI 草稿以及提交审核后的全部版本不可原地修改。
- `content_tasks.current_content_version_id` 是内容主线唯一权威，必须为空或指向同任务版本；审核、修订、自然化、待发布资格和发布版本切换只接受当前版本。
- 每个任务至多一个 `PENDING_REVIEW` 内容版本；放弃当前草稿或退回版本后，指针恢复到该任务最近批准版本，没有批准版本时置空。
- 无直接引用的人工 `DRAFT | ABANDONED` 可通过精确单版本删除事务清理；AI 草稿、审核历史和任何生成/发布下游引用均阻断删除。
- `users.account_type` is the only permission source. `ADMIN` includes all `ENGINEER` abilities and exclusively manages users and configuration.
- At least one active `ADMIN` must remain after every user account-type or active-state update.
- 用户物理删除仅限管理员操作停用账号；会话级联清理，审计操作者按 `0027` 受约束置空，任何业务历史引用都阻断删除。用户实时 `admin_total` 统计全部 `ADMIN`，包括停用账号。
- Sensitive AI values are encrypted with the deployment master key and never returned, audited, logged, or copied into generation snapshots.
- A platform type referenced by a platform profile cannot be deleted. Platform types do not own Prompts after `0014`.
- A concrete platform binds zero or one current Prompt, while one Prompt may be shared by multiple platforms. Missing binding keeps the platform selectable for manual content tasks but makes system AI generation unavailable.
- Platform Prompt update and deletion require optimistic revision matching against the locked template row. Prompt deletion atomically unbinds every current platform and increments each platform revision; platform deletion never deletes the template.
- A concrete platform's `is_active` state is independent from configuration completeness. A disabled platform remains manageable but cannot be used to create a content task, repair task, platform account, or publication work; disabling never mutates existing accounts, configuration, or history.
- Platform completeness, account counts, and task-reference counts are real-time read projections. Completeness is true when the current platform Prompt exists; a task reference is counted once through `content_tasks.platform_profile_id`.
- A concrete platform stores at most one Logo source. New writes only accept a `VERIFIED`, `PUBLIC`, `PLATFORM_LOGO` file; `logo_external_url` remains a nullable read-only legacy field until a later migration, and `website_url` remains an explicit nullable URI.
- File cleanup uses all actual current-head file foreign keys, including AnswerSnapshot screenshot/raw payload references, as its deletion authority. Unconfirmed files retain their configured grace period, detached previously used files retain seven days, and object deletion remains retryable through `DELETING` before a `DELETED` tombstone is recorded.
- Product, fact version, platform profile, platform account, platform type, and user physical deletion is admin-only. Services lock targets and return structured `409` conflicts; the only configured cascades are the approved Prompt auto-unbind, platform-owned account cleanup, and task-aggregate deletion paths.
- A product can be physically deleted only when no `FactVersion`, `ContentTask`, or `GeoObservation` directly references it. A platform profile must first be disabled and requires no `OPEN` content task or nonterminal `PublicationWork`; deleting it never deletes a task. A platform account requires no nonterminal `PublicationWork`; a platform type requires no platform profiles.
- 未归档 `OPEN | CANCELLED` 内容任务可连同其任务聚合删除，但运行中的生成作业、成功文章或 GEO 文章关系阻断普通删除。`COMPLETED` 任务只能先归档；管理员随后可按固定确认文本永久删除整个内部任务聚合，共享 GEO 与文件保留。
- Channel deletion cascades to Headers and models. Historical job foreign keys become null while their immutable snapshots remain readable.
- A model can be enabled only after its own successful test. A channel can be enabled only when at least one child model has passed testing.
- A generation job performs at most one provider call. Expired worker leases fail explicitly; retries create a new job and preserve the original non-sensitive snapshot. Original-generation v2/v3 snapshots may retry from their frozen input; legacy v1 snapshots are read-only.
- Automatic recovery dispatches only overdue `PENDING` jobs. Dispatch counters, queue ages, failure codes, and provider duration diagnostics must never contain prompts, response bodies, credentials, or sensitive Headers.
- Third-party AI egress requires the bound fact version to be explicitly `PUBLIC`; missing, legacy-empty, `INTERNAL`, or `RESTRICTED` fact data is a hard denial.
- Original generation revalidates the user-confirmed current Prompt UUID and revision, then sends exactly one system message equal to that Prompt and one user message equal to the frozen fact Markdown; no prefix, task field, metadata, JSON wrapper, repair, model switch, or fallback is allowed.
- A manual first draft creates a `HUMAN DRAFT` content version with null generation and parent lineage, then uses the same review and publication gates as AI content.
- A publication work can reference only an approved content version whose fact is not retired at creation time.
- A publication account profile must equal the content task's locked platform profile; both the application service and PostgreSQL enforce it.
- A publication work freezes the selected platform in `platform_profile_id_snapshot` without a foreign key. Published Article and GEO history read this UUID plus `platform_profile_name_snapshot`; deleting the live platform may null only the live foreign key and must not alter either snapshot.
- A concrete platform may own multiple publication accounts, but their internal identifiers are unique by `lower(btrim(account_identifier))`; disabled accounts retain identity and historical references but are excluded from new publication candidates.
- A publication work selects exactly one account. One content task has at most one work, and one `platform_profile_id + content_hash` has at most one non-closed work.
- Work idempotency、ContentTask identity与active platform/hash的数据库最终权威分别是`uq_publication_works_idempotency_key`、`uq_publication_works_content_task_id`与`uq_publication_works_active_platform_hash`；仅`23505 + exact diag.constraint_name`可进入局部恢复，且任一获准约束都必须先按request key保持canonical replay/`IDEMPOTENCY_CONFLICT`优先级，再处理`PUBLICATION_IDENTITY_CONFLICT`。
- 非终态发布工作仅可切换到同任务、同平台的当前批准版本；切换事件记录前后版本，每次核验记录当时版本，成功成果永久读取成功核验快照。
- Result registration requires a valid HTTP(S) URL matching the configured platform domain and may append only verified `OPERATION_SCREENSHOT` evidence. Result fields, evidence, work event and audit commit or fail together.
- A failed verification appends an immutable snapshot and leaves the work pending in `ACTION_REQUIRED`; it never creates an article or completes/cancels the task.
- Task completion has no public manual command. The first successful verification atomically creates the read-only `PublishedArticle` and completes the open source task; completed tasks never revert.
- A nonterminal work may only end without success through explicit close with a structured reason and non-blank comment; close atomically cancels the source task.
- Publication works, events, verifications, articles and issues cannot be individually deleted through business APIs. Published results remain immutable in place; the only aggregate exception is administrator permanent deletion of their archived source task.
- Repair-task creation and issue resolution are separate explicit commands. A repaired issue remains `OPEN` until explicitly resolved, and resolving it does not complete the repair task.
- Fact and content review records are append-only, and every request-changes command requires a non-blank comment.
- Observation accuracy `UNJUDGEABLE` is excluded from the accuracy-rate denominator.
- Manual GEO observations cover every currently eligible `PublishedArticle` for one product and store one independent `discovered`, `mentioned`, and optional `accuracy` result per article. Articles with an open issue or a historical `RETIRED` outcome are ineligible. Evidence screenshots are optional; corrections aggregate ancestor evidence for reads without duplicating file links. Administrators may delete a complete manual correction chain directly; archived-task permanent deletion removes only chains that lose every article relation.
- Historical GEO publication associations with null insight facts remain explicitly incomplete and never enter manual insight denominators.
- GEO 优化任务必须与一条不可变 `content_task_geo_sources` 来源快照同事务创建；服务端重新计算异常，拒绝客户端伪造、过期或数据不足的依据。
- Audit log details must not contain passwords, session cookies, AccessKeys, model keys, or unpublished source documents. Runtime audit accepts only retained successful actions; task aggregate deletion may remove old target logs and preserve one minimal deletion tombstone.

## CONTENT_GENERATOR 业务生成运行模式

`CONTENT_GENERATOR` 为各进程启动时的配置快照，保留 `deterministic` 和 `openai-compatible`。`deterministic` 只表示关闭正式业务生成，不能生成固定成功内容；GENERATE、HUMANIZE 与 RETRY 命令在任何 Job 写入、提交和 Redis 投递前返回 `409 AI_GENERATION_DISABLED`，包括同 key 的幂等 replay。管理模型测试/发现属于独立操作，仍遵守各自权限、revision 和网络门禁。

正式 Worker 以 Job 行锁吸收重复投递；deterministic 下所有 PENDING 在执行前进入 `FAILED/AI_GENERATION_DISABLED`，保留原 attempt/started 字段，设置 finished_at、清 lease，不创建 ContentVersion、不写供应商成功 metadata 或审计。门禁先于已有 source_job_id 内容回收快速路径；既存内容历史不修改。openai-compatible 的既有内容回收语义保持不变。RUNNING 重投始终直接返回，配置变更不能撤回已发请求；原执行继续按 lease 与迟到结果合同收尾。配置文件变化不代表运行进程已重载，API/Worker/Scheduler 必须加载同一受控模式后才可声称新模式生效。

## GEO Batch / Run 合同（GEO-301 / R2）

`0048_geo_batches_runs`（down_revision=`0047_geo_monitoring_plans`）仅expand两表和冻结SQL函数/触发器，不改旧GeoObservation、QueryTopic或既有配置数据。公共数据组件见OpenAPI的`GeoObservationBatchOut`、`GeoObservationRunOut`等21个新增组件；不是GEO-306详情或GEO-302动作投影。无HTTP执行命令、AnswerSnapshot、Collector或外部调用。内部单租户共享业务历史；created_by只追溯，不代表用户私有权限。

### geo_observation_batches

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id | UUID | pk_geo_observation_batches |
| plan_id | UUID NULL | fk_geo_batches_plan → geo_monitoring_plans.id RESTRICT；临时批次为空 |
| trigger_type | varchar(16) | SCHEDULED/MANUAL/RETEST |
| status / revision | varchar(20) PLANNED / integer 0 | PLANNED/QUEUED/RUNNING/COMPLETED/PARTIAL/FAILED/CANCELLED/BUDGET_BLOCKED；status和时间是可重建缓存，不是第二业务事实源 |
| scheduled_for / schedule_identity | timestamptz NULL / varchar(64) NULL | SCHEDULED必须与非空plan_id一起提供；其他触发均空；identity为非敏感SHA256摘要 |
| plan_snapshot / rule_snapshot | JSONB NOT NULL | schema_version=1，闭合计划配置与规则revision；计划身份/revision成对；不含凭据或执行结果 |
| requested_run_count | integer NOT NULL | >=1，初始attempt1逻辑cell数；创建提交时与实际roots相等，retry不改变 |
| source_opportunity_id | UUID NULL | 仅RETEST提供；GEO-702建立实体时追加真实FK；301无机会命令、不可伪称已验证机会归属 |
| baseline_batch_id | UUID NULL | fk_geo_batches_baseline → batches.id RESTRICT；RETEST必填，不可指向自己 |
| created_by | UUID NULL | fk_geo_batches_creator → users.id RESTRICT；SCHEDULED系统actor允许NULL，MANUAL/RETEST必须提供 |
| started_at / finished_at / created_at | timestamptz NULL / NULL / now() | 时间不早于创建，finish不早于start；终态缓存必须finish、非终态无finish |

`uq_geo_batches_schedule_window(plan_id,scheduled_for)`与`uq_geo_batches_schedule_identity`（identity非空partial）是同窗口唯一防线，**不包含plan_revision**。计划修改不会使同窗口可再次创建。索引`ix_geo_batches_status_created(status,created_at,id)`、`ix_geo_batches_plan_created(plan_id,created_at,id)`、creator、baseline。CHECK前缀`ck_geo_batches_`：trigger/status/schedule/retest/actor/count/revision/snapshots/time。

### geo_observation_runs

| 列 | 类型/默认 | 合同 |
|---|---|---|
| id / batch_id | UUID | PK；fk_geo_runs_batch → batches RESTRICT，无通用历史级联删除 |
| prompt_variant_id / collection_profile_id | UUID NOT NULL | fk_geo_runs_prompt / profile →配置 RESTRICT；身份不置空、不改写 |
| repeat_index | integer | 1..10 |
| run_cell_key | varchar(64) generated stored | SHA256(规范UUID prompt + ':' + profile + ':' + repeat_index)，与attempt及当前配置revision无关 |
| attempt_no / previous_attempt_id | integer 1 / UUID NULL | attempt1无前序；后续前序必填，fk_geo_runs_previous RESTRICT；连续编号，同batch/cell/原输入 |
| status / revision | varchar(20) PENDING / integer 0 | PENDING/RUNNING/COLLECTED/ANALYZING/NEEDS_REVIEW/COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED；实际UPDATE恰好revision+1，no-op保持 |
| input_snapshot | JSONB NOT NULL | schema_version1；typed prompt/topic、profile/Surface、subjects与alias/domain、规则revision、显式PUBLIC/INTERNAL/RESTRICTED；不含Product事实正文/secret |
| external_call_state | varchar(24) NOT_STARTED | NOT_STARTED/SENT/UNKNOWN/COMPLETED；已发送/未知不恢复NOT_STARTED，COMPLETED不回退 |
| lease_token / lease_expires_at | UUID NULL / timestamptz NULL | 同时有/空；RUNNING/ANALYZING必须持有，其他状态为空；token不暴露公共组件 |
| dispatch_attempt_count / last_dispatch_attempt_at | integer 0 / timestamptz NULL | >=0；0与NULL成对；仅唤醒/诊断，不等于执行attempt |
| error_stage / error_code / error_summary | varchar(24)/varchar(100)/varchar(500) NULL | FAILED/BUDGET_BLOCKED全部非空，其他全部空；stage COLLECTION/ANALYSIS/REVIEW；code为GeoRunErrorCode闭合枚举；summary仅批准静态非敏感说明，不保存异常/响应正文 |
| provider_request_id | varchar(200) NULL | 非空时无首尾空白，非敏感请求标识 |
| duration_ms | bigint NULL | >=0，NULL未知 |
| cost_amount / cost_currency | numeric(14,6) NULL / varchar(8) NULL | 成对有/空，金额有限非负、币种三位大写；未知费用不补0；wire金额十进制字符串 |
| prompt_tokens / completion_tokens / total_tokens | integer NULL | 独立>=0，NULL未知；不猜算provider未报告数据 |
| started_at / collected_at / finished_at / created_at | timestamptz NULL/NULL/NULL/now() | PENDING/CANCELLED/BUDGET_BLOCKED无start；RUNNING及后续成功阶段有start；采集/分析/复核成功阶段有collected；终态有finish；先后关系受CHECK保护 |

`uq_geo_runs_cell_attempt(batch_id,run_cell_key,attempt_no)`；`uq_geo_runs_successor(previous_attempt_id)`非空partial禁止分叉。前序只有FAILED或BUDGET_BLOCKED且error_stage=COLLECTION可追加采集attempt，连续编号、完全相同input与身份；分析失败不重采集。新Run必须PENDING/revision0/NOT_STARTED，无lease、结果或错误；旧失败尝试只读。

索引：`ix_geo_runs_status_created(status,created_at,id)`；`ix_geo_runs_pending_dispatch_due(COALESCE(last_dispatch_attempt_at,created_at),id) WHERE status='PENDING'`；`ix_geo_runs_running_lease(lease_expires_at,id) WHERE status IN ('RUNNING','ANALYZING')`；`ix_geo_runs_batch_status(batch_id,status,id)`；`ix_geo_runs_profile_created(collection_profile_id,created_at,id)`；`ix_geo_runs_prompt(prompt_variant_id)`。CHECK前缀`ck_geo_runs_`：status/repeat/attempt/previous/revision/input/external/lease/dispatch/error/provider/duration/cost/usage/time。

### 不可变、并发与错误边界

- Batch input/identity/requested_count/created元数据、Run identity/input均禁止修改；两表DELETE禁止，默认长期保留。稳定具名23514：`ck_geo_batches_immutable`、`ck_geo_runs_immutable`、`ck_geo_runs_terminal`、`ck_geo_runs_revision`、`ck_geo_runs_external_progress`、`ck_geo_runs_attempt_chain`。
- Run终态COMPLETED/FAILED/CANCELLED/BUDGET_BLOCKED禁止所有实际UPDATE（包括迟到provider结果/费用/lease）；同值UPDATE无副作用。重分析通过未来AnalysisRevision追加，不将终态倒退；未来分析指针的限定发布字段由GEO-501另迁移，不通过301终态守卫例外偷偷放行。
- Run INSERT先锁Batch并对父revision做同值UPDATE建立MVCC冲突；初始roots仅可在PLANNED插入。链父FOR KEY SHARE、唯一单元/后继仲裁；`geo_batch_complete`和`geo_run_batch_complete`为DEFERRABLE INITIALLY DEFERRED，提交时count(attempt_no=1)=requested_run_count。失败整体回滚，RR旧快照写冲突不自动重放。创建完整矩阵、角色/资格/锁存、审计和dispatch由GEO-303接线；消息只能ID。
- Batch缓存允许同批次显式retry后重新投影，原attempt保持终态。重建使用每cell最新attempt；COMPLETED全cell成功、PARTIAL成功与失败/取消/预算混合、FAILED无成功且失败、CANCELLED全取消、BUDGET_BLOCKED无成功且含预算阻断；非终态优先，NEEDS_REVIEW仍未完成。完整纯策略由GEO-302实现；301不提供指标、结果择优或动作。requested是cell数，attempt_count和费用使用全部尝试；不得将attempt当额外指标样本，具体指标公式留GEO-601。
- 23505精确schedule_window/identity对应未来`GEO_SCHEDULE_WINDOW_EXISTS`；successor对应`GEO_RUN_HAS_SUCCESSOR`；cell_attempt是工厂一致性失败，不吞错或自动改号。23514终态/不可变/lease等保留明确失败，未来命令只能按精确SQLSTATE+constraint映射；未知异常原抛。301没有HTTP错误映射实现，不声称已有命令成功。
- JSONB数据库检查保护闭合快照外壳、标量叶子/UUID身份、模式settings、身份对齐；Pydantic完整校验所有typed字段与集合。旁路SQL不能增加配置秘密键；自由业务文本不作为凭据通道。PUBLIC声明本身不授予外发许可，执行边界仍须依据权威分级/授权检查，301无外发。
- Prompt/Profile/Plan/User RESTRICT为最后历史防线；303必须在首次真实工厂创建时接入历史锁存、引用查询、删除动作/精确映射与现有资源锁序。Subject字典保存在完整快照；303设置/维护真实历史删除阻断，301不伪造历史计数。source_opportunity_id未来FK尚未实施，RETEST业务仍不可用。
- downgrade明确55000拒绝删除历史；恢复用前向修复或迁移前备份。本次没有历史数据迁移或生产迁移。

### GEO-302 状态策略与数据库衔接

`geo_run_policy` / `geo_batch_policy` 只接收由权威数据库事实显式转换的不可变状态对象，不查询或写入 ORM。Run 四终态无出边；retry 是同 cell 追加 attempt 的资格，不更新前序；cancel 仅 PENDING/NOT_STARTED/无答案。完整合法边、最新 attempt 的 Batch 投影优先级及动作门禁见 [业务状态机](../docs/geo-monitoring/02-business/03-workflows-and-state-machines.md#31-geo-302-确定性投影)。

Batch 投影要求完整初始矩阵与历史，不接受分页或缓存作为事实，不择优答案。每 cell 最大 attempt_no 决定状态，retry 后 Batch 缓存可再次 QUEUED/RUNNING，原 Run 仍不可变。逐 cell 当前 Profile/资源资格与 actor/真实命令接线能力是动作投影输入，不写入历史快照。

RUNNING 的未发送恢复还要求过期租约及 token 已撤销，不能以 NOT_STARTED 单独判定；后续写入 owner 必须锁内校验 token/期限/状态，撤销旧 lease 并实际 UPDATE revision+1。读时动作不代替该写入校验。现有锁顺序、单后继唯一索引、revision 和 0048 终态/外发进度守卫继续仲裁；本任务不新增事务、幂等存储、锁或数据库守卫，也没有 Alembic revision、数据回填或历史迁移。

## GEO 批次创建合同（GEO-303 / R2）

`0049_geo_batch_creation`（down_revision=`0048_geo_batches_runs`）只增加下列创建关系，不改变0048的历史输入、状态机或旧 GeoObservation。

| 表/字段 | 合同 |
|---|---|
| geo_batch_creation_requests.identity_hash | varchar(64)，pk_geo_batch_creation_requests；SHA256(`geo-batch-manual:` + actor UUID + `:` + 可见ASCII Idempotency-Key)，用户作用域且跨两个创建端点共用；不保存原 key |
| request_hash | varchar(64) NOT NULL；规范化命令来源、计划ID/expected_revision或临时完整配置的JSON摘要；两项哈希受 ck_geo_batch_creation_requests_hashes 保护 |
| batch_id | UUID NOT NULL，fk_geo_batch_creation_requests_batch → Batch RESTRICT；uq_geo_batch_creation_requests_batch；insert guard 只允许 MANUAL |
| geo_batch_subjects.batch_id / subject_id | UUID复合PK；fk_geo_batch_subjects_batch / subject → Batch/Subject RESTRICT；ix_geo_batch_subjects_subject(subject_id,batch_id) |
| role | varchar(16)，PRIMARY/COMPETITOR/REFERENCE；ck_geo_batch_subjects_role |

`geo_creation_request_immutable`、`geo_batch_subject_immutable` 禁止任何 UPDATE/DELETE（ck_geo_creation_immutable）；主体 insert guard 在 Batch 锁内只接受 PLANNED 且与冻结 plan_snapshot 的主体ID/role相符的行（ck_geo_batch_subjects_snapshot）。`geo_batch_subjects_complete` 为新 Batch INSERT 的 deferred constraint trigger，提交时要求主体引用数等于冻结主体集合（ck_geo_batch_subjects_complete）。回填在守卫建立前从既有 plan_snapshot.subjects 建立精确引用；缺失 Subject 明确 FK 失败，事务DDL全部回滚，不跳过历史。

创建服务是事务 owner。锁序：手工 User非键更新锁→创建身份 advisory xact lock→既有 AIChannel/AIModel→Product→品牌→Subject→QueryTopic→Prompt→Surface→Profile→Plan→新Batch→Runs；调度省略User。READ COMMITTED 锁后复核 revision、资格和资源身份；同计划配置更新复用同一协议。创建身份哈希取有符号64位 advisory lock；碰撞最多产生额外等待，真实唯一性仍由持久化身份/窗口裁决。

首次创建冻结完整计划/规则配置、Prompt/Topic、Profile/Surface安全配置及adapter版本、所选主体及活动alias/domain；OWN_PRODUCT名称从当前Product明确转换，不保存事实正文。Prompt/Surface首次引用锁存与 revision+1 在同一创建事务中完成；快照记录锁存后的 revision。GEO-303 输入分类明确为 INTERNAL，不建立外发授权，也不接受客户端分类/快照。费用及用量未知仍为NULL。

同一事务先插入PLANNED/revision0 Batch、主体引用和完整根矩阵（每块250行），最后更新QUEUED/revision1；根Runs保持PENDING/revision0/attempt1/NOT_STARTED。提前执行0048数量与0049主体完整性约束，再提交审计及手工幂等记录；任一阶段失败全部回滚，包括首次引用锁存。矩阵至少覆盖1000 roots，不乘主体数量，不静默缩减阻断资源。

手工幂等在当前用户鉴权后先查已提交记录：同请求返回首次batch_id/requested_run_count/created_at；异请求409 IDEMPOTENCY_CONFLICT；配置修订/停用/归档不影响重放，也不重复成功审计。首次计划请求必填expected_revision，ARCHIVED拒绝；DISABLED/PAUSED/ACTIVE均可在当前资格满足时手工创建，不改变计划状态/revision。调度内部服务只接受ACTIVE CRON计划的新窗口；身份SHA256(`geo-batch-schedule:` + plan UUID + `:` + UTC ISO微秒时间)，不含revision，同窗口重放不检查后续配置。HTTP不能伪造SCHEDULED或RETEST。

主体真实run引用由Batch主体关系连接Runs统计；Profile、Plan、User的删除投影及命令接入真实历史。手工成功审计 geo_observation_batch.created 与业务同事务，只包含plan_id、requested_run_count、trigger_type。系统调度created_by=NULL，不伪造审计用户。无Redis/Collector/派发/分析。唯一冲突仅按精确23505+约束名映射，其他未知数据库失败不吞掉。0049禁止破坏性降级；保留历史并前向修复。

## GEO AnswerSnapshot / Citation 合同（GEO-304 / R2）

`0050_geo_answer_evidence` 紧跟 `0049_geo_batch_creation`，只新增回答证据，不迁移旧文章观测，不提供manual-submit/Collector/分析命令。Accepted ADR-003规定原始URL/位置/采集标题属于证据，分类/Subject/Article匹配属于未来AnalysisRevision，不在原始Citation复制派生事实。Accepted ADR-001要求引用接入文件资格/锁/GC，不采用草案SET NULL/CASCADE。

### geo_answer_snapshots

UUID `id` PK；`run_id` UNIQUE（uq_geo_answers_run）且FK→runs RESTRICT。`prompt_text`=冻结input_snapshot.prompt.prompt_text，`answer_text`保留原文，非空且最多1048576字符；`answer_sha256 varchar(64)` generated stored = geo_answer_sha256(answer_text)，固定UTF8原字节，不trim/Unicode规范化/渲染HTML。`answer_format` TEXT/MARKDOWN/HTML_TEXT（最后者只作为文本，不执行HTML）。source_product(160)/source_model(200)/source_version(200)可空；web_search_observed可空表示unknown。`collected_at`带时区且与Run相同，`created_at`数据库时间。

`raw_payload_summary` JSONB闭合version1：schema_version=1，payload_format=JSON/TEXT/DOM/null，payload_bytes=0..52428800整数/null，finish_reason=STOP/LENGTH/CONTENT_FILTER/OTHER/null；完整四键，禁止扩展/秘密键、字符串数值、自由对象/正文/Header。`citation_count`=规范URL去重后的行数，0..1000，提交时校验精确集合。

`raw_payload_file_id` / `screenshot_file_id` 可空，分别命名FK fk_geo_answers_raw_file / screenshot_file→FileRecord RESTRICT，两者不能相同。截图要求VERIFIED、OPERATION_SCREENSHOT、image/png/jpeg/webp、1..10MiB；raw要求VERIFIED、EVIDENCE、text/plain、1..50MiB（结构化JSON以安全文本存储）。均要求INTERNAL/RESTRICTED、verified_at非空、规范SHA256。实际对象HEAD的size/hash/type必须与FileRecord一致；内部关联函数还验证上传者稳定ID。功能仅提供既有受控文件引用，不新增上传/抓取/脱敏伪成功入口。raw bytes去secret及截图敏感裁剪由后续Collector/人工提交边界负责。

索引ix_geo_answers_raw_file / screenshot_file；CHECK ck_geo_answers_text / format / sources / summary / citation_count / files。UPDATE/DELETE无条件23514 ck_geo_answers_immutable，包括同值UPDATE。文件引用长期保留；专用retention/墓碑由GEO-901定义，GC不能静默清空引用。

### geo_answer_citations

UUID id PK；answer_snapshot_id FK→snapshot RESTRICT；position首次实际引用位置1..1000；occurrences整数数组，非空、唯一升序、第一项=position、全部1..1000。保留首次original_url（text≤2083）、normalized_url（text≤2083）、hostname（varchar253）、title（nullable text≤2000）、extraction_source STRUCTURED/DOM/TEXT/MANUAL、created_at。uq_geo_citations_url(snapshot,normalized_url)、uq_geo_citations_position(snapshot,position)，同回答不同引用不得共享任一occurrence。

URL在应用输入边界使用installed idna/标准库：HTTP(S)，scheme/host小写、IDNA UTS46/STD3、默认端口去除、空path=/、fragment去除；query顺序/值和path保留，没有批准追踪参数清单则不移除。拒绝userinfo、空白/控制字符/反斜线/无效百分号转义，不进行DNS/HTTP。SQL CHECK保护安全规范ASCII authority、scheme和hostname关联；完整URL规范化由唯一输入owner保证。数据库CHECK ck_geo_citations_url / occurrences / source / title；UPDATE/DELETE无条件23514 ck_geo_citations_immutable。

### 原子提交、锁、清理和错误

插入快照先锁Run，再按UUID升序FOR UPDATE锁文件，重新检查资格。允许MANUAL PENDING或自动RUNNING且external_call_state=COMPLETED，不接受终态迟到结果。引用插入锁同Run且只能处于该写入窗口；快照/全部引用/Run采集事实必须同事务。deferred geo_answer_complete / geo_run_answer_complete 检查采集状态存在唯一快照、prompt/时间一致、citation_count和全部occurrences一致；有快照不能回PENDING/RUNNING，采集后的FAILED保留原证据。提交后COLLECTED及后续阶段不允许新增引用。数据库仅验证事实，不替代GEO-302状态策略、lease/授权、GEO-305提交事务或幂等键。

FileRecord被引用后不能修改identity/object_key/category/content_type/size/sha256/access_level/uploader/verified_at/上传创建时间或VERIFIED状态（ck_geo_evidence_file_immutable）；cleanup_after仍可由生命周期owner清空。file_is_referenced计入两项新外键；GC持文件锁检查引用，先提交DELETING再删对象。关联等待文件锁后重验；GC先声明则关联失败，关联先锁则GC跳过/看到引用。REPEATABLE READ旧快照关联通过写文件cleanup_after=NULL产生MVCC冲突，不允许陈旧资格跨过已删对象。无无界重试。

资格/HEAD不符→内部AppError FILE_INTEGRITY_FAILED 422；非上传者→PERMISSION_DENIED 403；存储不可用→DEPENDENCY_UNAVAILABLE 503。数据库具名23514 ck_geo_answers_submission / ck_geo_answers_complete / ck_geo_answers_file_eligible / ck_geo_evidence_file_immutable / ck_geo_citations_submission / ck_geo_citations_complete，重复快照23505 uq_geo_answers_run。只供未来命令精确映射，本次无HTTP接线，未知错误不得吞掉。

迁移先持Run表SHARE ROW EXCLUSIVE锁直至提交，等待旧写事务并阻止预检后新采集穿越；再预检既有collected_at或采集成功状态；无原始证据无法修复时55000原子拒绝，不补空回答。正常0049只含PENDING/失败采集，因此零回填。空库和非空0049前滚/metadata与旧行保留测试；downgrade55000拒绝删证据，恢复使用前向修复或一致备份。没有生产迁移。

## GEO MANUAL 草稿与提交合同（GEO-305 / R2）

`0051_geo_manual_collection` 接续0050，新增人工临时编辑与稳定提交身份，不修改已冻结输入/答案、不回填旧文章观测或既有采集历史。降级55000安全停止，恢复用前向修复。

### geo_manual_drafts

run_id UUID PK/FK→geo_observation_runs RESTRICT；draft_revision正整数；draft JSONB为闭合GeoManualObservationDraft临时编辑内容（有序原始引用、可空白原文、可空采集时间、GEO-304闭合raw summary）；screenshot_file_id/raw_payload_file_id为显式FileRecord RESTRICT FK且与JSON一致；updated_by UUID FK→User RESTRICT；created_at/updated_at timestamptz。文件索引ix_geo_manual_drafts_screenshot_file / raw_file。引用JSON只作编辑内容，不是指标关系。

具名ck_geo_manual_drafts_revision / payload / files，触发器ck_geo_manual_drafts_editable / identity / file_eligible：仅冻结MANUAL PENDING/NOT_STARTED/无答案可INSERT/UPDATE/DELETE；初次revision1、实际内容变化恰好+1、同值不递增；Run/created_at身份不改。关联持Run锁，再Files UUID排序锁，校验VERIFIED、内部访问级别、正确类别/类型/size/hash与当前updated_by上传者；写cleanup_after=NULL建立MVCC冲突。Application Service额外真实HEAD；文件GC实时计入两项FK，解除引用才安排清理。草稿命令允许缺证据，正式提交须至少截图或raw文本证据；冻结require_screenshot=true强制截图。

数据库守卫校验闭合JSON形状、来源首尾空白及原始引用的协议/host存在/userinfo/空白/转义安全外壳。完整URL和IDNA规范化由GEO-304应用输入owner负责，不在SQL新增第二套规范化器。

草稿collected_at非空时只保存 canonical UTC ISO微秒字符串，SQL同时验证格式与真实日期，非法日期不得破坏录入读模型。

### geo_manual_submissions

identity_hash varchar64 PK；request_hash varchar64；run_id UUID UNIQUE/FK→Run RESTRICT；answer_snapshot_id UUID UNIQUE/FK→Answer RESTRICT；submitted_by UUID FK→User RESTRICT；run_revision正整数、draft_revision非负；created_at timestamptz。唯一uq_geo_manual_submissions_run / answer；CHECK ck_geo_manual_submissions_hashes / revisions；用户索引ix_geo_manual_submissions_actor。触发器ck_geo_manual_submissions_complete确认Answer/Run同归属且MANUAL COLLECTED、revision匹配；ck_geo_manual_submissions_immutable禁止UPDATE/DELETE。

身份SHA256(`geo-manual-submit:`+actor UUID+`:`+key)，原key不保存/日志；request_hash覆盖run与规范完整请求（采集时间UTC、引用按实际位置、原文保留）。当前鉴权后先读回执，同请求重放首次结果，异请求409 IDEMPOTENCY_CONFLICT；不同身份不得再次提交同Run。虚拟无草稿revision0，首次保存1，同值无变化；stale409 REVISION_CONFLICT。submit可以包含未保存最终编辑，但必须匹配当前draft_revision。

### 事务、状态与占位

锁序User(FOR NO KEY UPDATE，舍弃认证heartbeat)→identity advisory xact→Surface→Profile→Batch→Run→Draft→Files(UUID)。READ COMMITTED锁后重读；当前资格沿GEO-204，模式/环境/截图策略沿冻结InputSnapshot。仅MANUAL PENDING/NOT_STARTED/无答案可首次保存或提交；非MANUAL409 GEO_MANUAL_MODE_REQUIRED，不可编辑409 INVALID_STATE_TRANSITION。GET录入上下文在认证前RR，当前写开关/配置阻断返回闭合blockers/无动作，不丢草稿。

同事务先删除临时草稿，再写Snapshot/全部Citation、复用GEO-302合法边推进COLLECTED/revision+1、完整集合复用Batch投影、提交身份和最小成功审计，再commit。started_at=人工collected_at，创建≤采集≤锁内数据库时钟；未知来源/模型/搜索保留NULL，费用/usage保持未知。同事务失败全部rollback，已提交证据由0050继续保护，不能追加或修改。

回执保存提交时Run/Draft版本、Answer UUID/哈希/采集时间/提交时间，collection_status=COLLECTED、analysis_dispatch=NOT_IMPLEMENTED；不是当前可变状态。COLLECTED/ANALYSIS_PENDING是后续分析加载稳定run ID的依据；不发送Redis、不增加dispatch计数、不创建分析结果或伪成功。人工上传前负责去除凭据/账号/支付信息，服务不宣称通用脱敏器。

最小保留审计geo_manual_draft.saved / geo_manual_observation.submitted只含run_id、draft_revision、answer_snapshot_id；不含正文/URL/文件内容/key。User历史计入updated_by/submitted_by。文件/HEAD不符422 FILE_INTEGRITY_FAILED、非上传者403 PERMISSION_DENIED、存储不可用503 DEPENDENCY_UNAVAILABLE；空白回答422 GEO_ANSWER_EMPTY、缺证据422 GEO_EVIDENCE_REQUIRED，时间非法422 VALIDATION_ERROR。应用在锁内将已知业务冲突映射上述稳定错误；未知数据库约束或内部失败原样上抛，不扩大全局mapper或伪造成功。


## GEO Batch/Run 读模型合同（GEO-306 / R2）

本任务没有新增表、持久化字段、索引、Alembic revision或历史回填。当前head仍为0051；现有Batch/Run/Answer/Citation/Files唯一业务状态来自PostgreSQL。五个GET在认证之前建立REPEATABLE READ事务、关闭autoflush，Session关闭rollback认证heartbeat；应用查询不commit、不写、不锁、不推进revision。count、分页、冻结输入、当前资格和全部关联属于同一快照，as_of使用事务数据库时钟。

Batch状态与status筛选以完整最新cell attempts为权威，共用GEO-302有序规则；缓存状态不作为读取依据。requested_run_count与状态计数只按最新cell，attempt_count及费用包括全部尝试，未知费用保留unknown_attempt_count，已知金额按currency分组。Run分页默认先去除有后继attempt，再筛选；latest_only=false保留历史。列表稳定created_at+UUID排序、10/20/50分页、带时区半开时间窗口；维度身份、问题与计划名取冻结快照，当前ProfileFacts仅提供当前动作资格，模式/Surface绑定变更明确阻断。

每页Batch只批量读取compact完整attempt事实，不传全部输入/正文；Run页只加载当前页冻结输入。Run详情单请求组装所选attempt证据、batch summary、同cell attempts和真实时间线，禁止浏览器跨接口join。包含认证的非空读取固定SELECT：Batch列表6、Batch详情5、全局Run列表5、批次Run列表6、Run详情9；查询数不随批次、runs、引用数量增长。没有租户新模型，内部ADMIN/ENGINEER共享历史，created_by不是私有ACL。

只读取白名单公共Run列，不加载lease_token；资格批量读取非敏感配置，不加载凭据正文、API请求参数或Header。文件只允许VERIFIED、verified_at非空、INTERNAL/RESTRICTED不可变引用，返回白名单元数据及现有EvidenceStorage限时签名；不返回原始字节、object_key/上传者/文件名，不做外部HEAD/HTTP。GET不重验对象存在性，实际下载沿现有签名校验。缺失历史/证据409 GEO_READ_MODEL_INCOMPLETE、不合格文件409 FILE_INTEGRITY_FAILED、已知签名不可用503 DEPENDENCY_UNAVAILABLE。详情Cache-Control:no-store。data_quality明确NOT_IMPLEMENTED且metric_eligible=NULL，不把当前采集资格等同指标资格，不创建分析/复核/指标/机会/重测数据。


## GEO-405 采集执行写入合同

复用 `0052_geo_profile_tests` head；无新表、列、索引、revision 或历史回填。
创建 commit 后的首次 dispatch 和补投递只更新 PENDING 的 dispatch 计数/时间与 revision，
不改变冻结输入或 execution attempt；入队与 PG metadata 不具备跨服务事务，重复消息由 claim 仲裁。

采集 claim/发送前锁序为 Channel → Model → Surface → Profile → Batch → Run；结果/扫描只用
Batch → Run，不反向获取配置锁。claim PENDING/NOT_STARTED/无答案/无后继，生成 token，
RUNNING.started_at 与 lease 原子提交；provider I/O 无数据库事务。
发送前重验 token/expiry/当前资格及依赖 revision，再写 SENT。
答案 INSERT 前同事务 flush RUNNING/COMPLETED（revision+1），随后答案和 COLLECTED/清空lease
一起提交（再次实际UPDATE revision+1），继续服从 0050 延迟完整性和不可变守卫。
失败装配禁止中间 autoflush，状态/错误/lease/revision 同次UPDATE；错误摘要只允许固定安全文案。
GEO-405 的保守过期失败策略已由下述 GEO-406 按持久化发送事实恢复策略替代。
COLLECTED 保持非终态并投影 Batch RUNNING；分析尚未实施。

GEO-405 当前提交仅正文/基本来源/闭合摘要，citation_count=0；非空引用或文件证据明确
PROVIDER_RESPONSE_INVALID/COMPLETED 失败且不重发，避免提前实现 GEO-407 或静默丢弃证据。

首次/补投递先在短事务预留 dispatch metadata 并 commit，再在事务外发布；预留回滚不发布。
Broker 已接收后丢确认可造成重复入队，但不会重复调用。首次发布遇首个 Broker 错误即停止，
其余预留 PENDING 后续按阈值扫描恢复，避免大矩阵在创建回执中逐项等待离线 Broker。
Profile 资格锁使用 FOR NO KEY UPDATE，继续排斥修改/删除而允许答案提交的 FK KEY SHARE；
同事务两次 Run UPDATE 会触发 FK 重验，FOR UPDATE 会与重复 claim 的 Profile→Batch 形成锁环。
扫描默认使用 PG clock_timestamp；显式 now 仅用于定向测试。Redis socket/connect timeout 为5秒。

## GEO-406 发送事实、崩溃恢复与显式尝试合同

继续复用 `0052_geo_profile_tests` head 和 0048 的外发进度、revision、不可变终态、
同 cell 连续 attempt、`uq_geo_runs_successor` 唯一后继守卫；0050 保证答案与采集成功原子提交。
没有新 Alembic revision、DDL、数据回填或历史重写。

过期恢复只扫描自动 API 的 RUNNING，按 Batch → Run / SKIP LOCKED 锁内重验期限。
NOT_STARTED 且无答案时，先撤销旧 token/expiry，清 started_at，再原子恢复原 attempt 为 PENDING，
实际 UPDATE 的 revision+1。旧 Worker 即使仍存活也不能通过发送前授权。
SENT/UNKNOWN 则写 FAILED/COLLECTION/COLLECTOR_UNKNOWN_OUTCOME 与 UNKNOWN，清 lease；
COMPLETED 不回退，失败使用 WORKER_LOST。所有终态不再写入，迟到成功或失败都被拒绝。
同 attempt 的自动补投递仅允许 PENDING/NOT_STARTED；SENT 在首字节前提交，即使后来 transport
报告 NOT_STARTED，也不能撤销该持久化事实，未知失败按 UNKNOWN 关闭。完整响应或完整结果
已收到后提交失败保留 COMPLETED；进程丢失且没有持久化完整响应仍保守 UNKNOWN。

显式 retry 的 service 复用 User → Channel → Model → Surface → Profile → Batch → Run 锁序，
锁内 expected_revision、无答案/无后继、COLLECTION 失败资格和当前配置资格共同裁决；冻结
Profile revision/绑定/adapter version 不匹配返回 GEO_PROFILE_CHANGED，要求创建新批次。
原 Run 不 UPDATE；仅追加同 Batch/cell、完整 input_snapshot、attempt_no+1 的 PENDING/NOT_STARTED
新 Run。单后继索引裁决竞争，只有 `23505 + uq_geo_runs_successor` 在 INSERT flush 边界映射
GEO_RUN_HAS_SUCCESSOR，其余完整性错误保持显式失败。重复命令不重放成功回执。
Batch 按最新 attempts 重建并清除非终态 finished_at；requested_run_count 不增加。
新 Run、Batch 与 `geo_observation_run.retried` 成功审计同事务提交，审计仅保留 run_id、
previous_attempt_id、attempt_no。commit 后才投递新 Run UUID，Broker 失败由 PENDING 扫描处理。


## GEO-407 采集元数据与 admission 合同

`0053_geo_collection_admission` 为加法迁移（down_revision=0052_geo_profile_tests）。API settings新增可选max_concurrency(1..100，默认1)、requests_per_minute(1..60000，默认60)，旧Profile/快照省略时应用相同默认，不改历史输入。Run新增provider_status(100..599,NULL未知)、retry_after_seconds(bigint>=0,NULL未知；只用于COMPLETED/429/PROVIDER_RATE_LIMITED)，插入初态为空，终态保持全行冻结。

`geo_collection_reservations`：run_id UUID PK/FK→geo_observation_runs RESTRICT；state为RESERVED/SENT/SETTLED/UNKNOWN/RELEASED；estimated_amount numeric(14,6)/estimated_currency varchar(3)成对NULL或有限非负；budget_day UTC date；reserved_at timestamptz；sent_at/settled_at timestamptz NULL。索引budget_day与sent_at。RESERVED为当前RUNNING/NOT_STARTED的预留；SENT为已授权且未结算；SETTLED只取Run实际报告金额；UNKNOWN表示已发送未报告金额（包括完整接收后的失败）；RELEASED仅用于未发送。唯一run_id防重复计费。终止SETTLED/UNKNOWN及DELETE受触发器保护；未发送RELEASED可重新预留同attempt。旧API已发送事实在新账本归集为SENT/SETTLED/UNKNOWN，不修改旧Run/答案，不伪造费用。旧发送时刻未知时sent_at/budget_day使用最晚可能发送上界（finished_at/collected_at，未結则迁移statement_timestamp），用于保守计账/限速，不冒充provider原始精确时刻。API RUNNING或已发送缺账本由Run侧延迟约束拒绝。CHECK强制budget_day等于coalesce(sent_at,reserved_at)的UTC日期；已采集Run的原始费用、usage、provider ID/status、duration和采集时间由独立触发器冻结，后续分析生命周期不能改写采集事实。

业务状态唯一来源PG。短事务取得固定`pg_advisory_xact_lock(407,1)`作为预算/限速串行化点；全局日预算与跨批次/跨profile竞争均受约束。锁序配置Channel→Model→Surface→Profile(NO KEY UPDATE)→accounting→Batch→Run，结果/失败/恢复accounting→Batch→Run，网络无数据库事务。所有账本与Run状态同事务提交；任一异常整体回滚。claim估价来自无I/O Collector.estimate，未知不能补0；有batch/day预算时未知估价、历史未知费用或币种不一致均BUDGET_BLOCKED/BUDGET_EXCEEDED，无答案/调用。Batch限额取冻结budget_limit，币种取唯一明确估价/费用；不换汇。日预算由GEO_DAILY_BUDGET_LIMIT/CURRENCY配置，单租户全局UTC日，在SENT边界重验并移至实际发送日。

额度按全部attempt计算：RESERVED/SENT使用估价，SETTLED使用已报告成本；发送后金额未知继续阻断受限预算。无预算允许未知，费用覆盖仍计unknown。实际成本超过预估不能撤销既有外部调用，记录真实金额并阻断后续。PENDING限速拒绝无业务写入；claim预留并发slot及滚动60秒quota，发送时间计入rate窗口；429保存安全状态/Retry-After并按finished_at+秒冷却同profile，无同attempt自动重试。过期NOT_STARTED释放预留并撤销token；过期SENT/UNKNOWN保留未知账款并终止。显式新attempt不清旧费用。

原始引用使用既有URL规范化、首次元数据与全部occurrences，答案+引用+Run(provider_request_id/duration/独立usage/成对cost)+COLLECTED原子提交。未知token不补算total，未知cost不补0；0050完整性与不可变触发器继续生效。当前文件bytes adapter未接线仍明确失败，无机器分析或业务指标。

迁移须先停新采集并前滚再统一部署Worker。不可安全downgrade；关闭开关安全停止，前向修复或恢复备份。API批准、INTERNAL外发和敏感数据边界保持。

## GEO AnalysisRevision / 子结果 / RunReview 合同（GEO-501 / R4）

0054_geo_analysis_contract 是0053之后的加法迁移。历史 Run 新增可空 current_analysis_revision_id，全部保持 NULL；无答案、引用、费用或历史分析推断/回填。不接入分析算法、Worker、review命令或统计。Accepted ADR-003裁决早期草稿的CASCADE/SET NULL、单事实与可选指针：以下强引用、显式指针及独立执行外壳为精确合同。

### 分析输入与版本

`geo_analysis_revisions`：id UUID PK；run_id FK→geo_observation_runs RESTRICT；answer_snapshot_id FK→geo_answer_snapshots RESTRICT；revision integer>=1；status PENDING/COMPLETED/FAILED；analyzer_type DETERMINISTIC/HYBRID/EXTERNAL_MODEL；analyzer_version varchar100非空；input_snapshot闭合GeoAnalysisInputSnapshot；input_sha256 varchar64 GENERATED STORED；confidence_summary可空闭合GeoAnalysisConfidenceSummary；review_required_reasons为最多20个非空、最多100字符的原因代码（语义由后续分析器合同定义，本任务不从gold局部label推导公共枚举）；error_code仅ANALYSIS_FAILED、error_summary最多500非空字符；created_at/finished_at timestamptz。

- uq_geo_analysis_run_revision(run_id,revision)；uq_geo_analysis_id_run(id,run_id)供复合FK；uq_geo_analysis_success_input(run_id,input_sha256) WHERE status=COMPLETED；ix_geo_analysis_answer。
- 必须从空结果PENDING创建。输入/身份/revision/created_at从创建起不可变；PENDING只可同值锁定或一次终结。COMPLETED/FAILED任何UPDATE（包括同值）和所有DELETE被ck_geo_analysis_immutable拒绝。PENDING无finished_at，终态有finished_at>=created_at；FAILED必须明确错误；其他状态无错误；未成功状态无摘要/原因/子结果。
- 分析只能绑定同Run答案及其实际answer_sha256，并要求采集时间存在。分析对象继承Run冻结的id/type/product/role，可使用更新的别名、域名及对象修订重分析，不能偷偷更换监测对象。
- snapshot v1含answer_sha256、完整subjects（复用GeoRunSubjectSnapshot）、fact_versions[{subject_id,fact_version_id}]和configuration。对象与事实subject均唯一；事实仅OWN_PRODUCT。配置闭合rule_set_version、model_name/model_version/prompt_template_version/prompt_sha256和parameters（temperature 0..2、top_p 0..1、max_output_tokens>=1、seed>=0，可空）。DETERMINISTIC无模型/提示/模型参数；HYBRID/EXTERNAL_MODEL必须完整模型与提示身份。没有headers、URL、凭据、Cookie、prompt正文或任意request JSON槽位。
- 输入摘要由PG geo_analysis_input_sha256唯一生成：完整UTF8编码的jsonb_build_array('geo-analysis-v1',input_snapshot,analyzer_type,analyzer_version)::text的SHA256。对象键以PG jsonb规范文本表示，数组顺序为输入一部分；答案摘要、别名/域名修订、每产品事实UUID、模型/提示/参数/规则都参与。事实正文已冻结且由强FK保留，UUID引用不是删除后仍可复现的替代证据。后续装配者读RETURNING摘要，不维护第二套Python/前端哈希公式。

`geo_analysis_fact_versions`：PK(analysis_revision_id,subject_id)；fact_version_id非空；三列uq_geo_analysis_fact_binding用于claim复合FK。三个FK分别到analysis、subject、FactVersion，均RESTRICT；subject/version索引。只在PENDING装配、无UPDATE/DELETE。绑定时锁定FactVersion并验证同产品、非空正文、APPROVED及输入manifest；延迟约束在提交时要求输入manifest与强关系完全一致，禁止漏绑。事实日后RETIRED不改旧输入或破坏历史，新增分析重新判断当前资格。创建时已有同产品非空APPROVED事实的OWN_PRODUCT必须在manifest中选择一份合格事实，ck_geo_analysis_fact_required拒绝省略；只允许当时没有合格事实的产品不绑定，对应claim只能UNJUDGEABLE且无fact_excerpt。GEO-505 装配者按同产品最高合格 version 选择事实（APPROVED、非空 Markdown）；更高的待审/退役/空白版本不替代较低合格版本。列查询绕开 ORM identity-map，禁止 autoflush，不读取 Product 工作区。每个 OWN_PRODUCT 独立装配，即使回答未提及也不能省略已有合格事实；无合格事实保留空绑定。装配只读且不提交、不创建分析或推进状态；后续 GEO-506 在同一一致读事务内冻结输入与绑定，并由0054写入防线重新裁决资格。

### 不可变子结果

所有子结果有UUID PK、analysis_revision_id/subject_id RESTRICT FK；subject必须在本分析snapshot；只在PENDING插入并与COMPLETED同事务提交，延迟ck_geo_analysis_results_complete拒绝提交半成品或失败结果。任何UPDATE/DELETE包括同值都由ck_geo_analysis_children_immutable拒绝；完成后补插由ck_geo_analysis_children_open拒绝。

| 表 | 字段与约束 | 唯一/索引 |
|---|---|---|
| geo_entity_mentions | mention_count>=1；first_character_offset可空>=0；matched_aliases非空字符串数组，每项<=240；confidence可空numeric(5,4) 0..1 | uq_geo_mentions_analysis_subject；ix_geo_mentions_subject |
| geo_recommendations | recommendation RECOMMENDED/CONSIDERED/NOT_RECOMMENDED/UNKNOWN；rank可空>=1；rationale_excerpt可空非空文本<=2000；confidence同上 | uq_geo_recommendations_analysis_subject；ix_geo_recommendations_subject |
| geo_claim_assessments | claim_kind按方法论IDENTITY/PARAMETER/PACKAGE/TEMPERATURE_GRADE/CERTIFICATION/LIFECYCLE_STATUS/APPLICATION/REPLACEMENT_RELATION/COMPATIBILITY_CONDITION/OTHER；claim_text非空<=2000；claim_sha256由PG完整UTF8生成；verdict ACCURATE/PARTIAL/INCORRECT/UNJUDGEABLE；severity LOW/MEDIUM/HIGH/CRITICAL；fact_version_id可空；fact_excerpt可空<=2000；explanation非空<=2000；confidence同上 | ix_geo_claims_subject_result(subject_id,verdict,severity,id)、analysis、fact索引 |

Claim非空fact_version_id必须经(analysis_revision_id,subject_id,fact_version_id)复合FK指向本分析/产品事实绑定，并直接RESTRICT FactVersion。无事实只能UNJUDGEABLE且fact_excerpt=NULL，不猜测事实。原始Citation仍只存URL与位置，来源分类是派生结果；本任务只冻结Review中的来源修正组件，不提前实现GEO-504机器分类或指标。

### 当前指针与复核选择

Run.current_analysis_revision_id UUID可空；fk_geo_runs_current_analysis(current_analysis_revision_id,id)→analysis(id,run_id) RESTRICT；ix_geo_runs_current_analysis。0054重置geo_guard_observation_run仅添加以下限定发布分支，其余0048身份/外部请求/采集终态守卫保持原语义：

- 创建Run指针必须NULL。发布必须在同事务完成成功analysis之后；只改pointer和Run.revision=old+1，其他字段严格相同，包括status、lease、采集时间、provider结果、费用。终态Run也仅此分支可实际更新，重分析不倒退采集状态。
- target必须本Run COMPLETED且是当时最大成功revision，严格大于旧pointer revision；不可清空、指向PENDING/FAILED、串Run或倒退。较旧晚完成不能覆盖更新成功结果；新失败不改旧pointer。相同指针没有发布副作用。
- current analysis只读显式pointer，不能用created_at、任意max或最新失败替代。成功完成但尚未发布的revision是历史候选，不能被客户端自行选为当前。

`geo_run_reviews`：id UUID PK；run_id RESTRICT FK；(analysis_revision_id,run_id) RESTRICT复合FK；decision CONFIRMED/CORRECTED；correction_payload可空闭合GeoReviewCorrectionPayload；comment<=2000；reviewer_id RESTRICT FK；created_at timestamptz由BEFORE INSERT强制clock_timestamp()，调用者不得回填排序时间。ix_geo_reviews_current(run_id,analysis_revision_id,created_at DESC,id DESC)和reviewer索引。

- INSERT只允许本Run当前COMPLETED analysis；UPDATE/DELETE包括同值全部禁止。CONFIRMED payload=NULL；CORRECTED说明非空，payload v1四个类型化数组mentions/recommendations/claims/citations合计至少一项，各数组目标唯一。
- mention修正可count=0，必须清空offset/aliases；正数保留命中别名。recommendation修正有kind/rank/excerpt；claim修正仅本analysis既有claim的verdict/severity/explanation，不能绕过无事实UNJUDGEABLE；citation修正仅本answer原始citation的source_category和可空本snapshot subject。任何原始/机器数据均不改写。
- 当前有效review唯一规则：WHERE run_id=:run AND analysis_revision_id=Run.current_analysis_revision_id ORDER BY created_at DESC,id DESC LIMIT 1；无pointer或无review返回NULL。新pointer发布后旧review自然只作历史，没有SUPERSEDED字段或第二current review pointer。
- 后续服务必须一致事务/快照读取Run、analysis与最新review；GEO-501仅定义GeoAnalysisSelection组件，不提前实现GEO-507详情查询/API或GEO-508复核策略。

### 事务、并发、错误与保留

事实资格与字典以装配事务可见快照冻结。RR事务快照之后才批准的事实不回写该历史输入：当时无合格事实可保存无绑定的UNJUDGEABLE结果；新的RC装配看到已批准事实后不得继续省略。Run同值写保护revision/pointer/review一致性，不宣称强制刷新RR事实快照。后续事实/字典变更需要新revision；不把历史分析伪装成使用了之后才出现的事实。

写聚合统一Run→Analysis→Fact锁顺序；应用需先锁Run再UPDATE Analysis（UPDATE行锁在BEFORE trigger前取得，不能指望trigger替应用建立顺序）。revision=max+1由持有Run行锁的插入守卫验证；最终unique防线仍保留。分析/子结果/review守卫对Run同值UPDATE建立MVCC写冲突，防RR旧快照在等待后继续提交过期manifest/current判断；业务revision不因同值锁定增长。23505表示具体unique冲突；23514附具体constraint表示冻结/归属/状态/发布拒绝；23503表示强引用；40001/40P01事务显式失败，后续服务只可按命令幂等合同受控重试。本任务没有把任意IntegrityError转成成功或通用业务冲突。

管理员事实删除及FactVersion删除投影计入GEO_ANALYSIS直接绑定，返回既有FACT_VERSION_IN_USE与类型化阻断；reviewer计入既有USER_BUSINESS_HISTORY/USER_IN_USE；Catalog analysis_count按冻结Batch主体关联实际revision，不再固定为零。FK在并发下最终阻止引用删除。所有新FK RESTRICT，不复用content-task永久删除例外。0054 downgrade显式55000安全停止；关闭新分析写入并前向修复，不删除证据。

## GEO-506 Analysis Worker / revision 生命周期（R4）

`0055_geo_analysis_worker`（down_revision=`0054_geo_analysis_contract`）只新增执行元数据和引用分类，
不回填旧 revision、旧引用或 current pointer，不修改0054。旧 revision 没有 job 不代表有新 Worker 结果。

### 表和数据库防线

| 表 | 列与约束 | 索引 |
|---|---|---|
| geo_analysis_jobs | analysis_revision_id UUID PK/FK→analysis RESTRICT；lease_token UUID NULL、lease_expires_at timestamptz NULL 成对；claimed_at timestamptz NULL；last_dispatch_attempt_at timestamptz NULL；dispatch_attempt_count integer>=0 默认0 | ix_geo_analysis_jobs_expiry(lease_expires_at) WHERE lease_token IS NOT NULL；ix_geo_analysis_jobs_dispatch(last_dispatch_attempt_at,analysis_revision_id) |
| geo_citation_classifications | (analysis_revision_id,citation_id) UUID 复合PK；分别RESTRICT→analysis/original citation；source_category varchar32（既有十类GeoSourceCategory）；subject_id UUID NULL/RESTRICT→subject | citation_id、subject_id |

Job 不保存第二套 status，revision.status 是权威。Job 从未派发/未 claim 创建；只有 PENDING 可维护。
dispatch 次数只能+1、时刻单调且不早于 revision；claim 时刻不早于创建，expiry>claimed_at。
每个 revision 只 claim 一次，已分配 token/expiry 不得替换或延长；释放 lease 必须同事务终结 revision。
终态 Job 不可 UPDATE，全部 Job 不可 DELETE。初次 ANALYZING 的 Run 与 Job token/expiry 必须一致。
Run、revision、Job 三侧的 deferred constraint trigger 读取事务最终行：仅修改 Run 的 token/expiry、
或只终结 revision/Run 而留下另一侧活动租约均不能提交；不按同事务的中间 UPDATE 状态误判。

引用分类仅在 PENDING 插入，必须属于该 revision 绑定的原始 Answer；非空 Subject 必须在冻结对象集合内。
UPDATE/DELETE 禁止。分类与 COMPLETED 同次提交；拥有 Job 的成功分析必须覆盖该 Answer 全部原始引用，
无引用允许0条。FAILED/PENDING 不得有 normalized 子结果。原始 Citation URL/位置/标题不修改；
歧义保留空归属与 revision 原因，不凭数量、父级或域名长度猜选。

### 生命周期、输入与原子发布

初次从 COLLECTED 创建/复用 PENDING revision，输入创建使用 REPEATABLE READ，锁 Batch→Run。
Run 冻结对象/角色及 alias/domain 用于首轮；显式重分析可冻结当前字典，但 id/type/product/role 不变。
按稳定 UUID/字典排序冻结输入；最高同产品非空 APPROVED FactVersion 强绑定随创建提交。
PG `geo_analysis_input_sha256` 是唯一 hash owner；锁内同 hash 的 PENDING/COMPLETED 返回原ID，
FAILED 显式重跑可追加 revision；成功唯一索引是最后防线，不把唯一冲突伪装成功。

确定性 analyzer_version=`geo-analysis-v1`，rule_set_version 拼接 geo-mentions-v1、
geo-recommendations-v1、geo-citations-v1、geo-claims-v1；模型/提示/参数全NULL。
当前无第三方来源类别登记，未匹配为UNKNOWN。创建时的批准资格由强绑定证明；执行仍使用同一不可变
事实正文/分类，即使版本之后RETIRED也不重新选择或把历史依据替换成最新工作区。

claim/提交锁 Batch→Run→Analysis→Job（既有Fact绑定触发器在末端锁Fact）；claim 分配唯一300秒lease。
首次 Run COLLECTED→ANALYZING 镜像该lease；终态/NEEDS_REVIEW 的重分析仅使用Joblease。
事务外本地计算四阶段。提交以PG clock_timestamp 重验PENDING/token/expiry，插入并flush全部结果，
释放Joblease、COMPLETED revision，先独立UPDATE首次Run状态/lease，再pointer-only UPDATE，最后刷新Batch；
这些步骤同事务commit。无原因→COMPLETED，有原因→NEEDS_REVIEW，保存四阶段去重排序原因和未知confidence=NULL。
新成功只有当它是最新成功版本才发布，晚完成较旧版本保留历史而不倒退current。

任何计算/结果写入/提交失败先回滚结果事务，再以有效token记录FAILED/ANALYSIS_FAILED固定安全摘要；
首轮Run为FAILED/ANALYSIS，答案及引用保留；重分析失败不改Run历史/旧pointer。过期扫描同一路径终结，
提交端在扫描前也拒绝expired/token不符；没有同revision自动重claim或无限自动复跑。
若失败记录本身遭遇数据库异常，明确抛出安全错误并保留未终结lease，恢复后的过期扫描再终结；
日志只记录ID和两个异常类型，不把原始错误/SQL参数串入Worker traceback，也不宣称FAILED已提交。
40001/40P01显式事务失败；扫描下一轮新事务读取，不能吞异常伪造revision或改用不一致事实。

### 派发、权限和恢复

collection任务commit后仅实际COLLECTED发送Run UUID。数据库扫描覆盖MANUAL和采集提交后崩溃，
创建revision后发送revision UUID；消息不带答案、facts、配置或凭据。派发短事务先提交时间/次数，
之后发布Broker；确认丢失允许重复消息，claim保证幂等。SKIPPED与Broker不可用分开，后者停止该轮发布。
扫描大小/周期/节流复用既有GEO recovery参数，总开关关闭不新claim/派发，仍允许过期安全终结。

内部`reanalyze_run`先锁最新User（NO KEY UPDATE）验证active、改密门禁、ADMIN，再锁Batch/Run并校验
expected_revision与已结束首次分析/保有Answer。新输入追加；同hash复用，不改采集终态。成功接受记录
`geo_observation_run.reanalyzed`审计，仅run_id、analysis_revision_id、闭合reason_code：
RULES_UPDATED/DICTIONARY_UPDATED/FACTS_UPDATED/RETRY_FAILED；不保存自由文本/答案/事实。
创建和审计同事务，commit后派发故障不撤销已接受ID，由PENDING扫描恢复。GEO-507接入公共命令/读取。

0055先迁移再部署新Worker/beat；本地只验证隔离数据库，不操作生产。downgrade显式55000安全停止，
停新Worker/beat、保留表和历史并前向修复；无破坏性数据迁移。

## GEO-507 人工复核命令与当前结果（R4）

`0056_geo_run_review` 只扩展 Run 的受控复核发布分支，不增加表/列，不回填、不改变旧 Answer、Analysis、Review 或 current pointer；旧迁移保持冻结。Review 数据结构及不可变/归属约束仍由0054拥有。

Application Service 使用 READ COMMITTED、User→Batch→Run→Analysis 锁序，锁后重新验证当前启用账号、改密门禁、ADMIN/ENGINEER、当前成功 analysis、expected_run_revision 和 correction scope。若 analysis 不是 current，409 GEO_REVIEW_STALE_ANALYSIS；Run revision 不同，409 REVISION_CONFLICT；无当前成功分析，409 GEO_ANALYSIS_NOT_AVAILABLE。命令仅处理已结束首轮且有答案的 NEEDS_REVIEW/COMPLETED/FAILED；失败采集历史不能靠复核变成成功。

每次成功追加 Review、Run.revision+1、受控审计同一事务。首次 NEEDS_REVIEW→COMPLETED 仅额外设置 finished_at，并重建 Batch；已完成或首次分析失败后重分析的 Run 保持采集 status/时间/费用/外部请求/证据。0056 guard 要求存在本事务新增的本 Run/current analysis Review（xmin=pg_current_xact_id()::xid）；旧 Review 不能授权新的终态 revision 更新，也不能夹带采集字段。无 Idempotency-Key 或自动重放；同 Run revision 并发命令最多一个成功。旧直接 SQL Review 数据装配仍按0054保存，不推测历史 Run 生命周期。

CONFIRMED 无修正；CORRECTED 有说明及至少一项闭合四栏修正。Subject 必须在本 analysis snapshot；Claim 必须属于本 analysis、无事实仍只能 UNJUDGEABLE；Citation 必须属于本 answer，Subject 可清空。原始回答、引用、机器子结果与旧复核不更新。只映射已登记精确23514/constraint：current_analysis→GEO_REVIEW_STALE_ANALYSIS，correction_scope/decision/comment→VALIDATION_ERROR；其他错误原样失败并回滚，既有安全错误边界不泄露SQL/正文。

读取在原 Run Detail 的同一 REPEATABLE READ 快照中装配机器结果、所有 revision/review 历史、current selection 和有效结果。唯一 review 选择仍是 current pointer 内 created_at DESC,id DESC。最新 Review 是整体替换：CONFIRMED 使用机器结果，CORRECTED 只叠加该记录的明确字段；不累计旧修正。机器结果始终独立返回。没有可核验的旧引用分类时返回实际空集合及 completeness=false，不把未知填成已完成。

当前 analysis 有 review_required_reasons 且无当前 Review 时，review_required=true、review_gate_passed=false、metric_eligible=false/GEO_REVIEW_REQUIRED；通过门禁不宣称完整指标资格，metric_eligible仍null/METRIC_ELIGIBILITY_NOT_IMPLEMENTED。列表needs_review按相同 current analysis与Review存在性筛选，不按终态采集status推断。新成功pointer使旧review自然只作历史；失败不影响既有选择。GEO-601继续拥有全部MetricEligibility/公式。

审计 action=`geo_observation_run.reviewed`，仅run_id、analysis_revision_id、review_id和decision，不保存comment/correction/答案/事实。0056先迁移再部署新API；downgrade显式55000安全停止，关闭复核写入口、保留历史并前向修复，不操作生产数据。


## GEO-602 Overview 只读合同（R5）

无新表、列、索引、约束、Alembic revision或回填；当前head仍0056，指标不另存权威状态。Overview和组成样本API在认证之前建立REPEATABLE READ、禁autoflush，关闭Session回滚身份heartbeat；无commit、DML、行锁、revision推进、状态命令、审计写入或外部调用。

每个请求固定12次应用SELECT：数据库事务时钟、latest Run列、Answer、原始Citation、显式current Analysis、Mention/Recommendation/Claim/CitationClassification四批、current Analysis内DISTINCT ON latest Review(created_at DESC,id DESC)、引用FileRecord状态、Batch创建时间。加身份查询当前实际共13次SQL，空集也执行同样批量查询。读取Run不包含lease或渠道凭据，分析历史不择优，Review不累计历史修正。

候选使用Run.created_at的半开窗口与全表successor存在性排除旧attempt；完整过滤定义及两个用户质量口径裁决见方法文档§19。批量读取冻结输入，不按当前Catalog或Product反推历史分母。所有区块和组成样本共享筛选/转换/601公式；业务按完整维度和scope分栏，quality允许明确操作统计。当前成功指针/答案不匹配、缺父Batch等不完整历史使用既有409 GEO_READ_MODEL_INCOMPLETE，不吞错或回退。

组成样本为实时RR重算，返回每Run的事件贡献与analysis/review身份，适用时通过既有Run Detail查看原始证据。不同请求as_of可不同，cell已消失明确404；不引入持久化filter token、报告快照或跨请求事务。原始答案、分析、Review、事实和文件历史仍由既有不可变防线保护。文件状态完整性仅涉及PG元数据，不声称OSS下载可用，不在GET调用HEAD。
