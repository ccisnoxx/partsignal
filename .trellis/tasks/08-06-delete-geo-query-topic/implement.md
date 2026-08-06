# 删除 GEO 问题：实施计划

## 阶段 1：合同与后端

- [x] 先修改 `contracts/openapi.yaml`：为 `QueryTopic` 增加 required nullable `deletion`、typed `DELETE`，并定义 admin-only DELETE 端点及 `expected_revision`、204/404/409/422 响应。
- [x] 更新 `backend/app/schemas/configuration.py`，使 Pydantic 与 OpenAPI 一致。
- [x] 在 `backend/app/services/content_planning.py` 实现统一批量引用计数、按权限投影删除资格和带行锁/revision/引用复核的删除命令。
- [x] 在 `backend/app/routers/planning.py` 按 `ADMIN` 投影删除能力，并增加 `AdminUser` + CSRF 的 DELETE 路由。
- [x] 将 `query_topic.deleted` 加入 `backend/app/audit_types.py` 的保留型成功审计白名单。
- [x] 更新 `backend/tests/unit/test_workflow_projections.py`：覆盖 ADMIN 可删、三类单独/组合阻断、ENGINEER `deletion=null`，并证明列表数量不增加 SQL 条数。
- [x] 更新 `backend/tests/unit/test_contract.py`：覆盖运行时合同、ENGINEER/匿名/CSRF 拒绝与目标不变。
- [x] 更新 `backend/tests/integration/test_publication_workflow.py`：使用 PostgreSQL 覆盖成功删除、重复删除、stale revision、投影后新增引用以及三类精确 `QUERY_TOPIC_IN_USE`，并断言失败无成功审计。

## 阶段 2：生成类型与前端

- [x] 运行 `make contract-generate`，只通过 OpenAPI 重新生成 `frontend/src/shared/api/schema.d.ts`。
- [x] 更新 `GeoTopicsPage.tsx`：按服务端投影显示“删除”或“查看删除条件”，复用现有确认、阻断与焦点恢复组件；请求携带当前 revision。
- [x] 删除成功失效 `queryKeys.queryTopics` 与 `queryKeys.geo.all`；结构化失败保留列表并刷新权威投影。
- [x] 更新 `AuditLogDetailPanel.tsx` 的 `query_topic.deleted` 中文动作标签。
- [x] 新增 `GeoTopicsPage.test.tsx`：覆盖 ADMIN 可删确认与请求、阻断数量且不发 DELETE、ENGINEER 无删除入口、成功刷新和 409 错误呈现。

## 阶段 3：文档与一致性

- [x] 更新 `.trellis/spec/backend/available-actions-contract.md`，把 `QueryTopic` 纳入 required nullable 删除投影资源。
- [x] 更新 `docs/GEO多平台内容运营系统方案设计.md`，记录仅 ADMIN、三类引用保护、永久删除和非级联规则。
- [x] 对新增或实质修改的 Python/TypeScript 业务代码执行中文注释、docstring、日志和错误文本检查；只说明非显然规则。
- [x] 检查最终 diff，确认没有迁移、依赖、兼容 fallback、重复权限判断、第二套引用计数或无关改动。

## 必需验证

以下命令直接覆盖本任务的公开合同、权限、数据库并发边界和页面行为：

```bash
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/unit/test_workflow_projections.py backend/tests/unit/test_contract.py -q
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -k query_topic
npm --prefix frontend exec vitest run src/features/geo-observations/GeoTopicsPage.test.tsx
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check backend/app/services/content_planning.py backend/app/routers/planning.py backend/app/schemas/configuration.py backend/app/audit_types.py backend/tests/unit/test_workflow_projections.py backend/tests/unit/test_contract.py backend/tests/integration/test_publication_workflow.py
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy --config-file backend/pyproject.toml backend/app
npm --prefix frontend run lint
npm --prefix frontend run typecheck
git diff --check
```

若 PostgreSQL 集成环境不可用，不以 SQLite 或 mock 替代；保留集成测试并明确报告未运行原因。

## 可选完整回归

仅在目标验证暴露共享合同风险、准备发布或用户要求时执行，避免把全仓耗时检查当作本任务默认完成条件：

```bash
make test-unit
make test-integration
make build
make e2e
```

## 完成条件

- [x] `prd.md` 的验收条件全部满足。
- [x] API、Pydantic、生成类型、前端行为、审计和设计文档一致。
- [x] 必需验证通过，或对不可运行项给出可复现的环境阻断与剩余风险。
- [ ] 实施完成后先提交 commit 计划并获得用户确认；不自动推送。
