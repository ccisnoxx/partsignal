# 配置中心平台管理高保真复刻技术设计

> 产品语义和统计口径已收敛，实施与验证已完成；提交时与后续审计任务重叠的审计写入以 `audit-log-fidelity` 的较新契约为准。

## 1. 设计判断

现有 `/configuration/platforms` 已经是具体平台的唯一管理页面，现有 `PlatformProfile`、规则版本、平台 Prompt、平台账号和内容任务也分别拥有权威数据。本任务不重建平台领域，而是在原页面和原模型上补齐独立启停状态、服务端管理查询、详情聚合、真实导出与关联筛选，并按批准原型重排现有界面。

五张卡片只读取同次请求中的实时 PostgreSQL 计数，趋势行由前端显示批准文案“暂无历史基线”。不增加快照表、统计缓存、定时任务、客户端完整性算法或历史回填。原型中的通知、帮助和应用切换图标没有项目契约或真实功能，本任务保留现有可用的全局搜索、主题和用户区域，不添加空按钮；该差异进入 fidelity ledger。

## 2. 权威所有权与不变量

| 概念 | 权威所有者 | 本任务处理 |
| --- | --- | --- |
| 平台身份、类型、官网、允许域名、Logo、修订号 | `platform_profiles` | 复用现有记录和写命令，统一输入规范化 |
| 平台启停 | `platform_profiles.is_active` | 新增独立布尔状态；既有记录迁移为 `true` |
| 当前规则 | 每个平台唯一 `ACTIVE platform_profile_version` | 不增加 `current_rule_id` 或前端选择逻辑 |
| 当前 Prompt | 每个平台零或一条 `platform_prompts` | 不增加类型级或默认 Prompt |
| 配置完整 | 服务端表达式：存在 ACTIVE 规则且存在当前 Prompt | 列表、统计、筛选、详情共用同一表达式 |
| 发布账号摘要 | `platform_accounts` | 实时聚合总数、启用数和停用数，不复制计数 |
| 引用摘要 | `content_tasks` 经规则版本关联平台 | 每个任务计一次；按统一 `as_of` 计算 30 天和历史数量 |
| 平台更新时间 | `audit_logs` 中平台创建、编辑、启用、停用事件 | 取最新真实事件；无证据返回 `null` |
| 规则最后更新时间 | 当前规则版本的激活审计事件 | 无真实激活审计时返回 `null`，不以迁移时间代替 |
| Prompt 最后更新时间 | `platform_prompts.updated_at` | 直接读取当前行 |
| 集合筛选、分页、详情选择 | React Router URL | 不放入全局 Store，不维护第二份筛选状态 |
| 权限与写入保护 | FastAPI 依赖、服务命令、CSRF、revision、审计 | 前端可见性仅作体验优化，不是安全边界 |

平台启用与配置完整互相独立。停用不改变既有账号、规则、Prompt、内容任务、发布记录、GEO 观测或审计记录，也不阻止管理员继续查看、编辑平台身份、维护规则与 Prompt 或重新启用平台。

## 3. 数据库与迁移

新增下一条 Alembic 迁移，为 `platform_profiles` 增加：

- `is_active BOOLEAN NOT NULL`；迁移阶段把全部既有平台明确回填为 `true`，运行时新建命令也显式写入 `true`，不依赖模糊默认。
- `ix_content_tasks_platform_profile_version_created_at`，列顺序为 `platform_profile_version_id, created_at`，服务平台引用总数和半开时间窗聚合。
- `ix_platform_accounts_platform_profile_active`，列顺序为 `platform_profile_id, is_active`，服务账号摘要。
- `ix_audit_logs_target_created_at`，列顺序为 `target_type, target_id, created_at DESC`，服务平台和当前规则的真实最近事件投影。

不增加平台统计表、配置完整字段、账号计数字段、引用计数字段、`current_rule_id`、软删除时间或平台更新时间字段。更新时间继续由追加式审计事实派生，无法追溯的既有记录保持 `null`。

迁移不修改历史规则、Prompt、账号、任务、发布和 GEO 数据。降级只移除新增索引和 `is_active`；执行降级会丢失平台启停状态，因此迁移 Docstring 和测试必须明确这一限制，不伪装成无损降级。

## 4. 输入规范化与状态命令

### 4.1 平台字段

`PlatformProfileCreate` 和 `PlatformProfileUpdate` 共用同一组 Schema 边界校验：

