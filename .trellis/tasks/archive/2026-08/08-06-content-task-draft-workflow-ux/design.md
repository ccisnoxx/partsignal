# 内容任务工作流与人工草稿管理优化：技术设计

## 1. 设计结论

本任务只引入一个可变窗口和一个删除例外：**当前人工未审核 `DRAFT` 可原地保存，未审核且无引用的人工 `DRAFT / ABANDONED` 可受控删除**。其余内容版本和全部 AI 作业继续不可变。

服务端仍是状态、权限和引用门禁的唯一权威。前端只消费 `workflow_stage`、`primary_task` 和 `available_actions`，不按状态自行补写操作。

### 1.1 已验证的当前实现

- `backend/app/services/projections.py:201` 当前给所有当前 `DRAFT` 投影 `CREATE_REVISION` 和 `ABANDON`，尚未区分人工与 AI 来源。
- `backend/app/services/content_production.py:665` 只支持创建人工首稿、创建新修订和放弃，没有人工草稿原地保存或单版本删除命令。
- `backend/alembic/versions/0035_business_workflow_primary_tasks.py:289` 把内容载荷全部视为不可变，必须由新 head 精确收窄。
- `frontend/src/features/content-tasks/ContentTasksPage.tsx:879` 以 `!canGenerate` 推出“必须新建任务”，并在 `02A` 卡片中渲染续建按钮；`:1081` 创建后自动打开 AI 弹窗。
- `frontend/src/features/content-editor/ContentEditorPage.tsx:312` 只识别 `CREATE_REVISION`，现有 `RevisionForm` 已具备 Markdown、预览、dirty 和离开确认能力，可以复用。
- `frontend/src/shared/components/StatusTag.tsx:6` 已集中管理中文状态，但缺少 `ABANDONED`。

## 2. 合同变更

### 2.1 内容草稿保存

在既有单项资源路径增加：

```http
PUT /api/v1/content-versions/{content_version_id}
```

新增 `ContentDraftUpdate`：

```yaml
required:
  - expected_revision
  - title
  - summary
  - body_markdown
  - tags
```

- `expected_revision` 必须为非负整数。
- 内容字段复用 `ContentRevisionCreate` 的非空 Markdown 与标签校验，不新增兼容默认值。
- 成功返回重新投影的 `ContentVersion`。
- revision 冲突返回 `409 REVISION_CONFLICT`；非当前版本返回既有 `409 CONTENT_VERSION_NOT_CURRENT`；来源、状态、任务或审核资格不符返回 `409 INVALID_STATE_TRANSITION`。任何失败都不静默转为创建新版本。

保存命令锁定任务和目标版本后重新校验：任务为 `OPEN`、目标为当前版本、`source_type=HUMAN`、`status=DRAFT`、`source_job_id=NULL`、没有审核记录。成功后只更新四个可编辑字段、`content_hash`、`quality_issues` 和 revision。

### 2.2 内容草稿删除

在同一路径增加：

```http
DELETE /api/v1/content-versions/{content_version_id}?expected_revision=<revision>
```

- 成功返回 `204`。
- query 中的 `expected_revision` 防止用户删除打开页面后已被他人保存的新内容。
- 不返回删除内容，不建立软删除字段或墓碑表。
- 来源或状态不允许时返回 `409 INVALID_STATE_TRANSITION`；存在直接引用时返回新增的结构化 `409 CONTENT_VERSION_IN_USE` 及非零引用类型和数量。

服务锁定目标任务与版本，再用同一资格规则检查：

```text
source_type = HUMAN
source_job_id IS NULL
status IN (DRAFT, ABANDONED)
审核记录数 = 0
下游内容版本数 = 0
生成作业来源/结果引用数 = 0
发布工作/事件/核验引用数 = 0
```

目标是任务当前版本时，先把 `current_content_version_id` 改为 `based_on_id`；目标是历史版本时保持指针不变。随后设置事务内精确版本删除语境并删除目标，最后写入 `content_version.deleted` 成功审计。审计只保存 `task_id`、版本号等稳定标识，不保存内容载荷。

### 2.3 动作投影

复用现有资源级动作名，给 `ContentVersion.available_actions` 增加 `SAVE` 与 `DELETE`，不创建第二套权限字段。

| 版本状态/来源 | 服务端动作 |
| --- | --- |
| 当前 `HUMAN DRAFT` | `SAVE`, `SUBMIT_REVIEW`, 条件满足时 `DELETE` |
| 当前 `AI DRAFT` | `CREATE_REVISION`, 条件满足时 `CREATE_HUMANIZATION_JOB`, `SUBMIT_REVIEW`, `ABANDON` |
| 当前 `CHANGES_REQUESTED` | `CREATE_REVISION`, AI 来源满足现有门禁时 `CREATE_HUMANIZATION_JOB`, `ABANDON` |
| 历史未审核 `HUMAN ABANDONED` | 条件满足时 `DELETE` |
| 其他状态 | 保留现有审核、发布或只读动作，不增加保存/删除 |

删除资格需要同一规则同时服务列表投影和写命令，因此在后端放置一个小型共享策略函数：批量输入版本 ID，批量读取直接引用并返回可删除 ID 集合。写命令在持锁后对单个 ID 重新调用该策略。该函数不缓存、不新增表，也不把读投影当作授权凭证。

## 3. 数据库约束

新增 Alembic head `0040`，不增加业务表或列，只调整 `content_versions` 触发器：

