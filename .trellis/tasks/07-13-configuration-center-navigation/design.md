# 技术设计

## 设计判断

当前问题是信息架构与页面边界失衡，不是简单调整 Card 样式即可解决。配置中心中的四个业务域应拥有稳定路由；渠道详情包含多组独立查询和 mutation，应从临时 Modal 提升为页面。

本任务以配置中心重组为主，并调整既有模型测试接口内部的供应商调用语义；不改变 API 路径、请求/响应结构、权限或数据库。

## 路由与权限边界

```text
/configuration                         → Navigate /configuration/ai
/configuration/ai                      → AIChannelsPage
/configuration/ai/channels/:channelId  → AIChannelDetailPage
/configuration/platform-types          → PlatformTypesPage
/configuration/platforms               → PlatformsPage
/configuration/audit                   → AuditLogPage
```

- 配置子路由放在 `ConfigurationLayout` 下，由该布局执行一次管理员校验并渲染 `Outlet`。
- `ConfigurationLayout` 是真实权限和布局边界，不仅是组件转发；普通用户直接访问时重定向首页。
- 每个叶子页面自行拥有 `PageHeader`，渠道详情页额外提供返回 AI 配置的面包屑或返回链接。
- `/configuration` 只做确定性重定向，不保留旧 Tabs 状态兼容层。

## 导航模型

`AppLayout` 的导航类型扩展为可选 `children` 的树结构。权限过滤、选中叶子、父级展开和菜单项渲染分别由小型纯函数处理，避免继续依赖扁平 `visibleNavigation.find()`。

```text
配置中心
├── AI 配置
├── 平台类型与 Prompt
├── 具体平台规则
└── 审计日志
```

- 默认展开当前路由所属的“配置中心”。
- 用户手动收起后不强制每次 render 重新展开；路由切入配置中心时确保父菜单可见。
- `currentSection` 使用最深匹配叶子的名称；渠道详情显示“AI 配置”。
- `prefetchNavigation` 接受子路由并映射到对应 loader；父菜单 hover 只预取默认 AI 配置页，不空闲预取全部管理员页面。

## 页面与组件边界

建议结构：

```text
frontend/src/features/configuration/
├── ConfigurationLayout.tsx
├── AIChannelsPage.tsx
├── AIChannelDetailPage.tsx
├── AIChannelForms.tsx
├── PlatformTypesPage.tsx
├── PlatformsPage.tsx
└── AuditLogPage.tsx
```

- `AIChannelsPage` 只负责渠道集合查询、创建、启停、删除和卡片列表。
- `AIChannelDetailPage` 负责单渠道查询、模型查询、Header/模型/连接 mutation 和三个详情区块。
- `AIChannelForms` 复用新增/编辑 Header、渠道和模型表单；不抽取只转发一两个字段的包装组件。
- `PlatformTypesPage` 承接现有 `PlatformTypesPanel`。
- `PlatformsPage` 与 `AuditLogPage` 从 `SettingsPage.tsx` 移出；业务设置文件仅保留目标问题和平台账号标识。
- 页面级文件尽量保持职责单一；如果渠道详情仍过长，只提取具有独立表单状态或复杂展示规则的区块，不创建无行为薄包装。

## AI 配置展示

### 渠道列表

使用 CSS Grid + Ant Card。每张卡展示：

- 名称和启停状态。
- API 根地址，允许换行并提供完整 title。
- 超时。
- API Key 是否已配置及最近更新时间。
- Header 数量，其中敏感 Header 只显示数量，不显示值。
- “查看配置”主入口；启停为次级操作；删除为危险操作并要求确认。

列表接口已返回 Header，但不返回模型数量。为了避免 N+1 请求，卡片不显示模型数量；模型信息只在详情页查询。

### 渠道详情

1. 连接与凭据：显示和编辑名称、根地址、超时；API Key 独立安全区域，只允许替换。
2. 请求 Header：表格展示名称、敏感性、配置状态和允许回显的值；新增/编辑使用 Modal。
3. 模型：模型表格和测试状态放在同一 Card；“获取模型”使用独立弹窗承载远端列表和添加操作，手动新增继续使用聚焦表单。

模型表格的高频操作保留“测试”和“启用/停用”；“编辑”“删除”进入更多操作，降低单行噪声。模型参数默认展示键数量或简短摘要，完整 JSON 在编辑 Modal 中查看。