- 平台名称首尾去空白后必须非空，最大长度沿数据库 160 字符约束。
- `slug` 继续只在创建时写入并依赖现有唯一约束；编辑不改变稳定标识，不新增名称唯一规则。
- 官网继续使用 `HttpUrl`，服务端只持久化 Pydantic 规范化后的 HTTP/HTTPS URL；空值保持 `null`。
- 允许域名转换为小写 IDNA ASCII、去除唯一末尾点，拒绝 scheme、路径、查询、端口、通配符、空标签和非法 DNS 标签；在规范化后检查当前平台列表内重复。
- 不推断官网域名，不跨平台声明域名全局唯一，也不改变 Logo 的上传/外链单一来源约束。

创建和更新必须消费已经规范化的同一 Schema 值，修复当前“创建规范化、更新原样写入”的分叉。数据库唯一约束冲突继续转换为现有结构化业务错误，不增加候选字段或静默改名。

### 4.2 启用与停用

新增管理员命令：

- `POST /api/v1/platform-profiles/{platform_profile_id}/enable`
- `POST /api/v1/platform-profiles/{platform_profile_id}/disable`

请求复用 `RevisionRequest { expected_revision }`。服务先以 `FOR UPDATE` 锁定平台并校验 revision，再更新 `is_active`、递增 revision、追加 `platform_profile.enabled` 或 `platform_profile.disabled` 审计并在同一事务提交。命令不检查配置完整性，不联动账号或配置；重复设置同一状态仍作为显式命令递增 revision，与既有 AI 渠道状态命令语义一致。

以下所有新建路径在服务端最终写入前以 `FOR UPDATE` 锁定同一平台行、读取状态，并以稳定错误码 `PLATFORM_DISABLED` 和 409 拒绝：

- 普通 `ContentTask` 创建；
- 发布异常的修复 `ContentTask` 创建；
- `PlatformAccount` 创建；
- 所有 `PublicationRecord` 创建。当前代码只有人工发布服务这一处构造入口；未来新增入口也必须复用同一门禁，不能绕过。

对应选择器和发布候选投影排除停用平台，减少无效提交；服务端校验仍保留。既有任务可继续生成、审核，既有账号状态不变，既有发布/观测历史不受影响。

## 5. API 契约

### 5.1 平台集合

继续使用现有 `GET /api/v1/platform-profiles`，不创建第二个管理集合接口。新增可选参数：

- `q`：最多 200 字符，匹配平台名称或平台类型名称；
- `platform_type_id`；
- `status=ENABLED|DISABLED`；
- `configuration_status=COMPLETE|INCOMPLETE`；
- `page` 与 `page_size=10|20|50`。

兼容模式被写入 OpenAPI，而不是运行时猜测：

- `page` 和 `page_size` 同时省略时，返回完整的参考集合，供现有平台/规则/Prompt/任务表单使用；
- 两者同时提供时，按服务端分页返回管理集合；只提供一个参数时返回明确的 422 查询错误；
- 两种模式都按 `lower(name), id` 稳定排序，并返回统一响应结构。

`PlatformProfileList` 增加 `page`、`page_size`、`total` 和 `summary`。无分页模式返回 `page=1`、`page_size=total`（空集合为 0）；分页模式返回请求值。`total` 是应用搜索和筛选后的总数，`summary` 始终统计当前用户可见的全部平台，不受搜索、筛选和分页影响。

`summary` 字段为：

- `platform_total`：全部平台数；
- `enabled_total`：`is_active=true`；
- `missing_prompt_total`：无当前 Prompt；
- `missing_active_rule_total`：无 ACTIVE 规则；
- `configuration_complete_total`：同时有 ACTIVE 规则和当前 Prompt。

缺 Prompt 与缺规则可以重叠，五个值均为请求时实时计数。列表项在现有 `PlatformProfile` 字段上增加平台类型摘要、`is_active`、`configuration_complete`、账号总数和可空 `updated_at`。列表聚合使用 CTE/分组子查询批量完成，不对每行读取规则、Prompt、账号或审计。

### 5.2 详情

新增管理员只读 `GET /api/v1/platform-profiles/{platform_profile_id}`，返回：

- 列表身份与状态字段；
- 当前规则版本、状态及可空激活时间；
- Prompt 是否配置及可空更新时间；
- 账号总数、启用数、停用数；
- `references.as_of`、`recent_30_days`、`all_time`。

