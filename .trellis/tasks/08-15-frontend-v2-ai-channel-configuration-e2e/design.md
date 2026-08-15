# Frontend V2 AI Channel Configuration E2E Design

## 1. 决策摘要

采用一个独立、可 review 的 real-stack vertical slice，不再拆子 Task：

```text
existing e2e-local.sh
  ├─ environment preflight / exact cleanup
  ├─ FastAPI + PostgreSQL + Redis/Celery + existing fake Provider
  ├─ V2 production preview
  │    ├─ new AI Channel Configuration real-stack spec
  │    └─ existing Content AI timeout/real-generation specs
  └─ V1 dev/production surfaces
       └─ ai-channel-management + mvp-flow + setup dependency
```

理由：新 spec、Provider 的最小可观察能力、trace policy 和资源 lifecycle 共同构成一个验收结果。只提交 spec 而不关闭 secret trace/cleanup 会留下不安全 gate；只改 harness 又没有业务闭环，不能独立验收。预计约 8–10 个主要文件，仍在一个清晰 PR/commit review slice 内。

## 2. 当前实现与目标 gap

| 能力 | 当前状态 | Gap | 最终 owner |
| --- | --- | --- | --- |
| V2 List/Workspace UI | strict fixture 与 production artifact 已完整 | 没有真实 backend/Provider 连续流 | 新 real-stack spec |
| V2 Content AI | 真实 generation/humanization/timeout/retry | Channel/Header/Model 由 API 前置 | 保持原 spec；新 spec补 Configuration UI |
| V1 real Provider | 两个现有 spec 已编码 | Models Task 未保存实际结果 | required 同次重跑并记录 |
| Provider observability | models、completion count、payload 已存在 | 无法区分旧/新 credential | 原 fake Provider 的 model-prefix校验 |
| conflict | fixture 已覆盖 409 | 未经过真实 PostgreSQL revision | 新 spec + 测试 API 并发写入 |
| consumer | route 已精确 invalidate 两类 key | 尚无真实服务端 handoff | 新 spec 验证 same-SPA 结果，不冒充内部 cache test |
| Usage/Logs | UI/contract/integration 已覆盖 | 没有 Configuration→formal job→Runtime 连续证据 | 新 spec |
| trace | 默认 `retain-on-failure` | real-stack secret body 可留存 | V1/V2 Playwright config |
| database/storage | 脚本已统一清理 | 无问题 | 保持现有 owner |
| process/ports | `kill`，不 `wait`/复核 | 子进程和端口可能残留 | 原脚本 + environment helper |
| Redis | 外部 URL，无 preflight/cleanup | queue/binding 可残留或误用共享 DB | environment helper + CI 独立 DB |

## 3. 测试分层与不重复原则

### 3.1 本 Task 新增的证据

- V2 浏览器实际提交 Configuration 命令。
- PostgreSQL revision 真实 stale 409，单次命令且不 replay。
- Provider 确认旧 credential 失败、新 credential 成功。
- 同一 SPA 会话中的 Prompt/Content consumer 读取真实服务端可用模型。
- 正式 Generation 经 Worker/Provider 后进入 Usage；Logs 来自真实安全审计投影。
- real-stack trace 关闭、资源 cleanup 自动失败封闭。

### 3.2 继续由既有测试拥有的证据

- 375/768/1024/1440、键盘、focus、全部 loading/error 矩阵：Workspace strict fixture suites。
- Prompt Preview 与 Content generation-options 的精确 query key/predicate：route composition/component tests。
- Header/Model 并发锁序、audit whitelist、Usage SQL 口径和固定查询数：backend PostgreSQL integration。
- timeout、exact snapshot retry、humanization：既有 V2 Content AI 与 V1 MVP real-stack。
- 真实公网/云 Provider：不属于普通 gate。

## 4. Route、component、query、mutation 与 form ownership

| Surface | Route | Component owner | Query owner | Mutation/form owner | E2E 验证 |
| --- | --- | --- | --- | --- | --- |
| AI List/Create | `/settings/ai?page=1&pageSize=20` | `ai-channel-list-page.tsx` | `aiChannelKeys.lists/list` | Create Dialog + `createAIChannel` | UI 创建并按响应 ID 进入 Basic |
| Workspace Core | `/settings/ai/$channelId?tab=basic|request` | `ai-channel-workspace-page.tsx` | `aiChannelKeys.detail` | Basic/Request 共享 RHF；完整 `AIChannelUpdate` | 同草稿、完整 PATCH、409/reload |
| API Key/Header | `tab=request` | 同上 | Detail 的 safe Header projection | `gcTime=0` secret Dialog；channel revision | 旧/新 credential、Header CRUD、无回显 |
| Models | `tab=models` | `ai-channel-models-section.tsx` | `aiChannelKeys.models` | discovery dialog、model form、model revision | discover/create/edit/test/enable/disable/delete |
| Prompt Preview | `/settings/prompts?promptId=$id` | `prompt-preview.tsx` | `promptKeys.previewOptions` | 本 Task不从 Preview 创建第二个 job | empty → 可选择 model |
| Content generation | `/content/tasks/$taskId/editor` | `content-ai-production.tsx` | `contentKeys.generationOptions/jobs/editorContext` | AI confirm Dialog + existing job command | empty → 可选择 → formal job |
| Usage | `tab=usage&period=30d|all` | `ai-channel-runtime-section.tsx` | `aiChannelKeys.usage` | URL period 唯一 owner | test 后 0；formal 后 all=1 |
| Logs | `tab=logs&page=1&pageSize=20` | 同上 | `aiChannelKeys.logs/auditDetail` | URL pagination + on-demand Sheet | actor、server order、安全详情 |

