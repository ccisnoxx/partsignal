# 全站业务表格操作流程重设计：技术设计

## 1. 设计结论

本任务不建设通用工作流引擎。PostgreSQL 中现有领域状态和关联关系继续是唯一业务事实；服务端在读取时按领域投影“当前业务阶段”和“下一步主任务”，前端只做该领域 token 到中文文案、已有路由或命令的穷尽映射。

`primary_task` 与 `available_actions` 必须分开：

- `primary_task` 回答“用户下一步应该做什么”，可以是进入工作区、查看历史、下钻明细或执行简单命令。
- `available_actions` 只表达当前操作者可尝试的资源命令；命令入口仍在写入时重新授权和校验。
- 两者都使用各资源自己的 typed union，不建立跨领域 enum，不由服务端下发前端路径、中文按钮文案或任意 action 配置。
- 组合阶段只在响应中派生，不写入数据库，因此不会形成第二套状态机。

## 2. 权威边界与数据流

```text
PostgreSQL 领域状态、当前指针、引用关系、操作者
            ↓
领域服务批量查询并投影 workflow_stage / primary_task / available_actions
            ↓
OpenAPI 领域 DTO（字段 required、typed union）
            ↓
前端领域页面穷尽映射中文主操作、次级操作和工作区定位
            ↓
命令请求再次锁行、校验 revision / 状态 / 权限 / 引用
            ↓
事务写入业务状态、追加历史和审计，再返回重新投影的 DTO
```

固定查看类对象可以返回固定 `primary_task`；没有独立生命周期的逐篇文章观测输入行不建立资源投影。

## 3. OpenAPI 与投影合同

### 3.1 领域字段

对存在组合阶段的列表 DTO 增加必填 `workflow_stage`，对独立业务行增加必填 `primary_task`。示例：

```yaml
Product:
  required: [workflow_stage, primary_task, available_actions]
  properties:
    workflow_stage:
      enum: [FACTS_EMPTY, FACTS_EDITING, FACT_REVIEW_PENDING, FACT_CHANGES_REQUESTED, FACT_APPROVED, RETIRED]
    primary_task:
      enum: [ENTER_FACTS, SUBMIT_FACT_REVIEW, REVIEW_FACT, REVISE_FACT, CREATE_CONTENT_TASK, VIEW_FACT_HISTORY]
```

具体 token 按 `research/target-action-matrix.md` 分领域定义。业务页面只展示中文映射；未知 token 必须在类型检查或穷尽分支测试中失败，不提供默认按钮。

### 3.2 命令一致性

- 若 `primary_task` 表示直接命令，该命令 token 必须同时存在于资源自己的 `available_actions`。
- 若 `primary_task` 表示导航、下钻、查看或集合级创建，不放入 `available_actions`。
- 删除、关闭、退回、停用、密码重置和外部费用操作仍使用现有确认流程和 typed command。
- 列表与详情复用同一领域投影器；涉及关联状态的列表先批量查询，禁止 serializer 或 presenter 逐行访问数据库。

### 3.3 受影响的合同

| 领域 | 主要合同变化 |
| --- | --- |
| 产品事实 | 产品与事实版本增加主任务；事实工作区命令由 `CREATE_VERSION` 改为 `SUBMIT_REVIEW`；移除事实版本 `DRAFT` 与版本级 `SUBMIT` |
| 内容生产 | 任务、作业、内容版本增加阶段/主任务；任务返回 `current_content_version_id`；内容版本增加 `ABANDON` 命令和 `ABANDONED` 终态 |
| 发布 | 待发布项、工作、成果、问题增加完整主任务；工作增加 `SWITCH_CONTENT_VERSION`；核验返回当时内容版本 |
| GEO | 观测、问题、平台表现、内容排行和覆盖明细增加领域主任务；增加从仍成立的洞察创建优化任务的命令合同 |
| 配置治理 | AI 渠道、模型、模型发现、平台、账号、用户增加治理阶段/主任务；Header、日志、平台类型增加固定主任务 |

`contracts/openapi.yaml` 仍是 API 唯一权威，生成的 `frontend/src/shared/api/schema.d.ts` 不手改。

