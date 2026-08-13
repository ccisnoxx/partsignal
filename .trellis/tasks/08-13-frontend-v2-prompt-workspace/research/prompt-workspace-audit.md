# Prompt Workspace 审计记录

## 1. 前置状态

- 主工作目录：`/Users/sc/PycharmProjects/partsignal`。
- 当前分支：`main`；创建 Task 前工作区干净。
- `54680bf4`、`f20a5e2f`、`9dfb22b3` 已在 main。
- `frontend-v2-platform-types` 已归档；创建前没有 active Trellis Task。
- 本 Task 已创建为 `.trellis/tasks/08-13-frontend-v2-prompt-workspace`，状态仍是 `planning`，未运行 `task.py start`。

## 2. 文档与范围证据

- `docs/frontend-v2/03-page-and-workflow-blueprint.md` 的 `/settings/prompts` 明确为 Library + Editor + Preview，并要求 revision、dirty、统计、真实 preview、bound platform。
- `docs/frontend-v2/09-architecture-decisions.md` ADR-018 只规定三栏 Prompt Workspace，没有 Humanization Tab。
- V2 Content AI Production 只读取 `humanization_prompt_configured` 并执行自然化；`frontend-v2` 没有 `ContentHumanizationPrompt` 配置页面。
- 已归档 Platform Workspace 规定 Generation Tab 只选择/解除既有 Prompt；Prompt Markdown 由独立页面维护。
- 结论：本 Task 只包含 `PlatformPrompt`。V1 的 Humanization Tab 不能作为 V2 范围证据。

## 3. 当前 Prompt 合同与 backend

### List / Detail

- `contracts/openapi.yaml` 已定义：
  - `GET/POST /api/v1/platform-prompts`
  - `GET/PUT/DELETE /api/v1/platform-prompts/{platform_prompt_id}`
- `backend/app/routers/configuration.py` 的五个 endpoint 均通过 `AdminUser` 或显式 ADMIN assertion；写操作需要 CSRF。
- `backend/app/services/platform_configuration.py::list_platform_prompts` 使用 `lower(name), id` 稳定排序，返回 revision、updated time、bound count、actions，不返回正文。
- `_platform_prompt_detail` 批量返回正文和全部 `bound_platforms`；平台按 `lower(name), id` 排序。

### Create / Update / Delete

- create/update 都 trim Markdown 并拒绝空正文；name 由 schema trim，数据库唯一。
- update 持有 Prompt row lock 并校验 `expected_revision`；审计记录当时绑定平台 IDs/count。
- delete 使用 `PLATFORM_PROMPT_BINDING_LOCK` advisory transaction lock，锁 Prompt 与全部 bound PlatformProfile；校验 revision 后统一置空 binding、递增 PlatformProfile revision，再删除 Prompt。
- `GenerationJob.input_snapshot` 只保存 Prompt identity/final messages JSON，不对当前 Prompt 建 FK；删除不会改写历史 snapshot 或 ContentVersion。
- 当前 `available_actions` 对 ADMIN 始终为 UPDATE/DELETE；没有独立 deletion projection。删除确认影响可由最新 Detail 提供，但 binding 变化不递增 Prompt revision，存在确认前后集合变化的残余竞态。

## 4. 当前 V2 frontend

- `frontend-v2/src/app/navigation.ts` 尚无 Prompt nav ID/entry；业务配置 Platform entry 对所有角色可见，Prompt 需新增 `adminOnly` entry。
- `_app/_admin/route.tsx` 已提供可复用 AdminBoundary；Platform Types 证明 flat admin route 可保持 `/settings/*` URL。
- `platform.api.ts` 当前以 `platformKeys.promptOptions()` 读取完整 Prompt list，唯一消费者是 Platform Workspace Generation Tab。
- 应将该 query 移到新的 `prompt.api.ts`/`promptKeys.list()`，让 Library 与 Platform Workspace 共享一份 Configuration server-state owner，避免同 endpoint 两套 key。
- `MarkdownEditor` 已提供 CodeMirror、edit/split/preview、revision、dirty、Unicode 字符数与行数；Prompt 不需要第二 wrapper 或 tokenizer。
- `WorkspaceShell` 在 `min-width:1280px` 显示 16rem/main/20rem 三栏，其余宽度使用 Tabs，满足 375/768/1024/1440 目标。
- `DirtyGuard` 当前阻止所有 path/search/hash 导航。为了允许 dirty 时 q-only URL 更新但阻止 editor identity 变化，需要增加可选导航 predicate；默认行为保持不变。

## 5. Preview 生成边界

- `GET /content-tasks/{id}/generation-options` 返回任务当前平台 Prompt 和可用模型，但只服务于已选定 task，不能提供某 Prompt 的合格 context 集合。
- `POST /content-tasks/{id}/generation-jobs` 只接受任务平台当前绑定的 Prompt ID/revision；`build_generation_input` 在锁内重新校验 Platform、Prompt、Fact、Product、模型与 PUBLIC egress，并冻结 snapshot。
- `create_generation_job` 只允许 OPEN、无现有主线的任务；幂等键冲突与 Prompt 变更均显式失败。
- `content_tasks_out` 是 `CREATE_GENERATION_JOB` action 的现有权威投影：OPEN、未归档、无 current content、无 active generation、Fact APPROVED/PUBLIC/nonblank、Product ACTIVE、Platform ACTIVE 且绑定 Prompt。
- V1 `PromptOutputPreview` 请求 ContentTask list 后在浏览器按 action 筛选，再读 generation-options；它还默认使用第一个绑定平台。这是被本任务明确禁止的 waterfall/客户端资格推导。
- 最小缺口是 ADMIN-only `GET /platform-prompts/{id}/preview-options`：使用现有 action projection筛出 contexts，并批量返回 context identity、当前 Prompt identity 与 enabled/tested models。
- Preview mutation、Job list polling、ContentVersion GET 全部复用现有 Content API；无需新增 preview command、DB 字段、migration、queue 或 provider flow。

## 6. Preview 副作用

- Preview 创建的是普通 `GENERATE` GenerationJob，不新增 preview 类型。
- `GenerationJob` 自身持有 `created_by`、唯一 idempotency key、immutable input snapshot、状态、provider metadata 与结果 ContentVersion 关系，是可追溯业务记录；当前 create command 没有额外 audit_log action，规划不得声称存在。
- 成功会创建 AI DRAFT ContentVersion 并设置 ContentTask 当前主线，因此该 context 不再有 `CREATE_GENERATION_JOB`。
- Prompt 后续更新/删除/解绑只改变当前配置与未来资格，不改变 Job snapshot 或已生成 ContentVersion。

## 7. 搜索、数据与权限结论

- Prompt list 是无分页完整 reference collection；名称 q 可在浏览器过滤。没有已批准 bound/unbound filter 或分页需求。
- Detail 按选择读取；Bound Platforms 不通过 Platform list join。
- Prompt route、list/detail/create/update/delete 与新 preview-options 均 ADMIN-only。
- 既有 generation command 接受 ADMIN/ENGINEER；管理员页面调用不需要扩大任何权限。

## 8. 拆分结论

- Core 是纯 frontend、可独立交付的 Prompt 管理 Workspace。
- Preview 需要 OpenAPI、backend read model、PostgreSQL query-count test、Content public API 与异步状态；它依赖 Core 页面。
- 建议按 Core -> Preview 拆分，父 Task 只做规划/一致性 owner。本轮不创建子 Task 或分支。
