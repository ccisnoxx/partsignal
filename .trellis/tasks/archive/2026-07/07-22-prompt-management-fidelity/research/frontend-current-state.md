# 前端 Prompt 管理现状（只读调查）

## 路由与权限

- `frontend/src/app/App.tsx:61-70` 在 `/configuration`（`ConfigurationLayout`）下注册 `/prompts` → `PlatformPromptsPage`；配置首页重定向到 `ai`。
- `frontend/src/features/configuration/ConfigurationLayout.tsx:5-8` 仅 `auth.isAdmin` 可进入，否则重定向 `/`。`AuthProvider.tsx:20-53` 从 `/api/v1/auth/me` 获取用户，`isAdmin` 为 `account_type === 'ADMIN'`。
- `frontend/src/app/AppLayout.tsx:33-44` “配置中心”菜单为管理员专属，Prompt 菜单文案为“平台 Prompt”。

## 页面真实实现与 API

`frontend/src/features/configuration/PlatformPromptsPage.tsx:16-52` 是单页组件：

- 平台集合 `useQuery(platformProfilesQueryOptions())`（`queryOptions.ts:69-73` 调 `/api/v1/platform-profiles`，无 query 参数，返回集合及 summary）；平台类型通过 `/api/v1/platform-types` 查询。前端按 `prompt_configured` 划分已配置/未配置平台（行 39-42）。
- URL `platform_profile_id` 是唯一筛选/选择状态（行 18-34）；Select“按平台筛选 Prompt”仅单选/清除。筛选后表格只显示该平台，未筛选显示全部已配置平台。没有搜索、分页、平台类型筛选或排序控件；Table 未传 pagination（行 48-49）。
- 已配置表格列：平台、平台类型、操作；“编辑 Prompt”打开 Modal。平台类型名称由 `Map(types.data?.items)` 映射，缺失显示“未归类”（行 39、49）。
- 新增 Modal（行 50）：平台下拉只提供 `!prompt_configured` 的平台；Markdown `Input.TextArea`，首次 PUT `/api/v1/platform-profiles/{id}/prompt`，`expected_revision: null`（行 36、50）。
- 编辑 Modal（行 51）：按选中平台 GET `/api/v1/platform-profiles/{id}/prompt`（行 34），TextArea 预填 `template_markdown`；保存 PUT 并带当前 `revision`（行 37）；有 Popconfirm 物理 DELETE（行 38、51），删除后清除 URL 选择并刷新平台列表/Prompt 查询。
- 全局文章自然化 Prompt 独立 Card（行 23、47）：GET `/api/v1/content-humanization-prompt`；404 `NOT_FOUND` 被视为未配置（`humanizationMissing`，行 24），首次保存 `expected_revision:null`，已有数据按 revision 保存；失败显示 `QueryFailure`，成功 message“自然化 Prompt 已保存”。链接外部 Humanizer-zh 来源。
- 所有写操作带 `csrfHeader()`；成功后使用 React Query `setQueryData`/`invalidateQueries`（行 25、35-38）。错误聚合 `create.error ?? save.error ?? remove.error ?? saveHumanizationPrompt.error`，显示单一 Alert（行 43-46）。

## 编辑器、脏状态与交互缺口

- 编辑器是 Ant Design `Input.TextArea`（普通 textarea），样式 `.markdown-source` 仅设置等宽字体/行高（`frontend/src/styles/global.css:732`）；不是 Markdown 编辑器，无语法高亮、预览、工具栏、行号或代码模式。
- 表单通过 `initialValues` 与 `key` 按 revision 重建（行 47、50-51），没有显式 dirty 状态、离开确认、取消恢复提示或自动保存；Modal `destroyOnHidden`。
- 页面没有标签页（平台 Prompt 与全局自然化为纵向 Card），没有平台切换工作区/左右预览；平台切换仅 URL 单选筛选，编辑需回到列表点行。
- 删除仅当前 Prompt，服务端错误通过通用 `errorMessage` 展示；无权限按钮级控制（路由层已拦截），无专门 403/409/并发 revision UI。
- 加载态使用共享 `QueryLoading`，空态 `NoData`（`AsyncState.tsx`）；平台查询/自然化查询各自有 retry 入口。没有静态业务假数据（页面数据全来自 API）；外部 Humanizer-zh 超链接是固定资产。

## 类型、查询键与测试

- OpenAPI 生成类型定义 Prompt API：`frontend/src/shared/api/schema.d.ts:559-590, 4485-4604`（平台 Prompt GET/PUT/DELETE、自然化 GET/PUT）；`queryKeys.ts:31-37` 注册 `platformProfiles.prompt(id)` 与 `contentHumanizationPrompt`。
- `frontend/src/features/configuration/ConfigurationPages.test.tsx:363-428` 覆盖：真实 Prompt 列表仅显示已配置平台；新增下拉仅未配置平台且 PUT `expected_revision:null`；自然化按 revision 保存；平台 Prompt 覆盖保存带 revision、删除调用 DELETE 后行移除并显示“暂无 Prompt”。测试 fixture/API mock 位于同文件约 `:58-146`，属于测试静态数据，不是产品回退。
- `frontend/tests/e2e/mvp-flow.spec.ts:427-434, 496-498` 覆盖导航到 `/configuration/prompts`、自然化 Prompt 保存，以及平台 Prompt 删除/恢复的后端闭环。

## 可复用项与明确缺口

- 可复用：`PageHeader`、`TableRegion`、`AsyncState`（加载/失败/空态）、`errorMessage`/`ApiError`、React Query 缓存键及 CSRF 头；平台详情已有“查看 Prompt 详情”链接（`PlatformDetailPanel.tsx:53,84-90`）。
- 当前实现没有服务端列表分页/搜索协议在此页面的接入；若原型要求搜索、筛选、分页、标签页、预览、脏状态保护或权限细粒度控制，均需新增实现并先确认契约，不可从现有代码推断字段。