### 3.4 受约束删除引用投影（批准增补）

七类可物理删除资源增加必填、可空的 `deletion` 读模型：

```yaml
Deletion:
  required: [blockers]
  properties:
    blockers:
      type: array
      items: {$ref: '#/components/schemas/DeletionBlocker'}
```

- `deletion = null`：当前操作者或业务阶段不进入该资源的删除流程。
- `deletion.blockers = []`：当前读取时没有直接阻断引用；`available_actions` 同时包含 `DELETE`。
- `deletion.blockers` 非空：当前读取时存在直接阻断引用；不返回 `DELETE`，前端显示“查看删除条件”。
- `DeletionBlocker` 只包含稳定机器类型和正整数数量，不下发前端路由、中文文案或引用对象快照。
- 列表投影批量统计直接引用，删除命令锁定目标后重新统计，并通过现有 `409` 错误返回同一类型与数量。用户业务历史按现有全部 `RESTRICT` 归属聚合为一个不可清理类型，不从数据库异常文案猜测引用。

该投影不递归计算引用树，也不建立通用依赖图。用户进入目标页面后，由目标资源自己的 `deletion` 和 `available_actions` 继续给出下一层真实状态。

## 4. 数据模型与迁移

新增单个前滚迁移 `0035_business_workflow_primary_tasks`，在同一版本建立以下不可分割约束。

### 4.1 产品事实

- `fact_versions.status` 新合同只允许 `PENDING_REVIEW | CHANGES_REQUESTED | APPROVED | RETIRED`。
- 为 `status = 'PENDING_REVIEW'` 增加按 `product_id` 的部分唯一索引。
- `POST /products/{product_id}/fact-review-submissions` 在同一事务锁定产品、校验事实工作区 `expected_revision`、冻结 Markdown/分级并直接创建待审核版本。
- 删除旧的“先创建草稿版本、再提交版本”路径和状态转换；被退回版本只允许回到产品事实工作区创建新的提交。

迁移发现任何现存事实版本 `DRAFT` 或同一产品多条待审核记录时以 PostgreSQL `55000` 阻断，因为系统无法替用户决定是否提交或保留哪条审核。

### 4.2 内容版本单主线

- `content_tasks` 增加可空 `current_content_version_id`，外键指向 `content_versions.id`；无内容任务保持空值。
- 数据库约束/触发器保证当前版本必须属于该任务；应用服务在创建人工稿、生成成功、自然化成功、创建修订和放弃修订时原子更新该指针。
- `content_versions.status` 增加 `ABANDONED`；`CHANGES_REQUESTED` 成为不可重提的审核结论。
- 为每个任务最多一个 `PENDING_REVIEW` 增加部分唯一索引；现有“最多一个批准版本”约束继续保留。
- 只有 `current_content_version_id` 指向的版本可以编辑成新版本、提交、审核、自然化或开始新的发布。保存编辑仍创建新的不可变 Markdown 版本并前移指针，不修改旧正文。
- 放弃当前草稿/退回修订时将其标记为 `ABANDONED`；存在最近批准版本则把指针恢复到该版本，否则清空指针。待审核版本必须先形成审核结论，不能直接放弃。
- 新修订存在时，待发布查询只认当前批准版本；已存在发布工作与历史成果不受当前指针变化影响。

迁移按每个任务最大的 `version` 确定当前版本；若存在多条待审核、版本号/归属异常或其他无法唯一确定的主线则以 `55000` 阻断。选择最大版本是现有数据中唯一明确的创建顺序，不对历史正文或审核结论做推断。

### 4.3 发布工作版本切换

- `publication_works` 增加稳定的 `content_task_id` 并从现有内容版本确定性回填；每个内容任务只允许一个发布工作。
- 首次核验成功或显式关闭前，新增命令可把工作切换到同一 `content_task_id`、同一平台的当前批准版本，同时更新 `content_version_id` 与 `content_hash`。
- `publication_work_events` 增加可空 `from_content_version_id`、`to_content_version_id`；版本切换写入 `CONTENT_VERSION_CHANGED` 事件和必填说明，其他历史事件保持空值。
- `publication_verifications` 增加必填 `content_version_id`，每次核验冻结当时版本。现有核验从工作当前版本确定性回填。
- `PublishedArticle` 的最终内容版本从成功核验快照读取；成功后数据库守卫拒绝版本切换，避免依赖可变工作行解释成果。
- 待发布资格改为“任务当前版本已批准且任务尚无发布工作”，不再只按任意批准版本判断。

