# 设计方案

## 1. 最小设计判断

唯一需要新增的跨模块边界是“按已保存 Platform Prompt 返回真实可生成 Test Context 与模型”的只读合同。Prompt CRUD、生成 mutation、幂等、snapshot、Worker、Job 状态与 ContentVersion 都已有权威实现，不创建第二套 Preview workflow。

核心依赖方向保持：

```text
route
  -> configuration/Prompt Workspace
      -> configuration Prompt API/query owner
      -> content.api 公开生成边界（Preview 阶段）
      -> design-system/shared

backend production router
  -> ContentTask action projection / AI model query
  -> existing content generation command
```

Configuration 拥有页面、URL、Prompt cache 与 Preview UI；Content backend 继续拥有生成资格、命令、Job、snapshot 与 ContentVersion。

## 2. 已交付 Task 边界

### Core

- 归档：`.trellis/tasks/archive/2026-08/08-14-frontend-v2-prompt-workspace-core`；实现提交 `2705b806`。
- 已实现 Prompt 管理与可扩展的三槽 Workspace。
- 桌面三栏为 Library / Editor / Bound Platforms；不显示“即将推出”Preview，也不使用 fixture 假结果。
- 未修改 OpenAPI、backend、数据库或 Content domain。

### Preview

- 归档：`.trellis/tasks/archive/2026-08/08-14-frontend-v2-prompt-workspace-preview`；实现提交 `158006b6`。
- 已在 Core 右侧 reference pane 中把真实 Preview 放在 Bound Platforms 上方。
- 新增一个 read-only options endpoint；所有写入与异步读取复用现有 Content API。
- 未修改 Prompt CRUD 与生成状态机。

## 3. URL State

`promptWorkspaceSearchSchema` 输出：

```ts
type PromptWorkspaceSearch = {
  q?: string;
  promptId?: string;
  new?: '1';
};
```

Canonicalization：

1. q：trim，空或超过 200 字符则省略。
2. promptId：trim + lowercase，有效 UUID 才保留。
3. new：仅字面量 `1` 有效。
4. new 与 promptId 同时存在时保留 new、删除 promptId。
5. 删除未知参数；空状态不补默认 Prompt。

Route 负责 validate/canonical redirect、list prefetch、AdminBoundary 与页面装配。Detail 不在 loader 无条件读取，避免 promptId 缺失时发请求；Page 按选中 ID启用 query。

DirtyGuard 增加可选 `shouldBlockNavigation(current, next)`：Prompt Workspace 仅允许 pathname 相同且 `promptId/new` identity 未变化的 q-only navigation；其他导航保持 blocker 和 beforeunload。默认未传 predicate 时仍阻止所有导航，不改变现有消费者。

## 4. Frontend Server-State Owner

新增 `configuration/prompt.api.ts`：

```text
promptKeys.lists()                         ['configuration','prompts','list']
promptKeys.list()                          same exact unpaged collection
promptKeys.details()                       ['configuration','prompts','detail']
promptKeys.detail(promptId)                [..., promptId]
```

- 将 `platformPromptOptionsQueryOptions` 从 `platform.api.ts` 移入 `prompt.api.ts`，并改名为 `platformPromptListQueryOptions`。
- Platform Workspace 与 Prompt Library 共用 `promptKeys.list()`，不为同一 endpoint 建两套 cache。
- Prompt Detail 只由 `prompt.api.ts` 读取。
- Prompt create/update/delete 与结构化 `PromptRequestError` 由同文件拥有。
- Content generation functions/query options 保持在 `content.api.ts`；Prompt Workspace 只导入其公开 exports，不导入 Content UI 或 model 内部状态机。
- Preview 已新增 `promptKeys.previewOptionsRoot()/previewOptions(promptId)`；Core 阶段没有预建未使用 query-key 脚手架。

## 5. Library / Detail / Editor 数据边界

```text
GET /platform-prompts
  -> Library rows + Platform Workspace Prompt options

GET /platform-prompts/{id}
  -> Editor canonical baseline
  -> update/delete impact
  -> Bound Platforms

RHF form
  -> local Name + template_markdown draft only
  -> expected_revision always from canonical Detail baseline
```

