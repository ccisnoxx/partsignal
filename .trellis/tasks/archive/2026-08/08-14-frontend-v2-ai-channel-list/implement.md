# Frontend V2 AI 渠道列表实施计划

## 0. 阶段门禁与交付纪律

- 当前仅完成 planning；不得运行 `task.py start`、创建分支或修改业务代码。
- 计划获用户明确批准后，重新确认主工作目录为干净 `main`、父任务已归档、目标分支/工作树不存在，再运行 `task.py start` 并创建唯一临时分支 `codex/frontend-v2-ai-channel-list`。
- 主 agent 自行完成实现与检查，不启动 subagent。
- 不 push、不创建 PR。提交前先展示精确 commit plan 并取得用户确认，不夹带不认识的 dirty 文件。
- 完成 required validation 后，解释 Trellis archive/session 可能产生的 bookkeeping commit；按获批流程归档，随后在主工作目录以 `git merge --ff-only codex/frontend-v2-ai-channel-list` 合入 `main`，确认 clean 后删除本地临时分支。由于禁止 push，正常不会存在远端临时分支；若意外存在则先报告并取得删除授权。

## 1. 契约与后端投影

### 目标

先把列表需要的事实放进单一安全投影，补全 revision/no-op 规则，Frontend V2 不做 join 或推断。

### 文件与职责

- `contracts/openapi.yaml`
  - 新增 `AIChannelConfigurationStatus`。
  - `AIChannelSummary` 删除 `base_url`，新增必填 `model_count/configuration_status`。
  - 启用/停用 200 响应改为 `AIChannelSummary`，补 `409/422`。
  - 删除增加必填 query `expected_revision`，补 `409/422`。
- `backend/app/schemas/configuration.py`
  - 增加配置状态枚举与 summary 字段；不改完整 detail schema。
- `backend/app/services/ai_configuration.py`
  - `q` 只匹配名称/描述。
  - 复用已计算的 `model_count`，在同一处生成 `configuration_status`。
  - 抽取或复用最小 summary projection 函数，使 list 与启停响应一致；只有出现真实重复时才提取，避免薄 wrapper。
  - `set_channel_enabled` 在 revision 后拒绝 no-op。
  - `delete_ai_channel` 接收 `expected_revision`，行锁后校验。
- `backend/app/routers/configuration.py`
  - 路由响应类型与 delete query 对齐 OpenAPI。
- `backend/tests/unit/test_contract.py`
  - 锁定 safe summary 字段、命令响应和 delete revision 合同。
- `backend/tests/integration/test_ai_channel_management.py`
  - 覆盖模型总数、配置状态、无 base URL、q 不探测 base URL、启停 safe response、no-op、delete conflict、Engineer 403。
  - 新增固定三条 SQL 回归：空/稀疏/密集关联数据的集合请求数量相同。

### 退出条件

- OpenAPI 与运行时 schema 一致；后端目标测试通过。
- 列表与启停响应没有 base URL/API Key/Header；所有列表列由服务端直接给出。
- 无数据库迁移、无额外列表 HTTP/SQL waterfall。

## 2. 生成类型与 V1 最小兼容

### 文件与职责

- `frontend/src/shared/api/schema.d.ts`、`frontend-v2/src/shared/api/generated/schema.d.ts`
  - 只通过各自 `api:generate` 生成，不手改。
- `frontend/src/features/configuration/AIChannelsPage.tsx`
  - 移除 summary base URL 列与地址搜索文案；删除命令传当前 revision。
- `frontend/src/features/configuration/AIChannelDetailPage.tsx`
  - 删除命令传 detail revision。
