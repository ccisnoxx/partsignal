# 收缩删除与归档生命周期：技术设计

## 1. 设计结论

采用一个共享生命周期规则，不建立通用级联删除框架：

1. `archived_at` 只控制内容任务是否出现在默认工作区，不改写现有业务状态机。
2. 普通删除处理“未形成成功文章身份”的整个任务聚合。
3. 管理员永久删除处理“已归档且曾成功发布”的整个任务聚合。
4. 当前配置通过必要标量快照与历史解耦；平台和 Prompt 删除不再要求跨页面手工解绑。
5. 审计改为显式成功动作白名单，并在迁移中执行一次全局低价值历史清理。

这五条由现有 PostgreSQL 事务、外键、行锁、revision 和服务层命令实现，不引入新依赖、回收站、删除队列、策略接口或领域框架。

本任务不拆分 Trellis 子任务。数据库关系、OpenAPI、后端投影和前端动作必须按同一迁移与契约顺序交付，拆分会产生不可独立部署的中间状态。

## 2. 数据模型

### 2.1 内容任务归档与平台快照

`content_tasks` 新增：

- `archived_at timestamptz NULL`。
- `platform_profile_name_snapshot varchar(160) NOT NULL`。
- `platform_website_url_snapshot text NULL`。

同时调整：

- `platform_profile_id` 改为可空，外键使用 `ON DELETE SET NULL`。
- 增加约束：`status = 'OPEN'` 时 `platform_profile_id` 必须非空。
- 增加约束：`archived_at IS NOT NULL` 时 `status` 必须为 `COMPLETED`。
- 增加默认列表索引 `archived_at, created_at`；不增加单独归档表。

任务创建时从已锁定的 `PlatformProfile` 同步写入名称和网站快照。迁移从当前有效外键确定性回填；任何缺失关联都使迁移失败，不填猜测值。

历史平台仍存在时，任务响应使用实时平台名称、网站和 Logo；平台已删除时改用任务快照，Logo 返回空。`platform_profile_id` 和嵌套平台 `id` 都可以为空，前端不得为已删除配置补造 UUID。

### 2.2 发布工作平台与账号快照

`publication_works` 新增并回填：

- `platform_profile_name_snapshot varchar(160) NOT NULL`。
- `platform_account_label_snapshot varchar(160) NOT NULL`。
- `account_identifier_snapshot varchar(200) NOT NULL`。

同时调整：

- `platform_profile_id` 与 `platform_account_id` 改为可空并使用 `ON DELETE SET NULL`。
- `PREPARING`、`PLATFORM_REVIEW`、`AWAITING_VERIFICATION`、`ACTION_REQUIRED` 仍要求两个实时配置 ID 非空；只有 `COMPLETED`、`CLOSED` 可以仅依赖快照。
- 发布列表、详情和文章查询对实时配置使用左连接，并以 `COALESCE(实时值, 快照值)` 投影展示字段。

发布工作创建时写入快照。切换账号仍只允许非终态阶段，并同时更新账号快照；平台快照始终来自任务锁定的平台。

### 2.3 平台配置外键

- `platform_accounts.platform_profile_id` 改为 `ON DELETE CASCADE`：账号是平台配置子项。
- 平台硬删除前，服务端必须确认不存在 `OPEN` 内容任务和非终态发布工作。
- 删除平台时允许数据库把终态任务/发布工作的实时配置外键置空；任务行本身不删除。
- 平台级删除只写一条 `platform_profile.deleted` 审计。级联删除的账号不逐条写审计；显式账号删除继续写 `platform_account.deleted`。

### 2.4 来源关系与 GEO 关系

- `content_tasks.source_published_content_issue_id` 改为 `ON DELETE SET NULL`。
- `content_task_geo_sources.published_article_id` 改为 `ON DELETE SET NULL`；删除“必须存在实时文章或查询主题”的约束，`basis_snapshot` 继续作为来源历史的必需数据。
- `geo_observation_citations.published_article_id` 改为 `ON DELETE SET NULL`，保留 citation 自身 URL。
- `geo_observation_publications.published_article_id` 改为 `ON DELETE CASCADE`，文章身份删除时只移除对应逐篇结果。

