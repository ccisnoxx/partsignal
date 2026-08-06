# 支持删除发布成果：技术设计

## 1. 结论与不变量

删除以一条成功发布形成的完整发布聚合为边界：`PublicationWork`、同 ID `PublishedArticle`、工作事件、核验、附件关系和内容问题一起删除；来源 `ContentTask`、已批准 `ContentVersion`、事实版本、修复任务及外部页面保留。

核心不变量如下：

- 来源成果没有独立 GEO 下游引用时，管理员可以永久删除，来源任务恢复为可再次发布的 `OPEN`。
- `GeoObservationPublication` 与 `GeoObservationCitation` 按去重后的观测数量作为 `GEO_OBSERVATION` 阻断；`ContentTaskGeoSource` 作为 `GEO_OPTIMIZATION_SOURCE` 阻断。删除不得依赖现有 `CASCADE` / `SET NULL` 偷偷清理这些关系。
- `PublishedContentIssue` 属于成果聚合内部范围；删除问题时，现有 `ON DELETE SET NULL` 只解除独立修复任务的来源问题关联，不删除修复任务。
- 外部公开页面不在系统控制范围，预览和确认必须明确说明不会删除外部页面。
- 前端投影只是当前提示；服务端命令与 PostgreSQL 守卫共同决定最终资格。

该边界修正了当前“只能删除整个来源任务”的所有权错误：删除成果不应顺带删除已批准内容，删除内容任务也不再是清理单条成果的必经入口。

## 2. API 与读模型

### 2.1 成果动作投影

`PublishedArticleListItem` 与 `PublishedArticleOut` 增加 required 字段：

- `revision: int`：权威值来自同 ID `PublicationWork.revision`，不新建第二个 revision。
- `deletion: DeletionProjection | null`：仅管理员获得删除管理上下文。
- `available_actions` 的 typed union 增加 `PERMANENT_DELETE`。

管理员读取列表或详情时：

- 无 GEO 阻断：`deletion={blockers: []}`，动作包含 `PERMANENT_DELETE`。
- 有 GEO 阻断：`deletion.blockers` 返回 `GEO_OBSERVATION`、`GEO_OPTIMIZATION_SOURCE` 中实际存在的类型和正整数数量，不包含 `PERMANENT_DELETE`。

非管理员固定 `deletion=null`，不得包含 `PERMANENT_DELETE`；既有 `OPEN_ISSUE` 资格独立计算，不因删除能力变化。

列表投影对当前页成果批量统计依赖：以 `UNION` 合并 publication/citation 两张关系并按 `published_article_id` 统计 distinct `observation_id`，另一次聚合查询统计 `ContentTaskGeoSource`。详情复用同一投影函数，不逐行查询。

### 2.2 永久删除预览与命令

新增管理员端点：

```http
GET  /api/v1/published-articles/{article_id}/permanent-deletion-preview
POST /api/v1/published-articles/{article_id}/permanent-delete
```

预览响应包含：

- `article_id`、当前工作 `revision`；
- 将删除的事件、核验、附件关系和内容问题数量；
- 将解除来源问题关联但保留的修复任务数量；
- 唯一外部公开 URL；
- 固定确认文本 `永久删除`。

POST 请求包含 `expected_revision` 与 `confirmation_text`，要求管理员、登录、合法 CSRF，成功返回 `204`。不存在或重复删除返回 `404`；revision 过期返回 `409 REVISION_CONFLICT`；确认文本错误返回 `422 PERMANENT_DELETE_CONFIRMATION_MISMATCH`；GEO 引用返回 `409 PUBLISHED_ARTICLE_IN_USE` 和标准 `details.references`。

不增加兼容端点、DELETE 请求体或通用 command 包装器；复用内容任务永久删除的 preview/confirm 交互形状，但使用发布领域自己的 Schema。

## 3. 后端事务

### 3.1 删除范围投影

在现有发布服务中建立一个成果删除 scope，集中读取并锁定：来源任务、工作、成果、事件、核验、附件、问题，以及问题派生的修复任务数量；同时复用读投影的 GEO 引用统计口径。该 scope 同时服务实时预览与写命令，避免影响范围和执行范围漂移。

### 3.2 写命令顺序

永久删除命令在一个事务中：

