# 设计：Frontend V2 Content AI Humanization Real-Stack Gate

## 边界与权威所有者

本次诊断跨浏览器、FastAPI、PostgreSQL、Celery Worker 和 fake provider，因此保留本设计文档；实现 owner 仍只在 frontend。

| 边界 | 权威事实 | 本次结论 |
| --- | --- | --- |
| 浏览器 | submitted/tracked job ID、轮询与 Context refetch | 存在首次观察即 terminal 时跳过 refetch 的竞态 |
| FastAPI | humanization POST 与 Editor Context | 有效运行返回 202，terminal 后 Context GET 成功 |
| PostgreSQL | job 状态、版本 lineage、current pointer | 有效运行中均正确，不需修改 |
| Celery Worker | job 执行、attempt 与 terminal 提交 | 有效运行中同一 job 已执行一次并成功 |
| fake provider | AI 请求结果 | 有效运行返回 200，provider duration 为 1 ms |
| Redis | broker 隔离与 backlog | 有效运行初始空且独占；无积压，结束残留 Celery binding 元数据 |

## 有效运行状态时间线

以下时间均为 UTC，job 与版本字段来自 PostgreSQL 采样；HTTP 顺序来自同次 `e2e-local.sh` 日志。

1. 运行前：Redis DB 15 `DBSIZE=0`、无其他客户端；相关端口无外部 listener。
2. 浏览器通过 V2 页面提交 `POST /content-versions/a3e.../humanization-jobs`，API 返回 `202 Accepted`。
3. PostgreSQL 创建 humanization job `31635ef5-ea1d-4439-aca8-09681c30f35a`，源版本为 `a3e27d52-46f6-4647-a18e-b8b6d18462d6`；`last_dispatch_attempt_at=06:00:24.056379`，`started_at=06:00:24.060364`，`created_at=06:00:24.071590`，`finished_at=06:00:24.080358`。PostgreSQL server default 与应用时间取值点不同，所以 `created_at` 的展示顺序不用于推断 dispatch 先后。
4. Worker 将同一 job 执行到 `SUCCEEDED`：`attempt_count=1`、`dispatch_attempt_count=1`。
5. fake provider 收到 `POST /v1/chat/completions` 并返回 200；job 记录 `provider_request_id=e2e-provider-request`、`response_duration_ms=1`。
6. Worker 创建版本 `ef86b69f-2461-456a-b2f5-6ab24bc623fc`：`based_on_id=a3e...`、`source_job_id=31635...`、`source_type=AI`、版本号 2、状态 `DRAFT`，并把任务 `current_content_version_id` 指向该版本。源版本前后 exact snapshot 断言通过。
7. 页面在 POST 前后读取同一任务的 generation-jobs；terminal 后读取 Editor Context，页面出现“自然化次数：1”，随后 E2E 读取 canonical Context 和源版本完成 lineage/不可变性断言。
8. Content AI spec `23.4s` 通过，完整固定 real-stack 顺序 `10 passed (50.2s)`；没有观察到前序残留、Worker backlog 或共享配置竞争。
9. 退出时脚本删除数据库 `partsignal_e2e_20260812_59063`、临时对象存储并终止本次服务。Redis queued/unacked 数据为零，但脚本未删除 `_kombu.binding.celery`；确认无客户端后清空独占 DB 15，最终 `DBSIZE=0`。

## 当前证据缺口

- 通过运行按 Playwright 默认 `retain-on-failure` 未保留 trace，因此 API access log 只证明浏览器 POST 收到 202，不能还原该响应 body 中的 job ID/status 或 `X-Request-ID`。PostgreSQL 和后续 job list 能关联 job，但不能代替浏览器响应头证据。
- Worker 以 WARNING 级别启动，没有逐任务 receipt 日志；`started_at`、`attempt_count=1`、provider 请求和 terminal 提交共同证明 Worker 执行，但不能提供一条独立的 Celery receipt 文本。
- 历史失败只保留 UI timeout 汇总，没有当时的 job/版本行、request ID、Worker/provider 日志或 Redis logical DB 归属，因此不能断言历史实例的服务端 Context 已更新，也不能完全排除环境竞争。

上述缺口不通过重复跑绿色补齐。实施后的同一次 required real-stack validation 在原 spec 内捕获 POST 响应并保留运行日志。

实施验证已补齐浏览器 POST 证据：job `da132c86-9c21-4176-b5e2-488b2c80a6c1`、初始状态 `PENDING`、request ID `4a26a127-9b44-4804-8442-431096267e45`；同一 job 随后于 `06:21:15.421420Z` 开始、`06:21:15.448761Z` 成功结束，并记录 `provider_request_id=e2e-provider-request`。历史失败本身仍没有对应 trace，因此不反推其具体服务端时序。

## 根因时序

正常慢路径：

```text
POST -> submitted PENDING -> effect 记录 active ID -> polling 得到 terminal
     -> Editor Context invalidate/refetch -> canonical lineage 显示
```

缺陷快路径：

```text
POST -> Worker + 1ms fake provider 已完成 -> submitted/首次 list 已 SUCCEEDED
     -> activeJobsSeen 中没有 ID -> terminal effect 提前 return
     -> canonical DB 已更新，但页面继续持有旧 Context
```

API 的 202 只表示命令已接受，不保证响应序列化时 job 仍为 active。前端必须把自己刚成功提交的 job 视为已跟踪，而不能要求它先被 UI 观察为 active。

## 最小设计

1. 保留现有 `submittedJob`、generation-jobs query、2 秒 active polling 和 `terminalRefetched` 去重。
2. terminal effect 的准入条件从“曾观察为 active”收敛为“曾观察为 active，或就是本组件刚提交的 job”。不新增状态机、hook 或 helper。
3. 继续由现有 exact Editor Context query invalidation 获取 canonical current pointer/lineage；details/lists 的失效策略不变。
4. component 回归让 humanization POST 首次返回 `SUCCEEDED`，直接证明该 job 仍触发一次 Editor Context invalidation，推进计时后 generation-jobs 不再轮询。
5. real-stack spec 只增强同一次 UI 提交的响应观测：捕获 humanization POST，断言 202、job ID、terminal/active status 和非空 request ID，并断言页面显示的 Job ID 与响应一致；原“自然化次数：1”和所有数据库投影断言保留。

## 放弃方案

- 延长 30 秒、sleep、test retry：只降低出现概率，不修复 terminal refetch 丢失。
- terminal 时无条件 refetch：会让页面加载历史 terminal Context 时产生无关失效；不如只接受本组件刚提交的 job。
- backend 等待 Worker、改变 202 响应或新增状态：扩大公共合同且没有后端故障证据。
- 新 polling abstraction、SSE/WebSocket、Store：现有 query owner 足够，属于无必要架构。
- 修改 selector 或只等待 API：会绕过用户可见 canonical Context 证明。

## 文件范围

- `frontend-v2/src/domains/content/content-ai-production.tsx`
- `frontend-v2/src/domains/content/content-ai-production.test.tsx`
- `frontend-v2/tests/e2e/content-ai-real-stack.spec.ts`

不修改 backend、合同、数据库、fake provider、Celery、Editor Context owner 或 orchestration。
