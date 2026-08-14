# Frontend V2 AI Channel Workspace 实施计划

## 0. 当前阶段与门禁

- 当前父 Task 仅完成 planning，状态必须保持 `planning`。
- 本轮不得运行 `task.py start`、创建子 Task、创建分支、修改业务代码、提交、push或创建PR。
- 用户批准父计划后，按 Core → Models → Runtime 逐个创建子 Trellis Task；每个子 Task 使用新的独立会话。
- 每个子 Task 启动前重新确认：主工作目录为最新 clean `main`；前序子 Task 已归档并 fast-forward 合入；没有同名分支/worktree；再运行该子 Task 的 `task.py start` 并创建唯一临时分支。
- 不并行维护多个实现分支，不从旧临时分支派生下一 Task。
- 每个子 Task 提交前展示精确 commit plan 并等待用户确认；不push、不建PR。归档后在主工作目录 fast-forward合入`main`并删除临时分支。

## 1. 子 Task 1：`frontend-v2-ai-channel-workspace-core`

候选分支：`codex/frontend-v2-ai-channel-workspace-core`。

### 1.1 Contract first

1. 修改 `contracts/openapi.yaml`：
   - 从 `AIChannelHeader` 移除 `value`。
   - Header DELETE 增加 required `expected_channel_revision` query与 `409/422`。
   - 不改变 `AIChannelUpdate`/`AIChannelCreate`/API Key payload，不增加partial或compatibility字段。
2. 修改后端 runtime schema/router/service：
   - Header read projection不再返回普通或敏感value。
   - Header DELETE锁定真实目标与channel后比较channel revision，再执行失效、审计与删除。
   - 保持并发DELETE单成功语义、统一失效model测试状态、ADMIN/CSRF与安全审计。
3. 更新 `backend/tests/unit/test_contract.py` 与 `backend/tests/integration/test_ai_channel_management.py`：
   - runtime/OpenAPI、Header value absence、create/update/delete revision、stale 409、并发204/404/单审计、secret redaction。
4. 生成V1/V2 types；不得手改生成文件。

### 1.2 V1 consumer update

1. `frontend/src/features/configuration/AIChannelDetailPage.tsx`：
   - Header表不展示value；普通/敏感Header edit都从空替换值开始。
   - Header DELETE发送当前channel revision。
   - 继续确保secret mutation `gcTime:0`/reset，不把值带入copy config。
2. 更新 `ConfigurationPages.test.tsx`、`ai-channel-management.spec.ts` 与直接受影响fixture。
3. 保持V1 channel完整update、API Key、Models、Usage/Logs行为不变。

### 1.3 V2 route、API owner 与表单模型

候选主要文件：

```text
frontend-v2/src/routes/_app/_admin/settings.ai.tsx
frontend-v2/src/routes/_app/_admin/settings.ai.$channelId.tsx
frontend-v2/src/domains/configuration/ai-channel.api.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.test.ts
frontend-v2/src/domains/configuration/ai-channel-workspace-page.tsx
frontend-v2/src/domains/configuration/ai-channel-workspace-page.test.tsx
frontend-v2/src/domains/configuration/ai-channel-list-page.tsx
frontend-v2/src/routeTree.gen.ts                    # generated
```

实施顺序：

1. 扩展 `aiChannelKeys` 与typed request functions；不创建第二API模块。
2. 建立UUID/tab canonical model、完整channel form mapping、server token resolver、field/server error mapping与conflict判定。
3. 注册ADMIN `$channelId` route，loader只预取detail；未交付的models/usage/logs显式not-found，不渲染200占位。
4. 实现Workspace back/header/tabs、loading/not-found/forbidden/generic/refresh states。
5. 实现共享Basic/Request form：完整update、basic↔request保留、DirtyGuard、cancel、409 lock、显式reload。
6. 实现API Key Dialog与Header Table/Dialog；secret输入生命周期、revision、focus return、confirmation。
7. 在现有List增加Create Dialog；成功seed/refetch安全detail并进入`?tab=basic`。
8. channel mutation成功按cache matrix处理；失败不乐观写入，409不自动invalidate/replay。

### 1.4 Core tests 与文档

- Component/model tests覆盖完整payload、canonical URL、dirty、conflict、token、secret lifecycle与Header无value。
- 新增严格 `tests/e2e/fixtures/ai-channel-workspace.fixture.ts` 与 `ai-channel-workspace-core.spec.ts`；未登记API为501 + teardown fail。
- 视口375/768/1024/1440、keyboard/focus、ADMIN边界、List handoff与无secret sentinel。
- 更新 `.trellis/spec/backend/ai-configuration-guidelines.md`、`.trellis/spec/frontend/state-management.md` 与 `docs/frontend-v2/02/03/05/07/08/09` 中被本slice改变的权威事实；不重复维护无变化内容。
- `contracts/database.md` 不改，并在closeout说明无持久化变化。

### 1.5 Core Required validation

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/schemas/configuration.py \
  backend/app/routers/configuration.py \
  backend/app/services/ai_configuration.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_ai_channel_management.py
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_ai_channel_management.py

