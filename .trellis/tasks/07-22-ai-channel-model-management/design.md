# AI 渠道与模型管理页面技术设计

> 产品规则已收敛；开始实施前需完成规划校验并由用户评审确认。

## 1. 设计判断

问题不是缺少一套 AI 配置系统，而是现有真实能力分散在集合页和独立详情页，且当前契约不足以表达原型中的渠道元数据、服务端集合查询、统计与渠道级操作历史。目标态方案应在同一个 AI 配置领域内重组页面和契约，直接替换过时的集合/详情边界，并使每个新增字段和查询都有明确所有者。

开发阶段允许调整 OpenAPI、数据库与服务端查询，但仍不新增第二套配置源、统计状态表、日志表、前端 Store 或双详情实现。协议类型与供应商品牌是两个独立概念；品牌使用受控目录，供应商调用采用 `AT_MOST_ONCE` 并只允许显式新作业重试，正式业务作业统计从 `generation_jobs` 按时间窗实时聚合。全局搜索复用同一权限感知导航元数据，只做页面与功能跳转，不虚构跨域业务搜索。

## 2. 权威所有权与不变量

| 概念 | 权威所有者 | 本任务处理 |
| --- | --- | --- |
| 渠道身份、凭据、超时、启停 | `ai_channels` / `AIChannel` | 增加描述、协议类型和供应商品牌 |
| Header | `ai_channel_headers` / `AIChannelHeader` | 复用普通/敏感二选一存储和现有 CRUD |
| 模型、参数、测试、启停 | `ai_models` / `AIModel` | 复用现有 CRUD、测试和门禁 |
| 协议类型 | `AIChannel.protocol_type` | 决定真实适配器；首个实现为 OpenAI-compatible Chat Completions |
| 供应商品牌 | `AIChannel.provider_brand` | 受控目录；只用于管理端身份、筛选和图标，不决定请求构造 |
| 重试 | `generation_jobs.retry_of_id` 的显式新作业 | `AT_MOST_ONCE`；页面显示“仅手动重试” |
| 使用统计 | `generation_jobs` | 按时间窗只读聚合正式业务作业，不保存汇总 |
| 操作日志 | `audit_logs` | 新增渠道关联读取投影，不复制日志 |
| 权限 | `users.account_type` | 继续只由服务端 `AdminUser` 判定 |
| 集合视图 | React Router URL 查询参数 | 不放入全局 Store或重复本地状态 |
| 选中渠道 | `/configuration/ai/channels/:channelId` | 不再维护第二个 selected ID |
| 全局导航搜索 | 权限过滤后的导航注册表 | AppLayout 菜单与搜索结果共用，不新增业务搜索索引 |

敏感值、测试状态、渠道启停、模型启停和生成可用性仍由服务端拥有。前端只显示服务端投影和发出明确命令。

## 3. 契约与数据库

### 3.1 渠道身份与描述

`ai_channels` 增加非空 `description TEXT`、`protocol_type VARCHAR(64)` 和 `provider_brand VARCHAR(32)`。迁移把既有渠道的协议回填为当前唯一真实实现 `openai-compatible-chat-completions`，无法可靠识别供应商品牌的既有渠道回填为 `CUSTOM`；不根据名称或 URL 猜测品牌。完成后设置非空和数据库 `CHECK`，运行时不设置数据库默认，所有新写入必须经过请求 Schema。

OpenAPI、Pydantic 和前端生成类型同步增加：

- `AIChannelCreate.description: string`，最大 500 字符，允许空字符串。
- `AIChannelUpdate.description: string`，最大 500 字符，允许空字符串。
- `AIChannel.description: string`。
- `AIProtocolType: openai-compatible-chat-completions`，直接复用现有生成快照的 `adapter_name` 标识。
- `AIProviderBrand: OPENAI | ANTHROPIC | GOOGLE | AZURE_OPENAI | ZHIPU | QWEN | CUSTOM`。
- 创建、更新和读取渠道均要求 `protocol_type` 与 `provider_brand`。

服务端维护唯一的品牌—协议组合目录；当前每个品牌只登记 `openai-compatible-chat-completions`，登记仅表示管理员为该渠道提供兼容端点，不代表项目已实现供应商原生 API。未知枚举值或未注册组合以明确的参数错误拒绝；官方原生端点若不兼容，连接测试必须真实失败。品牌不选择客户端、不改写 Base URL，协议类型才选择真实调用适配器。`CUSTOM` 使用通用图标，具体身份由渠道名称和描述表达，不增加第二个自由文本品牌字段。

