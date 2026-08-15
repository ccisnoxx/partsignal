# Frontend V2 AI Channel Workspace Models 实施计划

## 0. 执行阶段与门禁

- 用户已批准本子计划；Task 已运行 `task.py start` 并进入实现，始终在 `main` 工作，未创建开发分支。
- 业务实现完成并通过提交前质量门禁后，按用户确认的原子提交计划提交；不 push。
- 实现前运行 `trellis-before-dev`，完整读取本 Task 三份工件、相关规范和实际待改文件；Inline 模式不维护 `implement.jsonl/check.jsonl`。
- 当前项目采用 `main` 单分支流程；除非用户另行明确授权，不创建 `codex/*` 或其他开发分支。
- 实现开始前重新确认：父 Task 仍为 `planning`、Core 已归档并存在于最新 clean `main`、当前 Task 是唯一将启动的实现 Task、没有未知 dirty 文件。

## 1. Contract first

1. 全仓搜索 discovery、model test、model delete、model enable/disable 的 runtime 与所有直接调用者，记录真实 body/query/revision 来源。
2. 修改 `contracts/openapi.yaml`：
   - discovery POST 增 required `RevisionRequest` body 与 `409/422`；
   - model test POST 增 required `RevisionRequest` body；
   - model DELETE 增 required non-negative `expected_revision` query 与 `409/422`；
   - 保持 create/update/read model/token union 不变。
3. 修改 `backend/app/routers/configuration.py` 与 `backend/app/services/ai_configuration.py`：
   - 传递并校验 discovery channel revision；真实调用前后复核；
   - test 在调用前比较 model revision，保留调用后 channel/model 双复核；
   - delete 在统一锁序后比较 model revision；
   - enable/disable revision 后拒绝 no-op；
   - 保持 discovery/test 无永久审计/Usage，Provider 调用无 retry。
4. 扩展 `backend/tests/unit/test_contract.py` 与 `backend/tests/integration/test_ai_channel_management.py`：required request、stale before call 零调用、调用期间变化单调用、PASS/FAIL disabled、delete stale、no-op 无副作用、ADMIN/CSRF、公开错误无 secret。
5. 运行双端 API generate；生成文件只由命令产生，不手改。

主要 owner：

```text
contracts/openapi.yaml
backend/app/routers/configuration.py
backend/app/services/ai_configuration.py
backend/tests/unit/test_contract.py
backend/tests/integration/test_ai_channel_management.py
frontend/src/shared/api/schema.d.ts                 # generated
frontend-v2/src/shared/api/generated/schema.d.ts   # generated
```

`backend/app/schemas/configuration.py` 默认不改；只有实际合同/运行时类型证据要求时才纳入，不能为了 UI 再建第二 DTO。

## 2. V1 与直接 API consumers

1. 完整读取 V1 Detail/List mutation 与对应 tests。
2. `AIChannelDetailPage.tsx`：discovery body 使用 current channel revision；test body、delete query 使用 current model revision；409 不 replay。
3. `AIChannelsPage.tsx`：连接测试使用 model list 返回的 current revision。
4. 更新 `ConfigurationPages.test.tsx` 的 request 断言与 mock signature。
5. 同步所有动态直调：
   - `frontend/tests/e2e/ai-channel-management.spec.ts`
   - `frontend/tests/e2e/mvp-flow.spec.ts`
   - `frontend/tests/e2e/shared-data.setup.ts`
   - `frontend-v2/tests/e2e/content-ai-real-stack.spec.ts`
6. 不加固定 revision、`as any` 或 optional compatibility helper；既有 create/test response 是当次 revision 权威来源，连接配置变化后则显式读取 canonical model list，不能沿用已失效 revision。

## 3. V2 domain model、API 与 route

