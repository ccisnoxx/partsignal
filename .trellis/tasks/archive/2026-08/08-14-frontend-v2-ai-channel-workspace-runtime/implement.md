# Frontend V2 AI Channel Workspace Runtime 实施计划

## 0. 当前阶段与启动门禁

- 用户已批准最终规划，Task 已在 `main` 运行 `task.py start` 并进入 `in_progress`；未创建开发分支。
- 实现与 Required validation 已完成；提交前仍须展示精确 commit plan 并等待用户确认，不自动提交、push 或创建 PR。
- Inline 模式不维护 `implement.jsonl/check.jsonl`；实施前使用 `trellis-before-dev` 重新读取本 Task 三份工件、适用规范和实际待改文件。
- 启动前重新确认：Core/Models 已归档并合入、父 Task 仍为 planning、本 Runtime 是当前唯一实现 Task、没有未知 dirty 文件。

## 1. 冻结现有 read contracts

1. 复核而不修改：
   - `AIUsagePeriod/AIChannelUsageSummary`
   - `AuditLog/AuditLogList/AuditLogDetail`
   - `GET .../usage-summary`
   - `GET .../audit-logs`
   - `GET /audit-logs/{audit_log_id}`
2. 扩展现有 model tests，先冻结条件式 search、URL→API 参数、Runtime action 与 safe projection 行为。
3. 若 API drift check 或 runtime evidence 证明合同不一致，停止并回 planning；不得用 optional 字段、候选 key、默认零或 raw JSON fallback 继续。

默认不修改：

```text
contracts/openapi.yaml
backend/app/**
frontend-v2/src/shared/api/generated/schema.d.ts
contracts/database.md
```

## 2. Final URL、route 与 action handoff

1. 修改 `ai-channel-workspace.model.ts`：
   - 把 search 改为按 tab 的 discriminated canonical union；
   - 增 period/page/pageSize normalizer 与 canonical record/参数映射；
   - delivered gate 开放五 tab；
   - Channel `VIEW_RUNTIME` 与 Model `VIEW_MODEL_RUNTIME` 映射到真实 Usage；
   - 增 CONFIGURATION audit display allowlist 与安全 scalar/list formatter。
2. 修改 route：`onTabChange/onSearchChange` 为每个 tab 写入唯一 canonical search；period/page/pageSize 的用户变化使用 push，canonical 修正继续 replace。
3. 修改 Workspace page 与 Models section：
   - 三个 surface 都显示五 tab；
   - dirty Basic/Request 离开到 Usage/Logs 继续走 `DirtyGuard`；
   - model runtime command 交给页面导航 Usage；
   - 不抽通用 Tab/Workspace framework。

主要 owner：

```text
frontend-v2/src/routes/_app/_admin/settings.ai_.$channelId.tsx
frontend-v2/src/domains/configuration/ai-channel-workspace.model.ts
frontend-v2/src/domains/configuration/ai-channel-workspace.model.test.ts
frontend-v2/src/domains/configuration/ai-channel-workspace-page.tsx
frontend-v2/src/domains/configuration/ai-channel-models-section.tsx
```

## 3. API owner 与 Runtime section

1. `ai-channel.api.ts`：
   - 增 `usageRoot/usage`、`logsRoot/logs`、`auditDetail` keys；
   - 增三组 typed query options，全部 `retry:false`；
   - 把现有 mutation invalidation/removal 调用迁移到 runtime root keys。
2. 新增一个 cohesive `ai-channel-runtime-section.tsx`：
   - Usage period Select、局部 loading/refresh/error、server metric `<dl>`、null/zero/time window；
   - Logs server table、actor projection、安全摘要、URL-controlled `TablePagination`、空态/越界恢复；
   - Audit Detail on-demand Sheet、safe projection、related entry、loading/error/retry/focus；
   - 不拆额外 formatter/action/cache helper 文件，除非实现证据显示当前 model 已无法承担纯映射。
3. Workspace page 只负责把 channel/search/navigation 注入 section；Runtime section 不接触写命令、Prompt/Content cache 或 auth 逻辑。

候选新增 owner：

```text
frontend-v2/src/domains/configuration/ai-channel-runtime-section.tsx
```

## 4. Component/model tests

扩展现有两份测试，不先建新测试层：

```text
frontend-v2/src/domains/configuration/ai-channel-workspace.model.test.ts
frontend-v2/src/domains/configuration/ai-channel-workspace-page.test.tsx
```

覆盖：

1. 五类 search canonicalization；非适用字段剔除；默认值显式；pageSize change 回 page 1。
2. `VIEW_RUNTIME/VIEW_MODEL_RUNTIME` 导航 Usage；Core dirty 离开回归。
3. Basic/Request/Models 不发 Runtime GET；Usage/Logs 各自只发 exact active query。
4. Usage zero/null/time window；cached refresh error 保留 data。
5. Logs URL→`page/page_size`、response order/actor、无 Users 请求、empty/越界恢复。
6. Audit Detail 只在点击后读取；已知 whitelist 正常，未知 field/value 显式错误；Sheet close/focus。
7. Secret sentinel 不进入 rendered/query-observable output。

若 `ai-channel-workspace-page.test.tsx` 因 Runtime 场景变得不可扫描，可把 Runtime component tests放入同目录单一 `ai-channel-runtime-section.test.tsx`；只有实际测试 ownership 证明需要时才增加，不预建。

## 5. Strict fixture 与 production-artifact E2E