上述 `SET NULL` 都只解除已经删除的实时身份，不修改下游任务自身业务状态和快照。

### 2.5 不可变触发器边界

数据库继续拒绝批准内容、发布事件、验证、文章、发布问题和 GEO 数据的原地 UPDATE。永久删除不再依赖“所有历史表绝对禁止 DELETE”的规则：

- 将相关追加式触发器收窄为 UPDATE 不可变门禁。
- DELETE 由外键顺序和受权限保护的服务端聚合命令负责。
- 保留现有 `partsignal.content_task_delete_id`，仅用于删除事务中断开 `content_versions.source_job_id` 等循环引用，不把它扩展成通用授权机制。
- 不提供发布事件、验证、文章或审核记录的独立删除 API。

这使“不可原地篡改”与“管理员显式删除整个聚合”成为两个独立规则，也避免为每张历史表复制事务变量和触发器分支。

### 2.6 审计表

- `audit_logs` 的 UPDATE 门禁保留，包括删除用户时受控 `actor_id -> NULL`。
- 从 `audit_logs_append_only` 触发器中移除 DELETE 事件；数据库不再把审计当作绝对不可删除业务历史。
- 不增加审计删除 API。
- Alembic upgrade 在移除 DELETE 门禁后执行一条白名单数据清理语句：`outcome <> 'SUCCESS' OR action NOT IN (...)` 的行全部删除。
- 迁移和永久删除均直接使用精确 SQL 条件删除审计，不增加保留期表或后台任务。

## 3. HTTP 与类型契约

### 3.1 内容任务响应

`ContentTask` / `ContentTaskListItem` 调整：

- `platform_profile_id: uuid | null`。
- `platform.id: uuid | null`。
- 新增 `archived_at: datetime | null`。
- `available_actions` 增加 `ARCHIVE`、`RESTORE`、`PERMANENT_DELETE`。

动作规则：

| 条件 | 动作 |
|---|---|
| 无成功文章/GEO、无运行生成作业、未归档 | `DELETE` |
| `COMPLETED` 且未归档 | `ARCHIVE` |
| 已归档，ENGINEER/ADMIN | `RESTORE` |
| 已归档，ADMIN | `PERMANENT_DELETE` |
| 已归档，ENGINEER | 不返回 `PERMANENT_DELETE` |

普通删除和永久删除互斥。已归档任务不返回内容编辑、生成、取消或普通删除动作。

### 3.2 列表筛选

`GET /api/v1/content-tasks` 新增：

```text
archive_status = ACTIVE | ARCHIVED | ALL
```

- 默认 `ACTIVE`。
- `ARCHIVED` 只返回 `archived_at IS NOT NULL`。
- `ALL` 用于管理员/工程师显式联合查询，不作为页面默认值。
- 现有平台、产品和事实筛选继续组合使用；实时平台已删除的历史任务不会命中平台 ID 筛选。

### 3.3 归档与恢复命令

```text
POST /api/v1/content-tasks/{content_task_id}/archive
POST /api/v1/content-tasks/{content_task_id}/restore
Body: RevisionRequest { expected_revision }
Response: ContentTask
```

- 两个接口允许 `ENGINEER` 和 `ADMIN`，要求 CSRF。
- archive 只接受未归档 `COMPLETED`。
- restore 只接受已归档任务。
- 成功后 `revision += 1`。
- 重复命令返回 `409 INVALID_STATE_TRANSITION`，旧 revision 返回 `409 REVISION_CONFLICT`。

### 3.4 永久删除预览与命令

```text
GET  /api/v1/content-tasks/{content_task_id}/permanent-deletion-preview
POST /api/v1/content-tasks/{content_task_id}/permanent-delete
```

两个接口仅 `ADMIN`。

预览响应：

```text
task_id
revision
counts:
  content_versions
  content_review_records
  generation_jobs
  publication_works
  publication_events
  publication_verifications
  published_articles
  published_content_issues
  geo_article_relations
  exclusive_geo_observation_chains
  attachment_relations
external_urls: string[]
confirmation_text: "永久删除"
```

永久删除请求：

```text
expected_revision: integer
confirmation_text: "永久删除"
```