名称、描述或品牌变更只更新管理元数据；Base URL、协议类型、API Key、请求 Header 变更继续停用渠道并使所有模型测试失效。品牌不参与请求构造，因此单独修改品牌不得伪造连接失效。

### 3.2 渠道最近测试投影

`AIChannel` 响应增加：

- `latest_test_status: UNTESTED | PASSED | FAILED`
- `last_tested_at: date-time | null`

投影规则：在该渠道 `last_tested_at` 非空的模型中按 `last_tested_at DESC, id DESC` 取最新一条；没有已测试模型时返回 `UNTESTED/null`。不增加渠道级测试状态列，避免模型状态和渠道状态双写。

### 3.3 使用统计投影

新增管理员只读接口：

`GET /api/v1/ai-channels/{channel_id}/usage-summary?period=7d|30d|90d|all`

`period` 默认 `30d`；时间窗以作业 `created_at` 和服务端当前时间计算，`all` 不设置起点。连接测试和模型发现不写入 `generation_jobs`，因此不计入本统计。

响应为所选时间窗投影：

- `channel_id`
- `period`
- `period_started_at: date-time | null`
- `period_ended_at: date-time`
- `total_jobs`
- `succeeded_jobs`
- `failed_jobs`
- `success_rate: number | null`
- `average_response_duration_ms: number | null`
- `prompt_tokens: integer | null`
- `completion_tokens: integer | null`
- `total_tokens: integer | null`
- `last_used_at: date-time | null`

`total_jobs` 包含时间窗内的所有正式业务生成和自然化作业；成功/失败只按终态计数，待执行和执行中的作业不会被伪装成失败。无终态作业时 `success_rate` 为 `null`。平均响应时间只聚合已有真实耗时的作业；Token 只累加供应商实际报告的非空用量，没有任何可确认数据时为 `null`，不得估算或补零，前端标签使用“已报告 Token”避免把部分供应商未报告的数据解释为完整成本。`last_used_at` 为时间窗内最近一次作业开始时间，无记录时为 `null`。

具体查询口径为：以 `generation_jobs.ai_channel_id = channel_id` 和 `created_at` 时间窗筛选；`job_type` 的数据库约束只允许 `GENERATE/HUMANIZE`，两者全部计入；`last_used_at = max(started_at)`；平均耗时和 Token 分别只聚合对应非空列。无作业时三个计数为 `0`，成功率、平均耗时、Token 和最近使用时间为 `null`。数据库增加 `(ai_channel_id, created_at)` 索引支撑按渠道时间窗查询。

统计不扫描 JSON 快照、不恢复已删除渠道的归属，也不增加汇总表或缓存。连接测试和模型发现继续分别由模型测试投影与审计事件表达。

### 3.4 渠道操作日志投影

新增管理员只读接口：

`GET /api/v1/ai-channels/{channel_id}/audit-logs?page=&page_size=`

返回既有 `AuditLogList`。查询覆盖：

- `target_type=AIChannel` 且 `target_id=channel_id` 的渠道、凭据和 Header 事件。
- `target_type=AIModel` 且当前模型 ID 属于该渠道的历史事件。
- 审计详情中安全字段 `channel_id` 等于该渠道的模型事件，用于覆盖模型删除后的新事件。

模型 CRUD、启停和测试审计详情增加非敏感 `channel_id`；不改变其 `target_type/target_id`，全局审计仍能按模型定位。当前仍存在的模型可通过关系覆盖旧事件；任务实施前已经删除且审计详情没有 `channel_id` 的模型事件无法可靠恢复归属，渠道面板明确不展示且不猜测，原始全局审计记录继续保留。

### 3.5 连接测试与模型发现审计

- `test_ai_model` 接收管理员与 `request_id`，测试完成后在同一状态回写事务追加 `ai_model.tested`，详情只含 `channel_id` 和 `test_status`；修订冲突时不覆盖模型状态，并以安全 `error_code=REVISION_CONFLICT` 记录被丢弃的测试结果。
- 模型发现增加服务函数，成功记录 `ai_channel.models_discovered` 和 `model_count`；失败记录同一动作及安全 `error_code` 后提交，再原样抛出业务错误。
- 审计不保存 API Key、Header 值、完整 URL 响应、供应商正文或错误响应体。

### 3.6 渠道集合契约

