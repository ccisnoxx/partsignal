# 数据库开发规范

## 概览

PostgreSQL 是业务状态唯一来源，Alembic 是唯一迁移入口。历史迁移必须冻结执行时的 Schema 契约，不得通过修改 `migration_schema_v1.py` 或运行时 ORM 模型追赶旧 revision。

## 场景：一次性用户数据迁移与初始化账号

### 1. 范围与触发条件

- 适用于按已确认身份清理历史初始化数据、同时必须保留业务归属和审计历史的迁移。
- 账号日常生命周期仍使用启用和停用；一次性迁移不得演变为通用删除 API 或管理界面删除入口。

### 2. 签名

- 数据库 revision：`0010_user_cleanup`，`down_revision = "0009_config_center"`。
- 初始化函数：`seed_demo(admin_password: str, engineer_password: str) -> None`。
- CLI：`python -m app.cli seed-demo --password <admin> --engineer-password <engineer>`。

### 3. 契约

- `PARTSIGNAL_SEED_ADMIN_PASSWORD` 与 `PARTSIGNAL_SEED_ENGINEER_PASSWORD` 均为必需且相互独立，最少 12 个字符。
- 初始化只补充不存在的 `admin` 和 `content_editor`，不得覆盖既有密码、账号类型、启停状态、姓名或其他资料。
- 数据清理必须先锁定目标 `users` 行，再显式预检迁移时点全部非会话用户外键；引用清单写入迁移文件，不能运行时猜测未来 Schema。
- `sessions` 可随已确认的目标账号删除；业务表和审计表不得级联删除、清空演员或迁移归属。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 任一初始密码短于 12 字符 | 初始化事务开始前抛出明确的中文 `ValueError` |
| 缺少任一 CLI 密码或环境变量 | 输出对应变量名并以状态码 `2` 退出 |
| 目标旧账号存在业务或审计引用 | 汇总“用户名 -> 表.列”并使整个 Alembic revision 回滚 |
| 目标旧账号不存在 | 视为已清理，不创建兼容账号 |
| `content_editor` 已存在 | 迁移只设置 `must_change_password=true` 并增加 `revision`，初始化不再覆盖状态 |
| revision 降级 | 明确失败，要求恢复迁移前 PostgreSQL 备份 |

### 5. 正常、基础与失败案例

- 正常：旧六账号均无业务引用，迁移删除四个冻结用户名及其会话，只保留 `admin` 和 `content_editor`。
- 基础：空库先迁移再初始化，创建 `ADMIN` 管理员和必须改密的 `ENGINEER`；重复运行保持两个账号不变。
- 失败：一个目标账号存在 `RESTRICT` 引用或 `audit_logs.actor_id` 引用，四个目标账号、会话和 `content_editor` 状态全部保持迁移前值。

### 6. 必需测试

- PostgreSQL 集成测试验证空库迁移、独立密码、初始化幂等和旧权限表移除。
- 从旧角色 Schema 构造六账号及会话，验证准确清理集合、密码哈希保留和 `revision` 变化。
- 同时构造业务与审计引用，断言失败输出包含全部引用位置，`alembic_version` 未前进且无部分删除。
- E2E 验证自助改密、其他会话撤销、自身管理重置被拒绝，以及审计响应不包含任何密码。

### 7. 错误与正确示例

错误做法：直接删除用户并依赖首个外键错误，或把历史归属转移给管理员。这会产生不完整诊断，甚至破坏历史责任链。

正确做法：在同一事务中锁定全部目标用户，按冻结引用清单收集所有阻断位置；只有预检结果为空时才删除会话和用户，任何异常由 Alembic 事务整体回滚。

## 场景：生成作业补投递与租约恢复

- 数据库 revision：`0011_generation_reliability`，`down_revision = "0010_user_cleanup"`。
- `generation_jobs.status` 是执行权威；Redis 消息、投递次数和时间只负责唤醒与诊断，不能形成第二状态机。
- 超龄 `PENDING` 扫描必须使用有限批次与 `FOR UPDATE SKIP LOCKED`；只有原子声明为 `RUNNING` 的 Worker 可以发起供应商调用。
- 租约取不可变快照中的供应商超时再加正数收尾裕量。过期 `RUNNING` 只能显式失败，自动补投递不得覆盖到该状态。
- 迁移只增加可向后读取的列、检查约束和部分索引；历史迁移与 `migration_schema_v1.py` 保持冻结。
- PostgreSQL 集成测试必须覆盖多恢复器、重复消息、租约竞态、迟到响应和迁移前后旧列读取，不能用 SQLite 替代行锁语义。

