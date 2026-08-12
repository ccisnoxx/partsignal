# 实施计划：Frontend V2 Content AI Humanization Real-Stack Gate

## 前置门禁

- 当前 Task 保持 `planning`。只有用户批准后才运行 `task.py start`；不创建分支。
- 实施前再次确认主工作区位于 `main`、无未识别 dirty files，并重读本 Task 的 `prd.md`、`design.md`、`implement.md` 与 frontend/state、infra/e2e specs。
- 如新证据表明 job 未创建、Worker/provider 失败、服务端 Context 未更新，停止 frontend 实施并报告最小 backend owner；公共 API、数据库或状态机变更必须另行获得扩围批准。

## 修改步骤

### 1. 先补 component 回归

修改 `frontend-v2/src/domains/content/content-ai-production.test.tsx` 中现有 humanization 用例，使 POST/首次 job list 可直接返回同一 `SUCCEEDED` job，同时保留源版本 ID、模型和稳定幂等键断言，并新增：

- 页面跟踪响应中的同一 job ID；
- exact Editor Context query 被 invalidate 一次；
- terminal 后推进 polling interval 不再产生新的 generation-jobs GET。

该回归在生产修复前必须因缺少 Context invalidation 而失败；若不失败，停止并重新诊断，不为预设结论修改测试。

### 2. 修复现有 terminal effect

修改 `frontend-v2/src/domains/content/content-ai-production.tsx`：保留现有 query 和 refs，只让 terminal refetch 准入同时接受“当前 tracked job 是本组件刚提交的 job”。`terminalRefetched` 继续保证每个 job 只刷新一次，未提交的历史 terminal job 不触发额外 refetch。

不新增 helper、Store、轮询框架、timeout、retry 或 fallback；generate、humanize 和 retry 共用现有 `submittedJob` 所有权，因此不分别复制补丁。

### 3. 补齐同一次 real-stack 的浏览器证据

修改 `frontend-v2/tests/e2e/content-ai-real-stack.spec.ts`，在既有 humanization 按钮提交周围捕获对应 POST response：

- 断言 HTTP 202；
- 解析并记录 job ID/status；
- 断言 `X-Request-ID` 非空；
- 断言页面显示的 tracked Job ID 与响应 ID 相同。

继续等待“自然化次数：1”，继续通过 UI 发出业务命令，并保留源版本 exact snapshot、lineage/current pointer 断言。不得增加等待时间或重试。

## Required validation

### A. Targeted component

```bash
npm --prefix frontend-v2 run test -- src/domains/content/content-ai-production.test.tsx
```

必须证明 immediate-terminal 回归修复前失败、修复后通过；最终断言 terminal 后 generation-jobs GET 不再增加且 Editor Context exact key 只失效一次。

### B. Frontend 静态检查

```bash
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run lint
```

### C. 现有隔离 orchestration 的 real stack

先导出本机可访问的 `DATABASE_URL`，并把 `REDIS_URL` 指向经只读检查后为空、无其他 Worker/Scheduler 客户端的任务独占 logical DB；不得使用共享 DB 0。然后只运行一次现有入口：

```bash
deploy/scripts/e2e-local.sh tests/e2e/trusted-types.spec.ts
```

该脚本按既定顺序运行固定 V2 real-stack 集合，其中必须包含且通过 `content-ai-real-stack.spec.ts`。本 Task 不另建 orchestration，也不默认运行根 `make e2e`。

同次运行必须保存浏览器结果、API、Worker、fake provider、PostgreSQL/Redis 状态采样与 cleanup 日志，并核对：

1. humanization POST 的 HTTP 202、job ID、status、`X-Request-ID`；页面始终显示同一 tracked job ID。
2. PostgreSQL 中该 job 的 `created_at`、`last_dispatch_attempt_at`、`started_at`、`finished_at`、attempt/dispatch count 与最终 `SUCCEEDED`。
3. Worker 执行同一 job，fake provider 收到请求并成功响应；如任一层失败，不归因于 frontend。
4. 新版本 `based_on_id`、`source_job_id`、`source_type=AI` 和任务 `current_content_version_id` 正确；源版本 exact snapshot 不变。
5. terminal 后 job polling 停止，发生 Editor Context refetch，服务端 Context 与页面都显示一次 humanization。

### D. Cleanup assertions