1. 扩展 `frontend-v2/tests/e2e/fixtures/ai-channel-workspace.fixture.ts`：
   - generated-type Usage、AuditLogList、AuditLogDetail 响应；
   - 记录 method/path/query/call count；
   - 提供 Usage/Logs initial error、refresh error、empty/overrun 和 unsafe-projection probe；
   - 未声明 API 继续 501 + teardown fail，不记录 secret body 字符串。
2. 新增 `frontend-v2/tests/e2e/ai-channel-workspace-runtime.spec.ts`：
   - direct/default canonical、period/page/pageSize、refresh/Back/Forward；
   - active-only query、Channel/Model Runtime handoff；
   - zero/null、actor projection、safe summary、on-demand detail、越界恢复；
   - 无 Users/raw details/secret sentinel；
   - 375/768/1024/1440、TableShell local overflow、Sheet keyboard/Escape/focus return。
3. 继续运行 Core/Models specs，确认 shared tabs/search/page 无回归。

## 6. Specs 与 Frontend V2 docs

1. `.trellis/spec/frontend/state-management.md`：把 AI Channel Workspace signature/contract更新为最终五 tab、Runtime URL、queries、safe detail与无 Users join。
2. `.trellis/spec/backend/ai-configuration-guidelines.md`：只修正 page_size 文档漂移，明确 API `1..100`、Workspace UI `10|20|50`；不改变 runtime。
3. 更新以下权威文档的 Runtime 已交付状态、测试边界与 ADR：

```text
docs/frontend-v2/02-information-architecture-and-routing.md
docs/frontend-v2/03-page-and-workflow-blueprint.md
docs/frontend-v2/05-business-actions-state-and-api-contract.md
docs/frontend-v2/07-migration-plan.md
docs/frontend-v2/08-testing-quality-and-acceptance.md
docs/frontend-v2/09-architecture-decisions.md
```

4. `contracts/database.md` 不改；closeout 说明只读复用 `generation_jobs/audit_logs`，持久化合同无变化。

## 7. Required validation

```bash
npm --prefix frontend-v2 run api:check

UV_CACHE_DIR="$PWD/.cache/uv" uv run --project backend pytest \
  backend/tests/integration/test_ai_channel_management.py::test_ai_channel_api_enforces_permissions_contract_and_secret_redaction \
  backend/tests/integration/test_identity_management.py::test_audit_log_query_detail_filters_and_current_actor_projection

npm --prefix frontend-v2 run test -- \
  src/domains/configuration/ai-channel-workspace.model.test.ts \
  src/domains/configuration/ai-channel-workspace-page.test.tsx
npm --prefix frontend-v2 run lint
npm --prefix frontend-v2 run typecheck
npm --prefix frontend-v2 run build
npm --prefix frontend-v2 run e2e -- \
  tests/e2e/ai-channel-workspace-core.spec.ts \
  tests/e2e/ai-channel-workspace-models.spec.ts \
  tests/e2e/ai-channel-workspace-runtime.spec.ts

git diff --check
```

这些检查是本 Task 的最小直接证据：API check冻结现有 read contract；两个 PostgreSQL节点证明渠道 Usage/Logs、全局安全详情、权限、actor与secret projection；V2 model/component/production artifact证明条件 URL、共享 Workspace 回归、响应式与可访问交互。

如果实际新增独立 Runtime component test，把它加入 targeted Vitest 命令。若实际修改任何 backend/OpenAPI/generated file，必须先回 planning 说明真实缺口，并把双端 generate、contract-check、相关 Ruff/mypy/contract/integration 与 V1 typecheck 升级为 Required。

## 8. Optional validation

```bash
npm --prefix frontend-v2 run test
npm --prefix frontend-v2 run e2e
make contract-check
make test-integration
make verify
```

仅在 Required 失败指向共享核心、准备发布或用户要求时升级；不重复运行没有代码/配置变化能够影响的失败命令。完整 Configuration real-stack 浏览器闭环仍由后续独立 Task 负责。

## 9. 完成前自审与提交门禁

1. 检查全部 affected callers 与 diff，确认没有第二 key/API owner、URL/local 双状态、客户端统计/分页、Users join、raw JSON、silent fallback、自动 retry或无关修改。
2. 检查所有 Runtime query/error/DOM/fixture/trace/snapshot 无 API Key、Header value、Provider body或完整请求配置。
3. 对照 PRD 验收五 tab、action handoff、null/zero、越界页、on-demand detail、四档响应式、键盘/focus与局部错误。
4. Required validation 全部实际通过；只修当前 diff 导致且在 scope 内的问题，不重复无效重跑。
5. 核对代码、OpenAPI、generated types、spec/docs 一致；说明 backend/OpenAPI/database 未修改的原因。
6. 提交前展示精确 commit plan 并等待用户确认；未确认不 commit，不 push、不建 PR。

## 10. 实施结果（2026-08-14）

- 已交付条件式五 Tab URL、Channel/Model Runtime handoff、Usage、服务端分页 Logs、按需安全 Audit Detail、精确 Runtime keys/invalidation，以及 Core/Models/Runtime strict production-artifact 回归。
- Required validation 实际通过：OpenAPI drift check；PostgreSQL 目标节点 `2 passed`；targeted Vitest `2 files / 16 tests`；lint、typecheck、production build；三份 Playwright spec 两项目 `20 passed`；`git diff --check`。
- `contracts/openapi.yaml`、backend runtime、generated types、`contracts/database.md`、依赖与全局 store 均未修改；现有 read contracts 足以满足可观察行为。
- 当前仅剩提交门禁：等待用户确认 commit plan；不 push、不建 PR、不归档父 Task。
