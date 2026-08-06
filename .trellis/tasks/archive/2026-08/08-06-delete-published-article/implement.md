# 支持删除发布成果：实施计划

## 阶段 1：合同与数据库边界

- [x] 修改 `contracts/openapi.yaml`：为发布成果增加 `revision`、required nullable `deletion`、typed `PERMANENT_DELETE`、永久删除预览/请求 Schema，以及 admin-only preview/command 路径。
- [x] 更新 `contracts/database.md`，固定成果聚合删除范围、两类 GEO 阻断、来源任务恢复、修复任务解绑、外部页面边界和事务变量。
- [x] 新增下一号 Alembic 迁移：为发布聚合子表安装精确 DELETE 守卫，同时保留已归档内容任务永久删除语境；升级/降级都不得留下宽泛放行。
- [x] 先补 PostgreSQL 迁移/集成用例，证明未声明、错配目标和存在 GEO 引用时直接删除返回 `55000`，两种合法聚合删除语境通过。

## 阶段 2：后端投影与删除命令

- [x] 更新 publication Schema：成果动作加入 `PERMANENT_DELETE`，成果列表/详情增加 `revision` 与 `deletion`，增加发布成果永久删除预览和请求模型。
- [x] 在 publication query 层实现批量 GEO 依赖计数，列表/详情按管理员身份投影相同删除资格，不产生 N+1。
- [x] 在 publication service 中实现成果删除 scope、实时预览和原子永久删除：锁内复核 revision/依赖，删除内部聚合，保留批准内容和修复任务，恢复来源任务为 `OPEN`，清理文件关系与旧 target 审计，写最小成功墓碑。
- [x] 调整已归档内容任务永久删除，在清理发布历史前设置任务删除上下文，确保新数据库守卫不改变既有能力。
- [x] 在 router 中传入 actor-aware 投影并新增 `AdminUser` + CSRF 的预览/永久删除端点；把成功动作加入审计白名单。
- [x] 更新发布就绪查询排除 `archived_at` 非空任务，保证删除归档成果后必须先恢复任务才可再次发布。

## 阶段 3：生成类型与前端

- [x] 运行 `make contract-generate`，只从 OpenAPI 生成 `frontend/src/shared/api/schema.d.ts`。
- [x] 修改 `PublicationsPage.tsx`：在列表、移动卡片和详情统一消费 `PERMANENT_DELETE` / `deletion`；复用 `DeletionGuidanceModal`，增加实时预览、固定确认文本、外部页面警示和成功后的 URL/查询失效。
- [x] 更新审计详情动作中文标签；不在前端推导角色、状态或依赖。
- [x] 更新前端针对性测试：组件层覆盖管理员无引用可删、两类精确阻断、预览确认和详情文案；普通用户权限与 `409` 竞态由后端集成测试和真实 E2E 覆盖。
- [x] 更新既有发布 E2E：把“成果无删除按钮”的旧断言替换为管理员预览确认和工程师端点拒绝，并验证没有失败业务请求或控制台错误。

## 阶段 4：规范、文档与一致性

- [x] 更新 `.trellis/spec/backend/publication-workbench-guidelines.md`、`.trellis/spec/backend/available-actions-contract.md`、`.trellis/spec/backend/database-guidelines.md` 与 `docs/GEO多平台内容运营系统方案设计.md`，删除“成果绝对不可单项删除”的过时设计，记录受控聚合永久删除合同。
- [x] 对实质修改的 Python/TypeScript、迁移和开发者可见文本执行中文文档检查；只为非显然业务边界、数据库守卫和异常路径补充说明。
- [x] 检查最终 diff，确认没有单删 `PublishedArticle` 的症状补丁、GEO 静默解绑、第二套依赖统计、权限前移、隐藏 fallback、无关重构或未说明行为变化。

## 必需验证

以下检查直接覆盖公开合同、数据库最终守卫、权限/并发、来源任务恢复和页面行为：

```bash
make contract-check
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/unit/test_contract.py backend/tests/unit/test_workflow_projections.py -q
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest backend/tests/integration/test_publication_workflow.py -q -k "published_article and (delete or deletion or permanent)"
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check backend/app backend/tests backend/alembic/versions
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy --config-file backend/pyproject.toml backend/app
(cd frontend && node_modules/.bin/vitest run src/features/publications/PublicationsPage.test.tsx src/shared/components/DeletionError.test.tsx)
npm --prefix frontend run lint
npm --prefix frontend run typecheck
./deploy/scripts/e2e-local.sh tests/e2e/mvp-flow.spec.ts --project=e2e --grep "批准事实到人工发布"
git diff --check
```

若 PostgreSQL 或浏览器测试环境不可用，不以 SQLite、mock 成功或手工点击替代；保留测试并报告可复现阻断与剩余风险。

## 可选完整回归

仅在针对性检查暴露共享状态机/合同风险、准备发布或用户另行要求时运行：

```bash
make test-unit
make test-integration
make build
make e2e
```

## 完成条件

- [x] `prd.md` 验收条件全部满足，代码、迁移、合同、生成类型、测试与权威文档一致。
- [x] 必需验证通过，或不可运行项有明确环境证据和剩余风险。
- [x] 实施完成后先提交 commit 计划并获得用户确认；不自动提交或推送。

## 验证记录（2026-08-06）

- `make contract-check`、后端 ruff、mypy、前端 lint、typecheck 与 `git diff --check` 通过。
- 后端相关单元测试通过 34 项；PostgreSQL 集成测试通过 3 项，覆盖成果删除成功、GEO 双来源阻断与既有内容任务永久删除回归。
- 发布页组件测试通过 15 项，共享删除错误组件测试通过 1 项。
- 官方隔离 E2E 完成全量迁移 `0001 -> 0038`、前端生产构建与发布主流程，2 项通过；工程师预览和删除分别返回 `403`，隔离数据库与存储均已清理。
- 可选仓库全量回归未运行；针对性检查、完整迁移链和发布主流程已覆盖本次共享合同、数据库、权限与页面风险。
- 剩余环境事项：在切换到官方隔离脚本前误用共享开发库运行过两次未完成的 E2E setup，可能留有局部测试记录；未进行按名称猜测或批量清理，需另行精确识别后处理。