## 场景：第三方模型数据分级

- 数据库 revision：`0012_ai_data_classification`，`down_revision = "0011_generation_reliability"`。
- `content_tasks` 的分级、分类人和分类时间必须全空或全有；历史任务保持全空，不得迁移猜测为 `PUBLIC`。
- Prompt 与整份生成输入分级在同一个任务修订事务中更新，PostgreSQL 是当前分类唯一来源。
- 第三方作业快照冻结分类结论和事实 Evidence 分级；Redis 不保存或推断分类。
- 降级只移除分级元数据。回滚到不识别 0012 的应用前必须先停用全部 AI 渠道，避免旧应用绕过新门禁。

## 场景：发布闭环历史门禁与异常状态

- 数据库 revision：`0013_publication_closure`，`down_revision = "0012_ai_data_classification"`。
- `COMPLETED` 表示任务曾完成发布闭环。完整性门禁必须读取追加式 `publication_status_events` 中的 `VERIFIED` 事实，不能只看发布记录当前状态；后来 `REMOVED` 或 `VERIFICATION_FAILED` 不得把合法完成历史误报为脏数据。
- 跨平台错绑只在尚未进入 `REJECTED`、`REMOVED` 或 `VERIFICATION_FAILED` 时阻断。已显式终态处置的旧记录继续保留，不通过改绑、删除或隐藏 allowlist 清理历史。
- 新发布的平台等值由应用服务给出业务错误，并由 PostgreSQL 插入触发器最终保护。测试必须同时覆盖 API 与直接数据库写入。
- `PublicationAttention` 只能以 revision 0 的 `OPEN` 初态插入，绑定与打开时间不可变，历史不可删除；唯一允许的状态变化是带非空说明和单次 revision 递增的 `OPEN -> RESOLVED`。
- 修复任务来源字段一旦写入不可改绑。异常或修复来源产生后，迁移只允许前滚，downgrade 不得删除业务历史。

## 场景：平台级 Prompt 与受约束物理删除

### 1. 范围与触发条件

- 修改平台 Prompt 所有权、平台可用性、产品或平台配置删除时适用。
- 当前配置可以物理删除；不可变事实、任务、内容、发布和观测历史不得级联、改绑或自动清理。

### 2. 签名

- 数据库 revision：`0014_platform_prompt_ownership`，`down_revision = "0013_publication_closure"`。
- Prompt 主键：`platform_prompts.platform_profile_id -> platform_profiles.id ON DELETE CASCADE`。
- 删除接口：`DELETE /products/{id}`、`/platform-profile-versions/{id}`、`/platform-profiles/{id}`、`/platform-accounts/{id}`、`/platform-types/{id}`。

### 3. 契约

- 一个具体平台拥有零或一个当前 Prompt；类型级 Prompt 字段、接口、双读和默认值全部禁止。
- 平台可没有 `ACTIVE` 规则。管理员仍可配置；工程师只有在 `ACTIVE` 规则和当前 Prompt 同时存在时才能创建任务。
- 删除服务在同一事务锁定目标并统计直接引用。冲突响应使用 `details.references[{type,count}]`，只报告真实直接引用。

### 4. 校验与错误矩阵

| 删除对象 | 直接阻断引用 | 成功结果 |
|---|---|---|
| `Product` | `FactVersion`、`ContentTask`、`GeoObservation` | 删除产品和当前事实工作区 |
| `PlatformProfileVersion` | `ContentTask` | 删除版本；若为 `ACTIVE`，平台进入无有效规则状态 |
| `PlatformProfile` | 规则版本、平台账号 | 删除平台及其当前 Prompt |
| `PlatformAccount` | `PublicationRecord` | 删除公开账号标识 |
| `PlatformType` | 具体平台 | 删除分类 |

### 5. 正常、基础与失败案例

