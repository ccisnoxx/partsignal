# Frontend V2 Prompt Workspace Core

## 1. 目标与用户价值

交付 ADMIN-only `/settings/prompts` 的 Platform Prompt 管理核心，使管理员可以从独立 Sidebar 入口搜索、选择、新建、编辑和删除可复用 Prompt，查看当前绑定平台，并在 refresh/Back/Forward、revision conflict 和窄屏布局下保持可靠工作流。

本 Task 完成后，Prompt 管理本身可独立使用；真实 AI Preview 由后续 `frontend-v2-prompt-workspace-preview` 增量加入。

## 2. 依赖与交付顺序

- 父规划：`.trellis/tasks/08-13-frontend-v2-prompt-workspace`，已批准拆分。
- 本 Task 是第一交付，不依赖 Preview。
- Preview 子 Task必须等待本 Task 验证、提交、归档并 fast-forward 合入 main。
- 候选临时分支：`codex/frontend-v2-prompt-workspace-core`。
- 当前状态仅 planning；用户批准本文件及配套设计/实施计划前不 start、不创建分支。

## 3. 已确认事实

- Prompt CRUD OpenAPI/backend 已完整存在且 ADMIN-only；Core 不需要修改合同或 backend。
- list 是按 `lower(name), id` 稳定排序的无分页完整集合，不含 Markdown；detail 含正文、revision、actions 与全部 bound platforms。
- update/delete 使用 `expected_revision`；delete 在服务端原子解绑全部平台并递增 PlatformProfile revision，历史生成快照不变。
- V2 已有 MarkdownEditor、DirtyGuard、WorkspaceShell、StickyActionBar、Tabs、RHF/Zod 与结构化错误模式。
- Platform Workspace 当前通过 `platform.api.ts` 读取同一 Prompt list；Core 要将其移动到唯一 Prompt query owner。
- `ContentHumanizationPrompt` 不属于本 Task。

## 4. 范围

### 4.1 Route、Navigation 与 URL

- 新增 ADMIN route `/settings/prompts` 和 admin-only “Prompt 管理”Sidebar entry。
- canonical URL 只含 `q`、`promptId`、`new=1`：
  - q trim 后最长 200；空值省略。
  - promptId 仅 lowercase UUID。
  - new 仅字面量 1；与 promptId 同时存在时 new 优先。
  - 未知/非法参数被 replace canonicalize。
- 空 URL 不自动选择第一项；合法但不存在 ID 保留 URL 并显示 Detail 404。
- Prompt selection、new、direct、refresh、Back/Forward 可恢复。

### 4.2 Library 与 Detail

- Prompt Library 使用完整 list 做客户端名称 q 过滤，不增加分页、排序或绑定筛选。
- 每项展示 Name、Revision、Updated time、Bound platform count 和可用 action入口。
- selected 与 URL 一致；搜索不改 selection。
- Detail 仅在选中 Prompt 后按需读取，支持 loading、stale refresh、404、403、generic error 和 retry。
- unknown/duplicate action 显式失败；不从 count、role 或客户端状态推导 UPDATE/DELETE。

### 4.3 Editor 与 revision

- create 只提交 `name/template_markdown`；update 另提交 canonical `expected_revision`。
- name trim/nonblank/max 300；Markdown trim 后非空。
- RHF/Zod 持有表单，现有 MarkdownEditor 持有 CodeMirror/Markdown text preview/字符与行数；不创建第二 wrapper 或 word tokenizer。
- StickyActionBar 显示 clean/dirty/saving/saved/conflict/revision；pending 防重复提交。
- Ctrl/Cmd+S 仅在 dirty、合法且 UPDATE 可用时保存一次。
- 成功采用 response ID/revision，create 后 replace 为 promptId；不搜索列表推断 ID。
- `PLATFORM_PROMPT_NAME_EXISTS` 映射 name；`REVISION_CONFLICT` 保留本地草稿，显式 reload 才 reset。

### 4.4 Dirty 与 q-only navigation