1. `ai-channel.api.ts` 增加 models query options 与 discovery/create/update/test/enable/disable/delete typed request；全部使用 generated types 与现有错误映射，retry 关闭。
2. `ai-channel-workspace.model.ts` 增加：
   - model form schema、JSON object/reserved-key boundary 与 payload mapping；
   - model `primary_task/available_actions` exhaustive resolver；
   - channel Models capability 与 `TEST_MODEL -> show-models`；
   - delivered tab 扩为 `basic|request|models`，DirtyGuard 判定保持配置 surface 边界。
3. 先扩 `ai-channel-workspace.model.test.ts`，证明 JSON、token、revision mapping、delivered tab 与 Core dirty navigation。
4. route `onTabChange` 开放 models；usage/logs 保持 notFound。route 继续只 prefetch detail，不 prefetch models。

## 4. V2 Models UI vertical slice

1. 把 RHF 配置 owner 收进只在 `basic|request` 挂载的 domain-local configuration surface，保持 Core 全部行为与测试；确认离开后不留隐藏 dirty state。
2. 增加有真实责任的 `AIChannelModelsSection`：active 时读取 models，渲染 loading/empty/error/refresh 与响应式 `TableShell`。
3. 模型行展示 identity、model ID、workflow、测试状态/时间/安全摘要、启用状态与 `RowActions`；移动端主单元保留必要事实。
4. Discovery Dialog：说明真实远端调用，确认后 single-flight；结果局部；configured 定位行，unconfigured 只预填 Create Dialog。
5. Create/Edit Dialog：完整字段与 JSON 边界；create 无 revision；edit 用 current model revision；409 保留草稿、锁定旧 revision并提供显式 reload。
6. Test Dialog：PASS/FAIL 文案、真实副作用确认、current model revision、pending 防重；409 不自动 retry，结果后仍 disabled。
7. enable/disable/delete 使用 server token + current model revision；`ENABLE_CHANNEL` 复用现有 channel lifecycle；`VIEW_MODEL_RUNTIME` 保持禁用说明。
8. 成功 mutation 按设计矩阵更新/失效 cache；失败/409 不写、不失效。Dialog/RowActions 恢复焦点。

候选 owner：

```text
frontend-v2/src/routes/_app/_admin/settings.ai_.$channelId.tsx
frontend-v2/src/domains/configuration/ai-channel.api.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.test.ts
frontend-v2/src/domains/configuration/ai-channel-workspace-page.tsx
frontend-v2/src/domains/configuration/ai-channel-workspace-page.test.tsx
frontend-v2/src/domains/configuration/ai-channel-models-section.tsx  # 仅当承载完整 Models owner
```

不为 dialogs、actions、cache invalidation 再拆 helper 文件；只有上列 Models section 的真实 cohesive ownership 足以支持一个新源文件。

## 5. Strict fixture、E2E 与文档

1. 扩展 `frontend-v2/tests/e2e/fixtures/ai-channel-workspace.fixture.ts`：只声明 generated-type model list 与 Models mutations；记录调用次数与 revision，未知 API 继续 501 + teardown fail；不记录 secret/request body 字符串。
2. 新增 `frontend-v2/tests/e2e/ai-channel-workspace-models.spec.ts`：
   - List/Header handoff、direct/reload/Back/Forward、lazy query；
   - loading/empty/error/refresh；
   - discovery local result、configured focus、create prefill；
   - create/edit/test/enable/disable/delete revision 与 409 no replay；
   - unknown/contradictory token、安全 failure summary、single call；
   - 375/768/1024/1440、keyboard/focus、无 root overflow、无 secret sentinel。
3. Core spec 更新 models 从未交付到已交付的期望；usage/logs 继续 notFound。
4. 更新 `.trellis/spec/backend/ai-configuration-guidelines.md` 与 `.trellis/spec/frontend/state-management.md` 的稳定 Models 合同。
5. 更新 `docs/frontend-v2/02-information-architecture-and-routing.md`、`03-page-and-workflow-blueprint.md`、`05-business-actions-state-and-api-contract.md`、`07-migration-plan.md`、`08-testing-quality-and-acceptance.md`、`09-architecture-decisions.md` 中 Models 已交付的权威事实；不重复维护不变内容。
6. `contracts/database.md` 不改；closeout 明确 revision owner 与持久化结构未变化。

