# Frontend V2 功能合同一致性基线执行计划

## Scope

本计划只生成审计与后续实施规划，不修改产品代码、OpenAPI、数据库、部署或生产数据。

## Phase A：输入冻结

- [x] 阅读根与前后端 `AGENTS.md`。
- [x] 完整阅读用户指定的 Frontend V2 02/03/04/05/06/08/09 文档。
- [x] 完整阅读 `contracts/openapi.yaml` 与 `contracts/database.md`。
- [x] 确认 canonical 路由闭集为 37 条。
- [x] 记录开始时 `main` 工作区已有未提交/未跟踪内容，不修改或纳入这些用户改动。

## Phase B：实现与合同审计

- [x] 审计 `frontend/src/app`、`routes`、`domains`、`design-system`、`shared/api`。
- [x] 审计 generated schema/client 的权威来源和 raw API 旁路。
- [x] 审计 backend read model、command、permission、revision、idempotency、锁和状态转换。
- [x] 审计组件/模型测试、fixture E2E、真实栈 E2E 和 backend HTTP/service tests 的覆盖层级。
- [x] 对 P0/P1 原始代码位置做主会话抽查，不把子代理摘要当最终证据。

## Phase C：基线与拆分

- [x] 写入 37 路由 conformance matrix。
- [x] 写入跨路由合同缺口和已知 `/geo/topics` blocker。
- [x] 每个缺口映射到独立 Task，明确合同决策前置项和依赖顺序。
- [x] 选出首个实施 Task，并冻结精确验收标准。

## Required Validation

本 Task 的必需验证均为只读：

```bash
cd frontend && diff -u src/shared/api/generated/schema.d.ts <(./node_modules/.bin/openapi-typescript ../contracts/openapi.yaml)
PYTHONPATH=backend backend/.venv/bin/python -m app.tools.contract_check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-30-frontend-v2-functional-contract-conformance-baseline
! rg -n '[[:blank:]]+$' .trellis/tasks/08-30-frontend-v2-functional-contract-conformance-baseline
```

预期：generated diff 退出码 0；当前合同检查器报告语义一致；Task 文档通过结构校验且无 context truncation warning；新增文档无行尾 whitespace。`contract_check` 的通过只证明其当前实现覆盖的 operation/request/首个 2xx response，不用于否定非 2xx response drift。

## Optional Validation Not Run

- 不运行 Vitest、Playwright、backend 全套或真实 PostgreSQL 并发测试：本 Task 不修改代码，重型套件不能关闭本轮已识别的特定覆盖缺口。
- 不发起生产请求或生产写操作：`/geo/topics` 使用已有只读复现证据；部署后重验留给独立修复 Task。

## Review Checklist

- [ ] 人工确认 P0/P1 排序和 Task 边界。
- [ ] 人工确认 Article 与 AI operation history 两个合同决策项的 owner。
- [ ] 人工批准首个实施 Task 后再创建/启动该 Task。
- [ ] 本基线通过 review 后再完成或归档，不自动提交、推送或启动修复。
