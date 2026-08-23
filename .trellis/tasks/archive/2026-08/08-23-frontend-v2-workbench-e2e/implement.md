# Frontend V2 Workbench E2E 实施计划

## 1. 前置门禁

规划批准后已执行：

1. 再次确认 primary working directory 位于 `main`，dirty paths 仅为已审阅 Task artifacts 与父任务 child metadata。
2. 运行 `python3 ./.trellis/scripts/task.py start frontend-v2-workbench-e2e`。
3. 创建唯一临时分支 `codex/frontend-v2-workbench-e2e`，并更新 Task branch metadata。
4. 复读注入的 frontend quality、infra E2E isolation 与本任务 audit，再修改测试。

不 pull、push、建 PR、改写 Git 历史、运行完整 `make verify` 或启动额外服务。

## 2. 精确修改文件

只修改以下五个实现/文档文件，不预设新 helper 文件：

1. `frontend-v2/tests/e2e/product-facts-real-stack.spec.ts`
2. `frontend-v2/tests/e2e/content-review-real-stack.spec.ts`
3. `frontend-v2/tests/e2e/publication-workspace-real-stack.spec.ts`
4. `frontend-v2/tests/e2e/geo-real-stack.spec.ts`
5. `docs/frontend-v2/08-testing-quality-and-acceptance.md`

另维护本 Task 的 `prd.md`、`research/audit.md`、`design.md`、`implement.md`、context manifests、`task.json`，以及
Trellis 自动写入的父任务 child metadata。实施不修改 Workbench API/model/page/route/fixture spec 本身。

## 3. 实施顺序

1. Product Flow A：以 `/` → 唯一 fact attention → Fact Review navigation 替代原 List detour；保留全部批准、
   immutable detail 与 ContentTask handoff 断言。
2. Content Flow A：在 `createReviewReadyTask` 后加入 content count/filter/item；点击 item 返回原 Review Workspace，
   再继续现有批准流程。
3. Publication Flow A：在 PREPARING、AWAITING_VERIFICATION、OPEN issue 三个状态点加入 count/filter/item 断言，
   使用 attention link 返回对应服务端 section；不改 Flow B 或 Published Article API-only 用例。
4. GEO Flow A：PARTIAL root 后保存 issue count并断言三项 rate/item/detail；UNJUDGEABLE correction 后断言 count
   减 `1`、item 消失、tail rates 与 nullable accuracy；保留既有 chain/list/immutable evidence。
5. 在 08 文档的 real-stack 验收区、Deployment Smoke 前增加 Workbench owner 小节；不改 07 Phase 8 状态。
6. 自审仅上述文件：无 fixture/API interception/new helper、绝对共享计数、response body/header logging、断言放宽或
   workflow mutation 重复。
7. 依次执行全部 Required Validation；单个 owner 失败不阻塞其余安全独立项，代码/环境未变化时不重复失败命令。

## 4. Required Validation

四个 real-stack owner 必须分别执行：

```bash
PARTSIGNAL_E2E_V2_SPEC=tests/e2e/product-facts-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh

PARTSIGNAL_E2E_V2_SPEC=tests/e2e/content-review-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh

PARTSIGNAL_E2E_V2_SPEC=tests/e2e/publication-workspace-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh

PARTSIGNAL_E2E_V2_SPEC=tests/e2e/geo-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh

npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
git diff --check
python3 ./.trellis/scripts/task.py validate frontend-v2-workbench-e2e
```

执行规则：

- 每条 real-stack 命令是独立诊断 owner；某条非零后继续运行其余安全独立 spec、lint、typecheck、diff 与 Task
  validate，最后批量归因。
- 代码、配置或环境未发生预期影响失败的变化时，不重复同一失败命令。
- 每条 real-stack 输出必须同时保留 database `status=dropped`、storage `status=removed`、Redis
  `status=deleted`、所有固定 port `status=released`；cleanup 任一失败即该命令失败。
- 运行后只读确认没有本次数据库、Redis key、storage 目录、E2E 进程或固定端口残留；不使用 broad kill、
  `FLUSHDB`、通配删除或额外 cleanup。
- 不运行完整 `make verify`；最终全仓 gate 属于后续 Workbench abstraction review。

执行结果（2026-08-23）：Product Facts `4 passed`、Content Review `2 passed`、Publication `3 passed`、GEO
`2 passed`；lint、typecheck、`git diff --check` 与 Task validate 均退出 `0`。四次真实栈分别输出 Redis DB 14
本次 key `status=deleted`、固定端口 `status=released`、临时数据库 `status=dropped` 与 storage
`status=removed`。

## 5. Stop Conditions

出现任一情况立即停止并报告：

- 现有 workflow 无法自然产生 pending fact/content、Publication 三态或 manual current-tail accuracy 状态。
- 正确断言需要修改产品源码、backend、OpenAPI、database、V1、Workbench API/UI 设计或其他 domain mutation/cache。
- 需要新 spec/fixture/helper 文件、API seed 被测业务 mutation、第二套 orchestration/服务/清理生命周期。
- 需要放宽既有断言、忽略 browser failure、启用含敏感请求的 trace/video/report，或记录 header/body/storage state。
- count 只能依赖跨 spec 绝对总数，或 GEO chain-tail/null rate 无法由当前场景可靠区分。
- 工作区出现无法归属或与本任务重叠的用户改动。

## 6. 建议 Commit 范围

实施、定向验证和审阅完成后，建议一个聚焦工作提交：

`test(frontend-v2): cover workbench in real-stack workflows`

包含四个既有 spec 的 Workbench checkpoints、08 测试文档、本 child Task artifacts 与父任务第三个 child metadata；
不包含 archive/journal bookkeeping。提交前按项目规则展示精确 commit plan 并等待用户确认；不自动 push。