## 6. Required validation

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/routers/configuration.py \
  backend/app/services/ai_configuration.py \
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
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/ai-channel-workspace-core.spec.ts \
  tests/e2e/ai-channel-workspace-models.spec.ts

git diff --check
```

这些检查是本跨合同 slice 的最小直接证据：contract/backend 覆盖 revision 与并发；V1 E2E 的 setup + AI/MVP 流程覆盖所有直接调用和本机 Provider discovery/test；V2 component/production-artifact E2E 覆盖真实页面、Core 回归和四档 UI。

若实施实际修改 `backend/app/schemas/configuration.py` 或其他 Python 文件，把它们加入 Ruff targeted list；不得用当前静态候选列表漏检真实 touched 文件。

## 7. Optional validation

```bash
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
deploy/scripts/e2e-local.sh
make verify
```

`deploy/scripts/e2e-local.sh` 负责隔离真实栈与 V2 `content-ai-real-stack.spec.ts`；本 Task 的 Required V1 Provider E2E 与 V2 strict fixture 已分别证明真实协议和 production UI，因此完整 Configuration real-stack 浏览器闭环保留给后续独立 Task。仅在 Required 失败指向共享核心、准备发布或用户要求时升级重型 suite。

## 8. 完成前自审与提交门禁

1. 完整检查 diff 与所有 endpoint 调用者，确认没有 optional body/query、固定 revision、自动 retry/replay、第二 DTO/key/revision owner。
2. 确认 Provider 每个用户动作至多一次、stale/no-op 无副作用，secret/完整配置不进入 cache、error、audit、DOM、console、fixture、trace/snapshot。
3. 核对 mutation invalidation matrix；Prompt/Content 历史、Generation Job/Version 与 Usage 不被刷新。
4. 对非平凡 Python touched scope 执行中文 docstring/comment/开发者文本检查；只记录必要并发与外部 I/O 边界。
5. Required validation 全部实际通过；失败只修本变更导致且在范围内的问题，不重复无效重跑。
6. 核对 OpenAPI、runtime、generated types、V1/V2、tests、spec/docs 一致；说明 `contracts/database.md` 无需更新的原因。
7. 提交前展示精确 commit plan 并等待用户确认；未确认不 commit，不 push、不建 PR。

## 9. 父任务最终审计补录（2026-08-15）

- Models 合同与实现已随提交 `a9aafe79` 合入 `main`，子 Task 已归档；后续 Runtime 与 Closeout 没有修改 Models API、revision、cache 或 secret 边界。
- 父任务最终审计实际通过：V1/V2 OpenAPI drift check；backend AI boundary/contract `58 passed`；PostgreSQL AI configuration integration `4 passed`；V1 Configuration component `37 passed`、lint、typecheck；V2 Workspace model/component `16 passed`、lint、typecheck；Core/Models/Runtime production-artifact Playwright `20 passed`；`git diff --check`。
- PostgreSQL integration 覆盖 ADMIN/CSRF、Header/channel/model revision、stale/no-op、调用期间竞态、持久化和审计脱敏；V2 strict fixture 只证明 production UI，不冒充真实 Provider。
- 原实施会话和 session journal 没有保存 V1 `ai-channel-management.spec.ts` / `mvp-flow.spec.ts` 的实际运行结果；最终审计没有把未观察结果补写为成功。完整真实后端、PostgreSQL、本机 Provider 协议替身和浏览器 Configuration 闭环由 `frontend-v2-ai-channel-configuration-e2e` 接续。
- `contracts/database.md` 无需更新：本 Task 只收紧并发输入合同和复用既有 channel/model revision、Header 与模型持久化结构，没有 migration 或字段变化。