1. 保留任务聚合删除使用的 `partsignal.content_task_delete_id` 例外。
2. `UPDATE` 仅在以下条件同时成立时允许内容载荷变化：人工 `DRAFT`、任务 `OPEN`、目标是任务当前版本、无审核记录、身份/lineage/版本号/创建信息不变、revision 精确加一。
3. 可变字段仅为标题、摘要、Markdown 正文、标签、内容哈希和质量问题；`change_summary` 不在原地保存范围内。
4. 新增 `BEFORE DELETE` 守卫：任务聚合删除语境继续按原规则放行；单版本删除只接受匹配 `partsignal.content_version_delete_id` 的人工未审核 `DRAFT / ABANDONED`。
5. 现有 `RESTRICT` 外键继续阻止子版本、生成、审核和发布引用；应用层在删除前给出结构化错误，数据库作为最终竞态门禁。
6. downgrade 明确拒绝：已保存的旧草稿值和已删除正文无法从数据库重建，只能前滚修复或恢复升级前备份。

ORM 的 `ContentVersion` 文档同步改为“提交审核后不可变；当前人工未审核草稿是唯一原地编辑例外”，避免继续声明所有正文插入后绝对不可变。

## 4. 前端交互

### 4.1 任务详情

`ContentTasksPage.tsx` 按服务端阶段组织三个互斥分支：

1. `NO_DRAFT`：显示 `02A / 系统 AI 生成` 与 `02B / 手动录入`。
2. `OPEN` 且存在当前内容：显示“当前内容工作”，读取当前版本 `primary_task` 作为唯一主入口。
3. `COMPLETED`、`CANCELLED` 等终态：不显示首稿入口；单独显示“新一轮内容生产”及“基于当前上下文新建任务”。`OPEN` 任务的 AI 配置错误只在 AI 卡片中解释，不触发续建分支。

章节导航与区块使用相同条件，避免导航指向不存在的卡片。AI 查询成功且 `items=[]` 时不渲染记录区；加载和失败仍显示可恢复状态。有数据时标题统一为“AI 生成记录”。

### 4.2 基于当前上下文新建任务

复用现有 `TaskCreateModal`，只补充必要的初值能力，不新增第二个创建表单：

- 原产品作为初值；
- 原平台仍有效时作为初值；
- 产品事实列表本身按版本倒序返回，选择第一条 `APPROVED` 作为默认值；
- 不覆盖用户已手动选择的事实版本；
- 若默认版本与来源任务不同，在表单内显示版本变化提示；
- 创建成功后普通导航到 `/tasks/{new_id}`，移除续建路径的 `openAiGeneration` 路由状态。

### 4.3 内容编辑与删除

复用现有 `RevisionForm` 的 Markdown、预览、标签校验、dirty 和离开确认能力，增加“保存当前草稿 / 创建新版本”两种明确模式，不复制第二套编辑器。

- `SAVE` 模式提交 `ContentDraftUpdate`，成功后重置 dirty 基线、显示“已保存”并留在当前 URL。
- `CREATE_REVISION` 模式保持现有行为，提交成功后进入新版本。
- `DELETE` 作为危险次操作进入确认弹窗；成功后返回任务详情并刷新任务、版本、审核上下文和审计查询。
- `ABANDON` 只在服务端返回该动作时显示，因此人工 `DRAFT` 不再出现“放弃当前版本”。

## 5. 中文状态与文案

继续使用现有 `StatusTag` 作为唯一状态映射：

- 补充 `ABANDONED=已放弃` 及中性语义 tone。
- 导出同源的中文 label 读取函数，供 Select 文本和提示使用，避免页面复制映射。
- 把本任务触达的 `HUMAN DRAFT`、裸 `DRAFT` 和“AI 作业”改为用户语言；协议 enum 和测试载荷不变。
- 审计动作 `content_version.deleted` 在审计详情中显示“删除内容草稿”。

## 6. 错误与竞态

| 场景 | 结果 |
| --- | --- |
| 保存时 revision 过期 | `409 REVISION_CONFLICT`，页面保留本地草稿并允许显式重新加载 |
| 保存目标不再是当前人工草稿 | `409`，不创建新版本、不覆盖服务端内容 |
| 删除前新增审核或下游引用 | 锁内复核返回结构化 `409`；目标、指针和引用全部不变 |
| 删除当前草稿但父版本不存在或不属于同任务 | `409`，不把指针指向猜测对象 |
| 续建时没有已批准事实版本 | 表单不提交并明确提示，不回退到旧事实或未批准版本 |
| 原平台已删除或停用 | 不预填不可用平台；用户重新选择，服务端最终校验 |
| AI 记录查询失败 | 显示重试，不当成零记录隐藏 |

## 7. 文档一致性

实现时同步更新：

- `contracts/openapi.yaml`：PUT、DELETE、`ContentDraftUpdate`、动作 enum。
- `contracts/database.md`：人工草稿可变窗口、受控删除、指针恢复和审计。
- `docs/architecture.md`：将“所有内容版本不可变”收窄为提交审核后不可变。
- `docs/GEO多平台内容运营系统方案设计.md`：更新内容版本生命周期、人工草稿操作和任务详情交互。
- `.trellis/spec/backend/database-guidelines.md` 与 `.trellis/spec/frontend/component-guidelines.md`：记录稳定的跨层约束，移除冲突表述。

## 8. 明确不采用的方案

- 不给 AI 草稿增加删除特例，因为会破坏生成作业结果、成本与追溯关系。
- 不通过创建 V3 模拟“保存 V2”，因为用户确认的是提交审核前原地编辑，且无价值的版本膨胀仍会存在。
- 不新增回收站、软删除字段或通用删除框架；本阶段只处理精确的人工未审核草稿。
- 不在已完成任务上恢复生产动作；新一轮仍使用新任务，历史任务保持只读。
