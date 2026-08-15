# AI Channel Configuration E2E 审计

## 1. 审计结论

- 当前 OpenAPI、PostgreSQL 模型、AI configuration router/schema/service 与 V1/V2 generated types 已能表达完整 Configuration E2E；没有合同或数据库 blocker。
- 应新增一个 V2 real-stack spec，复用 `deploy/scripts/e2e-local.sh`、现有 fake Provider、真实 FastAPI/PostgreSQL/Celery 和 V2 production preview。不得新增 fixture、第二套 Provider 或第二套 orchestration。
- 新 spec 只把 AI Channel Configuration 主路径交给 V2 UI；支持数据建立、并发写入制造与最终只读投影可使用测试 API，不能代替被验收的配置和正式生成命令。
- 既有 Provider 已拥有 `/v1/models`、`/v1/chat/completions`、按 model ID 的调用计数和最近请求体读取，不需要新 recorder；只缺少一个不记录明文的凭据期望分支，用于证明 V2 replacement-only 值而不是旧值真正到达 Provider。
- 当前 real-stack 仍使用 `trace: retain-on-failure`。V1 shared setup、`mvp-flow`、AI Channel 管理和 V2 Content AI 都提交密码、API Key 或 Header 值；失败 trace 会记录输入和网络 body。必须在 real-stack 模式从 Playwright config 关闭 trace，普通 fixture suite 继续保留现有 trace。
- 当前脚本只清理临时 PostgreSQL、对象存储目录和已登记 PID，不等待子进程退出，也不清理/复核 Redis。历史运行确认 Celery binding key 会残留，人工 cleanup 不能继续作为脚本外隐含步骤。

## 2. 现有 owner 与证据

| 边界 | 当前 owner / 证据 | 结论 |
| --- | --- | --- |
| orchestration | `deploy/scripts/e2e-local.sh:4-15,33-67,70-134` | 已隔离数据库和存储、启动 API/Worker/Beat/V1/V2/Provider；扩展原 owner |
| 数据库 | `deploy/scripts/e2e-database.py:14-53` | 名称 allowlist、`CREATE DATABASE`、`DROP ... WITH (FORCE)` 已足够 |
| Provider | `backend/app/ai_fake_server.py:24-87` | 真实 HTTP 协议、调用计数、payload 观测已存在；不建第二套替身 |
| V2 AI runtime | `frontend-v2/tests/e2e/content-ai-real-stack.spec.ts:23-29,93-166,251-463` | 真实 Worker/Provider、timeout、exact retry 已证明；配置仍主要走 API |
| V1 AI UI | `frontend/tests/e2e/ai-channel-management.spec.ts:138-568` | 已覆盖 V1 UI 创建、换 Key、Header、发现、测试、启停、Usage/Logs、脱敏和删除 |
| V1 vertical flow | `frontend/tests/e2e/mvp-flow.spec.ts:387-417,458-667` | 已覆盖真实 discovery/test/generation/humanization/timeout/retry 与替换凭据生效 |
| V1 shared setup | `frontend/tests/e2e/shared-data.setup.ts:62-171` | 会提交凭据并调用 Provider；依赖隔离数据库统一清理 |
| V2 strict fixture | `ai-channel-workspace-core/models/runtime.spec.ts` | 已覆盖 URL、dirty、revision、精确请求、secret 和四档布局；不在 real-stack 重复矩阵 |
| cache composition | `settings.ai_.$channelId.tsx:62-68` | Configuration route 已精确失效 Prompt Preview root 与 Content generation-options predicate |
| Usage/Logs | `ai-channel-runtime-section.tsx:66-205` | 服务端 period、聚合、分页、actor 与按需安全详情均已有页面 owner |

## 3. Gap analysis

### G1 — V2 Configuration 浏览器闭环缺失

现有 V2 real-stack 用 API 创建 Channel/Header/Model，无法证明 List → Workspace → Provider → consumer → Runtime 的 V2 UI 链路。新增单一 spec 关闭该 gap。

### G2 — replacement-only 到 Provider 的证据不足

Provider 当前只要求三类 Header 非空；V2 即使错误继续使用旧凭据也会成功。按唯一 model ID 后缀派生预期测试 Key/Header，比较但不保存、不回显、不记录明文，可用一次失败和一次成功证明替换生效。

### G3 — real-stack trace 可能保存 secret

V2 Core fixture 已在文件级显式 `test.use({ trace: 'off' })`，说明项目已确认 trace 会记录 secret body；但 V1/V2 real-stack 配置仍为 `retain-on-failure`。修复点应在两个 Playwright config 的 real-stack 条件，不逐个 spec 打补丁。

### G4 — Redis 与进程 cleanup 不是脚本闭环

当前 `cleanup()` 只 `kill` 不 `wait`，且不验证端口释放；Redis 只由调用方传 URL，Celery queue/unacked/binding 可能残留。应在原脚本增加一个小型 environment helper：

- preflight 拒绝 DB 0、非空 logical DB、同 DB 外部客户端和六个固定端口占用；
- cleanup 在本次进程全部 `kill + wait` 后，只允许并精确删除 `celery`、`unacked`、`unacked_index`、`unacked_mutex` 与枚举得到的 `_kombu.binding.*`；
- 最终断言 Redis `DBSIZE=0`、无同 DB 外部客户端且六端口均释放；未知 key 或 listener 直接使 gate 失败，不执行 broad kill/flush。

CI 的 backend integration 使用 DB 15，可能保留测试 binding metadata；E2E step 应切到专用空 logical DB 14，避免用 cleanup 越权删除前序测试数据。

### G5 — 跨消费者 E2E 不能替代 key-level component test

Prompt Preview Options 和 generation-options 的 `staleTime=0` 意味着 SPA 返回时本来就会重新读取。real-stack 只能证明“不 reload 浏览器的服务端结果闭环”，不能把它表述为 query key 精确性证据；精确 invalidation 继续由现有 route composition/component tests 拥有。

## 4. 最小实施边界

建议保持一个 Task、一个 commit review slice，不拆子 Task。预计主要文件：

1. 新增 V2 Configuration real-stack spec。
2. 最小扩展现有 fake Provider 的凭据期望分支。
3. 扩展 `e2e-local.sh` 并新增一个 environment preflight/cleanup helper。
4. V1/V2 Playwright config 在 real-stack 模式关闭 trace。
5. CI E2E 使用独立 Redis logical DB。
6. 更新测试权威文档与稳定质量规则。

该切片只有一个可独立验收结果：同一次隔离运行完成 V2 Configuration、既有 V2 timeout/real generation、指定 V1 real-Provider 回归和资源 cleanup。把 harness 与 spec 分开会产生无法独立通过的半成品，因此不拆分。

## 5. 明确不做

- 不修改 OpenAPI、业务 router/schema/service、数据库或 generated API types。
- 不新增 runtime mock、第二 Provider、通用 E2E DSL、跨 spec helper framework、全局 Action Registry 或业务 fallback。
- 不重复 strict fixture 已覆盖的 375/768/1024/1440 全矩阵；real-stack 使用 desktop project，四档继续由既有 suites 负责。
- 不接真实云 Provider；本机 Provider 是真实协议边界替身，不冒充云服务。
