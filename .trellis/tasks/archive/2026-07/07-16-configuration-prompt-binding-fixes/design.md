# 技术设计

## 1. 最小改动边界

三个问题都由当前前端状态和布局实现造成，后端数据与契约已经满足最终业务关系。本任务只修改前端，不新增数据库迁移、OpenAPI 字段、Prompt 绑定表或后端兼容分支。

- AI 模型的权威状态仍是 `AIModel.is_enabled`，渠道列表的 `enabled_models` 仍由后端过滤生成。
- Prompt 的权威关系仍是 `PlatformProfile 1-0..1 PlatformPrompt`，`platform_profile_id` 主键继续保证一个平台最多一个当前 Prompt。
- 平台表单现有 `platform_type_id` 下拉框保持不变。
- 三项改动共用配置中心页面和前端测试，不拆分子任务。

## 2. 渠道模型摘要缓存

当前数据流为：

```text
AIModel.is_enabled
→ GET /api/v1/ai-channels 的 enabled_models
→ React Query aiChannels.all
→ 渠道卡片
```

后端投影正确；失真发生在模型变更后只失效 `aiChannels.models(channelId)`。复用现有 `invalidateChannel(channelId, includeModels)`，让模型新增、编辑、测试、启用、停用和删除成功后统一失效：

- `aiChannels.detail(channelId)`
- `aiChannels.all`
- `aiChannels.models(channelId)`

不增加第二个缓存同步 helper，也不在卡片中重新请求模型列表。虽然新建模型默认未启用，统一使用同一失效路径可避免后续遗漏；编辑显示名、测试强制停用和删除都会直接影响摘要。

## 3. Prompt 管理页面

继续复用一次平台列表请求，不新增 Prompt 列表接口：

- 已配置集合：`platforms.items.filter(item => item.prompt_configured)`，作为表格唯一数据源。
- 未配置集合：`platforms.items.filter(item => !item.prompt_configured)`，作为新增 Prompt 的平台下拉选项。
- 表格只显示真实存在 Prompt 的平台；无记录时显示“暂无 Prompt”。
- 新增入口打开表单，管理员选择一个未配置平台并填写 Markdown；调用现有 PUT 路径，`expected_revision=null`。
- 编辑入口从表格行确定平台，只编辑 Markdown，不允许改绑平台。
- 删除成功后关闭编辑框，精确失效该平台 Prompt 查询和平台列表；刷新后该行自然消失。
- 平台管理页继续以“未配置 Prompt”展示平台可用性，这是平台状态，不是 Prompt 列表占位。

该设计让 Prompt 在管理界面中表现为独立记录，同时保留已批准的一对一所有权和现有服务端校验。

## 4. 侧栏遮挡

从 `AppLayout` 删除 `sider-note` 节点，并从全局 CSS 删除 `.sider-note` 规则。该说明不承载功能，不替换为固定 footer、滚动容器或新的层级规则。

配置菜单继续使用 Ant Design Menu 的现有布局；删除绝对定位元素后不存在覆盖 Prompt 管理菜单的来源。

## 5. 测试与工作区保护

- 配置页面测试覆盖 Prompt 页面不显示未配置平台、创建时下拉仅包含未配置平台、删除后关闭编辑框并从列表消失。
- 渠道详情测试覆盖模型状态变化会失效渠道列表、渠道详情和模型列表三个查询键。
- 布局测试断言侧栏不再渲染信任说明，配置子菜单仍正常展开和选中。
- 浏览器检查配置中心在短视口、1024 宽度和移动端无菜单遮挡。
- 当前工作区已有大量未提交视觉基线变化；实现时不得覆盖或混入这些文件。若删除全局侧栏说明导致视觉快照需要更新，先保留现有改动并单独报告基线协调需求，不自动重写全部快照。

## 6. 文档判断

现有方案文档已经准确记录“平台类型 → 平台 → 当前 Prompt”、一个平台最多一个 Prompt、渠道卡片只显示启用模型。本任务只修复前端展示和缓存，不改变长期业务或技术契约，因此默认不改方案文档；收尾时明确记录该判断。若实现中发现契约变化，再回到规划阶段更新文档范围。