1. 根据 article ID 找到来源任务，按既有聚合顺序锁定来源任务、工作和成果，并校验三者仍属于同一成功发布闭环。
2. 校验 `expected_revision` 和固定确认文本。
3. 在成果行锁内重新统计两类 GEO 阻断；有引用立即返回结构化 `409`。
4. 设置仅限当前事务和目标成果的删除上下文。
5. 删除成果问题；由现有外键把独立修复任务的 `source_published_content_issue_id` 置空。
6. 删除成果、附件关系、事件、核验和工作；无引用文件沿用现有延迟清理机制。
7. 保留 `current_content_version_id` 与已批准内容，把来源任务从 `COMPLETED` 改为 `OPEN` 并增加 revision；保留 `archived_at`。发布就绪查询必须排除已归档任务，恢复归档后才再次出现。
8. 清理已删除对象的旧 target 审计，追加一条最小 `published_article.permanently_deleted` 成功审计并提交。

任一步失败全部回滚；失败不得写成功审计。

## 4. PostgreSQL 迁移与最终守卫

新增下一号迁移，恢复并收紧当前仅靠服务约定的发布历史删除边界：

- 为 `publication_works`、`publication_work_events`、`publication_verifications`、`published_articles`、`published_content_issues` 和 `publication_attachments` 的 DELETE 安装受控守卫。
- 只有事务变量精确匹配 `partsignal.published_article_delete_id`，或匹配既有 `partsignal.content_task_delete_id` 的来源任务聚合时允许删除；其他直接删除以 PostgreSQL `55000` 拒绝。
- 成果级删除上下文还必须在数据库内复核不存在三类 GEO 关系，防止绕过服务后触发当前 `CASCADE` / `SET NULL`。
- 调整现有任务永久删除服务，在删除发布子对象之前设置 `partsignal.content_task_delete_id`；其已归档整任务删除行为保持不变。
- 现有延迟完成一致性触发器继续校验 work/article/task 闭环；成果事务删除工作并把任务恢复 `OPEN` 后，提交态仍满足约束。

不把 GEO 外键机械改回 `RESTRICT`：它们还服务已归档内容任务的整聚合永久删除。删除语境由精确事务变量区分，避免建立第二套外键关系。

## 5. 前端交互

在发布成果行、移动卡片和详情 Drawer 的既有动作区消费服务端投影：

- `PERMANENT_DELETE`：显示危险操作“永久删除”，先请求实时预览，再展示内部删除数量、保留但解绑的修复任务数量、外部 URL 和“不删除外部页面”说明；输入 `永久删除` 后才可提交。
- `deletion.blockers` 非空：显示“查看删除条件”，复用 `DeletionGuidanceModal` 展示两类精确数量和重新检查；不得发送删除请求。
- `deletion=null`：不显示删除相关入口。

删除成功后关闭详情，清除 URL 中已删除选中项，并失效发布工作台、内容任务、发布成果、内容问题、GEO 候选/观测和审计查询。失败保留当前页面；结构化引用冲突使用现有 `DeletionError`，随后刷新权威投影。

原“发布成果为只读历史，不提供修改或删除”改为“正文与核验历史不可原地修改；管理员可在无下游引用时永久删除整个发布聚合”，避免与新能力冲突。

## 6. 受影响边界

计划修改：

- 合同与生成类型：`contracts/openapi.yaml`、`frontend/src/shared/api/schema.d.ts`
- 数据库：`contracts/database.md`、新 Alembic 迁移
- 后端：publication schemas/router/query/service、动作/审计类型及相关测试
- 前端：`PublicationsPage.tsx`、对应组件测试、审计动作中文标签、既有发布 E2E
- 权威规范：发布工作台规范、动作投影规范、GEO 系统设计文档

不新建服务层、删除框架、回收站、软删除列或兼容类型。

## 7. 风险、回滚与取舍

- 永久删除不可恢复；预览、固定确认文本、管理员权限和最小审计共同承担风险控制。
- 主要并发风险是预览后新增 GEO 引用；成果行锁、写命令重算、外键锁和数据库删除守卫共同阻止竞态。
- 删除后外部页面仍存在，系统可能再次把同一 URL 登记为新成果；这是允许重新发布的明确结果，不增加 URL 墓碑或历史唯一性。
- 代码回滚可以移除新入口并恢复旧守卫，但不能恢复已删除数据；恢复依赖数据库备份。
- `clean-code-design` 的影响：删除 scope 保持在现有发布领域所有者中，revision 复用 Work，不拆新模块、不引入通用抽象；新增复杂度仅用于公开合同、并发与数据库最终守卫。
