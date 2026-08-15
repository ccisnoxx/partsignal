# Frontend V2 AI Channel Configuration E2E

## Goal

在项目唯一的隔离真实栈上，为 Frontend V2 AI Channel Configuration 建立可重复的浏览器闭环，证明已交付的 List、Workspace Core、Models、Prompt/Content consumer、Usage 与 Logs 能共同操作真实 FastAPI、PostgreSQL、Celery Worker 和本机 OpenAI-compatible HTTP Provider 替身。该 Task 同时关闭 real-stack trace 与资源 cleanup 的真实 harness 缺口，但不新增业务能力、兼容字段、固定成功路径或第二套测试框架。

## 已确认基线

- `frontend-v2-ai-channel-workspace`、Core、Models、Runtime 与 Closeout 均已归档并合入 `main`；五个 canonical tab 已是生产能力。
- Workspace component、strict fixture 与 production-artifact Playwright 已覆盖 URL、dirty、revision、query invalidation、secret、键盘和 375/768/1024/1440；本 Task 不重复这些页面矩阵。
- `deploy/scripts/e2e-local.sh` 已拥有单次数据库、临时对象存储、FastAPI、Celery、现有 fake Provider、V1 dev/preview 与 V2 production preview；本 Task 只扩展该 owner。
- `frontend-v2/tests/e2e/content-ai-real-stack.spec.ts` 已证明 generation/humanization/timeout/exact retry，但 AI Channel 前置配置主要通过 API 完成，不能替代 V2 Workspace 浏览器闭环。
- V1 `ai-channel-management.spec.ts` 与 `mvp-flow.spec.ts` 已包含 real-Provider 行为，但 Models 子 Task 没有保存实际运行结果；本 Task 必须产生新的观察结果。
- OpenAPI、AI configuration 业务服务、PostgreSQL 模型与 V1/V2 generated types没有已知缺口，默认保持不变。
- 完整审计见 `research/e2e-audit.md`：当前 real-stack trace 可能保存 secret，脚本也没有等待子进程或闭环 Redis cleanup；两项都必须在本 Task 修正。

## Scope

### In Scope

- 新增一个 V2 real-stack spec，使用 V2 UI 完成 AI Channel Configuration 主闭环；不拦截业务 API、不导入 fixture。
- 最小扩展现有 fake Provider，使唯一 E2E model 能在不记录明文的前提下区分旧凭据与 replacement-only 新凭据。
- 扩展 `e2e-local.sh` 的既有生命周期：environment preflight、real-stack trace off、子进程 `kill + wait`、Redis 精确 cleanup、端口释放检查与新 spec 登记。
- CI E2E 使用独立空 Redis logical DB；本地文档明确同一隔离条件。
- 在同一次 required 运行中重新执行指定 V1 AI Channel/MVP real-Provider 流程，并继续运行既有 V2 Content AI timeout/real generation 流程。
- 更新测试权威文档与稳定质量规则，记录 fixture、real-stack、本机 Provider 与真实云 Provider 的边界。

### Out of Scope

- 新增或修改 AI Channel、Header、Model、Prompt、Content、Usage、Logs 的生产业务能力。
- 修改 OpenAPI、generated API types、业务 router/schema/service、数据库结构或 migration。
- 新增第二套 fake Provider、第二套 real-stack orchestration、通用 E2E DSL、万能 setup/cleanup framework、runtime mock、silent fallback 或兼容字段。
- 接入真实云 Provider、保存真实凭据、成本账单、模型级 Runtime、日志搜索/导出。
- 在 real-stack 重复四档响应式和所有 fixture 错误矩阵；现有 production-artifact suites 继续拥有这些回归。
- 顺手修复真实栈暴露的未授权产品缺陷；若出现合同或业务 blocker，保存证据并回到 planning。

## Requirements

### R1. 唯一真实栈与隔离边界

必须复用 `deploy/scripts/e2e-local.sh`，使用单次 PostgreSQL database、独立非 DB 0 且运行前为空的 Redis logical DB、临时对象存储、真实 FastAPI/Celery、现有 Provider 和 V2 production build/preview。不得连接生产服务、共享业务数据库或操作者现有 AI 配置。

### R2. V2 UI owner

已迁移的 List、Create、Basic、Request、API Key、Header、Models、Prompt Preview、Content generation 与 Runtime 浏览步骤必须操作 V2 页面。测试 API 只允许登录、建立非目标领域最小前置、制造并发写入和读取最终只读投影；不能替代被验收命令。

### R3. 主闭环

同一 spec 至少覆盖：

```text
List → Create → canonical Basic → Basic/Request 完整保存 → stale 409/reload
→ Header create/update/delete → discovery/create/edit model
→ Provider failure → API Key/Header replacement → Provider success
→ enable model/channel → Prompt Preview/Content generation-options
→ formal Generation → Usage/Logs
```

### R4. revision、dirty 与 no replay

Channel PATCH 必须发送完整 `AIChannelUpdate` 和当前 channel revision；Header 使用 channel revision，Model 使用自身 revision。测试通过真实第二写入制造 stale revision，断言浏览器只发送一次旧命令、不自动重放、保留非敏感草稿，并只在显式 reload 后采用 canonical state。

### R5. replacement-only 与 secret