### 4.4 GEO 优化来源

新增一对一表 `content_task_geo_sources`：

- `content_task_id`：主键并外键到内容任务。
- `rule_code`、当前分析周期、可选 `published_article_id`、`query_topic_id`、`geo_platform`：明确异常身份。
- `basis_snapshot`：由服务端生成并经 Pydantic typed schema 校验的不可变 JSONB，保存当时指标、阈值和中文依据。
- `created_by`、`created_at`：追溯创建人和时间。

新增 `POST /geo-insights/optimization-content-tasks`。客户端提交分析周期、异常身份和用户补齐的产品、内容平台、批准事实版本；服务端以同一筛选重新计算洞察，只接受仍存在且属于可创建任务规则的异常，再在同一事务创建内容任务与来源快照。宽泛平台聚合和数据不足规则只允许下钻/补充观测，命令必须拒绝。

不建立通用“任务来源”框架；当前只有 GEO 优化来源需要这组不可变指标，发布后问题继续使用已有 `source_published_content_issue_id`。

### 4.5 主任务不持久化

`workflow_stage`、`primary_task` 和治理阶段全部由当前权威数据派生，不新增数据库列。这样状态只在产品事实、内容、发布、GEO 和配置各自的现有所有者中维护一次。

## 5. 领域服务改造

### 5.1 产品事实与内容

- `product_facts` 服务负责原子事实提交和产品级批量阶段投影。
- `review_policy` 删除事实草稿提交与内容退回重提转换；审核服务锁定当前内容版本后才允许内容转换。
- `content_production` 统一负责推进 `current_content_version_id`；并发创建、生成完成和放弃操作使用任务行锁串行化。
- `projections` 批量读取最新事实、当前内容、生成作业和发布工作，返回任务主阶段；不在前端拼接“最近作业 + 最近版本 + 发布状态”。

### 5.2 发布与 GEO

- 发布服务以 `publication_works.content_task_id` 锁定稳定来源；切换版本、核验和关闭沿用 `expected_revision`。
- 核验、事件和成果查询显式使用版本快照，失败后继续 `ACTION_REQUIRED` 的既有规则不变。
- GEO 观测服务继续实时计算洞察，并为每条排行/覆盖结果投影主任务；创建优化任务时重新计算而不是信任客户端提交的指标。

### 5.3 配置治理

- AI 渠道阶段由 API Key、模型存在性、模型测试结论、模型启用状态和渠道启用状态批量派生。
- AI 模型阶段同时考虑自身测试/启用状态和所属渠道状态。影响请求合同的渠道、API Key、Header、模型标识或请求参数变更统一使相关模型测试结论失效并停用必要对象；复用现有配置服务，不新增平行失效逻辑。
- 平台阶段由启停和 Prompt 绑定派生；缺少 Prompt 只标记“系统生成配置不完整”，人工内容任务仍可创建。
- 发布账号和用户阶段复用已有引用保护、自己/最后管理员保护与权限投影。

## 6. 前端实现

### 6.1 领域内穷尽映射

每个 feature 在本领域页面内维护 typed `primary_task` 到以下三种结果的穷尽映射：

1. 打开已有工作区或 Drawer，并通过路径参数或 URL 查询参数定位当前步骤。
2. 打开确认/填写对话框后调用已有或新增命令。
3. 打开只读详情、历史或带精确筛选的下钻页面。

不创建跨全站 action registry，不让服务端返回路由字符串，不为只有一个使用方的映射增加工厂或插件层。

### 6.2 操作列结构