- `frontend/src/features/configuration/AIChannelFormModal.tsx`
  - 编辑类型只用完整 `AIChannel`，不为 summary 缺字段加 fallback。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx`
  - fixture 补新必填字段，更新列表/删除断言。
- `frontend/tests/e2e/ai-channel-management.spec.ts`
  - 所有清理与页面删除携带观测到的 revision；保持既有三栏真实协议 E2E。

### 退出条件

- V1 不再假设 summary 含 base URL，详情/编辑能力不变。
- V1 删除符合 revision 合同，无 `as any`、兼容字段或固定默认 revision。

## 3. Frontend V2 路由与列表模型

### 文件与职责

- `frontend-v2/src/app/navigation.ts`、`frontend-v2/src/app/navigation.test.ts`
  - 增加 admin-only “AI 渠道”导航，`navId=ai-channels`。
- `frontend-v2/src/routes/_app/_admin/settings.ai.tsx`
  - 注册 `/settings/ai`；Zod search 校验、canonical redirect、list prefetch、精确跨域 invalidation。
- `frontend-v2/src/domains/configuration/ai-channel.api.ts`
  - `aiChannelKeys`、list query options、enable/disable/delete 三条命令；由生成 operations 推导参数/响应类型。
- `frontend-v2/src/domains/configuration/ai-channel-list.model.ts`
  - URL schema/API mapping/canonical record。
  - Provider/Protocol/Status 注册表。
  - 主动作/overflow 穷尽映射、命令确认、未来 Workspace href。
  - page size 规范化、未知 token 与矛盾 projection 显式错误。
- `frontend-v2/src/domains/configuration/ai-channel-list.model.test.ts`
  - 覆盖 canonical URL、API snake_case 映射、动作表、重复 ENABLE 过滤、unknown token、配置/连接状态直接映射。
- `frontend-v2/src/routeTree.gen.ts`
  - 由 TanStack Router/Vite 生成，不手改。

### 退出条件

- URL 是唯一列表状态，刷新/直达/历史可恢复。
- 类型直接来自 OpenAPI；没有本地复制的业务 DTO 或状态机。
- 未来 Workspace 只有 href，没有路由/占位组件。

## 4. Frontend V2 页面与命令

### 文件与职责

- `frontend-v2/src/domains/configuration/ai-channel-list-page.tsx`
  - 复用 FilterBar、Table Kit、RowActions、Badge、Dialog、Notice、Pagination。
  - 实现七列、桌面/移动重复摘要、加载/空/错误/越界状态。
  - 启用/停用/删除确认、pending、焦点恢复、冲突显式 reload；命令只发送一次。
- `frontend-v2/src/domains/configuration/ai-channel-list-page.test.tsx`
  - 覆盖固定列、状态显示、筛选回调/page reset、迁移 href、命令 revision、冲突无重放、空/错误/越界。
- `frontend-v2/src/styles/global.css`
  - 仅增加 `.ai-channel-list-table` 局部响应式规则；不更改通用 Table Kit。

### Cache 失效实现

- 三种成功命令：invalidate `aiChannelKeys.lists()`、`promptKeys.previewOptionsRoot()`，并通过 `contentKeys.isGenerationOptions` predicate 失效内容生成选项。
- revision conflict：不自动 invalidation；用户点“重新加载列表”才 invalidate list。
- delete 后当前页仅一行且 `page > 1`：导航至前一页；其他命令不改 URL。
- 不刷新 Prompt 内容、Content Task 列表/详情、审计/生成历史或未存在的 Channel Workspace cache。

### 退出条件

- 一条集合请求完成首屏；无详情/model/header 请求。
- 所有服务端动作和错误可见；无乐观伪成功或自动重放。
- 移动端不丢事实/动作且页面根无横向溢出。

## 5. 严格 E2E 与文档

### 文件与职责

- `frontend-v2/tests/e2e/fixtures/ai-channels.fixture.ts`
  - 生成类型约束的 safe list fixture；实现真实 query/command/revision 语义；未知 API `501` + teardown fail。
- `frontend-v2/tests/e2e/ai-channel-list.spec.ts`
  - ADMIN/ENGINEER、URL、七列、敏感字段缺失、迁移链接、命令/冲突、状态、视口、焦点和浏览器错误。
- `.trellis/spec/backend/ai-configuration-guidelines.md`
  - safe projection、配置状态、固定查询数、revision/no-op。
- `.trellis/spec/frontend/state-management.md`
  - AI canonical URL、server actions、冲突与 cache 失效。
- `docs/frontend-v2/03-information-architecture.md`
  - `/settings/ai` 列表与未来 Workspace handoff。
- `docs/frontend-v2/05-api-and-state.md`
  - AI list read model、命令和敏感字段边界。
- `docs/frontend-v2/07-migration-plan.md`
  - 实现完成后记录该 slice；planning 阶段不改完成状态。
- `docs/frontend-v2/08-testing.md`
  - strict fixture 与 375/768/1024/1440 验收。
- `docs/frontend-v2/09-decisions.md`
  - ADR：safe summary、服务端配置状态、无 Workspace 占位。

### 退出条件

- fixture、快照、DOM、console 和网络响应均无凭据、Header 或完整 base URL。
- 文档、契约、代码和测试只描述已实现/已批准设计。
- `contracts/database.md` 保持不变并在 closeout 说明原因。

## 6. Required validation

以下为实现后的必跑检查；只在代码/环境发生可影响结果的变化后重跑失败项。

```bash
npm --prefix frontend run api:generate
npm --prefix frontend-v2 run api:generate
npm --prefix frontend run api:check
npm --prefix frontend-v2 run api:check
make contract-check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend ruff check \
  backend/app/schemas/configuration.py \
  backend/app/services/ai_configuration.py \
  backend/app/routers/configuration.py \
  backend/tests/unit/test_contract.py \
  backend/tests/integration/test_ai_channel_management.py
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend mypy --config-file backend/pyproject.toml backend/app
UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/unit/test_contract.py::test_runtime_openapi_matches_frozen_operations \
  backend/tests/unit/test_contract.py::test_ai_channel_list_contract_is_safe_and_revisioned \
  backend/tests/integration/test_ai_channel_management.py::test_ai_channel_api_enforces_permissions_contract_and_secret_redaction \
  backend/tests/integration/test_ai_channel_management.py::test_ai_channel_list_query_count_is_constant \
  backend/tests/integration/test_ai_channel_management.py::test_ai_configuration_concurrent_delete_has_single_successful_effect

