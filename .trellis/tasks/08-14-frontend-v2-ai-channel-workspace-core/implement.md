# Frontend V2 AI Channel Workspace Core 实施计划

## 0. 前置门禁

- 当前 Task 保持 `planning`，分支为 `codex/frontend-v2-ai-channel-workspace-core`，基线为 `fd6c9217` 的 `main`。
- 必须先由用户批准本子 Task 的最终规划摘要，下一条消息才可运行 `task.py start` 和修改产品代码。
- Inline 模式不维护 `implement.jsonl/check.jsonl`；启动前通过 `trellis-before-dev` 读取本 Task 工件和适用规范。
- 不 push、不创建 PR。Required validation 完成后先展示精确 commit plan，用户确认前不 commit。

## 1. Contract first

1. 全仓搜索 `AIChannelHeader.value`、`deleteAIChannelHeader` 和 Header DELETE 调用者。
2. 修改 `contracts/openapi.yaml`：移除 Header `value`；DELETE 增 required `expected_channel_revision` query、409/422。
3. 修改 backend schema/router/service：安全 read projection；锁定 Header/Channel 后 revision check；保留统一 invalidation、审计与并发删除语义。
4. 更新 backend contract/integration tests：runtime/OpenAPI、value absence、stale 409、并发 204/404/单审计、ADMIN/CSRF、secret redaction。
5. 运行双端 API generate；生成文件不手改。

主要 owner：

```text
contracts/openapi.yaml
backend/app/schemas/configuration.py
backend/app/routers/configuration.py
backend/app/services/ai_configuration.py
backend/tests/unit/test_contract.py
backend/tests/integration/test_ai_channel_management.py
frontend/src/shared/api/schema.d.ts                 # generated
frontend-v2/src/shared/api/generated/schema.d.ts   # generated
```

## 2. V1 consumer

1. 完整读取 `AIChannelDetailPage.tsx` 与 Header 相关 tests/E2E 调用。
2. 删除 Header value 展示/预填，普通与敏感编辑都从空替换值开始。
3. Header DELETE 发送 detail 当前 channel revision；409 不 replay。
4. 更新 `ConfigurationPages.test.tsx`、`ai-channel-management.spec.ts` 和直接受影响 fixture；不改 Models/Usage/Logs 行为。

## 3. V2 model/API/route

1. 完整读取现有 AI List API/model/page、route、Platform/Prompt workspace patterns、Form/Table/Dialog/DirtyGuard primitives 与调用者。
2. 扩展 `aiChannelKeys` 和 typed request functions；复用 `runAIChannelCommand`。
3. 新建 domain-local workspace model：UUID/tab canonical、完整 form mapping、server token exhaustive resolver、field/server error mapping、conflict 判定。
4. 先留下一个最小 model test，证明完整 payload、canonical URL、未知 token 和 conflict 分支。
5. 注册 `$channelId` ADMIN route：detail prefetch；Core delivered gate；loading/not-found/forbidden/generic/refresh states。

候选 owner：

```text
frontend-v2/src/routes/_app/_admin/settings.ai.tsx
frontend-v2/src/routes/_app/_admin/settings.ai_.$channelId.tsx
frontend-v2/src/domains/configuration/ai-channel.api.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.test.ts
frontend-v2/src/routeTree.gen.ts                    # generated
```

## 4. V2 UI vertical slice

1. 实现 Workspace back/header/tabs 与 server-token channel actions。
2. 实现共享 Basic/Request form：完整 update、跨 tab 保留、dirty/cancel、409 lock、显式 reload。
3. 实现 API Key replacement Dialog：无 prefill、`gcTime: 0`、结束 reset、focus return。
4. 实现 Header Table/Dialog：metadata-only read、普通/敏感均替换值、revision、confirm/focus。
5. 在 List 增 Create Dialog：真实 payload，成功 seed/refetch 安全 detail 并导航 Basic。
6. mutation 只按批准矩阵更新/失效 cache；失败不乐观写入，409 不 invalidate/replay。

候选 owner：

```text
frontend-v2/src/domains/configuration/ai-channel-workspace-page.tsx
frontend-v2/src/domains/configuration/ai-channel-workspace-page.test.tsx
frontend-v2/src/domains/configuration/ai-channel-list-page.tsx
```

只有真实职责或测试隔离需要时才增加文件；不预建通用组件。

## 5. E2E、spec 与 docs

1. 增加严格 `ai-channel-workspace.fixture.ts` 与 `ai-channel-workspace-core.spec.ts`；未知 API 501 + teardown fail。
2. 覆盖 List Create/handoff、direct/reload/history/canonical、Basic/Request save/dirty/409、API Key/Header sentinel、ADMIN、375/768/1024/1440、keyboard/focus/no root overflow。
3. 更新 `.trellis/spec/backend/ai-configuration-guidelines.md`、`.trellis/spec/frontend/state-management.md` 及 `docs/frontend-v2/02/03/05/07/08/09` 中被实现改变的权威事实。
4. `contracts/database.md` 不改；closeout 明确无持久化变化。

## 6. Required validation

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

这些检查直接覆盖共享 OpenAPI、后端并发/revision、V1 直接消费者、V2 route/生产构建和 Core 浏览器行为，是本 slice 的最小充分验证。

## 7. Optional validation

```bash
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make test-integration
make verify
```

仅在 Required 失败指向共享核心、准备发布或用户要求时升级；不重复运行未受环境/代码变化影响的失败命令。

## 8. 完成与提交门禁

1. 逐项核对验收标准，检查 OpenAPI、runtime、generated types、V1/V2、tests、spec/docs 一致。
2. 检查 diff 无 secret、compatibility fallback、partial payload、第二 revision/state owner、广义 catch、通用抽象、无关修改或未知 dirty 文件。
3. 对非平凡 Python 改动执行 touched-scope 中文文档/开发者文本检查；只记录必要业务规则和边界。
4. 展示 commit plan（拟提交文件分组、commit message、明确排除项）并等待用户确认。
5. 用户确认后才 commit；不 push、不建 PR。归档与 fast-forward 合入 `main` 另按 Trellis finish 流程执行并保持临时分支可删除。