- 主操作使用清晰中文文本按钮或链接；次级操作进入“更多”菜单，危险项置底并标记危险样式。
- 固定终态用“查看历史/记录/详情”等真实入口，不显示空白单元格、禁用占位按钮或“无可用操作”。
- 逐篇文章观测结果保持行内输入与父级提交；覆盖计数改用非表格概览卡，覆盖明细使用标准 Ant Table。
- 桌面固定右侧操作列，移动卡片复用同一 `primary_task` 和 `available_actions`，保留焦点返回、加载状态和错误反馈。
- 中文阶段名称复用/扩展领域枚举映射；技术 token 不直接显示给用户。

### 6.3 工作区定位

复用现有路由：`/products/:productId`、`/tasks/:taskId`、`/content/:contentVersionId`、`/publications`、`/observations`、`/observations/insights`、`/configuration/*`、`/settings`、`/users`、`/audit`。只增加必要的稳定查询参数（如 tab、selected、step 和筛选 ID），不新建重复详情页。

### 6.4 删除条件与引用下钻（批准增补）

- 当前 feature 只按 `deletion` 与 `available_actions` 渲染“删除”或“查看删除条件”，不得按角色、状态或关联字段重建资格。
- 复用共享引用列表展示；具体跳转仍归各 feature 所有，不建立跨全站 action registry。
- 平台类型下钻具体平台；平台下钻发布账号和内容任务；发布账号下钻发布工作；产品下钻事实版本、内容任务和 GEO 观测；事实版本下钻关联任务；内容任务下钻自身版本、发布工作和来源记录；停用用户下钻相关审计历史。
- 缺少稳定筛选的现有列表仅增加必要 URL/API 查询参数。引用页在新标签页打开，原页保留“重新检查”入口；重新检查必须重新读取服务端，不在本地删除 blocker。
- 不可变引用的操作文案使用“查看历史”，不得使用“去删除”或承诺最终可删除原对象。

## 7. 文档与规范一致性

同一任务更新：

- `contracts/openapi.yaml`：API、状态、typed 主任务和命令合同。
- `contracts/database.md`：当前指针、唯一约束、发布版本快照、GEO 来源和迁移边界。
- `docs/GEO多平台内容运营系统方案设计.md`：D1—D11 对应的最终业务流程。
- `docs/GEO系统前后端技术与部署方案.md` 与 `docs/architecture.md`：跨层数据流、服务端权威和迁移/发布注意事项。
- `.trellis/spec/backend/available-actions-contract.md`：明确 `primary_task` 与命令资格边界。
- `.trellis/spec/frontend/component-guidelines.md`：主操作、次级操作、终态和移动端等价规则。

不在多份文档重复枚举全部 25 表矩阵；任务矩阵保存决策历史，长期合同分别由 OpenAPI、数据库文档和 Trellis spec 所有。

## 8. 兼容、上线与回滚

- 本任务不保留旧事实草稿 API、旧状态转换或前端兼容分支；前后端与迁移必须作为同一发布单元。
- 迁移前备份并运行预检。可确定数据前滚；歧义数据以 `55000` 停止，按已批准的开发阶段边界在核对备份后重建环境。
- 迁移包含不可逆状态合同和新历史快照，`downgrade()` 必须明确拒绝有损降级。回滚发布使用迁移前数据库备份和上一版应用镜像，不尝试反向猜测内容主线。
- 本任务完成本地验证，不直接执行生产部署；后续上线任务再次确认目标数据库、备份和维护窗口。

## 9. 主要风险与控制

| 风险 | 控制 |
| --- | --- |
| 前端再次按状态猜主操作 | required typed `primary_task`、相同状态不同投影 fixture、穷尽映射测试 |
| 投影产生 N+1 查询 | 列表批量查询、查询计数测试 |
| 内容版本出现多主线 | 任务当前指针、任务行锁、待审核唯一索引、数据库归属守卫 |
| 发布改稿丢失核验依据 | 工作稳定任务 ID、版本切换事件、核验内容版本快照、成功后数据库拒绝切换 |
| 客户端伪造 GEO 异常 | 创建命令重新计算洞察并保存服务端快照 |
| 配置修改后继续使用旧验证 | 配置服务统一失效测试结论，启用命令再次校验 |
| 旧数据无法安全转换 | 迁移预检、明确 `55000`、备份后重建，不加兼容猜测 |
