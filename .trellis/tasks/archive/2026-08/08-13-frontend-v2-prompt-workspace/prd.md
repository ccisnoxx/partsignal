# Frontend V2 Prompt Workspace

## 1. 目标与结果

在 Frontend V2 提供管理员专用的 `/settings/prompts`，以 List + Workspace 方式维护可复用 `PlatformPrompt`，并让管理员使用真实、已保存且已绑定到合格 `ContentTask` 平台的 Prompt 创建可审计 AI 首稿。

完成后的页面必须同时满足：

- Prompt Library、Prompt Editor 与右侧参考区形成可恢复的工作区；小于桌面断点时降为可操作 Tabs。
- Prompt CRUD、revision、dirty、删除解绑与 Bound Platforms 完全服从现有服务端合同。
- 真实 Preview 不引入 raw prompt 或临时 AI 协议，只复用既有 `GenerationJob -> ContentVersion` 链路。
- 页面、Sidebar 与后端 API 均保持 ADMIN 边界；不扩大 ENGINEER 的 Prompt 管理权限。
- `ContentHumanizationPrompt` 不进入本 Task。

## 2. 最终交付基线

### 2.1 已具备

- OpenAPI 与 backend 已有 ADMIN-only Platform Prompt list/detail/create/update/delete。
- Prompt 列表是无分页完整集合，服务端按 `lower(name), id` 稳定排序；列表不含 Markdown 正文。
- Detail 一次返回正文、revision、actions、绑定数量与全部 `bound_platforms`。
- update 使用 `expected_revision`；409 不覆盖客户端草稿。
- delete 使用 `expected_revision`，在 advisory lock 和事务内原子解绑全部当前 PlatformProfile，并递增这些 PlatformProfile revision；历史 GenerationJob JSON snapshot 与 ContentVersion 不被删除或改写。
- V2 已有 `MarkdownEditor`/`MarkdownPreview`、`DirtyGuard`、`WorkspaceShell`、`StickyActionBar`、Tabs、表单与结构化错误 primitive。
- V2 Content AI Production 已有稳定 Idempotency-Key、GenerationJob 创建、按返回 Job ID 轮询任务 Job list、terminal 停止、失败摘要和不可变 ContentVersion 读取模式。
- 既有真实栈 `content-ai-real-stack.spec.ts` 已证明 provider、Worker、snapshot、ContentVersion、retry 与 humanization 的完整生成链路。

### 2.2 已关闭缺口

- `/settings/prompts`、独立 ADMIN Sidebar entry、Prompt domain query owner、List + Workspace 页面与 production-artifact tests 已由 Core 交付。
- Prompt list/detail/mutations 已统一归属 `prompt.api.ts`；Platform Workspace 复用同一 Prompt list key，不再维护第二 owner。
- Preview 已通过 ADMIN-only 窄 read model 返回真实可生成 ContentTask 与可用模型，最终资格复用服务端 `CREATE_GENERATION_JOB` action projection，没有迁移 V1 waterfall。
- canonical `q/promptId/new`、dirty-safe 搜索导航、冲突 reload、影响确认、幂等生成与完整 cache matrix 均已实现并验证。
- Platform bind/unbind、Prompt update/delete、Preview create/terminal 已精确失效 Prompt/Content 的真实消费者，历史 Job/Version 不被重写。
- V2 03/05/08/09 与 Trellis frontend/backend 规范已同步 Core/Preview 的页面、合同、测试和架构边界。

## 3. 范围结论

### 3.1 包含

- ADMIN-only `/settings/prompts` 与独立“Prompt 管理”Sidebar entry。
- Platform Prompt Library：名称搜索、稳定列表、选择、loading/empty/error/retry。
- Detail：正文、revision、更新时间、actions、绑定数量与 Bound Platforms。
- create/update/delete，含客户端字段校验、pending 防重、结构化错误、revision conflict、显式 reload、影响确认与焦点恢复。
- 复用 MarkdownEditor 的字符/行数，不增加 word tokenizer。
- canonical URL、DirtyGuard、Ctrl/Cmd+S、responsive/accessibility。
- 真实 Preview：Prompt Preview Options、Test Context、模型、显式确认、GenerationJob、active-only tracking、ContentVersion 结果与失败状态。
- 精确 cache invalidation，以及 Platform Workspace bind/unbind 的相关消费者修正。
- 直接相关 OpenAPI、backend read model、tests 与 V2 文档。

### 3.2 ContentHumanizationPrompt 结论

排除 `ContentHumanizationPrompt`：

- V2 `/settings/prompts` 蓝图只要求 Prompt Library + Editor + Preview，没有 Humanization Tab。
- 已批准 Phase 6/Platform/Content Editor 资料没有把全局自然化 Prompt 配置纳入本 Workspace。
- V2 Content AI Production 只消费 `humanization_prompt_configured` 并执行自然化，没有配置入口。
- V1 同页 Tab 是历史布局证据，不构成 V2 需求。