成功返回 `204`。预览只用于展示，永久删除服务必须在锁内重新计算全部范围，不信任预览计数。

稳定错误：

- `CONTENT_TASK_NOT_ARCHIVED`：任务未归档。
- `REVISION_CONFLICT`：revision 过期。
- `PERMANENT_DELETE_CONFIRMATION_MISMATCH`：确认文本错误。
- `CONTENT_TASK_BUSY`：普通删除时仍有运行生成作业。
- `CONTENT_TASK_REQUIRES_ARCHIVE`：普通删除发现成功文章或 GEO 关系。

### 3.5 发布与平台响应

- 发布工作、文章列表和详情中的 `platform_profile_id`、`platform_account_id` 改为可空。
- 平台名称、账号标签和账号标识继续为必需字符串，由实时配置或快照提供。
- 平台详情已有 `platform_account_count`，删除确认直接复用，不新增平台删除预览接口。
- Prompt 详情已有 `bound_platform_count` 与 `bound_platforms`，删除确认直接复用，不新增 Prompt 影响查询。

## 4. 后端命令流程

### 4.1 普通任务删除

现有 `delete_content_task` 保留为唯一普通删除命令，并扩展为整个未发布任务聚合的所有者：

1. `FOR UPDATE` 锁任务，拒绝已归档任务。
2. 按 UUID 稳定锁定任务的生成作业、内容版本和发布工作。
3. 若存在 `PENDING`/`RUNNING` 生成作业，返回 `CONTENT_TASK_BUSY`。
4. 若存在 `PublishedArticle`、GEO 文章结果或 citation 实时关联，返回 `CONTENT_TASK_REQUIRES_ARCHIVE`。
5. 收集任务拥有的子记录 ID、附件 ID 和旧审计目标。
6. 删除未成功发布工作的附件、事件、失败验证和工作；调度无引用文件清理。
7. 设置现有任务删除事务变量，断开内容/作业循环引用，删除审核、版本、作业、GEO 来源和任务。
8. 删除已移除子记录对应的旧审计，追加 `content_task.deleted`，提交。

任务原状态可以是 `OPEN` 或 `CANCELLED`；删除资格来自真实成功文章、GEO 关系和运行作业，而不是要求用户先制造一个中间取消状态。

### 4.2 归档与恢复

`archive_content_task` 与 `restore_content_task` 保持短事务：锁任务、校验 revision/状态、写 `archived_at`、增加 revision、提交。两者不写审计，因为归档是可逆工作区整理动作且不在白名单中。

归档不会修改发布工作、文章、GEO、内容或文件，也不会使外部页面产生任何请求。

### 4.3 永久删除

永久删除继续由现有发布服务持有任务聚合，不建立第二个删除服务层：

1. 锁定任务并校验 `ADMIN` 路由权限、归档状态、revision 和确认文本。
2. 按任务、内容、发布、文章、GEO 观测的稳定 UUID 顺序锁定删除图，并重新生成预览范围。
3. 记录目标文章 ID、受影响 GEO 更正链、附件 ID、旧审计目标和去重后的外部 URL。
4. 删除发布后问题；由 `ON DELETE SET NULL` 解除其他修复任务的实时来源。
5. 删除文章身份；逐篇 GEO 结果随外键删除，citation 与其他优化任务的实时文章 ID 置空。
6. 对受影响人工 GEO 更正链重新检查：仍有文章关系则保留；没有文章关系则调用 GEO 服务现有链锁定/附件清理逻辑删除整链。该内部 helper 不自行 commit 或写额外审计。
7. 删除发布附件、验证、事件和工作，并调度无引用文件。
8. 断开内容/作业循环，删除审核、版本、作业、任务自身 GEO 来源和任务。
9. 删除所有已移除目标的旧审计，写入 `content_task.permanently_deleted`，其 `details={}`。
10. 一次提交；任何异常回滚业务删除、来源解绑、文件调度和墓碑审计。

文件对象继续由现有异步清理器处理。永久删除事务只解除关系并安排无引用文件清理；共享文件和对象存储暂时失败不会造成错误级联。

### 4.4 GEO 链复用