npm --prefix frontend run test:watch -- --run \
  src/features/configuration/ConfigurationPages.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run e2e -- tests/e2e/ai-channel-management.spec.ts

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/ai-channel-list.model.test.ts \
  src/domains/configuration/ai-channel-list-page.test.tsx \
  src/domains/configuration/ai-channel-workspace.model.test.ts \
  src/domains/configuration/ai-channel-workspace-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/ai-channel-workspace-core.spec.ts

git diff --check
```

Required原因：Core改变共享OpenAPI、后端并发/revision、V1直接消费者和V2生产route；上述是证明合同、安全与artifact所需的最小直接集合。

### 1.6 Core Optional validation

```bash
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
make verify
```

仅在Required失败指向共享核心、准备发布或用户要求时升级；避免重复运行同一重型套件。

## 2. 子 Task 2：`frontend-v2-ai-channel-workspace-models`

候选分支：`codex/frontend-v2-ai-channel-workspace-models`。必须从Core归档并合入后的最新clean `main`创建。

### 2.1 Contract first

1. OpenAPI：
   - discovery POST required `RevisionRequest`（channel revision）及409/422。
   - model test POST required `RevisionRequest`（model revision）。
   - model DELETE required query `expected_revision`及409/422。
   - 保持model create/update shape与token union，不加compatibility字段。
2. Backend：
   - discovery在外部调用前比较expected channel revision，调用后再次读取并比较；变化丢弃结果并409。
   - model test在真实调用前比较expected model revision，保留现有调用后channel/model双revision复核。
   - model delete锁定channel→model后比较model revision。
   - model enable/disable在revision后拒绝no-op。
   - 不为discovery/test新增永久审计或Usage记录。
3. Backend tests：
   - stale before call、change during call、single Provider call、failed/success test仍disabled、delete conflict、no-op、ADMIN/CSRF、公开error无secret。
4. 双端generated types与V1所有直接endpoint consumer同步。

### 2.2 V1 consumer update

候选影响：

```text
frontend/src/features/configuration/AIChannelDetailPage.tsx
frontend/src/features/configuration/AIChannelsPage.tsx
frontend/src/features/configuration/ConfigurationPages.test.tsx
frontend/tests/e2e/ai-channel-management.spec.ts
frontend/tests/e2e/mvp-flow.spec.ts
frontend/tests/e2e/shared-data.setup.ts
```

- discovery使用current channel revision。
- test/delete使用current model revision。
- 409不自动重放；不写固定0或先GET猜revision的compatibility helper。

### 2.3 V2 Models vertical slice

1. 扩展现有AI API owner：model keys/query与全部typed commands。
2. 在workspace model定义form schema/payload mapping、JSON boundary、model token exhaustive resolver与公开错误映射。
3. Models tab active时才GET；实现loading/empty/error/refresh。
4. 复用Table Kit/RowActions实现模型、状态、连接测试、最近测试、操作；移动摘要保持全部事实。
5. discovery Dialog：显式说明远端调用，结果只在Dialog局部，configured item跳到真实row，ADD_MODEL预填model_id但不自动提交。
6. create/edit Dialog：完整字段，unknown/reserved JSON显式失败；成功用canonical response并按cache matrix失效。
7. test Dialog：真实副作用确认、pending single-flight、PASS/FAIL后仍disabled、409不重试。
8. enable/disable/delete：server token、revision、confirm/focus、no-op与conflict。
9. Core中`models` reserved tab从not-found切换为真实section；不改变其他未交付tab。

### 2.4 Models tests 与文档

- Component tests覆盖token/action table、JSON mapping、revision、single call、conflict、pending与cache callbacks。
- 扩展strict fixture；新增 `ai-channel-workspace-models.spec.ts`，fixture只证明production UI，不冒充Provider。
- Backend integration使用本机HTTP协议替身证明discovery/test的真实网络、副作用与secret边界。
- 四档响应式、keyboard/focus、DOM/console/request snapshot secret sentinel。
- 更新直接受影响的AI spec与Frontend V2 docs；无数据库文档变化。

### 2.5 Models Required validation

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/schemas/configuration.py \
  backend/app/routers/configuration.py \
  backend/app/services/ai_configuration.py \
  backend/tests/unit/test_ai_boundaries.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_ai_channel_management.py
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy \
  --config-file backend/pyproject.toml backend/app
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/unit/test_ai_boundaries.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_ai_channel_management.py

npm --prefix frontend run test:watch -- --run \
  src/features/configuration/ConfigurationPages.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run e2e -- \
  tests/e2e/ai-channel-management.spec.ts \
  tests/e2e/mvp-flow.spec.ts

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/ai-channel-workspace.model.test.ts \
  src/domains/configuration/ai-channel-workspace-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/ai-channel-workspace-models.spec.ts

git diff --check
```

### 2.6 Models Optional validation

```bash
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
deploy/scripts/e2e-local.sh
make verify
```