- list item 与 detail 同名字段出现差异时，选中 Editor 采用 Detail；mutation 完成后写入 exact Detail 并失效 list，使列表回到 canonical。
- create response 是 PlatformPromptDetail：直接 set detail、replace URL、reset form，再失效 list。
- update response同样成为新 baseline；不额外 GET。
- refresh error 有旧 data 时继续显示旧内容并明确 stale；首次 Detail error 显示 retry/clear selection。
- 404/403/generic 分开呈现，不把 404 canonicalize 成“无选择”。

## 6. Component Hierarchy

```text
AdminBoundary
└─ PromptWorkspaceRoute
   └─ PromptWorkspacePage
      ├─ Header / New action
      ├─ WorkspaceShell
      │  ├─ context: PromptLibrary
      │  ├─ main: PromptEditor
      │  │  ├─ Name FormField
      │  │  ├─ MarkdownEditor
      │  │  ├─ ErrorSummary / conflict reload
      │  │  └─ StickyActionBar
      │  └─ reference: PromptReferencePane
      │     ├─ PromptPreview（由 Preview 子任务交付）
      │     ├─ BoundPlatforms
      │     └─ GenerationBoundaryNote
      ├─ UpdateImpactDialog
      ├─ DeletePromptDialog
      └─ DirtyGuard
```

组件先作为 `prompt-workspace-page.tsx` 内部函数保持内聚；只有真实复用或独立测试边界出现时再拆文件。不会创建通用 List/Workspace/Preview framework。

## 7. Prompt Form 与冲突

- `promptFormSchema`：name trim/nonblank/max 300；templateMarkdown trim/nonblank。
- 表单 baseline 身份是 `new` 或 `prompt:{id}:{revision}`。仅 identity 切换且未被 DirtyGuard 阻止时 reset。
- update intent 在有 bound platforms 时先 refetch Detail，再打开影响 Dialog；无绑定可直接保存。
- 保存期间所有写 action disabled；重复 Enter/shortcut 不发第二请求。
- `PLATFORM_PROMPT_NAME_EXISTS` 映射 name field；422 按 body loc 映射已知字段；未知 issue 保留 form summary/request ID。
- `REVISION_CONFLICT` 只设置 conflict banner/request ID，不 reset 表单。Reload 精确 refetch Detail，成功后才 reset/revision 更新。
- Ctrl/Cmd+S 使用 page form keydown，复用当前 save action eligibility。

## 8. Action Mapping

### Prompt

| 服务端/状态 | UI | 命令 |
|---|---|---|
| 选中 row | Library option | URL promptId，不是业务 mutation |
| ADMIN + new mode | 新建 | POST create |
| `UPDATE` | 保存 | PUT current ID + expected_revision |
| `DELETE` | 删除 | refetch Detail -> confirm -> DELETE current revision |
| 未知/重复 action | 页面错误 | 显式 throw，不忽略 |
| 409 | conflict | 保留本地，显式 reload |

### Preview

| 权威状态 | UI | 行为 |
|---|---|---|
| options.contexts | Test Context options | 列表每项已由服务端证明可 `CREATE_GENERATION_JOB` |
| options.models | Model options | 必须显式选择 |
| dirty/new/revision mismatch | disabled | 不发 mutation |
| user confirms | create | 既有 POST GenerationJob + stable Idempotency-Key |
| PENDING/RUNNING | progress | 只按返回 Job ID轮询 task Job list |
| SUCCEEDED + content_version_id | result | GET immutable ContentVersion |
| FAILED | error | error_code/summary；不伪造结果 |

不新增 PREVIEW action token：Preview 实际执行普通 `CREATE_GENERATION_JOB`，options endpoint 已限定 context，写命令再次权威校验。

## 9. Preview Options Contract

新增：

```http
GET /api/v1/platform-prompts/{platform_prompt_id}/preview-options
```

- 权限：`AdminUser`。
- Tag/owner：production；URL 以 Prompt 定位，但 eligibility/models 属于 Content generation。
- Response：`PlatformPromptPreviewOptions`。

