# Frontend V2 Content AI Humanization Real-Stack Gate

## 目标

修复 Content AI 在刚提交的 humanization job 已经进入 terminal 状态时可能不刷新 canonical Editor Context 的竞态，并用最小修改恢复稳定的真实栈证明。不得通过延长等待、自动重试、固定成功路径或削弱断言掩盖异步链路缺陷。

## 复现结论

- 历史失败：Phase 4 抽象回顾的完整 real-stack 为 `9 passed / 1 failed`，唯一失败是 `content-ai-real-stack.spec.ts` 等待“自然化次数：1”超过 30 秒。
- 本任务有效复现：在运行前为空且无其他客户端的 Redis DB 15 上复用 `deploy/scripts/e2e-local.sh`，固定 V2 real-stack 顺序为 `10 passed (50.2s)`，其中 Content AI 为 `23.4s`。历史超时未再次出现。
- 没有循环重复运行测试。有效运行前的两次启动失败分别由容器主机名 `postgres` 和 `redis` 无法从 host 解析导致，均发生在测试前；修正为已有 host 端口后才执行唯一一次有效运行。
- 同一“自然化次数：1”超时只有一份归档记录。另一次 Content AI 历史失败发生在更早的 AI 标题等待，伴随 Celery 28800 秒时钟漂移，不是同一断言或同一时序。因此本任务不启动 `trellis-break-loop`。

证据：

- [有效运行、服务和 cleanup 日志](evidence/reproduction.log)
- [PostgreSQL job/version 与 Redis 采样](evidence/valid-state-monitor.log)
- 历史失败：`../archive/2026-08/08-12-frontend-v2-publishing-abstraction-review/audit.md`

## 根因与缺陷分类

### 主根因：frontend production defect

`ContentAiProduction` 只把曾以 `PENDING` 或 `RUNNING` 被 effect 观察到的 job ID 放入 `activeJobsSeen`。terminal refetch 又要求同一 ID 已存在于该集合。

创建接口在提交 Celery 后刷新并返回 job；本机 fake provider 响应只需 1 ms，Worker 可以在浏览器收到 `202` 或首次 job-list 结果前把 job 完成。此时组件首次观察到的 submitted job 已是 `SUCCEEDED`，它从未经过 active 分支，因此跳过 Editor Context invalidate/refetch。服务端已经创建新版本并移动 current pointer，页面仍持有旧 Context，表现正好是“自然化次数：1”永久不出现。

这是代码可达且缺少回归测试的竞态，不依赖等待时长。现有 component test 只覆盖 `PENDING → SUCCEEDED`；humanization test 只验证请求字段和幂等键，没有覆盖 POST 首次返回 terminal。

### test defect 判定

不是主因。E2E 的“自然化次数：1”来自 canonical `current_lineage.humanizations`，随后还校验源版本不可变、`based_on_id`、`source_job_id`、`source_type` 和 current version；selector 与可观察状态符合合同。测试缺少对 POST job ID/status/request ID 的保留证据，需要在原 spec 内补强，但不得替换 UI 断言。

### environment defect 判定

- 有效运行的 Redis DB 初始 `DBSIZE=0`、无其他客户端，未观察到前序 backlog 或共享 Worker 竞争；本次完整顺序也没有复现污染。
- 历史失败没有保留浏览器 trace、job 行、Worker/provider 日志或 Redis DB 归属，无法排除当时共享 DB 0 的环境竞争；它只能作为证据缺口，不能替代代码根因。
- 现有 `e2e-local.sh` 正确删除隔离数据库与对象存储并终止本次进程，但不会清空 Redis logical DB。有效运行结束后队列和 `unacked*` 已为空，仍残留一个可重建的 `_kombu.binding.celery` 键；本任务已在确认 DB 15 独占且无客户端后清空，最终 `DBSIZE=0`。这是 cleanup 可观察性缺口，不是本次 humanization 失败的致因，且不扩张本任务到编排脚本。

## 范围

### 实施范围

- 在现有 `ContentAiProduction` owner 中，让本组件刚成功提交的 job 即使首次可见状态已为 terminal，也只触发一次 Editor Context invalidate/refetch。
- 在现有 component test 中增加“humanization POST 直接返回 `SUCCEEDED`”回归，证明 terminal refetch 发生且 polling 不继续。
- 在现有 real-stack spec 的 humanization UI 提交处捕获同一 POST 响应，记录并断言 HTTP 202、job ID/status 和 request ID，并继续保留页面、不可变性、lineage 与 current pointer 断言。

### 不在范围

- 不修改 backend、Celery、fake provider、OpenAPI、数据库、状态机、Content Editor Context owner或 Publishing 代码。
- 不修改 `deploy/scripts/e2e-local.sh`；Redis logical DB 的归属、队列为空和最终清空作为验证前后置条件执行。
- 不新增轮询框架、SSE/WebSocket、全局 Store、第二套 job 状态机、fixture、mock server 或 orchestration。
- 不运行 Phase 4 最终 `make verify`、完整 `make e2e`、closeout 或 GEO。

## 不变量

- humanization 创建新的 `GenerationJob` 与新的 `ContentVersion`；源版本不变。
- 新版本必须保持 `based_on_id=源版本 ID`、`source_job_id=humanization job ID`、`source_type=AI`。
- `current_content_version_id` 只由服务端成功提交后移动；前端只重新读取 canonical Context，不在本地推导版本或 lineage。
- 页面只跟踪本次 submitted job ID；只有 active job 轮询，terminal 后停止，并对同一 job 最多执行一次 Context refetch。
- 不延长 30 秒 timeout，不增加 sleep、`waitForTimeout`、retry、catch 后重试或固定成功 fallback。
- 不跳过 UI 自然化断言，不通过 API 执行 humanization 业务命令，不直接写数据库。

## 验收标准

- [x] “POST 直接返回 terminal”回归在修复前失败、修复后通过，并证明 Editor Context 只失效一次且后续不再轮询。
- [x] `content-ai-real-stack.spec.ts` 在现有隔离 orchestration 中通过；保留 humanization POST 的 job ID/status/request ID，并证明页面跟踪同一 ID。
- [x] PostgreSQL 中 humanization job 最终 `SUCCEEDED`，Worker 已执行且 fake provider 成功响应。
- [x] 源 `ContentVersion` exact snapshot 不变；新版本 lineage 与服务端 current pointer 正确。
- [x] terminal 后页面停止轮询并重新读取 canonical Editor Context，页面显示“自然化次数：1”。
- [x] 运行前 Redis logical DB 为空且独占；运行后数据库、对象存储、本次进程已清理，Redis 无 queued/unacked 数据并最终回到空库。
- [x] `frontend-v2` targeted component test、typecheck、lint 与 `git diff --check` 通过。
- [x] 产品修改严格限于本 PRD 的三个 frontend 文件；未触及 backend/API/数据库/状态机。