- 正常：删除未引用的 `ACTIVE` 规则后，平台保留，`active_version=null`，工程师不可选。
- 基础：管理员为该平台激活新版本且当前 Prompt 存在后，平台重新进入可选集合。
- 失败：任一直接引用存在时返回结构化 `409`，所有目标和历史记录保持不变。

### 6. 必需测试

- PostgreSQL 迁移测试覆盖类型 Prompt 一对多复制、孤立 Prompt 丢弃、平台主键唯一约束和不可降级策略。
- API 集成测试覆盖每类直接引用、管理员权限、无引用成功删除，以及删除 `ACTIVE` 规则后的可用性变化。
- E2E 验证冲突引用中文展示、Prompt 缺失/无有效规则禁选和重新激活后的恢复。

### 7. 错误与正确示例

错误做法：捕获首个外键异常、级联删除历史，或删除 `ACTIVE` 版本后自动挑选旧版本。

正确做法：锁定目标，显式统计权威引用并返回稳定类型；只有引用为空才删除当前配置，平台可用性由当前 `ACTIVE` 规则与 Prompt 共同推导。

## 场景：平台规则草稿编辑与事实版本受限物理删除

### 1. 范围与触发条件

- 平台身份与平台规则必须独立管理：创建平台不隐式创建规则，规则版本继续由 `PlatformProfileVersion` 单一模型承载。
- 管理员编辑 `DRAFT` 规则、替换平台当前规则，或物理删除任意状态的事实版本时适用。
- 已被内容任务或内容版本引用的事实版本仍是历史依赖，不得删除；审核记录只允许作为被删除事实版本的严格从属记录在同一事务清理。

### 2. 签名

- 数据库 revision：`0015_platform_rule_draft_editing`，`down_revision = "0014_platform_prompt_ownership"`；`0016_fact_review_cleanup`，`down_revision = "0015_platform_rule_draft_editing"`。
- 平台规则接口：`GET /platform-profile-versions`、`PATCH /platform-profile-versions/{id}`、`POST /platform-profile-versions/{id}/activate`。
- 草稿更新体：`{expected_revision: integer >= 0, rules: PlatformRules}`；返回体必须含 `platform_profile_id`。
- 事实版本删除接口：`DELETE /fact-versions/{id}`，仅管理员可调用，成功返回 `204`。
- 事务门禁：`set_config('partsignal.fact_version_delete_id', <fact_version_id>, true)`；第三个参数必须为 `true`，确保值只在当前事务有效。

### 3. 契约

- `platform_profile_versions.rules` 只允许在更新前后状态均为 `DRAFT` 时修改；`ACTIVE`、`RETIRED` 正文不可变，`platform_profile_id`、`version`、`created_at` 在所有状态不可变。
- 草稿更新使用 `expected_revision` 乐观锁并只递增一次 revision。激活时必须锁定平台，先把旧 `ACTIVE` 更新并刷新为 `RETIRED`，释放部分唯一索引槽位后再把目标 `DRAFT` 设为 `ACTIVE`；任一步失败时整个事务回滚。
- 删除事实版本前必须锁定目标，分别统计 `ContentTask.fact_version_id` 与 `ContentVersion.fact_version_id`。任一计数非零时返回 `FACT_VERSION_IN_USE`，不得清理任何审核记录。
- 引用为空时，先写 `fact_version.deleted` 审计（含产品、版本、状态和审核记录数量），再以事务本地父版本 ID 放行并显式删除该父版本的 `FactReviewRecord`，最后删除 `FactVersion`。
- `fact_review_records` 的 `UPDATE` 始终拒绝；`DELETE` 只有在事务本地 ID 与该行 `fact_version_id` 精确相等时允许。不得放宽通用追加式触发器、增加级联删除或自动删除产品。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 创建平台但未创建规则 | 创建成功，规则列表为空且 `active_version=null` |
| 更新目标不是 `DRAFT` | `409 INVALID_STATE_TRANSITION`，正文和 revision 不变 |
| `expected_revision` 过期 | `409 REVISION_CONFLICT`，正文和 revision 不变 |
| 用新草稿替换已有 `ACTIVE` | 旧版本先变为 `RETIRED`，新版本成为唯一 `ACTIVE` |
| 非管理员删除事实版本 | `403`，事实版本、审核记录和审计均不变 |
| 事实版本不存在 | `404` |
| 存在内容任务或内容版本引用 | `409 FACT_VERSION_IN_USE`，`details.references` 只含真实非零引用 |
| 无内容引用，事实版本处于任意状态 | 删除事实版本及其从属审核记录，保留安全审计 |
| 直接更新审核记录，或未设置/设置错误的事务本地 ID 后删除 | PostgreSQL `55000` 拒绝 |

