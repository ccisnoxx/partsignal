# DEF-002 根因与调用链

## 证据

1. 验收证据：`artifacts/deployed-acceptance/20260730-002915/acceptance-report.md:124-138` 记录快速双击创建两个相同 `OPEN` 任务；`:185` 记录两次成功响应。
2. 前端：`TaskCreateModal` 的 `onFinish` 直接调用 mutation，POST 只带 CSRF；按钮 loading 依赖异步 mutation 状态（`frontend/src/features/content-tasks/ContentTasksPage.tsx:232-273`）。
3. API：`POST /api/v1/content-tasks` 只接收 body、Request、数据库、工程师身份和 CSRF，没有幂等头（`backend/app/routers/planning.py:159-175`）。
4. 服务：`create_content_task` 完成平台、事实和产品校验后无条件构造、flush、审计并 commit（`backend/app/services/content_planning.py:155-201`）。
5. 数据库：`ContentTask` 没有幂等字段；现有唯一约束只覆盖修复来源（`backend/app/models/content.py:26-59`）。
6. 既有模式：生成作业用持久化唯一键做同键载荷校验；人工发布还用 PostgreSQL advisory lock 串行化并发重放（`backend/app/services/content_production.py:256-299`、`backend/app/services/publication.py:428-453`）。

## 权威根因

创建链路的每一层都把两次点击视为两个独立请求：前端没有稳定请求键，API 没有幂等合同，服务没有重放判断，数据库没有相同键唯一性。`loading` 状态只能降低重复交互概率，不能处理同一事件循环内双击、请求重放或响应丢失。

## 最小修复判断

复用已有 `Idempotency-Key` 参数、`newIdempotencyKey()`、PostgreSQL advisory lock 和 `IDEMPOTENCY_CONFLICT` 语义。只为普通内容任务创建持久化请求键；不把三字段组合改成业务唯一键，不增加 Redis、通用框架或独立幂等表。