后续如需 V2 自然化 Prompt 管理，应单独确认产品入口与单例语义；本 Task 不放置兼容 Tab、占位页或隐藏入口。

## 4. 权限矩阵

| Surface / API | ADMIN | ENGINEER | 权威 |
|---|---:|---:|---|
| Sidebar “Prompt 管理” | 可见 | 隐藏 | 仅改善导航体验 |
| `/settings/prompts` route | 可进入 | AdminBoundary 显示 403 | Frontend route boundary |
| GET Prompt list/detail | 允许 | 403 | backend `AdminUser` |
| POST/PUT/DELETE Prompt | 允许，写请求需 CSRF | 403 | backend ADMIN + CSRF |
| GET Prompt Preview Options（新增） | 允许 | 403 | backend `AdminUser` |
| POST GenerationJob | 允许 | 允许 | 既有 backend `EngineerUser`；本页面仍只对 ADMIN 可达 |
| GET Job list / ContentVersion | 已认证可读 | 已认证可读 | 既有 backend `CurrentUser` |

不得把 Sidebar 隐藏、route 403 或客户端 action 当作 API 授权；不修改现有角色集合或 Prompt API 权限。

## 5. 产品与交互要求

### 5.1 Canonical URL

- 仅使用 `q`、`promptId`、`new=1`。
- `q` 是 trim 后最长 200 字符的名称搜索；空值省略。
- `promptId` 是 lowercase UUID；非法值省略。
- `new=1` 与 `promptId` 互斥；同时出现时 `new=1` 优先并移除 `promptId`。
- 未知参数全部移除；合法但不存在的 Prompt ID 保留 URL 并显示 Detail 404，不伪装成空选择。
- 初始空选择保持 `{}`，不自动选中第一项。
- 搜索在完整无分页 Prompt 集合上做浏览器名称匹配；不新增分页、排序、bound/unbound filter。
- q-only 变化不丢失编辑草稿；Prompt 切换、新建、离开 route、刷新与关闭必须受 DirtyGuard 保护。

### 5.2 Prompt Library

- 每项展示 Name、Revision、Updated time、Bound platform count 与服务端 actions 对应入口。
- selected 状态严格来自 URL；搜索不改变 selection。
- Detail 只在有 `promptId` 时读取；Library 不携带 Markdown 正文。
- 长名称换行或截断但不能破坏 action 可达性。
- 未知、重复或矛盾 action token 显式失败，不静默忽略。

### 5.3 Prompt Editor

- create 只提交 `name/template_markdown`；update 另提交当前 Detail `expected_revision`。
- Name trim 后 1..300；Markdown trim 后必须非空，保存正文仍采用服务端 canonical response。
- 使用 RHF/Zod + 现有受控 MarkdownEditor；不创建 Prompt 专用 CodeMirror wrapper。
- 编辑器自身 Markdown preview 只表示模板文本渲染，右侧 Preview 必须标注为真实 AI 输出。
- 409 `REVISION_CONFLICT` 保留本地 Name/Markdown；显式 reload 才 reset 到最新 Detail。
- 保存成功直接采用 canonical response ID/revision，并 replace 为 `promptId`；不得搜索列表推断 ID。
- Ctrl/Cmd+S 仅在 dirty、合法、可 UPDATE 且非 pending 时触发一次保存。
- StickyActionBar 显示 clean/dirty/saving/saved/conflict 与 revision，不遮挡正文。
- 字符/行数直接复用 MarkdownEditor 既有口径，不增加 word count 依赖。

### 5.4 Bound Platforms 与影响确认

- 数量和列表只来自同一 Prompt Detail；不请求 Platform List join。
- 每个平台链接 `/settings/platforms/$platformId?tab=generation`。
- Prompt Workspace 不提供绑定/解绑 mutation。
- update 与 delete intent 先 refetch 当前 Detail，再展示全部绑定平台；确认后使用该 Detail revision。
- delete 仅在服务端 `DELETE` action 存在时提供；不能从 count 推导资格。
- delete 成功清除 Detail cache 和 URL selection，进入保留 q 的空选择状态。
- 409 不 replay；Dialog 保留并提供显式 reload。

### 5.5 真实 Preview

- 仅已保存、clean、Detail revision 与 Preview Options prompt revision 一致的 Prompt 可预览。
- Test Context 只能来自新增 options read model 返回的、当前真实拥有 `CREATE_GENERATION_JOB` 资格且其平台绑定当前 Prompt 的 ContentTask。
- 模型来自同一 options response，用户必须显式选择；不设默认值。
- 提交前 Dialog 明确说明：这不是沙箱，将在选定 ContentTask 创建普通、可审计的 GenerationJob 和 AI ContentVersion，并占用该任务首稿位置。
- 同一确认/失败重试使用由 `crypto.randomUUID()` 生成并按命令 signature 保存的稳定 Idempotency-Key；payload 改变或 `IDEMPOTENCY_CONFLICT` 后废弃旧 key。
- mutation 继续调用既有 `POST /content-tasks/{id}/generation-jobs`，提交 options response 的 Prompt ID/revision；浏览器不拼 snapshot。
- 只追踪返回 Job ID；仅在该 Job 为 PENDING/RUNNING 时轮询任务 Job list，terminal 后停止。
- SUCCEEDED 后按 `content_version_id` 读取既有不可变 ContentVersion；FAILED 展示公开 error code/summary。
- Prompt 后续修改、删除或解绑不改变已显示结果；页面保留明确 Job/ContentVersion 身份。
- dirty/new/无 context/无 model/Prompt revision 不一致时禁用 Preview，并给出原因。
- 不新增 preview job type、preview flag、临时 ContentVersion、raw prompt mutation 或 browser-to-provider 调用。

