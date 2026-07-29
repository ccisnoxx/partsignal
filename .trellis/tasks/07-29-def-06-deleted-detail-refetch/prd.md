# DEF-06：修复配置删除后的已删除详情重取

## 目标

删除当前 AI 渠道或平台 Prompt 成功后，先解除该对象的活动详情身份，再刷新列表并进入现有产品行为定义的稳定页面；删除流程不得重新 GET 已删除详情，同时保留普通直接 URL 的明确 `NOT_FOUND` 行为。

## 背景与已确认事实

- 验收报告记录：删除渠道 `a03f3c78-dadc-4192-b017-f7ac930d90c4` 后出现两次详情 404；删除 Prompt `a6101085-5ce2-4564-b1c4-53e74ab798c7` 后仍保持选中并显示 `NOT_FOUND`。
- AI 渠道详情查询由路径参数 `channelId` 驱动，见 `frontend/src/features/configuration/AIChannelDetailPage.tsx:84-110`；父工作区在无 `channelId` 且列表非空时自动选择第一条，见 `frontend/src/features/configuration/AIChannelsPage.tsx:157-163`。
- AI 渠道有两个删除调用方：详情面板 `frontend/src/features/configuration/AIChannelDetailPage.tsx:194-205` 与列表行 `frontend/src/features/configuration/AIChannelsPage.tsx:214-225`。两者都会在旧路由仍活动时移除详情 query。
- Prompt 详情查询由 URL 参数 `platform_prompt_id` 驱动，见 `frontend/src/features/configuration/PlatformPromptsPage.tsx:62-81`；无选中项且列表非空时会自动选择第一条，见同文件 `:161-169`。
- Prompt 删除成功回调先移除活动详情 query，再清理 URL 选中项，见 `frontend/src/features/configuration/PlatformPromptsPage.tsx:269-287`。
- TanStack Query 的 `removeQueries` 会让仍挂载的详情 observer 重新建立查询；React Strict Mode 或重复渲染会放大为重复请求。两个场景属于同一类“活动身份解除晚于详情缓存移除”的生命周期根因。
- AI 渠道列表 key `['ai-channels', query]` 与详情 key `['ai-channel', id]` 分离；Prompt 列表 key `['platform-prompts']` 与详情 key `['platform-prompt', id]` 分离，见 `frontend/src/shared/api/queryKeys.ts:20-27,38-40`。无需清空应用缓存或修改共享 key。

## 要求

1. 删除失败时保持当前路由或 Prompt 选中项，并显示服务端原始错误。
2. 删除成功后，先从当前列表缓存移除已删除对象，使现有自动选择逻辑不能重新激活该 ID。
3. 已删除详情缓存必须标记为失效但不得在当前活动 observer 上重新获取；以后直接访问该 ID 时仍重新请求并展示明确 `NOT_FOUND`。
4. AI 渠道详情删除和列表行删除必须遵守同一不变量；删除非当前渠道继续留在当前详情。
5. Prompt 删除成功后清理已删除选中项与本地编辑器身份，刷新 Prompt 列表；若列表仍有对象，沿用现有“无选中项时选择第一条”行为，不新增下一项推断规则。
6. 只使用现有 React Router、TanStack Query 与页面本地状态 API；不新增全局协调器、状态机、事件总线、延时跳转、404 fallback 或后端兼容行为。
7. 仅修改 `frontend/` 与本任务 Trellis 产物；不修改 OpenAPI、数据库、后端或其他验收缺陷。

## 验收标准

- [x] AC1：删除当前 AI 渠道只发送一次 DELETE，随后不再 GET 该渠道详情或模型。
- [x] AC2：渠道列表刷新；单项列表删除后 URL 回到 `/configuration/ai` 且详情为空，多项列表按既有行为只可能选择仍存在的第一项。
- [x] AC3：AI 渠道删除失败时 URL 不变、详情保持可见并展示原始错误。
- [x] AC4：从列表删除非当前 AI 渠道后，当前详情与路由保持不变。
- [x] AC5：删除当前 Prompt 只发送一次 DELETE，清除已删除选中项与编辑器身份，并且不再 GET 该 Prompt。
- [x] AC6：Prompt 列表刷新；若仍有 Prompt，只能按既有自动选择行为选择未删除对象，页面不显示由成功删除触发的 `NOT_FOUND`。
- [x] AC7：Prompt 删除失败时当前 Prompt 仍可见、URL 选中项不变并展示原始错误。
- [x] AC8：直接访问真实不存在的渠道或 Prompt 时仍发出详情 GET，并展示明确 `NOT_FOUND`。
- [x] AC9：React Strict Mode 或重复渲染下，成功删除不会产生重复详情请求。
- [x] AC10：其他配置资源删除流程与公共 API 语义不变。

## 范围外

- 平台类型唯一性、Prompt revision 起点、重复产品错误码、CSV 行为及其他验收缺陷。
- 后端删除语义、OpenAPI、数据库、权限和审计契约。
- 新的选择模型、全局缓存工具或跨资源删除框架。
