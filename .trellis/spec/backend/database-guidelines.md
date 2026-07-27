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

## 场景：用户工作台实时查询与批量状态

- 本场景复用现有 `users`、`sessions` 和 `audit_logs`，不增加表、字段、派生汇总或迁移。用户状态、账号类型、强制改密和修订号均由 `users` 单一持有，Redis 不缓存或推断身份状态。
- 列表筛选、`created_at, id` 稳定排序、分页、导出和五项全局汇总都从 PostgreSQL 实时读取。列表 `total` 受筛选影响，汇总不受筛选影响；没有历史快照时不得补造趋势值。
- 新用户默认启用并只保存临时密码哈希，`must_change_password=true`；重置临时密码和停用用户都撤销目标用户全部会话。明文密码不得进入响应、日志或审计。
- 单个和批量状态命令共享同一锁、revision、最后有效管理员和会话撤销规则。批量按 UUID 稳定锁行，预期的用户不存在、revision 冲突和最后管理员保护逐项失败；非预期数据库、审计或程序错误回滚整批。
- 停用、重新启用、改名或调整账号类型始终更新同一用户 UUID。只有停用且没有业务历史引用的账号可按下节契约物理删除；CSV 导出只记录非敏感筛选与行数审计，不保存正文。

## 场景：受约束删除用户与内容任务

### 1. 范围与触发条件

- 修改用户、内容任务删除 API，或 `audit_logs.actor_id ON DELETE SET NULL` 与追加式审计门禁时适用。
- 删除只用于尚未承担业务历史的停用账号，以及没有生成作业或内容版本的已取消任务；不得扩展成级联清理历史。

### 2. 签名

- 用户：`DELETE /api/v1/users/{user_id}`，管理员权限和 CSRF，成功返回 `204`。
- 内容任务：`DELETE /api/v1/content-tasks/{content_task_id}`，内容编辑权限和 CSRF，成功返回 `204`。
- 临时密码重置：`ResetPasswordRequest.temporary_password` 最少 8 位；`UserCreate` 与 `ChangePasswordRequest` 仍最少 12 位。
- 数据库 revision：`0027_audit_user_delete_guard`，`down_revision = "0026_publication_account_dedup"`。

### 3. 契约

- 用户删除先锁定 `users` 表与目标行，仅接受 `is_active=false`。`sessions` 由既有 `CASCADE` 清理，业务归属继续由既有 `RESTRICT` 阻断。
- 删除事务通过 `set_config('partsignal.user_delete_id', <uuid>, true)` 声明目标。审计触发器还必须满足 `pg_trigger_depth() > 1`、`OLD.actor_id=<uuid>`、`NEW.actor_id IS NULL`，且除 `actor_id` 外整行完全相等。
- 内容任务删除锁定目标行，仅接受 `CANCELLED`，并显式确认 `generation_jobs.content_task_id` 与 `content_versions.task_id` 的引用数都为零。
- 任务详情与列表使用同一批量生产历史查询，只有满足上述条件时才投影 `available_actions=["DELETE"]`；删除服务仍须重新校验。
- 成功后分别追加 `user.deleted` 或 `content_task.deleted`；不得记录密码或删除历史审计行。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 用户不存在 / 任务不存在 | `404` |
| 用户仍启用 | `409 USER_ACTIVE` |
| 用户仍有任一 `RESTRICT` 业务引用 | `409 USER_IN_USE` |
| 任务不是 `CANCELLED` | `409 INVALID_STATE_TRANSITION` |
| 任务存在生成作业或内容版本 | `409 CONTENT_TASK_IN_USE`，返回真实非零引用 |
| 手工更新审计、目标 UUID 错配、同时修改其他字段或删除审计行 | PostgreSQL `55000` |
| 重置临时密码为 7 位 / 8 位 | `422 VALIDATION_ERROR` / `204` |

### 5. 正常、基础与失败案例

- 正常：管理员删除无业务引用的停用账号，会话消失，旧审计行保留且操作者为空，新的删除审计保留执行管理员和目标 UUID。
- 基础：已取消且没有生成作业或内容版本的任务被删除；外链平台、产品与事实版本保持不变。
- 失败：仅设置事务变量后直接执行 `UPDATE audit_logs SET actor_id=NULL`，或删除带业务历史的用户/任务，事务失败且目标数据保持原状。

### 6. 必需测试