测试不得读取 React Query 实例或调用 React 内部状态。支持 API 只创建 Platform/Prompt/Product/Fact/ContentTask 前置、制造 concurrent writer、读取最终 Usage/Logs/Job/Provider count；目标业务 mutation 仍由 V2 UI 发起。

## 5. 新 V2 real-stack flow

### 5.1 支持数据

使用 `randomUUID()` suffix 建立唯一：

- PlatformPrompt、PlatformType、PlatformProfile；
- Product、PUBLIC FactVersion、ContentTask；
- Provider model ID `e2e-config-model-{suffix}`；
- 四个只存在于进程内的 sentinel：initial/replacement API Key 与 initial/replacement sensitive Header。

支持数据通过 API 建立，因为它们不是本 Task 的验收对象；ContentTask 必须处于服务端允许 `CREATE_GENERATION_JOB` 的状态。所有数据最终由单次数据库 drop 删除，不增加逐记录 cleanup。

### 5.2 先观察 consumer empty

1. 打开 Prompt Workspace 对应 Prompt，确认 context 存在但模型为空。
2. 打开 Content Editor 的 “AI 生成首稿”，确认 generation-options 返回零模型，关闭 Dialog。
3. 全程不 reload 浏览器，保留同一 Router/QueryClient 生命周期。

### 5.3 Configuration UI

1. 从 AI List 点击创建，提交初始 API Key，断言 canonical `?tab=basic`。
2. Basic/Request 共享表单一次保存完整 name/description/provider/protocol/base URL/timeout。
3. 使用 test API 对当前 revision 做一次合法完整 PATCH；随后 UI 用旧 revision 保存，断言唯一 409、草稿保留、无自动 replay，再显式 reload。
4. Request UI 创建普通 `X-E2E-Region` 与敏感 `X-E2E-Secret` Header。
5. Models UI discovery 添加 Provider 返回的 `e2e-model`，再手工创建唯一 credential model并编辑 display name/request parameters。
6. 用 initial credentials 测试唯一 model：Provider 返回安全 400，模型保持 disabled，completion count=1。
7. Request UI replacement-only 更换 API Key并更新敏感 Header；读取面不显示新旧值。
8. Models UI 再测试：Provider 成功，模型仍 disabled，completion count=2；显式 enable model，再 enable channel。
9. 对非生产用 discovered model 完成删除；对 credential model 完成 disable→enable，证明自身 revision 链。

### 5.4 consumer 与 formal job

1. 在同一 page/context 中进入 Prompt Workspace，确认 Preview Options 出现唯一启用模型；不运行 Preview，避免创建第二个正式 Job。
2. 进入 Content Editor，确认 generation-options 出现同一模型。
3. 由 V2 Dialog确认 Prompt/model 并创建一个 GENERATE Job。
4. 等待真实 Worker/Provider 终态和 AI DRAFT；Provider count=3，最近 payload 只有严格 model/messages/stream/自定义参数，不含 credential、Header value 或配置对象。

### 5.5 Runtime 与收尾命令

1. 第一次 Model Test 后、formal generation 前访问 Usage `30d`，断言 `total_jobs=0`。
2. formal generation 后访问未预热的 `period=all`，断言 total=1、succeeded=1、failed=0、token/时长使用服务端值。
3. Logs 使用 `page=1&pageSize=20`，断言 admin actor、配置 action；读取最终 API action set，证明 discovery/test 没有 audit entry。
4. 按需打开一个 API Key/Header/Model 配置事件详情，只显示 whitelist projection。
5. formal generation 后删除普通 Header，证明 DELETE 使用最新 channel revision；此后不再调用 Provider。

## 6. Provider 设计

保持 `backend/app/ai_fake_server.py` 为唯一 owner。对 `e2e-config-model-{suffix}`：

```text
expected Authorization = Bearer e2e-config-replacement-key-{suffix}
expected X-E2E-Secret = e2e-config-replacement-secret-{suffix}
```