```text
PlatformPromptPreviewOptions
  platform_prompt: PlatformPromptSnapshot { id, name, revision }
  contexts: PlatformPromptPreviewContext[]
  models: GenerationOptionModel[]

PlatformPromptPreviewContext
  content_task_id
  identifier
  product_id / brand / part_number
  platform_profile_id / platform_profile_name
  fact_version_id / fact_version
```

不返回 Fact Markdown、Prompt Markdown、完整 ContentTask、available_actions、Job history、ContentVersion、credentials 或 snapshot。

### Query 与资格

1. 验证 Prompt 存在；ADMIN 权限由 dependency 先执行。
2. 查找平台当前绑定该 Prompt 的候选 ContentTask，保持 `updated_at DESC, id DESC` 稳定顺序。
3. 复用 `content_tasks_out` 的 `CREATE_GENERATION_JOB` action projection，过滤出真正合格 context；不在新 read model 复制状态机。
4. 对合格 fact IDs 做一次批量 identity/version 查询。
5. 用与 generation-options 相同的 enabled channel + enabled/tested model 查询返回 models；在 `content_task_queries.py` 抽取同一查询 helper，并让两个 production endpoint 复用，避免 router/service 反向依赖或两份模型资格逻辑。
6. sparse/dense 响应必须是相同固定查询次数，无逐行查询。

写命令仍会锁定 task/profile/prompt 并重新验证。Read model 只改善选择体验，不取代 mutation authority。

## 10. Preview State Flow

```text
clean saved Prompt
  -> load Preview Options
  -> user selects context + model
  -> confirmation explains ordinary first-draft side effect
  -> POST existing GenerationJob (stable key)
  -> store returned job ID/task ID
  -> poll task GenerationJobList only while tracked ID active
      -> FAILED: stop + public error
      -> SUCCEEDED: stop + GET ContentVersion by returned ID
  -> render immutable result + Job/Version identities + task link
```

- Prompt options revision 与 Detail baseline 不一致时，不自动 reset editor；标记远端变化并要求 reload。
- 创建成功即失效 preview-options，因为 active Job 已改变 context eligibility；当前提交的 context label保存在本地 job view，不依赖 options 继续存在。
- terminal 后失效 Content task list/detail/editor context 与 preview-options；不重新解释已读取 snapshot。
- Fullscreen preview 只使用现有 Dialog + MarkdownPreview；不是新的 editor mode。

## 11. Mutation / Cache Matrix

| 事件 | 直接采用/移除 | 精确失效 | 不触碰 |
|---|---|---|---|
| Prompt create | set returned Detail；URL -> promptId | Prompt list | Platform/Content；新 Prompt 未绑定 |
| Prompt update | set returned Detail | Prompt list、Platform lists/details、all generation-options、该 Prompt preview-options | 历史 Job/Version |
| Prompt delete | remove Detail；URL 清 promptId | Prompt list、Platform lists/details、Content task lists/details/editor-contexts、all generation-options、all prompt preview-options | 历史 Job/Version |
| Preview Job create | store returned Job；invalidate exact task Job list | preview-options root、Content task lists/details/editor-contexts | Prompt list/detail、历史结果 |
| Preview terminal | exact Job list停止 polling；读取 Version | preview-options root、Content task lists/details/editor-contexts | Prompt current config、其他 Job/Version |
| Platform bind/unbind | Platform page采用 canonical response | Prompt list/details/preview-options、Content task lists/details/editor-contexts、all generation-options | Prompt正文、历史 Job/Version |

Platform mutation 已有 Platform list/detail invalidation，表中只列本任务需补充的 Prompt/Content consumers。不得 `queryClient.clear()` 或无条件失效全部 query。

## 12. Responsive 与 Accessibility

