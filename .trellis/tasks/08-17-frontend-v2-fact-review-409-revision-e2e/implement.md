# 实施计划

## Phase A — 实施前核对

1. 用户批准本计划后才运行 `task.py start 08-17-frontend-v2-fact-review-409-revision-e2e`；继续使用 `main`，不创建分支。
2. 用 `trellis-before-dev` 重读本 task 的 `prd.md`、`design.md`、`implement.md`、`research/audit.md`，以及 frontend quality、infra E2E isolation specs。
3. 确认工作树只有本 task artifacts 与 parent child link；不 pull/push/PR。
4. 完整读取将修改的 `fact-review.spec.ts`、`product-facts-real-stack.spec.ts`、`e2e-local.sh` 和 `e2e-isolation.md`；再次确认 runtime/backend 无需改动。

## Phase B — 最小实施

1. `fact-review.spec.ts`：把 revision 1 fixture 更新移动到批准 Dialog 打开后、确认前；保留现有 request body、request ID、refetch 和 revision 1 UI 断言。
2. `product-facts-real-stack.spec.ts`：
   - 增加 generated `ErrorEnvelope` / `FactVersion` type alias；
   - 复用现有 helper 建立一个待审核 FactVersion；
   - 页面加载 revision 0 后，以真实 `REQUEST_CHANGES` 制造 revision 1；
   - UI 发送 stale APPROVE，精确断言一次请求、body、409/code/request ID；
   - 断言 UI refetch 和最终真实 context 保留 revision 1/history/immutable body，且没有 approve record。
3. `deploy/scripts/e2e-local.sh`：增加可选 `PARTSIGNAL_E2E_V2_SPEC` 分支；定向模式只启动/运行 V2 所需路径，默认完整路径逐项保持。
4. `.trellis/spec/infra/e2e-isolation.md`：记录变量签名、定向/默认/失败矩阵、cleanup 和“不可替代完整 gate”。
5. 不修改 production runtime、backend、OpenAPI、数据库、权限、Playwright config、Makefile 或 docs 07/08。

## Phase C — 独立诊断

1. 先运行 fixture Fact Review spec，验证 mobile/desktop 的 stale request 编排。
2. 运行 shell syntax、受影响 TS ESLint 和 Frontend V2 typecheck，集中发现静态问题。
3. 确认 `DATABASE_URL` 与非 0、空且独占的 `REDIS_URL` 已由调用环境提供；由既有 preflight 拒绝未知进程、端口、Redis 或 storage owner。
4. 只运行 `product-facts-real-stack.spec.ts` 的隔离定向模式；检查 Playwright 结果和 database/storage/Redis/port cleanup 行。
5. 同一失败在代码或环境没有相关变化时不重复运行；非本 owner 失败记录后停止，不扩围。

## Required Validation

仓库根目录：

```bash
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/fact-review.spec.ts \
  --project=foundation-mobile \
  --project=foundation-desktop

bash -n deploy/scripts/e2e-local.sh

npm --prefix frontend-v2 run typecheck

frontend-v2/node_modules/.bin/eslint \
  frontend-v2/tests/e2e/fact-review.spec.ts \
  frontend-v2/tests/e2e/product-facts-real-stack.spec.ts \
  --max-warnings 0

PARTSIGNAL_E2E_V2_SPEC=tests/e2e/product-facts-real-stack.spec.ts \
  deploy/scripts/e2e-local.sh

git diff --check
python3 ./.trellis/scripts/task.py validate \
  08-17-frontend-v2-fact-review-409-revision-e2e
```

real-stack 命令必须观察并记录：目标 spec 的 passed/failed/skipped、脚本退出码，以及 database `status=dropped`、storage `status=removed`、Redis `status=deleted`、port `status=released`。不得输出密码、cookie、CSRF、Authorization 或完整 headers。

## Optional / Deferred Validation

- 不运行完整 `npm --prefix frontend-v2 run e2e`：本 blocker 只覆盖 Fact Review fixture 与 Product Facts real-stack owner。
- 不运行未设置 selector 的 `deploy/scripts/e2e-local.sh`、`make e2e` 或 `make verify`：完整顺序留给 Phase 7 Exit Gate Recheck。
- 不运行 backend suite、contract check 或 migration tests：backend/OpenAPI/database 未改，现有 integration 已证明 revision conflict owner。
- 不单独运行 build：fixture spec 的 Playwright webServer 和 real-stack isolation 入口都会构建当前 V2 production artifact。

## Phase D — 自审与停止

1. `trellis-check` 逐项确认 diff 只含 task artifacts、两个 E2E spec、唯一 runner 选择分支和 infra spec。
2. 确认没有 sleep、blind retry、宽松 status、删除断言、route mock、状态推导、自动 replay、第二 orchestration 或敏感数据记录。
3. 确认默认 `e2e-local.sh` 的完整 V2 列表和 V1 suite 仍存在且执行顺序不变；定向分支仍使用同一 cleanup trap。
4. 若真实响应不是 revision conflict，或最终 context 被 approve 改写，停止并报告独立 backend/runtime blocker；不在本 task 修改合同。
5. 全部 Required Validation 通过后报告结果和精确 commit plan，等待批准；不自动 commit、archive、push、PR 或开始第四个 blocker。

## Commit 范围草案

单一提交，候选信息：

```text
test(frontend-v2): cover fact review revision conflict on real stack
```

只包含本 task artifacts、parent child link、`fact-review.spec.ts`、`product-facts-real-stack.spec.ts`、`deploy/scripts/e2e-local.sh` 与 `.trellis/spec/infra/e2e-isolation.md`。最终文件清单以实施后 diff 为准，提交前再次请求批准。

## 实施与验证结果

- fixture 409 编排已固定在批准 Dialog 打开后切换 canonical revision；mobile/desktop 共 `10 passed`。
- Product Facts 定向 real-stack 共 `4 passed`；新增 Flow D 真实收到 `409/REVISION_CONFLICT`，approve 请求恰好一次，最终 canonical context 为 `CHANGES_REQUESTED/revision 1`，并发意见与原 Markdown 保持。
- 定向 runner 只构建/启动 V2 并运行目标 spec；退出码 `0`，cleanup 输出 Redis `status=deleted`、port `status=released`、database `status=dropped`、storage `status=removed`。
- `bash -n`、Frontend V2 typecheck、受影响文件 ESLint、`git diff --check` 与 Task validation 均通过。
- 未运行完整 V2 E2E、未设置 selector 的 `e2e-local.sh`、`make e2e` 或 `make verify`；这些仍由 Phase 7 Exit Gate Recheck 负责。