- DirtyGuard 覆盖 Prompt 切换、新建、离开页面、Sidebar、Back/Forward、refresh/close。
- dirty 时 q-only URL 更新不应弹离开确认，也不得丢失表单。
- 最小扩展 DirtyGuard：增加可选 navigation predicate；未传时保留现有“阻止全部导航”行为。

### 4.5 Bound Platforms 与删除

- count/list 只来自 Prompt Detail；每项链接 `/settings/platforms/$platformId?tab=generation`。
- Core 不提供绑定/解绑 mutation。
- update/delete intent 在确认前 refetch Detail，展示全部当前 bound platforms。
- DELETE 只在服务端 action存在时展示，提交当前 Detail revision；409 不自动 replay。
- 删除成功清除 selection/detail，保留 q；Dialog 关闭或完成后恢复触发器焦点。

### 4.6 Layout 与 Core 完成态

- 使用 WorkspaceShell：1440 为 Library / Editor / Bound Platforms 三栏；375/768/1024 为 Tabs。
- Core 不渲染 Preview 占位、假结果或固定成功 fixture；reference pane 仅显示 Bound Platforms 与生成边界说明。
- loading/error/empty/status 使用语义区域、aria-live/alert 和键盘可达控件；页面根不横向溢出。

### 4.7 Cache owner

- 新 `prompt.api.ts` 唯一拥有 Prompt list/detail/mutations/query keys。
- Platform Workspace 改用同一 Prompt list key，不保留 `platformKeys.promptOptions()` 第二权威。
- create：set returned detail，invalidate Prompt list。
- update：set detail；invalidate Prompt list、Platform lists/details、all Content generation-options。
- delete：先从 list 投影过滤已删除项，旧 detail 以 `refetchType: 'none'` 失效；再 invalidate Prompt list、Platform lists/details、Content task lists/details/editor contexts、all generation-options。
- Platform bind/unbind：在现有 Platform invalidation 基础上补 Prompt list/details，以及受影响 Content task/action/generation-options consumers。
- 不清空 QueryClient，不触碰历史 GenerationJob/ContentVersion cache。

## 5. 验收标准

- [x] ADMIN 可见 entry并进入；ENGINEER 无 entry且 route/API 403。
- [x] q/promptId/new canonicalization、direct/refresh/Back/Forward 与空选择成立。
- [x] Library/Detail loading、empty、stale、404、403、error/retry 成立。
- [x] create/update/delete payload、CSRF、expected revision 与 canonical response处理准确。
- [x] name/Markdown validation、Ctrl/Cmd+S、pending 防重、name conflict 与 revision reload 成立。
- [x] DirtyGuard 阻止 identity/route/unload，允许 safe q-only navigation。
- [x] Bound Platforms、影响确认、handoff link、delete focus return成立。
- [x] single Prompt query owner和精确 cache invalidation由 tests证明。
- [x] 375/768/1024 Tabs、1440 三栏，页面根无横向溢出。
- [x] fixture 未声明 API、非预期非 2xx、console/page/request error均使测试失败。
- [x] 页面没有 Preview 占位、Humanization Tab、新依赖或通用框架。

## 6. 排除项

- 真实 Preview、Preview Options、GenerationJob polling、ContentVersion result。
- OpenAPI/backend/database/migration 调整。
- ContentHumanizationPrompt。
- Prompt bind/unbind UI、revision history、分页/排序/额外 filter、导入/导出/批量操作。
- AI Channel/Model/credential 管理、新依赖、Redux、通用 Prompt/Workspace framework。
- 旧 frontend 重构、Phase 6 完整 real-stack E2E。

## 7. 风险与 Deferred

- Bound platform 集合没有与 DELETE 一起提交的 binding token；确认前 refetch 降低陈旧窗口，实际解绑仍由服务端事务权威完成。严格集合一致性不在 Core 扩展合同。
- Preview reference pane 的最终内容由后续 Task 增量加入；Core 以 Bound Platforms 的真实可用状态交付，不保留未使用 Preview API/key scaffolding。
- 没有阻塞性产品问题。