- 期望值从 model ID suffix 计算，不进入全局 dict、response、exception 或日志。
- completion count 仍在现有 dict 计数，payload 仍只保存 JSON body，不保存 headers。
- credential 不匹配返回固定安全错误“E2E 替换凭据未生效”，不得包含 received/expected value。
- 其他现有 model、timeout 行为保持不变，确保 V1/V2 直接消费者不漂移。

不新增 reset endpoint。唯一 model ID 使同一 Provider 进程中的计数互不污染。

## 7. revision、dirty、conflict 与 side-effect matrix

| 对象/动作 | revision owner | conflict 制造/断言 | 外部副作用 | replay |
| --- | --- | --- | --- | --- |
| Channel full PATCH | channel | test API先提交同 revision；UI旧 revision=409 | 无 Provider | 0 次自动 replay |
| API Key replace | channel | 使用 reload 后最新 revision | 重置 channel/model测试状态 | 失败也清 secret；不 replay |
| Header create/update/delete | channel | 每次采用 Detail canonical revision | 重置 channel/model状态 | 不 replay |
| discovery | channel | 当前 revision | 一次 `GET /models` | 不落库/不 audit/不 replay |
| model edit/test/enable/disable/delete | model | 每次采用 Models canonical revision | test 一次 completion | 不 replay |
| channel enable | channel | 当前 Detail revision | consumer 可用性变化 | 不 replay |
| formal generation | task/options + Idempotency-Key | server最终复核 Prompt/model | 一次 Worker completion | 当前 job 不自动重试 |

409 断言同时采集浏览器相应 method/path 次数和 Provider count；失败命令不得导致 cache optimistic success、第二写入、第二 audit或第二 Provider call。

## 8. cache/consumer matrix

| 成功 mutation | Configuration keys | Prompt Preview | Content generation-options | Runtime logs | E2E 层证据 |
| --- | --- | --- | --- | --- | --- |
| Channel update/key/Header | list/detail/models | invalidate root | invalidate predicate | channel logs | same-SPA 后读取真实可用性 |
| Model create/test | list/detail/models | 不失效 | 不失效 | create 才刷新 logs | test 不使 model 可用 |
| Model edit/enable/disable/delete | list/detail/models | invalidate root | invalidate predicate | logs | enable/channel enable 后才出现 |
| Channel enable/disable/delete | list/detail/models | invalidate root | invalidate predicate | logs | enabled 后 consumer出现 |

该矩阵描述现有生产 owner；新 E2E 不添加 query key、不从 Configuration domain 导入 Content 组件。精确 key 调用由既有 component tests保留，real-stack 只验证服务端结果链。

## 9. secret handling matrix

| Surface | 允许内容 | 禁止内容 | 验证方式 |
| --- | --- | --- | --- |
| create/replace/Header request | 浏览器到真实 API 的 write-only body | 进入任何 GET/cache key/log | trace off；后续 safe GET 文本扫描 |
| Channel Detail/Model/Usage/Logs | configured flag、Header name/type、safe summary | API Key、普通/敏感 Header value | 收集相关 GET response text 扫 sentinel |
| Provider | 内存中比较 Header；payload 只存 JSON body | 记录/返回 auth 或 Header value | safe error + payload endpoint断言 |
| URL/DOM/browser storage | 公开 ID、tab/period/page | credential、完整配置正文 | URL/body text/storage扫描 |
| console/runner log | safe IDs、job/status/request ID | sentinel、request body | console collection + gate log `rg` |
| screenshot | secret Dialog 关闭后的公开页面（本 spec默认不截图） | input 值 | 不创建新视觉 artifact |
| Playwright trace | fixture suite按现状 | real-stack 任何 trace | config条件 `off` + artifact检查 |
| audit list/detail | whitelist changes/facts、actor、request ID | credential、raw nested JSON | UI Sheet + API response扫描 |

不访问或序列化 React Query 内部状态；Core component test 的 `gcTime=0` 和 mutation reset 继续拥有该证据。

## 10. trace 设计

两个 Playwright config 统一读取现有 `PARTSIGNAL_E2E_REAL_STACK`：

```text
real stack = 1  -> trace: off
otherwise       -> trace: retain-on-failure
```

`e2e-local.sh` 已向 V2 命令传该变量，需同样传给 V1 命令。新 spec 不再建立第二个 file-level策略。V2 Core fixture 因任何单独运行都会提交 secret，继续保留其现有 `test.use({ trace: 'off' })`。

## 11. environment 与 cleanup

新增聚焦的 `deploy/scripts/e2e-environment.py`，只负责本脚本的端口/Redis生命周期，不承载业务 setup。

### Preflight