### 获取模型弹窗

- 点击“获取模型”后先打开弹窗，再调用现有 `POST /ai-channels/{channel_id}/discover-models`，加载、空状态和错误均留在弹窗内。
- 远端结果只使用契约中的 `model_id`；已存在于本地模型列表的 ID 标记为“已添加”并禁用操作。
- 未配置模型通过现有单模型创建接口逐个添加，默认 `display_name=model_id`、`request_parameters={}`；高级命名和参数仍通过编辑或手动添加完成。
- 不新增批量接口，不在前端猜测供应商模型元数据，也不让远端发现结果自动落库。

### 连接测试边界

- 既有模型测试 API 保持不变，服务端改用 `OpenAICompatibleClient.test_connection()` 执行专用连接测试。
- 请求固定使用 `POST {base_url}/chat/completions`，`messages` 只有 `{"role":"user","content":"hi"}`，同时携带当前模型 ID、自定义参数、渠道凭据和 Header。
- 成功只要求 HTTP 成功且 `choices[0].message.content` 为字符串；正式生成仍由 `complete()` 独立执行严格四字段业务 JSON 校验。
- 测试期间释放数据库行锁、配置修订冲突、测试状态失效和启用门禁保持不变。

## 服务端状态与 mutation

- 保留现有 query key：`['ai-channels']`、`['ai-channel', channelId]`、`['ai-models', channelId]` 等。
- 渠道详情 mutation 成功后失效渠道详情、该渠道模型和渠道列表；不清空整个 QueryClient。
- 渠道列表删除或启停只失效渠道列表；如果操作影响当前详情，再额外失效详情。
- JSON 参数解析继续在提交边界显式失败，不添加模糊默认值或自动修复。
- 不新增后端聚合接口，不复制 OpenAPI 类型。

## 响应式与视觉

- 渠道网格使用 `minmax()` 自适应，手机固定单列。
- 详情页 Card 纵向排列，连接概览可以在宽屏使用两列，移动端回落单列。
- 表格保留明确的横向滚动边界，不让页面整体横向溢出。
- 复用现有 CSS 变量和 Ant Theme Token；新增样式集中在 `global.css` 的配置中心段落，兼容深色模式。
- 不增加无意义动效；保留当前页面进入动效和路由 Skeleton。

## 兼容与现有改动

- 当前工作副本中的 `routeLoaders.ts`、`routePrefetch.ts`、AppLayout Suspense 和 ThemeProvider 属于现有性能/主题工作，本任务必须在其上扩展。
- `routeLoaders.ts` 继续是动态 import 唯一所有者；拆页后每个配置页面有独立 loader。
- 截图式视觉基线已移除，不再为配置页面新增快照场景；响应式和无障碍验收使用功能测试与人工检查。
- `/configuration` 重定向保留旧入口，不保留旧 Tabs 查询参数。

## 测试设计

- AppLayout 单测：管理员看到配置子菜单，普通用户不可见；深层路由选中正确叶子和父菜单。
- 路由单测：`/configuration` 重定向；配置子路由管理员守卫；渠道详情刷新可恢复。
- AI 页面单测：渠道卡片字段、卡片导航、无模型 N+1；详情三个区块、获取模型弹窗、已配置模型去重、直接添加、敏感 Header 不回显、mutation 后 query 失效。
- 后端单测：连接测试发送唯一 `hi` 用户消息并携带模型参数；通用 Chat Completions 结构有效即可通过，业务草稿严格解析保持原测试覆盖。
- 路由预取单测：配置子路由映射到正确 loader，父入口只预取默认页。
- E2E：管理员从侧栏进入 AI 配置、打开渠道详情并看到 Header/模型；普通用户仍看不到配置中心。
- 响应式与无障碍：使用功能 E2E 和人工检查覆盖 AI 配置列表及渠道详情的 375/1440、浅色/深色，不生成截图快照。

## 回滚

- 未提交阶段只反向应用本任务精确 hunks，不使用 reset、checkout 或 clean。
- 路由出现问题时可先保留 `/configuration` 重定向并回退子菜单；不得恢复详情 Modal 作为长期双实现。
- 任何需要 OpenAPI 或后端聚合字段的展示项直接删减，不增加前端猜测字段或 N+1 请求。