### 5. 正常、基础与失败案例

- 正常：管理员创建平台后另建草稿，多次按 revision 编辑，再激活为平台当前规则；旧 `ACTIVE` 原子退役。
- 基础：事实版本没有内容引用但有多条审核记录，管理员删除后父版本与这些从属记录消失，产品和审计保留。
- 失败：事实版本同时被内容任务和内容版本引用，响应分别给出两个非零计数，数据库没有部分删除。

### 6. 必需测试

- PostgreSQL 迁移测试验证 `0015` 只放开 `DRAFT -> DRAFT` 正文更新，`ACTIVE`/`RETIRED` 与身份字段仍受触发器保护，downgrade 恢复旧门禁。
- PostgreSQL 迁移测试验证 `0016` 在无设置、错误父 ID 和 `UPDATE` 时拒绝，在正确事务本地父 ID 时只删除对应审核记录，downgrade 恢复通用追加式门禁。
- API 集成测试覆盖平台空规则初态、revision 冲突、不可变状态、已有 `ACTIVE` 的原子替换，以及事实版本全部业务状态、双引用冲突、管理员权限、审核清理和审计字段。
- E2E 验证独立平台规则页面的草稿编辑与当前规则选择，以及事实版本冲突提示和管理员删除入口。

### 7. 错误与正确示例

错误做法：在同一次 ORM flush 中同时提交“新版本激活、旧版本退役”，依赖未承诺的 UPDATE 顺序；或为删除事实版本而全局放开 `fact_review_records` 删除。

正确做法：

```python
current.status = "RETIRED"
db.flush()  # 先释放唯一 ACTIVE 槽位
draft.status = "ACTIVE"

db.scalar(select(func.set_config("partsignal.fact_version_delete_id", str(version.id), True)))
db.execute(delete(FactReviewRecord).where(FactReviewRecord.fact_version_id == version.id))
db.delete(version)
```

两组操作都必须位于各自的单一数据库事务内；刷新只固定约束检查顺序，不提前提交。

### 8. 自然化单例配置与活动作业

- `content_humanization_prompts` 只允许 `id=1`，迁移后保持空表，`updated_by` 必须引用真实管理员。历史作业自己冻结 Prompt，因此不得增加 Prompt 历史表或第二来源。
- `generation_jobs.job_type` 只允许 `GENERATE | HUMANIZE`；前者的 `source_content_version_id` 必须为空，后者必须非空并 `RESTRICT` 引用源版本。
- 同一源版本只允许一个 `PENDING | RUNNING` 自然化作业，使用 PostgreSQL 部分唯一索引处理并发竞态；服务端校验用于返回稳定业务错误，不替代数据库约束。
- 自然化成功只新增 `ContentVersion(source_type=AI, source_job_id=job.id, based_on_id=source.id)`，禁止更新源版本。存在任一 `HUMANIZE` 历史后，0017 downgrade 必须在删除任何结构前失败。

## 场景：产品级人工 GEO 文章观测

### 1. 范围与触发条件

- 新建、读取或更正 GEO 人工搜索记录，以及修改产品文章候选或推荐率统计时适用。
- 用户在外部搜索网站人工核对结果；本系统只保存可复核证据，不调用模型、搜索供应商或截图解析服务。

### 2. 签名

- 数据库 revision：`0018_manual_geo_observation`，`down_revision = "0017_content_humanization"`。
- 候选接口：`GET /api/v1/geo-observation-publications?product_id=<uuid>`。
- 创建接口：`POST /api/v1/geo-observations`，接收 `product_id`、`search_platform`、`search_query`、`tested_at`、`article_results[]`、`attachment_file_ids[]`、可选 `notes/supersedes_id`。
- 明细结果：`geo_observation_publications.recommendation_status`，仅允许 `RECOMMENDED | NOT_RECOMMENDED`。