把现有“锁定人工更正链、删除关系、调度附件”逻辑提取为同模块内部 helper：

- 公共 GEO 删除接口调用 helper 后写 `geo_observation.deleted` 并 commit。
- 任务永久删除调用 helper，但由外层任务事务负责审计和 commit。

该 helper 是已有两条真实调用路径的事务边界复用，不创建通用删除接口。

### 4.5 Prompt 原子解绑删除

平台 Prompt 绑定变更使用一个 PostgreSQL 事务级 advisory lock 串行化。管理操作频率低，单锁比跨 Prompt/Platform 的复杂锁图更小、更可靠。

删除流程：

1. 获取绑定图 advisory lock。
2. 锁 Prompt 并校验 revision。
3. 按 UUID 锁全部绑定平台。
4. 将 `platform_prompt_id=NULL`、每个平台 `revision += 1`。
5. 删除 Prompt，写 `platform_prompt.deleted`，一次提交。

平台更新中涉及 Prompt 绑定时使用同一 advisory lock。删除后现有生成作业继续读取 `input_snapshot`；新生成入口沿用现有“平台必须绑定 Prompt”校验。

### 4.6 平台与账号删除

平台删除：

1. 锁平台。
2. 统计 `status='OPEN'` 的任务和非终态发布工作；任一存在返回 `PLATFORM_PROFILE_IN_USE`。
3. 记录账号数量用于审计/响应前确认，解除 Logo 并复用现有无引用文件调度。
4. 删除平台；账号级联删除，终态任务/发布工作实时外键置空。
5. 写 `platform_profile.deleted` 并提交。

账号显式删除只统计非终态发布工作。只有终态历史时允许删除，工作实时账号 ID 置空后继续使用快照。

平台列表的 `available_actions` 与服务锁内校验使用同一“OPEN 任务 + 非终态工作”规则；列表只负责投影，不能代替服务校验。

## 5. 审计实现

### 5.1 单一白名单

在 `backend/app/audit_types.py` 定义不可变 `RETAINED_AUDIT_ACTIONS`，内容与 PRD 精确一致。`validate_audit_entry` 只接受：

- `outcome == AuditOutcome.SUCCESS`。
- `action in RETAINED_AUDIT_ACTIONS`。

删除现有失败/拒绝独立审计包装和不在白名单中的成功审计调用，不保留“构造后静默丢弃”的假审计路径。业务异常继续通过 API 错误和服务日志暴露。

### 5.2 数据迁移

迁移内使用冻结的动作字符串，不导入运行时 Python 常量。执行顺序：

1. 替换审计 UPDATE 门禁并允许 DELETE。
2. 删除 outcome 非 `SUCCESS` 的历史行。
3. 删除 action 不在冻结白名单的历史行。
4. 完成其余 Schema/外键/触发器变化。

迁移测试记录清理前后动作分布，并断言业务表行数和关键状态不变。迁移不写“审计被清理”的新审计，否则会重新引入自身历史。

## 6. 前端交互

### 6.1 内容任务页

- 默认请求 `archive_status=ACTIVE`，页面提供“当前任务 / 已归档”筛选，不把归档混入状态筛选。
- 行主任务继续只消费 `primary_task`；`ARCHIVE`、`RESTORE`、`DELETE`、`PERMANENT_DELETE` 放入现有“更多操作”。
- 普通删除确认说明会删除内部草稿、审核、生成和未成功发布记录；外部页面不会被处理。
- 归档确认说明只隐藏任务，不改变发布与 GEO 历史。
- 恢复使用普通确认，不把业务状态改成 OPEN。
- 永久删除点击后才读取预览；加载成功后展示分项数量、去重 URL、不可恢复与外部页面提示，并要求输入 `永久删除`。
- 前端确认文本不匹配时禁用提交；服务端仍独立校验。
- 永久删除成功后关闭弹窗、清除当前任务 URL、失效任务/发布/GEO/审计查询并返回归档列表，不能停留在 404 详情。

### 6.2 Prompt 管理

- Prompt 列表和详情始终按服务端 `available_actions` 展示删除。
- 绑定中的 Prompt 删除弹窗列出受影响平台名称和数量，说明平台会自动解绑且生成暂不可用。
- 成功后刷新 Prompt、平台列表、平台详情和生成选项；失败保留弹窗与真实错误。