- 从 `REDIS_URL` 解析 logical DB，拒绝 DB 0。
- 设置本次 helper client name，检查目标 DB `DBSIZE=0`，并拒绝该 DB 上除自身外的客户端。
- 逐一 bind `127.0.0.1` 的 `8000/9001/5173/4173/4174/$PARTSIGNAL_E2E_STORAGE_PORT`，任一占用即失败。
- preflight 在创建临时数据库、目录和进程前完成。

### Cleanup

- shell 对每个已登记 PID 先 `kill` 再 `wait`；不存在/已退出不伪造失败。
- helper 再确认没有外部同 DB client，枚举全部 keys。
- 只接受 exact `celery`、`unacked`、`unacked_index`、`unacked_mutex` 和 `_kombu.binding.*`；把枚举结果作为 exact key list 删除，不使用 `FLUSHDB` 或通配 DELETE。
- 断言 `DBSIZE=0` 与六端口可重新 bind；未知 key/listener 使 cleanup 非零。
- 随后脚本继续 drop allowlisted database、删除 allowlisted storage；原测试非零优先保留，测试成功但任一 cleanup 失败时最终非零。

CI 的 `make e2e` step 使用 DB 14，避免前序 backend integration 的 DB 15 binding metadata污染 E2E ownership。

## 12. OpenAPI/backend/database

| Layer | 变化 |
| --- | --- |
| `contracts/openapi.yaml` | 无 |
| generated V1/V2 types | 无；`make contract-check` 证明不漂移 |
| production router/schema/service | 无 |
| PostgreSQL schema/migration | 无 |
| `backend/app/ai_fake_server.py` | 仅 E2E Provider 的安全 credential比较 |
| deployment/runtime config | 不变；只调整 E2E script/CI test env |

如真实运行发现上述“不变”无法成立，停止本 Task，不在测试中补兼容。

## 13. 预计文件

### Test/harness

- `frontend-v2/tests/e2e/ai-channel-configuration-real-stack.spec.ts`（新增）
- `backend/app/ai_fake_server.py`
- `deploy/scripts/e2e-local.sh`
- `deploy/scripts/e2e-environment.py`（新增）
- `frontend/playwright.config.ts`
- `frontend-v2/playwright.config.ts`
- `.github/workflows/ci.yml`

### Documentation

- `docs/testing.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `.trellis/spec/frontend/quality-guidelines.md`
- 当前 Task 的 `prd.md`、`design.md`、`implement.md`、research/evidence/closeout。

不预先增加 helper/fixture 文件；新 spec 内保持局部 setup/read helper，出现第二个真实调用者前不抽象。

## 14. 响应式与浏览器边界

- 新 real-stack spec 使用 `foundation-desktop` 1440×1000，避免把跨服务 gate 乘以两个 project。
- 375/768/1024/1440、keyboard/focus、Dialog 和无根溢出继续由 `ai-channel-workspace-core/models/runtime.spec.ts` 两个 projects 的既有 20 passed 证据拥有。
- 实施若修改生产 UI/CSS（当前设计不允许），必须返回 planning，并把受影响四档 matrix 重新列入 Required。

## 15. 风险与控制

| 风险 | 控制 |
| --- | --- |
| mega-spec 过长/脆弱 | 只做一个 Configuration flow；timeout/humanization复用现有 spec；局部 helper不抽框架 |
| API setup 冒充 UI | allowlist 支持 API；目标 AI mutation和formal generation全部 UI |
| Provider count 被别的 spec污染 | 唯一 model ID；V2 new spec 在 Content AI/V1 前运行 |
| 旧 credential 仍被接受 | Provider按 model suffix派生 replacement期望；先失败后成功 |
| Usage cache仍显示预生成0 | 预生成读 `30d`，生成后读未预热 `all`，同时验证 period URL owner |
| query invalidation被过度宣称 | E2E只声称 same-SPA 服务端结果；key-level继续由component owner |
| trace泄漏 | config级 real-stack trace off；成功后查无 `trace.zip` 和 sentinel |
| Redis误清共享数据 | DB0/非空/外部client preflight拒绝；只删除枚举后的allowlist exact keys |
| CI前序 Redis metadata冲突 | E2E step独占DB14，integration继续DB15 |
| cleanup掩盖测试失败 | trap始终运行；保留原始失败码，cleanup另输出明确状态 |
| 真实产品/合同失败 | 分类、保存证据、停止；不加fallback或顺手修业务 |

## 16. Ponytail 自审

- 复用唯一 orchestration、Provider、API owner、Query owner 和既有 Content AI flow。
- 只新增一个业务 spec 和一个边界明确的 environment helper。
- 不新增 dependency、通用 fixture、Provider recorder、测试 DSL、第二 source of truth 或业务 test endpoint。
- timeout、响应式、精确 cache 和 backend contract 不重复实现。