## 6. 验收标准

### Core

- [x] ADMIN route、Sidebar、direct/refresh/Back/Forward 与 ENGINEER route/server 403 成立。
- [x] q/promptId/new canonicalization、空选择、搜索、选择和新建可恢复。
- [x] Library/Detail loading、stale refresh、empty、404、403、error/retry 完整。
- [x] create/update/delete 使用准确合同与 action；unknown action 显式失败。
- [x] dirty、Ctrl/Cmd+S、409 保留、显式 reload、impact confirmation 与 focus return 成立。
- [x] Bound Platforms 使用 Detail 且只 handoff 到 Platform Workspace。
- [x] 375/768/1024 使用 Tabs，1440 使用三栏；页面根无横向溢出。
- [x] Core 不渲染假 Preview；Preview 由后续子任务在同一 reference pane 增量加入。

### Preview

- [x] 新 Preview Options 是 ADMIN-only、固定查询次数、无 N+1 的窄 read model。
- [x] contexts 只包含当前 action projection 允许生成、且平台绑定目标 Prompt 的任务。
- [x] Prompt revision、模型与 Test Context 均由服务端响应明确提供；无客户端 join/资格推导。
- [x] Preview 显式确认、稳定幂等、PENDING/RUNNING/SUCCEEDED/FAILED、terminal stop 与 immutable result 成立。
- [x] Preview 副作用使用普通 GenerationJob/ContentVersion；不创建第二业务状态或无审计请求。
- [x] create、terminal 和 Platform bind/unbind 精确失效真实消费者，不清空 QueryClient。
- [x] 现有 Content AI real-stack 证据继续有效；本 Task 未重复整套 provider flow。

## 7. 最终子任务交付

| 子任务 | 实际交付 | 实现提交 | 归档提交 | 状态 |
| --- | --- | --- | --- | --- |
| `frontend-v2-prompt-workspace-core` | ADMIN route/nav、Library/Detail/CRUD、Bound Platforms、dirty/revision、responsive Workspace 与 Prompt cache owner | `2705b806` | `cc32778a` | completed |
| `frontend-v2-prompt-workspace-preview` | Preview Options 合同/backend、真实 GenerationJob/ContentVersion Preview、轮询、缓存、测试与文档 | `158006b6` | `f1797710` | completed |

两个子任务均已验证、归档、fast-forward 合入 `main`，临时分支已删除。原拆分理由成立：Core 独立交付管理闭环，Preview 再同步扩展 Configuration、Content、OpenAPI 与异步证据，没有用假 Preview 污染 Core。

## 8. 明确排除项

- ContentHumanizationPrompt 与自然化配置入口。
- PlatformProfile Prompt bind/unbind UI；绑定继续在 Platform Workspace。
- Platform Type、Platform Account、AI Channel/Model 管理、discovery/test、credential/secret。
- Prompt revision history、导入/导出、批量操作、分页、排序与额外 filter。
- 未保存 Prompt Preview、raw prompt endpoint、preview job type、临时/可变 ContentVersion。
- 修改历史 GenerationJob snapshot 或历史 ContentVersion。
- 通用 Prompt/Workspace/Preview/AI workflow framework、Redux、新依赖、机械拆文件。
- 旧 frontend 重构、Workbench、Cutover、Phase 6 完整 real-stack E2E 与抽象回顾。

## 9. 最终边界与后续

- Prompt Detail 的 bound platform 集合不是与 DELETE 一起提交的并发 token。UI 会在确认前 refetch，服务端实际删除仍原子且权威；若未来要求“确认列表与实际解绑集合严格相等”，需另立合同变更，不在本 Task 猜测 binding hash。
- Preview 是普通 Content 首稿生成，不是可重复沙箱；一个 context 成功后会失去再次生成资格。确认文案、empty state 与任务链接必须准确表达该副作用。
- ContentHumanizationPrompt 的未来 V2 配置入口没有已批准决定；只记录为后续产品问题，不阻塞 Platform Prompt Workspace。
- 本父任务没有未关闭的验收缺口。后续 Phase 6 工作按迁移计划进入 `frontend-v2-ai-channel-list`，不在本任务继续扩展 Prompt/Humanization/AI 配置范围。