npm --prefix frontend run test:watch -- --run src/features/configuration/ConfigurationPages.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend run e2e -- tests/e2e/ai-channel-management.spec.ts

npm --prefix frontend-v2 run test -- \
  src/app/navigation.test.ts \
  src/domains/configuration/ai-channel-list.model.test.ts \
  src/domains/configuration/ai-channel-list-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- tests/e2e/ai-channel-list.spec.ts

git diff --check
```

说明：后端 integration 文件同时证明真实 PostgreSQL 约束、权限、revision 与固定查询数；V1 E2E 是本次共享 summary/delete 合同收紧的直接兼容检查；V2 build 是 production artifact 门禁。

## 7. Optional full-suite validation

```bash
make verify
make test-integration
npm --prefix frontend run test
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
deploy/scripts/e2e-local.sh
```

可选原因：本任务不改变数据库 schema、外部 Provider 协议、认证模型、部署或完整 Phase 6 真实切片；required checks 已直接覆盖变更合同、两个前端消费者和生产构建。若 required 失败显示共享核心模块受影响，或准备发布，则升级运行对应全套检查。

## 8. 完成前检查

- 检查完整 diff：无 base URL/secret 泄漏、无客户端状态推断、无逐行请求、无 unknown fallback、无重复动作/缓存源、无不相关改动。
- 检查所有新增/实质修改的 Python 注释、docstring、日志、异常和开发者输出；只为非显然规则保留中文说明。
- 检查 `prd.md` 验收项、`design.md`、OpenAPI、后端、V1/V2 生成类型、测试和 docs 一致。
- 展示 commit plan 并等待用户确认；未确认不 commit。
- 归档、session journal、fast-forward merge 与分支清理按第 0 节执行；不 push、不创建 PR。