- PostgreSQL 迁移测试断言合法外键级联成功，手工 UPDATE、错配目标、其他字段 UPDATE、审计 DELETE 继续返回 `55000`，并覆盖 `0026 ↔ 0027`。
- 身份集成测试断言权限、CSRF、启用状态、业务引用、会话级联、审计保留、管理员实时总数和 8/7 位密码边界。
- 内容集成测试断言状态门禁、生成作业与内容版本引用、权限、成功审计和 `204`。
- 契约与前端测试断言 OpenAPI/生成类型一致，危险操作只从服务端动作或停用状态展示，并经过确认。

### 7. 错误与正确示例

错误：只设置可伪造的事务变量便允许应用直接改写审计。

```sql
IF current_setting('partsignal.user_delete_id', true) = OLD.actor_id::text THEN
  RETURN NEW;
END IF;
```

正确：同时限定外键级联触发深度、目标 UUID、唯一字段变化，并由业务外键决定能否删除。

```sql
IF pg_trigger_depth() > 1
   AND current_setting('partsignal.user_delete_id', true) = OLD.actor_id::text
   AND OLD.actor_id IS NOT NULL AND NEW.actor_id IS NULL
   AND to_jsonb(NEW) - 'actor_id' = to_jsonb(OLD) - 'actor_id' THEN
  RETURN NEW;
END IF;
```

## 场景：生成作业补投递与租约恢复

- 数据库 revision：`0011_generation_reliability`，`down_revision = "0010_user_cleanup"`。
- `generation_jobs.status` 是执行权威；Redis 消息、投递次数和时间只负责唤醒与诊断，不能形成第二状态机。
- 超龄 `PENDING` 扫描必须使用有限批次与 `FOR UPDATE SKIP LOCKED`；只有原子声明为 `RUNNING` 的 Worker 可以发起供应商调用。
- 租约取不可变快照中的供应商超时再加正数收尾裕量。过期 `RUNNING` 只能显式失败，自动补投递不得覆盖到该状态。
- 迁移只增加可向后读取的列、检查约束和部分索引；历史迁移与 `migration_schema_v1.py` 保持冻结。
- PostgreSQL 集成测试必须覆盖多恢复器、重复消息、租约竞态、迟到响应和迁移前后旧列读取，不能用 SQLite 替代行锁语义。

## 场景：发布闭环历史门禁与异常状态

- 数据库 revision：`0013_publication_closure`，`down_revision = "0012_ai_data_classification"`。
- `COMPLETED` 表示任务曾完成发布闭环。完整性门禁必须读取追加式 `publication_status_events` 中的 `VERIFIED` 事实，不能只看发布记录当前状态；后来 `REMOVED` 或 `VERIFICATION_FAILED` 不得把合法完成历史误报为脏数据。
- 跨平台错绑只在尚未进入 `REJECTED`、`REMOVED` 或 `VERIFICATION_FAILED` 时阻断。已显式终态处置的旧记录继续保留，不通过改绑、删除或隐藏 allowlist 清理历史。
- 新发布的平台等值由应用服务给出业务错误，并由 PostgreSQL 插入触发器最终保护。测试必须同时覆盖 API 与直接数据库写入。
- `PublicationAttention` 只能以 revision 0 的 `OPEN` 初态插入，绑定与打开时间不可变，历史不可删除；唯一允许的状态变化是带非空说明和单次 revision 递增的 `OPEN -> RESOLVED`。
- 修复任务来源字段一旦写入不可改绑。异常或修复来源产生后，迁移只允许前滚，downgrade 不得删除业务历史。

## 场景：具体平台启停与管理实时投影

- `platform_profiles.is_active` 是平台启停的唯一持久状态；配置完整性只表示存在当前 `PlatformPrompt`，不再依赖规则版本。
- 停用后仍允许查看、编辑、维护 Prompt 及重新启用，但新建普通/修复 `ContentTask`、`PlatformAccount` 或 `PublicationRecord` 必须先以 `FOR UPDATE` 锁定平台并返回 `PLATFORM_DISABLED`；不得停用既有账号或改写 Prompt、任务、发布及观测历史。
- 平台管理汇总、配置完整性、账号数量和引用数量只做 PostgreSQL 实时投影，不保存快照或派生列。引用数直接按 `ContentTask.platform_profile_id` 统计唯一任务；最近 30 天使用同一 UTC `as_of` 的半开区间 `[as_of - 30 days, as_of)`。
- 平台列表筛选、稳定排序、分页和 CSV 导出复用同一查询条件；无分页参数时保留完整参考集合语义，`page` 与 `page_size` 只能成对出现。更新时间只读取真实平台审计，缺失时返回 `NULL`，不得用迁移时间补造。

