# 修复 DEF-002 内容任务创建幂等

## 目标

关闭已部署验收缺陷 DEF-002：快速双击、网络重试或响应迟到时，同一次内容任务创建意图只能产生一条任务；服务端继续作为幂等、权限和输入校验的最终权威。

## 背景与根因

- 完整验收报告证明快速双击后列表从 8 条增至 10 条，并创建两条相同业务输入的 `OPEN` 任务（`artifacts/deployed-acceptance/20260730-002915/acceptance-report.md:124`、`:133`、`:185`）。
- 前端仅用异步 `create.isPending` 显示 loading；创建请求只带 CSRF，没有 `Idempotency-Key`（`frontend/src/features/content-tasks/ContentTasksPage.tsx:232`、`:253`、`:273`）。
- 后端创建路由不接收幂等头，服务在每次调用中无条件插入任务并追加审计（`backend/app/routers/planning.py:159`、`backend/app/services/content_planning.py:155`）。
- `content_tasks` 当前没有幂等列或唯一约束（`backend/app/models/content.py:26`）；OpenAPI 已有可复用的必填 `IdempotencyKey` 参数，但创建任务端点未引用（`contracts/openapi.yaml:1279`、`:2053`）。

## 需求

- R1：`POST /api/v1/content-tasks` 必须要求 8–128 字符的 `Idempotency-Key`，权限、CSRF 和现有三字段载荷保持不变。
- R2：同一幂等键与完全相同的 `product_id`、`fact_version_id`、`platform_profile_id` 重放时，返回首次创建的同一任务，HTTP 状态保持 `201`，不新增任务或审计。
- R3：同一幂等键用于不同载荷时返回 `409 IDEMPOTENCY_CONFLICT`，不得创建或修改任务。
- R4：不同幂等键仍允许用户有意创建相同业务输入的新任务；三字段组合不是业务唯一键。
- R5：并发同键请求必须由 PostgreSQL 事务 advisory lock 串行化，并由持久化唯一约束兜底；Redis 不参与业务状态或幂等。
- R6：前端一次创建弹窗生命周期生成并复用一个键；快速双击和失败后的安全重试使用同一键，关闭后重新打开弹窗才生成新键。提交期间继续显示 loading。
- R7：重放仍经过现有认证、角色和 CSRF 依赖；只有首次创建追加 `content_task.created` 审计。
- R8：历史任务和发布修复任务不回填、推断或伪造客户端幂等键；迁移只新增可空列和非空值唯一约束。
- R9：同步更新 OpenAPI、数据库合同、业务/技术设计和生成的前端 API 类型。

## 验收标准

- [x] AC1：两个并发的同键同载荷服务请求返回同一 UUID；数据库仅一条对应任务和一条创建审计。
- [x] AC2：顺序重放同键同载荷也返回原任务；平台随后停用等当前配置变化不把已成功请求重新解释为新请求。
- [x] AC3：同键异载荷返回 `409 IDEMPOTENCY_CONFLICT`，原任务保持不变。
- [x] AC4：不同键同载荷创建两条任务，证明没有误加三字段业务唯一约束。
- [x] AC5：缺少或长度非法的 `Idempotency-Key` 在 API 边界返回结构化 `422`；权限与 CSRF 行为不弱化。
- [x] AC6：前端创建请求包含生成类型认可的 `Idempotency-Key`；快速连续提交不产生不同键。
- [x] AC7：从 `0031` 升级后历史任务保留且幂等列为空；非空键唯一；降级移除新增列但不删除任务。
- [x] AC8：定向合同、迁移、PostgreSQL 并发、前端组件、lint 和 typecheck 全部通过。
- [ ] AC9：部署后按独立授权执行真实页面快速双击回归，任务列表净增一条，刷新后不增殖；不调用模型。

## 不在范围

- DEF-001、DEF-AI-001，以及其他权限、页面或网关问题。
- 内容任务三字段业务去重、重复任务历史清理、自动合并或删除现有任务。
- AI 作业、发布登记等既有幂等实现重构。
- Redis 幂等缓存、通用幂等框架、幂等记录新表、兼容旧客户端的可选 Header。
- 本任务不修改部署环境或线上数据，不删除或覆盖任何验收 artifacts。

## 已确认决定

- 用户已确认采用“请求键幂等”：同键同载荷返回原任务，同键异载荷冲突，不同键允许相同业务输入。
- Header 立即成为必填公共合同；不保留无幂等保障的兼容分支。
- 当前无阻断性产品、兼容或风险决策。