现有集合接口改为服务端查询：

`GET /api/v1/ai-channels?q=&status=&provider_brand=&sort=&page=&page_size=`

- `q`：可选，去除首尾空白后按名称、描述或 Base URL 不区分大小写匹配，最大 200 字符。
- `status`：可选 `ENABLED | DISABLED`；缺省表示全部。
- `provider_brand`：可选受控品牌枚举；缺省表示全部。
- `sort`：`CREATED_DESC | NAME_ASC | NAME_DESC | UPDATED_DESC | LAST_TESTED_DESC`，默认 `CREATED_DESC`；所有排序以 `id ASC` 作稳定次序。
- `page`：从 1 开始，默认 1。
- `page_size`：`10 | 20 | 50`，默认 20。

`AIChannelList` 返回 `items`、`page`、`page_size`、`total` 和 `counts`。`counts.all/enabled/disabled` 应用 `q` 与 `provider_brand`，但不应用 `status`，使状态分类切换后数量仍可解释。列表项从当前完整 `AIChannel` 响应明确替换为表格专用 `AIChannelSummary`：渠道身份、Base URL、状态、API Key 配置状态、Header 数、启用模型数、最近测试和修订号；Header 值与模型数组只由选中渠道的 `GET /ai-channels/{channel_id}` 与模型接口读取。创建、更新、启停和详情继续返回完整 `AIChannel`，不保留旧集合载荷兼容分支。

查询使用同一 SQLAlchemy 查询构造和聚合投影，不加载每个渠道的完整子集合，不产生 N+1，也不增加搜索索引或缓存。名称、描述和 Base URL 使用参数化表达式；通配符作为普通搜索字符处理。

## 4. 后端数据流

### 4.1 协议选择与生成快照

`AIChannel.protocol_type` 替换创建作业、模型发现和模型测试路径中的硬编码第三方适配器选择。当前只实现 `openai-compatible-chat-completions`，因此服务层用穷尽分支直接调用 `OpenAICompatibleClient`；未知值返回明确能力错误，不引入只有一个实现的工厂或回退。

正式第三方生成与自然化把渠道的 `protocol_type` 原值复制到不可变快照及 `generation_jobs.adapter_name`；现有历史值与新枚举值完全相同，无需重写历史作业。显式重试继续复制原快照和适配器。Worker 在发送前校验当前渠道协议与快照适配器一致，不一致则明确失败；开发环境显式 `deterministic` 生成器仍保持独立测试语义，不能被品牌或协议字段伪装成外部调用成功。

### 4.2 渠道列表

`GET /ai-channels` 按 3.6 的集合契约在数据库完成搜索、筛选、稳定排序、计数和分页。Header 数量、启用模型数量及最近测试由聚合子查询一次投影；响应不携带 Header 值或模型数组。选中渠道才通过既有详情和模型接口读取完整配置。

### 4.3 连接测试

渠道级“测试连接”没有无模型协议：

1. 前端要求管理员明确选择当前渠道的一个已配置模型。
2. 前端调用既有 `POST /ai-models/{model_id}/test`。
3. 服务端解密当前渠道凭据和 Header，使用模型 ID 与参数发送唯一 `hi` 消息。
4. 成功或失败写回该模型测试状态并停用模型，再追加脱敏审计；选择弹窗在发送前明确提示“测试后模型将停用，通过后需手动重新启用”。
5. 页面失效渠道、模型、统计和日志 query。

不得自动挑选第一个、最近或已启用模型，避免把产品猜测编码为连接语义。

### 4.4 重试、删除与停用

- `PinnedHTTPTransport` 只允许在尚未发送 HTTP 字节时尝试同次 DNS 解析中的其他已批准地址。
- 任何请求开始发送后都不自动重试，避免供应商已接收但响应丢失时产生重复生成。
- 显式重试创建新的 `GenerationJob` 并通过 `retry_of_id` 关联原作业；页面显示“仅手动重试”，不提供次数输入。

沿用当前权威契约：

- 停用渠道阻止后续 Worker 使用该配置；已经完成配置读取并开始供应商调用的 Worker 不执行强制中断。
- 删除渠道级联当前 Header/模型，历史 Job 外键置空且快照保留；尚未执行的 Job 因配置缺失明确失败。
- UI 确认文案必须说明这些影响，不增加和数据库契约冲突的引用阻断或静默延迟删除。

## 5. 前端路由与状态

### 5.1 路由结构