## 场景：Markdown 产品事实与双首稿内容生产

### 1. 范围与触发条件

- 修改产品事实工作区、事实版本、内容任务、平台 Prompt、生成快照、人工首稿、发布修复或 revision `0025_markdown_facts_direct_platform` 时适用。
- 产品数据手册由系统外 AI 总结；本系统只接收和维护用户提交的 Markdown 总结，不保存参考型号、参数、Evidence 或可独立编辑的结构化事实副本。

### 2. 签名

- 工作区：`products.facts_body_markdown TEXT NOT NULL`、`products.facts_classification PUBLIC|INTERNAL|RESTRICTED`、`products.facts_revision`。
- 冻结版本：`fact_versions.body_markdown`、`fact_versions.classification`；不得恢复 `snapshot_json`。
- 任务：`ContentTaskCreate(product_id, fact_version_id, platform_profile_id)`；`content_tasks` 直接外键到 `platform_profiles`。
- 系统首稿：`POST /api/v1/content-tasks/{id}/generation-jobs`，请求体仅 `{ai_model_id}`。
- 人工首稿：`POST /api/v1/content-tasks/{id}/manual-versions`，请求体复用 `ContentRevisionCreate`。
- 生成快照：新作业只写 `content-markdown-v2` 或 `humanization-markdown-v2`；旧 `chat-json-v1`、`humanization-json-v1` 只读。

### 3. 契约

- 保存事实时去除空白后的 Markdown 必须非空，原文和分级原样保存；创建事实版本只冻结当前工作区两个字段。已批准或已被内容引用的版本不得原地修改。
- `PlatformProfileVersion` 表、API、前端路由及任务中的受众、内容角度、转化目标、格式、长度、用户 Prompt、平台类型快照和 canonical URL 已物理删除；不得建立兼容字段或第二来源。
- 创建任务只校验产品、该产品的 `APPROVED` 非空事实版本和启用平台。缺少平台 Prompt 不阻止任务或人工首稿，只阻止系统 AI 作业。
- 原始 AI 请求必须恰好发送两条消息：`system.content == PlatformPrompt.template_markdown`，`user.content == FactVersion.body_markdown`；不得增加前缀、拼接任务要求、补默认安全规则或重写空白。
- 人工首稿创建 `source_type=HUMAN`、`status=DRAFT`、`source_job_id=NULL`、`based_on_id=NULL`，随后与 AI 草稿共用修订、审核和人工发布链。
- 发布、平台账号和修复任务沿用 `ContentTask.platform_profile_id`；修复任务只允许重新选择同产品的批准事实版本，并继承原任务平台。
- 管理员删除当前平台 Prompt 后，新 AI 生成必须显式失败；系统不恢复默认 Prompt。历史作业继续从不可变快照读取，legacy 作业禁止重试。

### 4. 校验与错误矩阵

| 条件 | 结果 |
|---|---|
| 事实 Markdown 为空白 | 请求校验失败，不递增 `facts_revision` |
| 事实版本不属于产品、非 `APPROVED` 或正文为空 | `409 INVALID_STATE_TRANSITION`，不创建任务/首稿 |
| 平台不存在或已停用 | `404` 或 `409 PLATFORM_DISABLED` |
| 系统 AI 使用非 `PUBLIC` 事实 | `409 AI_DATA_CLASSIFICATION_FORBIDDEN` |
| 当前平台 Prompt 不存在 | `409 PLATFORM_PROMPT_MISSING`，不得回退 |
| 人工首稿提交到终态任务 | `409 INVALID_STATE_TRANSITION` |
| 重试 legacy 生成快照 | `409 LEGACY_GENERATION_RETRY_FORBIDDEN` |
| 删除被任务或内容版本引用的事实版本 | `409 FACT_VERSION_IN_USE`，返回真实非零引用 |

### 5. 正常、基础与失败案例

