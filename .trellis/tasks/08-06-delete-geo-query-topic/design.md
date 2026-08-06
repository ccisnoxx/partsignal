# 删除 GEO 问题：技术设计

## 1. 结论与不变量

本任务复用现有资源删除合同，不建立 GEO 专用权限或删除框架。唯一业务不变量是：**只有 `ADMIN` 可以删除同时未被内容任务、GEO 优化来源和观测记录直接引用的问题主题**。

- 读取侧只负责投影当前资格；删除命令必须重新校验。
- PostgreSQL 外键继续使用 `ON DELETE RESTRICT`，作为最终数据完整性门禁。
- 不删除、不解绑、不改写任何引用历史，也不引入软删除、回收站或数据库迁移。

## 2. API 合同

### 2.1 `QueryTopic` 读模型

在 `contracts/openapi.yaml` 与 `backend/app/schemas/configuration.py` 中同步修改：

- `available_actions` 从仅允许 `UPDATE` 扩展为 typed `UPDATE | DELETE`。
- 增加 required nullable `deletion: DeletionProjection | null`。
- `ADMIN`：始终获得删除投影；无引用时 `allowed=true`、`blockers=[]` 并包含 `DELETE`，有引用时 `allowed=false`、返回正计数 blockers 且不包含 `DELETE`。
- 所有非 `ADMIN` 用户：保持原有可用动作，固定返回 `deletion=null`，不包含 `DELETE`；`ENGINEER` 因而仍可编辑但不可删除。
- 不具备问题管理语境的嵌套投影调用显式传入 `can_delete=false`，不得因为调用者是管理员而在无关页面暴露删除入口。

### 2.2 删除端点

新增：

```http
DELETE /api/v1/query-topics/{query_topic_id}?expected_revision={revision}
X-CSRF-Token: ...
```

- 依赖：`AdminUser` 与现有 CSRF 校验。
- 成功：`204 No Content`。
- 不存在或重复删除：`404`。
- revision 不一致：复用现有 `409 REVISION_CONFLICT`。
- 存在引用：`409 QUERY_TOPIC_IN_USE`，`details.references` 只包含实际存在的 `CONTENT_TASK`、`GEO_OPTIMIZATION_SOURCE`、`GEO_OBSERVATION` 及正整数数量。
- 缺失或非法 `expected_revision` 返回 `422`；缺失或过短 CSRF header 返回 `422`，格式合法但校验失败返回现有 `403 CSRF_INVALID`。

## 3. 后端实现

### 3.1 单一引用计数

在 `backend/app/services/content_planning.py` 增加一个私有批量计数函数，复用项目已有聚合查询模式，一次固定形态查询三张引用表并按 `query_topic_id`、引用类型返回计数。列表投影与删除命令都调用它，避免资格展示和命令校验形成两个事实来源；列表大小不得改变 SQL 条数。

现有单条投影函数改为委托批量投影。`ADMIN` 列表计算删除资格，非 `ADMIN` 列表不执行引用统计并返回 `deletion=null`。

### 3.2 删除事务

在同一服务文件增加删除命令：

1. 以 `SELECT ... FOR UPDATE` 锁定目标 `QueryTopic`；不存在则返回 `404`。
2. 校验 `expected_revision`，不一致立即返回现有 revision 冲突。
3. 在锁内调用统一引用计数；有引用则通过现有结构化 `in_use` 错误返回 `409 QUERY_TOPIC_IN_USE`。
4. 写入 `query_topic.deleted` 成功审计后删除问题并提交事务。

目标行锁会与并发外键引用写入发生冲突，命令内重算和现有 `RESTRICT` 外键共同保证检查与删除之间不能插入悬空引用。审计使用 `AuditModule.CONTENT_PLANNING`、`target_type=QueryTopic`、稳定目标 ID 和删除时 revision，不保存问题正文或引用快照；将该 action 加入保留白名单，并补充前端审计动作中文标签。

### 3.3 路由与权限

在 `backend/app/routers/planning.py`：

- 列表、创建、编辑响应根据当前用户是否为 `ADMIN` 传入 `can_delete`。
- 新增 admin-only DELETE 路由并调用删除命令。

服务端是最终权限边界；前端不根据角色字符串自行推导删除资格。

## 4. 前端交互

在 `frontend/src/features/geo-observations/GeoTopicsPage.tsx` 保留现有“使用此问题观测”和“编辑”，只为 `deletion !== null` 的行增加低频“更多”菜单：

- `available_actions` 包含 `DELETE`：显示危险操作“删除”。确认框说明不可恢复，并明确该操作不会删除任务、优化来源或观测历史；确认后携带该行 `revision` 发起 DELETE。
- `deletion.blockers` 非空：显示“查看删除条件”，复用 `DeletionGuidanceModal` 展示服务端三类中文标签和数量，不发送删除请求，也不伪造当前不存在的筛选链接。
- `deletion=null`：不展示删除或删除条件入口；这是 `ENGINEER` 的预期表现。

删除成功后提示结果，并失效 `queryKeys.queryTopics` 与 `queryKeys.geo.all`，因为 GEO 洞察筛选也消费问题选项。删除失败保留当前列表；结构化引用冲突复用 `DeletionError` 展示，随后刷新权威问题列表。焦点恢复和危险按钮样式沿用现有删除组件模式。

## 5. 受影响文件

- API 与类型：`contracts/openapi.yaml`、`backend/app/schemas/configuration.py`、生成的 `frontend/src/shared/api/schema.d.ts`
- 后端：`backend/app/services/content_planning.py`、`backend/app/routers/planning.py`、`backend/app/audit_types.py`
- 前端：`frontend/src/features/geo-observations/GeoTopicsPage.tsx`、`frontend/src/features/configuration/AuditLogDetailPanel.tsx`
- 测试：`backend/tests/unit/test_workflow_projections.py`、`backend/tests/unit/test_contract.py`、`backend/tests/integration/test_publication_workflow.py`、新增同目录前端页面测试
- 权威文档：`.trellis/spec/backend/available-actions-contract.md`、`docs/GEO多平台内容运营系统方案设计.md`

不修改数据库模型、迁移、依赖、部署配置或现有三类引用资源的业务行为。

## 6. 兼容、回滚与风险

- `deletion` 是新增 required 字段，前后端与 OpenAPI 必须同批发布；生成类型不得手工修改。
- 回滚代码可关闭后续删除能力，但无法恢复已经永久删除的问题；由于被引用问题无法删除，恢复只能依赖备份或以新 ID 重新创建同名问题。
- 主要风险是资格投影与命令校验漂移、并发引用竞态和错误权限暴露；统一计数函数、行锁、外键、服务端 `AdminUser` 与针对性测试分别覆盖这些风险。