`deploy/scripts/e2e-local.sh`在本子Task仍为Optional：Required backend integration已证明真实Provider协议，V2 fixture证明production UI。完整浏览器Configuration real-stack闭环保留给后续E2E handoff。

## 3. 子 Task 3：`frontend-v2-ai-channel-workspace-runtime`

候选分支：`codex/frontend-v2-ai-channel-workspace-runtime`。必须从Models归档并合入后的最新clean `main`创建。

### 3.1 Contract confirmation

- 复核但默认不修改 `AIUsagePeriod/AIChannelUsageSummary/AuditLogList/AuditLogDetail` 与两个read endpoint。
- 若实现只消费现有合同，不生成类型diff、不改backend。
- 任何想增加cost、raw request、provider response、日志搜索或导出字段的需求都超出本Task，停止并回父计划评审。

### 3.2 V2 Runtime vertical slice

1. 扩展workspace canonical search：最终开放五tabs；usage保留显式period，logs保留显式page/pageSize，其他tabs剔除不适用参数。
2. AI API owner增加usage/logs/audit detail keys与query options；只在active tab enabled。
3. Usage使用server summary直接渲染cards与时间范围；null不补0，不用客户端时钟重算。
4. Logs使用server page/total；复用Table Kit/Pagination；actor直接来自response，不查询users。
5. Logs detail按需读取现有安全detail；只渲染typed whitelist字段，不JSON dump。
6. loading/empty/error/old data refresh/越界页与URL push/back/forward。
7. `usage|logs` reserved tab从not-found切换为真实section；最终五tab全部闭环。

### 3.3 Runtime tests 与文档

- Model/component tests覆盖canonical conditional search、API mapping、null语义、server pagination、safe detail与无users request。
- 新增 `ai-channel-workspace-runtime.spec.ts`，扩展strict fixture；未知API 501。
- 375/768/1024/1440 metrics/log table/pagination/dialog、keyboard/focus、no root overflow。
- secret sentinel不能出network response、DOM、console、error、audit detail或snapshot。
- 更新 `docs/frontend-v2/02/03/05/07/08/09` 最终五tab状态与Configuration E2E handoff；backend/spec只有现状与实现不一致时才更新。

### 3.4 Runtime Required validation

```bash
npm --prefix frontend-v2 run api:check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/integration/test_ai_channel_management.py -k 'usage or audit'

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/ai-channel-workspace.model.test.ts \
  src/domains/configuration/ai-channel-workspace-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/ai-channel-workspace-runtime.spec.ts

git diff --check
```

Runtime不改共享contract/backend时，不要求V1 generate/lint/E2E；backend目标integration直接证明Usage/Logs口径，V2 tests证明URL/rendering/production artifact。

### 3.5 Runtime Optional validation

```bash
make contract-check
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
make verify
```

若Runtime实际需要改OpenAPI/backend，则必须先回父设计确认真实合同缺口，并把双端generate、contract-check、backend Ruff/mypy/完整AI integration与V1 typecheck升级为Required。

## 4. 每个子 Task 的完成前自审

1. 完整阅读实际修改文件与相关调用者；检查diff没有未知dirty文件。
2. 对照本父Task矩阵检查：
   - 没有partial payload猜值、第二revision owner、auto replay或silent fallback。
   - 没有API Key/Header value/完整请求配置进入query key/data、error、log、audit、copy、snapshot。
   - 没有design-system导入configuration domain、通用Workspace/Action/Table抽象或新依赖。
   - mutation只失效矩阵指定cache，不修改历史Job/Version。
   - 未交付tab仍明确not-found，无200空占位。
3. Python touched-scope文档检查：非显然职责/并发/secret边界使用必要中文docstring/comment；开发者可见error/log为中文；不加机械注释。
4. Required validation全部实际通过；失败只修当前diff导致且在scope内的原因，不重复无效重跑。
5. 更新该子Task `prd/design/implement` 验收与实际文件/命令；说明是否更新OpenAPI、database、docs及原因。
6. 展示commit plan等待确认；未确认不commit。

## 5. 父 Task 最终收口与 Configuration E2E handoff

三个实现子 Task都归档并fast-forward合入`main`后，本父Task才可进入最终核对：

- 五tab、List handoff、contracts/backend/V1/V2/generated/docs一致。
- `contracts/database.md` 无变化且理由仍成立。
- 没有遗留 `codex/frontend-v2-ai-channel-workspace-*` branch/worktree。
- 主工作目录 clean `main`。

随后创建独立 `frontend-v2-ai-channel-configuration-e2e` Task（候选分支 `codex/frontend-v2-ai-channel-configuration-e2e`），专门在真实stack闭环Configuration，不在任何Workspace子Task内塞一个假“全流程”fixture。该Task应读取本父Task矩阵，并至少验证：

```text
List → Create → Basic/Request → API Key/Header → Discover/Create Model
→ Real Test → Enable Model/Channel → Prompt Preview/Generation Options
→ Formal Generation → Usage/Logs → revision conflict/no replay → secret absence
```

Configuration E2E完成前，不把“AI Channel Workspace UI已交付”表述为“真实Configuration全链路已验收”。