### 3. 契约

- `PublicationRecord` 是公开文章的唯一身份，标题、平台、`final_url` 和状态均由发布链投影；GEO 不复制文章或链接字段。
- 一次人工观测必须覆盖该产品在提交事务中全部 `PUBLISHED | VERIFIED` 且 `final_url` 非空的发布记录；服务端锁定候选后比较精确 ID 集合。
- 每篇候选只能有一个二态结果。至少关联一个已验证的 `OPERATION_SCREENSHOT`，附件不能重复。
- `LEGACY_MODEL_RESULT` 继续保存旧目标问题、模型结果和引用；其文章关联状态保持 `NULL`，不得从旧观测级结论推断逐篇结果。
- `MANUAL_ARTICLE_SEARCH` 的旧模型字段必须全空；更正只能追加同产品、同类型且尚无后继的完整新记录。
- 人工文章指标只统计没有后继更正的人工观测，并由明细实时派生；无明细时推荐率为 `NULL`。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 产品不存在 | `404 PRODUCT_NOT_FOUND` |
| 请求文章集合与当前候选不完全相等 | `409 GEO_PUBLICATIONS_CHANGED`，不得部分写入 |
| 文章跨产品、状态不可观测或缺少 `final_url` | 服务端拒绝；数据库触发器最终拒绝直接写入 |
| 结果重复、不是二态值或结果为空 | 请求校验失败 |
| 截图为空、重复、未验证或类别不是 `OPERATION_SCREENSHOT` | 请求校验或服务端校验失败 |
| 更正来源不是同产品人工观测，或已有后继 | `409`，来源历史保持不变 |
| 存在任一人工观测后降级 | revision 在删除新语义前失败，要求前滚或恢复备份 |

### 5. 正常、基础与失败案例

- 正常：产品有两篇已发布文章，人工在 DeepSeek 搜索后逐篇标记一篇已推荐、一篇未推荐，并关联真实结果截图，事务一次追加全部明细。
- 基础：历史模型观测迁移后只增加 `LEGACY_MODEL_RESULT` 判别值，旧字段、引用和发布关联保持原义。
- 失败：用户填写期间新增一篇符合条件的发布记录，提交集合已过期，返回 `GEO_PUBLICATIONS_CHANGED`，不自动补成“未推荐”。

### 6. 必需测试

- PostgreSQL 迁移测试验证空库升级到 head、历史观测判别值、类型字段约束、文章归属触发器和存在人工历史后的不可降级策略。
- 集成测试至少用两篇当前文章断言完整集合成功、漏标失败、截图类别门禁、逐篇状态落库，以及推荐数加未推荐数等于文章结果数。
- 契约测试验证 OpenAPI、Pydantic 与前端生成类型一致；前端测试验证产品选择后再请求候选，且新载荷不含旧模型联网字段。
- E2E 验证人工观测主流程与历史模型观测只读展示；不得把固定成功的搜索或模型替身作为人工结果证据。

### 7. 错误与正确示例

错误做法：信任前端只提交命中的文章，或按提交时缺少的 ID 自动补“未推荐”。这会把遗漏和并发变化伪装成真实搜索结论。

正确做法：在同一事务锁定产品及权威候选，精确比较集合后再追加明细：

```python
candidate_ids = {publication.id for publication in locked_candidates}
submitted_ids = {result.publication_record_id for result in request.article_results}
if submitted_ids != candidate_ids:
    raise ConflictError("GEO_PUBLICATIONS_CHANGED")
```

文章 URL 始终从 `PublicationRecord.final_url` 读取，前端不得提交或覆盖该值。

## 场景：产品驱动内容任务与历史目标问题关联

### 1. 范围与触发条件

- 新建内容任务、创建生成作业、读取发布修复上下文或从发布异常创建修复任务时适用。
- `QueryTopic` 只服务旧内容任务和 `LEGACY_MODEL_RESULT` 观测；不得重新成为普通内容任务的创建前置条件。

### 2. 签名