使用 React Router 嵌套路由复用同一工作区：

```text
/configuration/ai                         → AIChannelsPage（无选中时选择首个可见渠道）
/configuration/ai/channels/:channelId     → AIChannelsPage + 右侧 AIChannelDetailPage Outlet
```

`AIChannelsPage` 始终拥有分类栏、工具栏和表格；`AIChannelDetailPage` 改为右侧详情面板，不再重复页面页头和集合逻辑。稳定详情 URL 保留，浏览器刷新和前进/后退可恢复选中渠道。

### 5.2 URL 查询参数

- `q`：名称、描述或 API 根地址搜索。
- `status`：`all | enabled | disabled`。
- `provider_brand`：`all | OPENAI | ANTHROPIC | GOOGLE | AZURE_OPENAI | ZHIPU | QWEN | CUSTOM`。
- `sort`：`default | name_asc | name_desc | updated_desc | tested_desc`。
- `page`：正整数，默认 1。
- `page_size`：`10 | 20 | 50`，默认 20。
- `tab`：`basic | request | models | usage | logs`，默认 `basic`。

筛选或搜索变化将 `page` 重置为 1。无效参数使用 `replace` 归一化，不维护 Ant Table 内部第二份页码或 Tabs 状态。

URL 参数由前端转换为服务端明确枚举；列表结果、总数和状态分类数量只消费服务端响应，不在浏览器重复过滤或排序。用户主动改变筛选条件时清除旧选择并选择新结果首项；直接访问稳定详情 URL 时即使该渠道不在当前页，右侧仍以详情接口显示，不伪造选中行。

### 5.3 三栏工作区

桌面主视口采用：

```text
状态分类 188px | 渠道集合 minmax(0, 1fr) | 详情面板 366px
```

- 左栏：标题、总数、全部/启用/停用及各自数量。
- 中栏：搜索、状态、供应商品牌、排序、紧凑表格和分页。
- 右栏：渠道头部、Tabs、基本信息/请求配置/模型管理/使用统计/操作日志、快捷操作。
- 窄桌面降为“分类横向 + 表格 + 详情整行”；移动端列表与详情按稳定路由顺序展示，不产生页面级横向滚动。

选中态由 `channelId` 和 Table `rowClassName` 派生；行本身不添加 `tabIndex`，名称链接和操作按钮承担键盘入口。

### 5.4 详情能力复用

- 基本信息：名称、描述、协议类型、供应商品牌、根地址、状态、API Key 状态、Header 数、超时、仅手动重试、创建/更新、创建人。
- 请求配置：API Key 重新配置和 Header CRUD，复用现有表单及服务端校验。详情只依据 `api_key_configured` 渲染固定 `••••••` 配置提示，不接收或展示真实长度、前后缀。
- 模型管理：复用模型发现、手工添加、编辑、测试、启停和删除。
- 使用统计：默认读取最近 30 天投影，可切换 7/30/90 天和全部时间；无作业时显示真实零计数，可空指标显示“暂无数据”。
- 操作日志：读取渠道审计投影，显示时间、动作、操作者、对象和请求 ID。
- 快捷操作：测试连接、启停、复制配置、删除。

创建人和审计操作者通过已验证的管理员 `GET /api/v1/users` 与既有用户列表 Query 映射显示名；映射失败时显示稳定用户 ID，不伪造姓名。

### 5.5 复制配置白名单

复制 JSON 只包含：

- `name`、`description`、`protocol_type`、`provider_brand`、`base_url`、`timeout_seconds`。
- 普通 Header 的名称和值。
- 敏感 Header 的名称、`is_sensitive=true` 和 `is_configured`，不含值。
- 模型的显示名、`model_id` 和请求参数。

不得包含 API Key、密文、Authorization、敏感 Header 值、测试错误或审计详情。对象只在点击时临时构造并写入剪贴板，不进入 localStorage、URL 或日志。

## 6. 导航与顶栏

配置中心子导航按原型改为：

```text
内容平台       → /configuration/platforms
平台规则       → /configuration/platform-rules
平台 Prompt    → /configuration/prompts
AI 渠道与模型  → /configuration/ai
用户与权限     → /users
审计日志       → /audit
```

仅移动入口，不复制页面、权限或 API。`/configuration/platform-types` 保留稳定直达路由，“内容平台”页面提供“管理平台类型”入口，全局导航搜索也可跳转该获权页面；用户与审计仍使用原有 URL 和页面守卫。