API Key 和 Header value 只通过 write-only Dialog 提交，读取面永不回显。Provider 必须先用旧凭据返回公开失败，再只在 UI replacement 后成功；Provider 只比较派生期望值，不保存、回显或记录 credential。

### R6. Provider 副作用

Discovery 必须命中 `GET /v1/models`；Model Test 与 Formal Generation 必须命中 `POST /v1/chat/completions`。每次确认最多一次外部调用；测试成功或失败后模型都保持 disabled，必须显式启用。

### R7. consumer handoff

在配置可用前先让 Prompt Preview Options 与 Content generation-options观察 empty；随后在同一 SPA 会话、不 reload 浏览器的情况下经 V2 Configuration mutation 后重新进入两个 consumer，并观察服务端返回的可用模型。query key 精确性继续由既有 component tests 证明，real-stack 不越界宣称内部 cache 实现细节。

### R8. Formal Generation 与 Runtime

Formal Generation 必须由 V2 Content Editor 创建真实 Job，经 Celery Worker 调用本机 Provider 并产生终态 ContentVersion。连接测试/发现后的 Usage 必须仍为零；正式作业后另一真实 period 显示服务端聚合。Logs 必须保持服务端分页、actor 和按需安全详情，不查询 Users、不 dump raw JSON。

### R9. Audit 边界

Discovery、测试成功和测试失败不得产生永久成功/失败审计；创建、更新、API Key、Header、Model CRUD/启停和 Channel 启用等真实配置事件必须由服务端 Logs 投影。Formal Generation 计入 Usage，不伪装成 Configuration audit。

### R10. secret-safe artifacts

real-stack 模式下 V1/V2 Playwright trace 必须在 config owner 关闭，普通 fixture suite 继续 `retain-on-failure`。secret sentinel 不得出现在 URL、读取响应、DOM、browser storage、console、公开错误、audit projection、成功运行日志、截图或 trace；禁止事后编辑 trace/日志掩盖泄漏。

### R11. timeout 与公开失败

新 V2 flow 使用 Provider credential rejection 证明公开失败；同次脚本继续运行既有 `content-ai-real-stack.spec.ts` 和 V1 MVP 的 timeout/exact retry 证据，不在新 spec 复制第二条 timeout 大流程。

### R12. cleanup

preflight 必须拒绝端口占用、Redis DB 0、非空 DB 或同 logical DB 外部客户端。成功、失败和信号退出都必须 `kill + wait` 本次进程，drop 单次数据库，删除 allowlisted storage 目录，只按枚举后的精确 key 清理本次 Redis queue/unacked/binding，并断言 Redis 空、六端口释放。不得 `FLUSHDB`、通配删除、broad kill 或清理未知资源。

### R13. V1 regression

required real-stack 命令必须显式运行 V1 `ai-channel-management.spec.ts`、`mvp-flow.spec.ts` 的 `e2e` project及其 setup dependency，记录通过/失败/跳过数与耗时。不能补写历史结果。

### R14. Contract-first stop rule

若实施中发现现有 OpenAPI/业务 backend/数据库不能表达上述行为，立即停止并回到 planning；不得在 E2E 中加入 compatibility field、silent fallback、测试专用业务 endpoint 或 migration。

## Acceptance Criteria

- [ ] 一个隔离命令完成 V2 Configuration、既有 V2 real AI/timeout、指定 V1 real-Provider 回归与资源 cleanup。
- [ ] 新 V2 spec 对业务 API 零拦截、零 fixture、零固定成功路径；所有目标 Configuration 和正式 generation mutation 均由页面发起。
- [ ] create handoff、完整 PATCH、三类 revision、真实 409/no replay、显式 reload 和 replacement-only 行为成立。
- [ ] Provider 可观察到一次旧凭据公开失败、一次替换后测试成功和一次正式 generation；无自动重试。
- [ ] Model Test 后仍 disabled；显式 enable model/channel 后两个 consumer 才出现模型。
- [ ] discovery/test 后 Usage 为零；正式 generation 后 Usage/Logs 由真实服务端数据闭环。
- [ ] secret 不出现在允许检查的读取面和 artifacts；real-stack 不生成 trace，普通 fixture trace 策略不变。
- [ ] V1 指定 real-Provider specs 产生新的实际结果，接续父 Models 历史证据缺口。
- [ ] PostgreSQL、Redis、storage、进程与端口 cleanup 全部通过；cleanup 失败时整个 gate 失败。
- [ ] OpenAPI、generated types、业务 backend、数据库、依赖与 runtime code 保持不变；fake Provider 变更仅服务 E2E。
- [ ] Required validation 的命令、退出码、计数、耗时、artifact/cleanup 证据与剩余风险写入 `implement.md`。
- [ ] 提交前展示精确 commit plan 并等待确认；不 push、不创建 PR。

## Planning Gate

- 当前状态保持 `planning`；本轮只完善 `prd.md`、`design.md`、`implement.md` 和审计记录。
- 未获得用户对本最终计划的后续明确批准前，不运行 `task.py start`、不创建临时分支、不实现代码、不提交本 Task。
- 获批实施时使用独立会话和候选临时分支 `codex/frontend-v2-ai-channel-configuration-e2e`，从当时最新 clean `main` 创建。