详情服务先生成一个 UTC `as_of` 并在同一数据库事务中用于两个引用聚合：

- `all_time = count(distinct ContentTask.id)`，关联该平台任一规则版本；
- `recent_30_days` 在同一集合上增加 `created_at >= as_of - interval '30 days' AND created_at < as_of`。

虽然一个任务当前只持有一个规则版本，SQL 仍按任务 ID 去重，以把“每个任务只计一次”写入可执行契约。

### 5.3 导出与关联过滤

新增管理员只读 `GET /api/v1/platform-profiles/export`。它接受与集合相同的 `q/platform_type_id/status/configuration_status`，忽略分页，复用相同过滤表达式和稳定排序。响应为带 UTF-8 BOM 的 CSV，使用 Python 标准库 `csv`，文件只含表格事实列，不包含签名 Logo URL 或详情引用计数；文件名包含服务端生成时间。无新依赖、无前端全量拼装。

静态 `/platform-profiles/export` 必须在动态 `/platform-profiles/{platform_profile_id}` 前注册，或给动态段使用 UUID 路径转换器，避免框架把 `export` 当作平台 ID。该路由顺序写入路由测试。

为真实关联入口增加最小查询能力：

- `GET /api/v1/content-tasks?platform_profile_id=...`：经规则版本关联过滤内容任务；
- `GET /api/v1/platform-accounts?platform_profile_id=...`：过滤账号列表；
- 平台规则页复用既有 `/platform-profiles/{id}/versions`，由 URL `platform_profile_id` 定位；
- 平台 Prompt 页读取 URL `platform_profile_id` 并选择既有具体平台 Prompt。

账号和内容任务接口省略参数时保持当前全量响应，不改变现有调用语义。

## 6. 删除、权限与错误

平台物理删除严格沿用现有直接引用契约：持有任何规则版本或平台账号时拒绝，服务在锁内返回结构化引用数量；规则版本和账号下游的 `RESTRICT` 继续保护 ContentTask、PublicationRecord 与历史。不把删除静默转换为停用，也不因原型提示而增加另一套级联或历史重写。

平台管理路由继续由前端管理员守卫保护；新增详情、导出、启停使用 `AdminUser`，启停同时要求 CSRF。现有 `/platform-profiles` 读取保留 `CurrentUser`，避免破坏工程师创建任务等既有引用选择器；平台账号创建继续使用现有 `ContentEditor`，删除继续使用 `AdminUser`，本任务只增加停用平台门禁而不改变角色边界。所有获权用户当前看到同一平台集合，因此 `summary` 的“权限范围”就是该现有集合。公共契约明确 `401/403/404/409/422`，前端显示服务端结构化错误。

新增和编辑继续使用现有管理员、CSRF、revision 与审计。审计详情只写非敏感状态和 revision，不记录 Prompt、域名以外的凭据或签名 URL。

## 7. 前端状态、结构与关联入口

### 7.1 URL 状态

`PlatformsPage` 使用以下查询参数作为唯一可恢复状态：

- `q`、`platform_type_id`、`status`、`configuration_status`；
- `page`，默认 1；`page_size`，默认 20；
- `platform`，当前详情平台 ID。

筛选变化和重置删除 `page`，但保留无关 URL 参数；非法枚举、页码和每页数量用 `replace` 清理。详情 URL 指向不存在或无权查看的平台时显示明确局部错误并允许关闭，不回退选择第一行。

### 7.2 页面组件

保留 `PlatformsPage.tsx` 作为页面编排和现有表单入口；只有当职责确实独立时拆出：

- `PlatformDetailPanel.tsx`：详情查询、分区、关联链接和固定操作区；
- `PlatformFormModal.tsx`：复用当前新增/编辑字段、Logo 和错误展示。

不抽取通用工作台框架、不增加 Provider 或全局 Store。React Query 管理集合/详情服务端状态，query key 包含完整查询对象；写成功后精确失效集合、详情及受影响的任务/账号候选查询。

桌面详情为页面右侧内联面板，关闭后列表恢复全部空间；小于既有配置中心桌面阈值时改为 Ant Drawer。指针点击非交互表格单元或查看按钮可打开详情；表格行本身不加入 `tabIndex`，键盘用户使用有可访问名称的查看按钮，行内链接/按钮点击不触发行选择。

### 7.3 真实入口