`AppLayout` 顶栏提供“配置中心 / AI 渠道与模型”面包屑、用户区和主题控制；AI 工作区使用自身 72px 紧凑页面头承载标题、测试连接与新增渠道操作。AppLayout 的菜单元数据是权限感知的单一来源，菜单渲染和全局导航搜索共同消费：

- 顶栏显示“搜索页面或功能…”入口，点击或按 `⌘/Ctrl + K` 打开可访问名称完整的搜索浮层。
- 只匹配当前用户有权访问的页面名称、导航名称和静态功能关键词；结果选择后使用 React Router 跳转。
- 搜索词只存在于浮层生命周期，不写 URL、localStorage、日志或服务端。
- 管理员专属配置、用户和审计入口不向普通用户出现在结果中；路由与服务端权限仍是最终安全边界。
- 渠道名称、描述和 Base URL 由页面内集合搜索处理；本任务不增加跨内容、任务、平台或数据的聚合 API、索引或伪结果。

## 7. 视觉设计

- 只消费 `ThemeProvider` 注入的语义变量和 Ant Design Token。
- 配置页使用现有玻璃表面、细边框和阴影，新增样式集中在 `global.css` 配置中心段。
- 原型 PNG 的原始 1570×1001 为主验收视口；行高、页头、工具栏、Tabs、状态点、选中行和悬浮反馈按同尺寸截图调整。
- 图标只来自受控品牌目录的本地展示映射；`CUSTOM` 使用通用图标。图标不从渠道 URL 远程加载，也不允许管理员提交任意图片地址。
- 保持浅色、深色和系统主题；键盘焦点、Modal 焦点恢复、危险操作确认和可访问名称继续由 Ant 组件承担。

## 8. 安全与错误

- 新接口全部使用 `AdminUser`，写操作继续使用 `CsrfProtected`。
- OpenAPI 为新增读取接口声明会话鉴权及 `401/403` 响应，为写接口继续声明 CSRF Header 及 `401/403`；管理员角色的最终判定由 FastAPI `AdminUser` 依赖执行。
- URL 和 Header 仍只在服务端统一安全边界校验；前端 URL 校验仅提供即时反馈，不替代服务端。
- API Key 字段只存在于创建/替换表单生命周期，Modal 销毁后清空。
- 测试错误继续使用固定业务错误，不记录响应正文；审计只记录状态、数量和错误码。
- 次级统计或日志查询失败只在所属 Tab 显示重试，不隐藏渠道身份、其他 Tab 或快捷操作。

## 9. 兼容、迁移与回滚

- 公共写契约增加必填 `description`、`protocol_type` 和 `provider_brand`，同步更新所有前端、seed、测试和 E2E 调用方，不增加旧载荷兼容默认。
- 数据库新增三个可回填列、受控值约束及 `generation_jobs(ai_channel_id, created_at)` 统计索引；统计和日志无新状态表。
- 当前工作区的 GEO 契约、路由、query key、生成类型、样式和 E2E 改动属于其他任务，修改重叠文件时只追加本任务精确 hunks。
- 回滚按“前端工作区 → 新读取投影与审计 → 渠道身份字段契约/迁移”的逆序应用精确 diff；不使用 reset、checkout 或 broad clean。
- 迁移测试只在测试创建的隔离 PostgreSQL 数据库验证 `previous head → new head → previous head`；不得对用户开发数据库执行降级。真实数据库降级会丢失已填写描述、协议和品牌，执行前必须导出三列且另行取得授权。

## 10. 主要取舍

- 服务端集合投影优于下载完整配置后客户端分页：搜索、筛选、排序、分页、分类数量和字段脱敏由同一契约负责，列表不再携带 Header 值或模型数组。
- 最近测试使用派生投影优于渠道列：测试事实属于模型，渠道只展示最近事件，不形成第二状态机。
- 固定统计预设优于另建统计状态：`7d|30d|90d|all` 覆盖当前管理场景，直接查询权威作业记录；需要任意日期、成本或趋势时再扩展同一读取契约。
- 受控品牌目录和协议枚举优于自由文本：筛选与图标稳定，新增品牌需显式扩展同一契约；品牌不能绕过协议能力边界。
- 固定的单次调用语义优于重试次数配置：这是现有调用安全契约，不为匹配原型制造无效配置。
- 权限感知导航搜索优于跨域伪搜索：它完整实现当前可验证的跳转语义，并为未来业务搜索保留独立契约边界。
