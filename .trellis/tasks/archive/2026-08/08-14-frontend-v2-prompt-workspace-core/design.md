# 设计方案

## 1. 边界

保持 `route -> domains/configuration -> design-system/shared`。Core 只改变 V2 frontend；既有 OpenAPI/backend 是业务权威。

- Route：AdminBoundary、search schema/canonical redirect、list prefetch、跨域 cache callback、页面装配。
- `prompt.api.ts`：Prompt query keys、list/detail options、CRUD、结构化错误。
- `prompt-workspace.model.ts`：URL、表单、action/error mapping 与纯 view decisions。
- `prompt-workspace-page.tsx`：Library、Editor、Bound Platforms、dialogs、dirty/focus/transient state。
- Design System：只为 DirtyGuard 增加真实需要的可选 navigation predicate；其他 primitive 原样复用。

不拆分内部页面组件文件，不创建 Prompt/Workspace 通用框架。

## 2. URL 与 DirtyGuard

```ts
type PromptWorkspaceSearch = { q?: string; promptId?: string; new?: 1 };
```

`canonicalPromptWorkspaceSearchRecord` 与 `isCanonicalPromptWorkspaceSearch` 使用项目现有显式 record 比较模式。new 与 promptId 冲突时只保留 new；未知字段删除。

DirtyGuard 新增可选 callback，接收 TanStack Router `current/next` 的 pathname/search。Prompt Workspace 仅在 pathname 相同且 editor identity（promptId/new）相同的 q-only transition 返回 false；其他 transition 返回 true。`enableBeforeUnload` 继续只由 dirty 决定，默认 callback 缺失时行为完全不变。

## 3. Query Owner

```text
promptKeys.lists()              ['configuration','prompts','list']
promptKeys.list()               same exact collection
promptKeys.details()            ['configuration','prompts','detail']
promptKeys.detail(id)           [..., id]
```

将 `platformPromptOptionsQueryOptions` 从 `platform.api.ts` 移到 `prompt.api.ts` 并命名 `platformPromptListQueryOptions`。Platform Workspace 和 Library 共享 list response/query key；Core 不定义 Preview key。

Detail query `enabled = selected && !new`，staleTime/refetch/error约定与 Configuration 现有 detail一致。create/update response 直接成为 exact Detail canonical data；list 通过 invalidate恢复服务端排序/摘要。

## 4. Component 与状态

```text
PromptWorkspacePage
├─ Header + New
├─ WorkspaceShell
│  ├─ PromptLibrary
│  ├─ PromptEditor
│  │  ├─ ErrorSummary + Name
│  │  ├─ MarkdownEditor
│  │  └─ StickyActionBar
│  └─ PromptReferencePane
│     ├─ BoundPlatforms
│     └─ GenerationBoundaryNote
├─ UpdateImpactDialog
├─ DeletePromptDialog
└─ DirtyGuard
```

- Server state：TanStack Query。
- URL：TanStack Router。
- Name/Markdown/baseline/dirty：RHF。
- Dialog target、focus return、saved announcement、conflict：local React state。
- form identity：`new` 或 `prompt:{id}`；同身份的后台 revision 仅在 clean 时更新基线，只有获准 identity change 才重建表单。

WorkspaceShell 现有 1280px 断点直接满足三栏/Tabs，不新增媒体逻辑；窄屏 TabsPanel 使用 Base UI 原生 `keepMounted`，避免切到 Library 搜索时卸载 dirty 编辑器。

## 5. Mutation 与 action

### Create

POST canonical form -> set returned Detail -> reset clean -> replace URL为 promptId -> invalidate list。

### Update

只在 `UPDATE` token存在时允许。若 detail有绑定平台，先 refetch 并显示 impact；提交 `expected_revision`。成功 set Detail + reset；失效 Prompt list、Platform lists/details、generation-options。

### Delete

只在 `DELETE` token存在时允许。intent refetch Detail后打开 dialog；提交当前 revision。成功 remove detail、URL清 selection、失效 Prompt/Platform/Content action消费者。409保留 dialog并显式 reload。

未知/重复 action、未知 error issue 或矛盾响应直接进入 error boundary/summary，不提供兼容 fallback。

## 6. Cache Matrix

| Event | Set/remove | Invalidate |
|---|---|---|
| create | set returned Prompt Detail | Prompt list |
| update | set returned Prompt Detail | Prompt list、Platform lists/details、all generation-options |
| delete | list 过滤已删除项；旧 Detail 以 `refetchType: 'none'` 失效 | Prompt list、Platform lists/details、Content lists/details/editor contexts、all generation-options |
| Platform bind/unbind | Platform owner采用 response | Prompt list/details、Content lists/details/editor contexts、all generation-options |

跨域组合放在 route callback；Configuration 同域 Prompt invalidation留在页面/API owner。历史 Job/Version不失效。

## 7. Accessibility / Responsive

- Library 使用可键盘操作的 listbox/option 或 button list，并设置 aria-selected。
- loading `aria-busy`，errors `role=alert`，save状态 `aria-live=polite`。
- Dialog 与 DirtyGuard恢复触发器焦点。
- MarkdownEditor继续 sanitize preview、字符/行数、safe-area StickyActionBar。
- 长名称、UUID、Markdown在自身容器换行/滚动；四档宽度测试根级 overflow。

## 8. 文件与回滚点

预计修改：

- `frontend-v2/src/app/navigation.ts` / test
- `frontend-v2/src/routes/_app/_admin/settings.prompts.tsx`（新增）
- `frontend-v2/src/routeTree.gen.ts`（生成）
- `frontend-v2/src/design-system/forms/dirty-guard.tsx` / test
- `frontend-v2/src/design-system/workspace/workspace-shell.tsx` / test
- `frontend-v2/src/domains/configuration/prompt.api.ts`（新增）
- `frontend-v2/src/domains/configuration/prompt-workspace.model.ts` / test（新增）
- `frontend-v2/src/domains/configuration/prompt-workspace-page.tsx` / test（新增）
- `frontend-v2/src/domains/configuration/platform.api.ts`
- `frontend-v2/src/domains/configuration/platform-workspace-page.tsx`
- `frontend-v2/src/routes/_app/settings/platforms/$platformId.tsx`
- `frontend-v2/tests/e2e/fixtures/prompt-workspace.fixture.ts`（新增）
- `frontend-v2/tests/e2e/prompt-workspace.spec.ts`（新增）

主要回滚点是 Prompt query-key ownership迁移与 DirtyGuard predicate。两者均保留原 endpoint/默认行为，无数据迁移。