- 数据库 revision：`0019_product_driven_tasks`，`down_revision = "0018_manual_geo_observation"`。
- 数据库列：`content_tasks.query_topic_id uuid NULL REFERENCES query_topics(id) ON DELETE RESTRICT`。
- 创建接口：`POST /api/v1/content-tasks`；`ContentTaskCreate` 不接受 `query_topic_id`。
- 内容任务响应：`ContentTask.query_topic_id: uuid | null`，用于显式区分新任务和历史任务。
- 修复上下文响应：`PublicationRepairContext.query_topic: QueryTopic | null`。

### 3. 契约

- 新任务由产品、该产品的 `APPROVED` 事实版本、具体平台的 `ACTIVE` 规则版本、平台当前 Prompt 和任务要求字段共同定义；服务端必须写入 `query_topic_id=NULL`。
- 生成新任务时，`GenerationSnapshot.task_requirements` 必须完全省略 `query_topic`，不得写入 `null`、空对象或根据产品名猜测问题；确定性开发生成器以 `content_angle` 生成摘要，标签只含产品型号。
- 历史任务保留真实非空外键。创建新生成作业时仍解析并冻结该目标问题；外键值存在但目标记录缺失时必须显式失败。
- 修复任务固定继承原任务的产品和可空 `query_topic_id`。修复上下文只在历史关联存在时返回问题投影，新任务返回 `query_topic=null`。
- 0019 upgrade 只放宽列空值，不改写历史任务；存在任一空关联任务时 downgrade 必须在恢复 `NOT NULL` 前以 PostgreSQL `55000` 失败并整体回滚。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 创建载荷包含 `query_topic_id` | OpenAPI/Pydantic 额外字段校验拒绝，不提供兼容双写 |
| 产品、事实版本或平台规则版本不存在 | 返回对应 `404`，不创建任务 |
| 事实版本不属于产品、未批准，或平台规则不是当前可用规则 | `409 INVALID_STATE_TRANSITION` |
| 平台缺少当前 Prompt | `409 PLATFORM_PROMPT_MISSING` |
| 新任务创建成功 | `query_topic_id=null`，生成快照省略 `query_topic` |
| 历史任务外键非空但目标问题缺失 | 生成或修复上下文显式失败，不降级为新任务语义 |
| 新任务历史存在时执行 0019 downgrade | PostgreSQL `55000`，revision 和全部任务数据保持不变 |

### 5. 正常、基础与失败案例

- 正常：工程师选择一个产品、批准事实和可用平台创建任务；请求和后续生成输入均没有目标问题，文章围绕 `content_angle` 生产。
- 基础：升级前任务继续返回原 `query_topic_id`，重新生成和修复时继续冻结、继承该真实问题。
- 失败：为了满足旧 `NOT NULL` 约束给新任务伪造通用问题，或生成时用产品名自动补一个问题；这会制造不存在的业务事实并污染分析。

### 6. 必需测试

- 契约测试断言 `ContentTaskCreate` 没有 `query_topic_id`，任务响应字段可空，修复上下文问题投影可空，生成类型与 OpenAPI 一致。
- PostgreSQL 迁移测试断言历史 UUID 不变、新任务可写 `NULL`，以及有损 downgrade 失败后 revision 和两类任务均不变。
- 后端单元/集成测试断言新生成快照不含 `query_topic`、开发生成器不输出“目标问题”、普通任务写空关联，旧/新修复任务分别继承 UUID/`NULL`。
- 前端组件和 E2E 测试断言创建弹窗不展示或请求目标问题，创建载荷不含该字段，完整生成链路不向模型发送 `query_topic` 或“目标问题”。

### 7. 错误与正确示例

错误做法：把兼容责任推给新任务，写入空对象或伪造问题。

```python
requirements["query_topic"] = {"canonical_question": f"如何选择 {product.part_number}？"}
```

正确做法：只在权威历史外键真实存在时冻结问题，否则完全省略该键。

```python
if task.query_topic_id is not None:
    topic = db.get(QueryTopic, task.query_topic_id)
    if topic is None:
        raise not_found("目标问题")
    requirements["query_topic"] = {
        "canonical_question": topic.canonical_question,
        "intent_type": topic.intent_type,
    }
```