- 脚本输出隔离数据库与对象存储 `status=deleted`，并只读确认二者已不存在。
- API、Worker、Scheduler、fake provider、storage、V1 dev server 与 V1/V2 preview 的本次 PID 已退出，相关端口无本次 listener。
- Redis 在进程退出后没有 `celery` 队列、`unacked` 或 `unacked_index` 工作项，也没有其他客户端。现有脚本会保留 Celery binding 元数据；仅在再次确认 logical DB 为本任务独占后清空该 DB，并确认最终 `DBSIZE=0`。若所有权不唯一，禁止清空并把运行判为无效。
- cleanup 任一项失败，本次 gate 不通过；不得以测试绿色覆盖清理失败。

### E. Diff

```bash
git diff --check
git status --short
```

diff 只能包含本 Task artifacts 与三个批准的 frontend 文件；不得夹带 Publishing、backend、合同、部署或其他用户改动。

## 不默认运行

- 不运行最终 `make verify`。
- 不运行完整根 `make e2e`。
- 不运行 backend tests、Ruff 或 mypy，因为计划不修改 backend；一旦需要 backend 变更，先停止并请求扩围，再补对应 targeted tests、Ruff 和 mypy。

上述门禁由所有 blocker 关闭后的 Phase 4 Exit Gate Closeout 统一执行。

## Failure attribution

| 失败证据 | 归属与处理 |
| --- | --- |
| immediate-terminal component 回归修复前未失败 | 根因假设未被测试证明；停止，不写生产补丁 |
| POST 未返回 202 或没有 job ID/request ID | API/测试观测层；先查 access log，不用前端 refetch 修复掩盖 |
| job 不存在、长期 PENDING/RUNNING、FAILED | backend/dispatch/Worker/provider；记录时间线并停止请求扩围 |
| job SUCCEEDED 但版本/lineage/current pointer 错 | backend content lineage/state；停止请求扩围 |
| 服务端 Context 已更新而页面未更新 | 本 Task frontend owner；component 与 real-stack 应共同失败/通过 |
| 独立运行通过但固定顺序失败且 Redis 有前序数据或外部客户端 | environment defect；该次运行无效，先恢复独占，不循环碰绿色 |
| 数据库、存储、Redis 工作项或进程未清理 | environment cleanup failure；gate 失败，不归因于产品代码 |
| 完整门禁中的其他失败 | 本 Task 不运行完整门禁；后续 closeout 按 touched path 单独归因 |

## Rollback point

回滚只涉及三个 frontend 文件：恢复 terminal effect 原条件、component humanization 用例和 E2E 响应观测。没有 schema、持久化数据、公共 API、generated types、配置或部署变更；回滚后保留本 Task 证据和诊断文档，Phase 4 Gate 回到 `NOT_MET`。

## 实施与验证结果

- Component 回归在生产代码未修改时按预期失败：页面已显示 `SUCCEEDED` job，但 Editor Context invalidation 为 0；单点修复后 `4 passed`。
- 修复只允许本组件刚提交的 job 绕过“必须先观察为 active”的 terminal 门禁，现有 `terminalRefetched` 去重、2 秒 active polling 和 canonical Context query 均保持不变。
- `frontend-v2` typecheck、lint 均通过。
- 现有隔离入口固定 V2 real-stack 为 `10 passed (50.5s)`，Content AI 为 `23.6s`；随后指定 V1 trusted-types 为 `7 passed (10.8s)`。
- humanization POST：job `da132c86-9c21-4176-b5e2-488b2c80a6c1`、状态 `PENDING`、request ID `4a26a127-9b44-4804-8442-431096267e45`；同一 job 最终 `SUCCEEDED`，`attempt_count=1`，新版本 `cdca1232-da1d-4514-bcbb-c140e3257a56`，provider request ID 为 `e2e-provider-request`。
- E2E 保留并通过源版本 exact snapshot、新版本 `based_on_id/source_job_id/source_type`、current Context、terminal refetch 与页面“自然化次数：1”断言。
- cleanup：数据库和对象存储均输出 `status=deleted` 且确认不存在；本次六个端口无 listener；Redis DB 15 无外部客户端、只残留 `_kombu.binding.celery`，清空后 `DBSIZE=0`。
- `trellis-check`、`git diff --check` 和 task artifact 格式/敏感连接串检查通过；未发现第二套状态、fallback、重试或无关改动。
- 无需更新权威合同或 `.trellis/spec/`：本次修复恢复既有“terminal 后停止轮询并重新读取 Editor Context”合同，没有改变 API、状态机或数据规则。
- 未运行最终 `make verify`、根 `make e2e`、Phase 4 closeout 或 GEO。

完整日志：`evidence/implementation-real-stack.log`；cleanup 复核：`evidence/cleanup-check.txt`。
