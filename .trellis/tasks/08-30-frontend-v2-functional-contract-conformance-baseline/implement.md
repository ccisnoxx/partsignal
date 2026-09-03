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

## Phase D：最终集成核对

- [x] 六个直属 child 均存在于 archive，`status=completed`，`parent=08-30-frontend-v2-functional-contract-conformance-baseline`。
- [x] 首个推荐 P0 Task `publication-verification-final-authority` 已独立完成；直属子任务的工作提交和归档提交均位于当前 `HEAD` ancestry。
- [x] 当前文档定义的 37 条 canonical 路由在 `frontend/src/routeTree.gen.ts` 全部存在，无重复或缺失。
- [x] 当前默认 `make contract-check` 使用唯一完整 response comparator；冻结 OpenAPI、runtime document 和 generated client 零漂移。
- [x] 原始矩阵保留审计时点事实，并增加最终处置台账；未完成项没有被写成已关闭。
- [x] 本次无需修改产品代码、公共合同、generated client、测试、数据库合同或业务设计文档。

## Required Validation

本 Task 的必需验证均为只读：

```bash
make contract-check
python3 ./.trellis/scripts/task.py validate .trellis/tasks/08-30-frontend-v2-functional-contract-conformance-baseline
! rg -n '[[:blank:]]+$' .trellis/tasks/08-30-frontend-v2-functional-contract-conformance-baseline
```

另以只读脚本从信息架构表提取 37 条 canonical 路由，去除 search 参数后与 `routeTree.gen.ts` 的 `fullPath` 集合逐项比对；并核对六个 child 的 archive/status/parent、关键提交 ancestry、任务范围 diff 和任务外 dirty/index 指纹。

### Actual Validation Result

- 37 条 canonical 路由：`37` 条、`37` 个唯一值、`missing=[]`。
- `make contract-check`：通过；FastAPI runtime 与冻结 OpenAPI 的完整契约一致，`openapi-typescript 7.13.0` 只读再生成与 canonical generated client 一致。
- 父 Task `task.py validate`、文档 trailing-whitespace 与 task-scope `git diff --check`：最终文档更新后均通过。
- 当前 static/runtime inventory 均为 128 paths、162 operations、1023 responses；operation key、operationId 与 status 集合精确一致。
- 六个直属 child 的 archive/status/parent 核对通过；工作提交为 `5add828a`、`15250902`、`56f92699`、`abd41e1c`、`180d0ad3`，完整 response 门禁的最终激活与方法覆盖提交为 `000a0d27`、`b2bc3c68`。
- 首个推荐 P0 修复提交 `4a7979e8` 已归档完成。后续线上验收及两个独立 P2 修复任务已有各自证据，不改变原始审计结论。

## Optional Validation Not Run

- 本次父 Task 收尾不重复运行完整 Vitest、Playwright、backend unit/integration、真实 PostgreSQL 并发或 `make verify`。父 Task 不修改产品代码；各独立修复 Task 已记录其定向 unit/integration/E2E、lint、type、contract 和 Review 证据，重复仓库级套件不会增加对本次文档归档边界的直接证明。
- 不发起生产请求或生产写操作。2026-08-30 的线上验收结果继续按归档 Task 保留；本次只复核当前本地合同和路由闭集。
- 未运行项保持 `NOT_RUN`，不写成通过；残余风险是矩阵中尚未启动的独立合同决策、P1/P2/P3 修复和最终测试收口仍需各自 Task 验证。

## Review Checklist

- [x] 人工确认 P0/P1 排序和 Task 边界；已完成项均以独立 Task 实施、验证和归档。
- [x] Article 与 AI operation history 保持独立合同决策 owner；本父 Task 不替它们决定语义或创建实现。
- [x] 首个实施 Task `publication-verification-final-authority` 经独立批准、实施、验证和归档。
- [x] 本基线完成最终 review 后才进入归档；提交使用路径受限方式，不 push，不启动 `integrity-error-domain-mapping`。