- 1440：WorkspaceShell 三栏；Library 16rem、Editor flexible、reference 20rem。
- 375/768/1024：WorkspaceShell Tabs，Editor 为默认主面板；Library 与 Preview/Bound Platforms 可由键盘切换。
- Library 使用语义 listbox/option 或等价 button list，`aria-selected` 与 URL 一致。
- loading 使用 aria-busy/Skeleton；errors 使用 role=alert；Job progress 使用 aria-live polite，FAILED 使用 alert。
- Dialog 关闭/取消/成功后恢复触发器焦点；DirtyGuard 保持原 focus return。
- MarkdownPreview 继续 sanitize、skip raw HTML、禁止图片；长名称/Markdown/Job ID可换行或滚动，不造成根级横向溢出。
- StickyActionBar 保留 safe-area padding，不覆盖 editor 底部。

## 13. 实际交付范围

### Core Task（`2705b806`）

- `.trellis/spec/frontend/state-management.md`
- `frontend-v2/src/app/navigation.ts`
- `frontend-v2/src/app/navigation.test.ts`
- `frontend-v2/src/routes/_app/_admin/settings.prompts.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/src/design-system/forms/dirty-guard.tsx`
- `frontend-v2/src/design-system/forms/dirty-guard.test.tsx`
- `frontend-v2/src/design-system/workspace/workspace-shell.tsx`
- `frontend-v2/src/design-system/workspace/workspace-kit.test.tsx`
- `frontend-v2/src/domains/configuration/prompt.api.ts`（新增）
- `frontend-v2/src/domains/configuration/prompt-workspace.model.ts`（新增）
- `frontend-v2/src/domains/configuration/prompt-workspace.model.test.ts`（新增）
- `frontend-v2/src/domains/configuration/prompt-workspace-page.tsx`（新增）
- `frontend-v2/src/domains/configuration/prompt-workspace-page.test.tsx`（新增）
- `frontend-v2/src/domains/configuration/platform.api.ts`
- `frontend-v2/src/domains/configuration/platform-workspace-page.tsx`
- `frontend-v2/src/routes/_app/settings/platforms/$platformId.tsx`
- `frontend-v2/tests/e2e/fixtures/prompt-workspace.fixture.ts`（新增）
- `frontend-v2/tests/e2e/prompt-workspace.spec.ts`（新增）

### Preview Task（`158006b6`）

- `.trellis/spec/backend/ai-configuration-guidelines.md`
- `contracts/openapi.yaml`
- `backend/app/schemas/content.py`
- `backend/app/routers/production.py`
- `backend/app/services/content_task_queries.py`
- `backend/tests/integration/test_prompt_preview_options.py`（新增）
- `frontend/src/shared/api/schema.d.ts`（生成，仅合同兼容）
- `frontend-v2/src/shared/api/generated/schema.d.ts`（生成）
- `frontend-v2/src/domains/content/content.api.ts`
- `frontend-v2/src/domains/configuration/prompt-preview.tsx`（新增）
- Core 中的 `prompt.api.ts`、`prompt-workspace-page.tsx` 及 tests
- Core 中的 Prompt/Platform routes
- Core 中的 Prompt fixture/spec
- `docs/frontend-v2/03-page-and-workflow-blueprint.md`
- `docs/frontend-v2/05-business-actions-state-and-api-contract.md`
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`
- `docs/frontend-v2/09-architecture-decisions.md`

最终未修改数据库 schema、migration、`contracts/database.md` 或依赖清单；仅同步了直接相关 frontend/backend Trellis stable specs。实现没有加入兼容 fallback。

## 14. 最终风险边界

- Bound Platforms confirmation 使用 intent 时最新 Detail；服务端 transaction 仍是实际解绑权威。当前合同不提供 binding-set revision，本任务不伪造严格 snapshot confirmation。
- Preview 成功会推进真实 ContentTask 主线。确认文案、任务链接和 context 移除必须把它当业务副作用，而非“测试数据”。
- `content_tasks_out` 复用确保资格一致，但可能比专用 SQL 多固定查询；只有实测成本不可接受时才在同一 owner 抽取共享资格 projection，不能先复制规则。
- Preview 不增加 real-stack suite；backend integration + production-artifact fixture + 已有 Content AI real-stack 构成证据链。若新 endpoint 使既有真实栈路径改变，才追加最小真实栈断言。