- 规则：`/configuration/platform-rules?platform_profile_id=<id>`；
- Prompt：`/configuration/prompts?platform_profile_id=<id>`；
- 账号：`/settings?tab=accounts&platform_profile_id=<id>`；
- 引用：`/tasks?platform_profile_id=<id>`。

目标页面解析参数并显示可移除的当前平台条件。内容任务和账号把参数发送服务端；规则页使用已有平台版本接口，Prompt 页使用已有具体平台 Prompt 接口。不存在占位页面、空弹窗或只改标题的伪过滤。

## 8. 高保真视觉实现

批准原型和量化清单分别见 `artifacts/platform-management-prototype-1581x995.png` 与 `research/visual-spec.md`。实现使用现有 Ant Design、Ant 图标、`PlatformAvatar` 和全局语义 Token。

在不影响其他配置页面的前提下，AppLayout 增加平台管理路由修饰类，将该页桌面侧栏调到约 190px，并对应校正顶栏三列，使全局搜索在 1581×995 视口对齐原型。页面主体采用“列表主区 + 约 315px 详情区”，统计卡约 120px 高、14px 间距，筛选条约 69px，表头约 40px、数据行约 49–50px；详情从标题区下方开始，正文独立滚动，操作区固定。

五张卡片使用 Ant 线性图标和现有成功/警告/危险/主色变量；卡片数值来自 `summary`，趋势统一为“暂无历史基线”。表格平台图标只使用现有上传/外链 Logo 和 `PlatformAvatar` 的项目回退，不增加 Emoji 或远程品牌资产。加载采用 Skeleton/Table loading，空、错误、无权限使用现有 `AsyncState`，所有控件保留可见焦点。

首屏严格保留原型规定的标题、说明、筛选、表头、详情分组及操作顺序。由于项目没有通知、帮助、应用切换契约，顶栏只显示现有真实全局控件；由于现有删除契约比原型提示更严格，删除提示使用真实“规则版本或平台账号引用”原因。这两点记录为有依据的保留差异。

## 9. 响应式与可访问性

- 1581×995 为高保真主视口，内容区不产生页面级横向滚动；表格宽度不足时只在 `TableRegion` 内滚动。
- 1199px 以下复用现有配置中心降级：主区单列，详情使用 Drawer；375/768/1024/1440 及 200% 缩放均可完成核心操作。
- 页面标题、统计区、搜索区、表格和详情用语义区域；表单字段有可见 label；图标按钮有 `aria-label`。
- 状态标签不只依赖颜色；禁用、加载、空数据和错误均有文本；危险操作使用确认流程并把服务端错误留在当前上下文。
- 详情打开后把焦点移到标题，关闭后归还触发按钮；Drawer 使用 Ant 的焦点圈定和 Escape 关闭行为。

## 10. 性能、并发与回滚

集合的分页行、筛选总数和五项 summary 在同一请求中读取；详情只在选中平台时请求。聚合采用批量 CTE/分组和新增索引，禁止循环查询每个平台。搜索先使用普通 `ILIKE`；平台配置量当前没有证据需要 pg_trgm 或新扩展，只有获得慢查询证据后再增加。

启停、编辑和删除保持固定“先锁平台，再检查 revision/引用，再写审计”的顺序。普通任务、修复任务、账号和发布记录创建也必须先锁同一平台行，再检查 `is_active` 并完成写入；两事务并发测试验证停用与新建串行，避免检查后写入穿透。所有路径维持平台行在前的统一锁顺序。列表和导出共享一个纯查询构造函数，防止筛选漂移。

代码回滚可移除页面、接口和服务改动；数据库降级会移除 `is_active`，因此不得宣称保留停用事实。若上线后必须回滚应用，旧应用会忽略新增列，但数据库降级应在业务确认可丢失启停状态后单独执行。

## 11. 主要取舍

- 扩展现有平台集合而不创建管理专用集合；通过“分页参数成对出现”保持现有引用选择器的全量语义。
- 实时聚合而不保存 summary/detail 计数，符合用户批准的无快照方案。
- 用审计事实投影更新时间，宁可显示空值，也不把迁移时间伪装成业务更新时间。
- CSV 使用标准库而不是引入 Excel 依赖；导出忠实反映当前过滤集合。
- 平台状态命令与配置完整性完全分离；启用不替代规则或 Prompt 校验。
- 保留既有删除约束，不为贴合原型文案增加级联、软删除或静默停用。