- 正常：管理员保存公开 Markdown、批准版本、选择平台建任务，再选择模型生成 AI 草稿；供应商收到的平台 Prompt 与事实正文逐字相同。
- 基础：同样的任务不配置模型也能直接粘贴网页版豆包、DeepSeek 或其他工具输出，创建人工 `DRAFT` 并进入审核。
- 失败：Prompt 被删后继续生成时显式失败；不得把安全规则、受众、角度或长度从已删除任务字段拼回请求。

### 6. 必需测试

- 契约测试断言任务创建仅三个字段、人工首稿接口存在、平台规则 Schema/路径和旧任务字段不存在。
- PostgreSQL 迁移测试断言确定性 Markdown 回填、最严格分级、任务平台唯一回填、旧表/列删除、活动旧作业阻断和有损 downgrade 拒绝。
- 单元/集成测试断言生成请求恰好两条原始消息、人工 lineage 四字段、非公开事实/缺 Prompt/legacy retry 明确失败。
- 前端测试断言 Markdown 是唯一事实编辑器，任务仅选择产品/事实/平台，AI 与人工入口并列，规则页面和旧字段不可达。
- E2E 使用真实 HTTP 替身断言 system/user 内容逐字相同，并覆盖人工首稿到审核、发布的共用链路。

### 7. 错误与正确示例

错误：为兼容旧任务继续拼接受众、角度或固定安全前缀。

```python
messages = [
    {"role": "system", "content": DEFAULT_SAFETY + prompt},
    {"role": "user", "content": task.user_prompt_markdown + fact.body_markdown},
]
```

正确：平台 Prompt 和冻结事实正文各自只有一个权威来源。

```python
messages = [
    {"role": "system", "content": prompt.template_markdown},
    {"role": "user", "content": fact.body_markdown},
]
```

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

## 场景：追加式审计结果与失败事务

### 1. 范围与签名

- 数据库 revision：`0024_audit_outcome`，`down_revision = "0023_rename_platform_website_url"`。
- `audit_logs` 是业务审计唯一来源；表级触发器继续拒绝业务运行时的 `UPDATE` 与 `DELETE`。
- 每条事件必须明确 `business_module`、`action`、`outcome` 和非敏感 `result_message`；`target_id` 允许为空，用于命令尚未创建业务对象时的失败或拒绝。
- `outcome` 只允许 `SUCCESS | FAILED | DENIED`。请求 ID 允许重复，但只接受 1–100 个可打印 ASCII 字符。

### 2. 事务与覆盖边界

- 成功审计使用 `append_audit`，与业务写入同一事务提交或回滚。
- 仅事实版本状态转换、内容提交与审核、发布登记、GEO 观测、平台与规则、平台 Prompt、AI 渠道与模型、用户状态与管理员标识、用户导出九类关键命令，在业务事务回滚后使用 `commit_audit` 独立记录 `FAILED` 或 `DENIED`。
- 其他既有写命令暂时只记录成功事件；不得用中间件、全局开关、第二张审计表或批量异常捕获伪造失败覆盖。
- 请求解析、身份认证、会话与 CSRF 失败不属于业务命令审计。

### 3. 数据安全与查询

- `details` 只保存结构化 `changes` 与 `facts`；写入前递归拒绝敏感键，读取时再按业务模块正向白名单投影字段。
- 关键词只匹配操作者、业务模块、动作、对象类型、对象标识、请求 ID、结果说明与错误码等已批准字段，不执行 `details::text` 搜索。
- 列表按 `(created_at DESC, id DESC)` 稳定排序。操作者信息使用当前用户投影；用户删除后事件仍保留，投影为空。
- 历史回填必须对已知 `action + target_type` 组合精确映射，未知组合中止迁移；AI 调用失败必须映射为真实失败，不能按旧成功默认回填。

### 4. 降级与必需测试

- 存在任一空 `target_id` 时，降级必须在恢复非空约束前以 PostgreSQL `55000` 失败并整体回滚。
- 迁移测试覆盖空库升级、历史模块与结果回填、追加式触发器和不可安全降级。
- 单元与集成测试覆盖九类关键命令的 `SUCCESS / FAILED / DENIED`、原业务事务回滚、审计独立提交、敏感键拒绝、字段白名单、稳定分页和管理员权限。
- 前端测试覆盖默认北京时间近三天、URL 可分享筛选、手动与 30 秒可见页刷新、空态/错误态、右侧详情以及敏感字段不展示。