### 6.3 平台与账号管理

- 平台有 OPEN 任务时显示“查看删除条件”与停用入口，不展示强制删除。
- 可删除平台的确认框展示将一并删除的平台账号数量，并明确不会删除任务。
- 平台删除后，终态历史页面显示快照名称，不渲染失效配置链接。
- 账号仅有终态历史时显示删除；确认说明历史记录保留账号快照。

### 6.4 可访问性

- 继续复用 Ant Design Modal、Dropdown、Form 和现有焦点恢复方式，不新增危险操作通用组件。
- 危险操作必须经过弹窗，确认按钮使用中文业务文案；不把数据库术语作为主文案。
- 弹窗错误可读、键盘可操作，关闭后焦点回到触发按钮；移动端弹窗内容允许内部滚动但不产生页面横向溢出。

## 7. 兼容、部署与回滚

- OpenAPI 的任务/发布配置 ID 可空是已批准的合同变化；前后端必须同一版本部署并重新生成类型。
- 迁移先回填快照再放宽外键。回填不存在模糊 fallback；异常关联直接终止迁移。
- 审计历史清理、已执行永久删除和配置硬删除都不可逆。Alembic downgrade 明确以 PostgreSQL `55000` 失败，并要求恢复迁移前备份，不伪造已删除数据。
- 项目处于开发阶段，不增加双写、兼容字段、Feature Flag 或分阶段影子表。
- 部署前如需保留旧审计，仅需备份数据库；产品运行不依赖该备份。

## 8. 并发与失败矩阵

| 场景 | 结果 |
|---|---|
| 两个管理员同时永久删除同一任务 | 一个 `204`，另一个在锁后得到 `404` 或 revision 冲突；只有一条墓碑 |
| 预览后任务 revision 变化 | 永久删除返回 `REVISION_CONFLICT`，无删除 |
| 普通删除期间生成作业进入运行态 | 行锁后的最终检查决定；若已运行则整笔拒绝 |
| Prompt 删除与平台重新绑定并发 | advisory lock 串行；不会出现半解绑或悬空 FK |
| 平台删除与新建任务并发 | 平台行锁串行；新建成功则删除被阻断，删除成功则新建发现平台不存在 |
| 删除文章时 GEO 观测仍含其他文章 | 只删除目标文章关系，观测链保留 |
| 文件被其他业务引用 | 只解除本任务关系，不调度实际删除 |
| 任意删除步骤、审计或数据库异常 | 整个业务事务回滚；对象存储清理由已提交调度独立重试 |

## 9. 文档一致性

实施时同步更新：

- `contracts/openapi.yaml`：接口、nullable ID、动作和预览 Schema。
- `contracts/database.md`：归档、聚合删除、快照、外键、触发器和审计迁移。
- `docs/GEO多平台内容运营系统方案设计.md`：把“发布/GEO 永不物理删除”改为“不可原地修改，归档后可管理员永久删除”。
- 根 `AGENTS.md`：保留批准内容/发布/GEO 不可原地修改，补充显式任务永久删除例外。
- `.trellis/spec/backend/database-guidelines.md`、`publication-workbench-guidelines.md`、`available-actions-contract.md` 和 AI 配置规范：实施完成后通过 `trellis-update-spec` 写入稳定合同。

不在多个设计文档重复维护动作白名单；API 以 OpenAPI、数据库以 `contracts/database.md`、开发约束以 Trellis spec 为各自权威来源。

## 10. 主要取舍

- 不增加 `ARCHIVED` 状态：归档只影响可见性，避免复制现有状态机。
- 不保留平台/账号配置 JSON：历史页面只需要名称、网站、标签和账号标识，标量快照足够。
- 不建立删除依赖图：两个任务删除命令拥有固定聚合边界，平台和 Prompt 使用各自明确规则。
- 不让审计调用静默 no-op：删除不保留的调用，并在唯一校验入口拒绝白名单外写入。
- 不取消运行中的生成作业：删除暂时返回忙碌，等作业终态后重试；只有出现真实长期卡死需求时再设计取消协议。
