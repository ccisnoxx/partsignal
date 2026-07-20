# 发布管理人工发布工作台设计

## 1. 设计原则

1. `PublicationRecord.status`、`PublicationStatusEvent`、`PublicationAttention` 和服务端 `available_actions` 是唯一状态来源。
2. 写流程保持现有命令模型；新增能力只解决工作台读取和结果证据关联，不创建平行服务、第二套状态机或兼容字段。
3. 统计在 PostgreSQL 一次聚合，列表通过批量投影读取；前端只负责展示、URL 状态和对完整集合的确定性筛选。
4. 历史事实只追加：发布记录锁定字段、发布事件、附件和已解决关注事项均不可覆盖或删除。
5. 视觉遵循现有 PartSignal 主题与组件，原型只决定层级和节奏。

## 2. 页面信息架构

```text
/publications
├── PageHeader：发布管理 + 当前视图说明
├── 发布流程概览（摘要 API）
│   ├── 待人工发布 PENDING_MANUAL_PUBLISH
│   ├── 平台审核中 PLATFORM_REVIEW
│   ├── 已发布 PUBLISHED
│   ├── 已验证 VERIFIED
│   └── 发布需关注 OPEN PublicationAttention
├── 工作视图（URL 驱动）
│   ├── 待发布候选：完整候选集 + 确定性平台/标题筛选
│   ├── 发布记录：服务端状态筛选 + 服务端分页
│   └── 发布需关注：OPEN 完整集 + 确定性 trigger_status 筛选
├── 按需 Drawer
│   ├── 候选：发布包、复制、账号、栏目 URL、证据、创建 PENDING
│   ├── 记录：锁定上下文、事件、附件、available_actions 对应表单
│   └── 关注：触发原因、修复任务、显式解决入口
└── 辅助区
    ├── 发布指引（静态）
    ├── 最近发布动态（状态事件）
    ├── 常见异常（三类确定性入口）
    └── 发布数据概览（默认 7 天，可切换 30 天；数字卡/进度条）
```

Drawer 不是新的路由边界：选择对象和动作写入查询参数，关闭后恢复触发按钮焦点；记录、关注和修复仍保留现有深链路由。没有选中对象时不渲染空 Drawer。

## 3. 现有能力复用关系

| 需求 | 复用对象 | 设计 |
|---|---|---|
| 路由与导航 | `App.tsx`、`PublicationsPage`、`AppLayout` | 保持 `/publications`、记录详情、关注详情、修复页现有 URL；工作台只增强主路由 |
| 页面标题与状态 | `PageHeader`、`StatusTag` | 状态中文名称继续由 `StatusTag` 统一，工作台不得维护另一份状态标签 |
| 数据与错误 | typed `api`、TanStack Query、`AsyncState` | 继续使用生成 OpenAPI 类型、统一 CSRF middleware、`ApiError`/`errorMessage` 和 query invalidation |
| 宽表与键盘 | Ant `Table`、`TableRegion` | 使用可聚焦横向滚动区域；不另建数据表组件 |
| 结果登记 | `PublicationDrawer`、`publicationTypes`、只读 `PublicationDetailPage` | 写操作统一由工作台 Drawer 承载；旧详情路由只保留历史读取和返回工作台入口，动作列表仍由响应 `available_actions` 决定 |
| 内容复制 | `PublicationPackage` | 保留标题、Markdown、纯文本复制，不保存额外 HTML/编辑器正文 |
| 文件 | `DirectUpload`、文件意图/完成/下载接口 | 上传类别使用 `OPERATION_SCREENSHOT`；只有命令成功响应中的附件才显示为已绑定 |
| 平台账号 | 候选 `matching_accounts`、设置页账号管理 | 工作台不请求全量账号后自行匹配；无账号时链接设置页 |
| 异常与修复 | `PublicationAttentionPage`、`PublicationRepairPage` | 工作台增加上下文列表和入口，不复制修复业务表单 |
| 主题 | `ThemeProvider`、`projectThemes`、全局 CSS 变量 | 只新增 `.publications-workbench` 作用域布局，不新增主题源或硬编码色板 |

## 4. 契约设计

### 4.1 `GET /api/v1/publication-workbench-summary`

新增普通已登录用户可读的聚焦响应：

```yaml
PublicationWorkbenchSummary:
  as_of: date-time
  window_start: date-time
  window_days: 7 | 30
  current_status_counts:
    PENDING_MANUAL_PUBLISH: integer
    PLATFORM_REVIEW: integer
    PUBLISHED: integer
    VERIFIED: integer
    REJECTED: integer
    REMOVED: integer
    VERIFICATION_FAILED: integer
  open_attention_count: integer
  period:
    registered_published_count: integer
    verified_count: integer
    verification_rate: number | null
    new_exception_count: integer
    current_unresolved_attention_count: integer
  exception_counts:
    rejected: integer
    removed_open: integer
    verification_failed_open: integer
  recent_activity: PublicationRecentActivity[]
```

`PublicationRecentActivity` 固定最多 5 条，字段为 `publication_id`、`content_title`、`content_version`、`platform_profile_name`、`status`、`occurred_at`。不返回 `actor_id`、自由文本 `comment` 或管理员审计字段。

接口接收 `window_days` 查询参数，枚举仅为 `7 | 30`，默认 `7`；前端周期选择器同步到 URL 和 query key。服务端在同一事务快照内确定 `as_of` 与 `window_start = as_of - window_days`，时间比较使用 UTC、半开区间 `[window_start, as_of)`。不引入自定义日期范围、90 天选项或后台周期配置。

### 4.2 `PublicationRecord` 与 `PublicationRecordListItem`

详情 `PublicationRecord` 增加只读锁定上下文：`content_title`、`content_version`、`platform_profile_id`、`platform_profile_name`、`platform_account_label`、`account_identifier`。这些字段由发布记录关联的内容版本、任务锁定规则版本、平台和账号一次投影，不在前端通过列表页或其他详情拼接。

`PublicationRecordList.items` 使用专用批量投影：

- 识别：`id`、`task_id`、`content_version_id`。
- 内容：`content_title`、`content_version`。
- 平台：`platform_profile_id`、`platform_profile_name`、`platform_account_id`、`platform_account_label`、`account_identifier`。
- 发布：`status`、`actual_title`、`final_url`、`published_at`、`created_at`。
- 验证：`last_verification_at`，取该记录最近的 `VERIFIED` 或 `VERIFICATION_FAILED` 事件时间；没有则为 `null`。页面验证状态仍使用 `status`，不新增枚举。
- 动作：`available_actions`，由服务端转换表生成。

列表查询通过必要联接和聚合一次返回当前页，不加载每条记录的完整事件与附件。完整历史继续由详情接口提供。

### 4.3 `PublicationAttentionListItem`

现有详情 `PublicationAttention` 保持不变；列表专用投影除现有字段外增加 `content_title`、`content_version`、`platform_profile_id`、`platform_profile_name`、`platform_account_label`、`final_url`。后端通过一次联接得到，禁止前端逐行请求发布详情。

本轮不为关注列表增加分页；当前接口返回完整集合，因此可在前端按稳定 `trigger_status` 做确定性筛选。若真实数据量证明需要分页，必须先单独补充分页契约，不能在实现时私自截断。

### 4.4 `PublicationCommand.attachment_file_ids`

在现有命令对象增加可选、唯一的 UUID 数组 `attachment_file_ids`，仅 `command=mark-published` 接受：

- 缺省/空数组：不追加结果证据，保持兼容当前行为。
- 非 `mark-published` 命令携带非空数组：返回 422，避免字段被静默忽略。
- 服务端在现有 `verified_files` 完整性检查后统一要求 `category=OPERATION_SCREENSHOT`，候选创建和结果登记使用同一发布证据门禁；拒绝重复、缺失、非 VERIFIED 或错误类别文件。
- 在持有发布记录行锁的同一数据库事务中插入 `PublicationAttachment`、写发布字段、追加 PUBLISHED 事件并提交。
- 若文件已与该记录关联，返回明确 422/409，不静默去重；附件关联继续只追加，不能解绑。
- 上传完成但命令失败时，文件只处于 VERIFIED，尚未成为发布证据；前端只能以成功响应或重取详情中的 `attachments` 认定绑定成功。

## 5. 统计定义与历史语义

| 指标 | 精确定义 | 历史边界 |
|---|---|---|
| 当前状态计数 | `publication_records` 按当前 `status` 全量计数 | 是当前快照；后续状态变化会移动计数 |
| 发布需关注 | 截至 `as_of` 状态为 OPEN 的 `PublicationAttention` 数量 | 创建修复任务不减少；只有显式 resolve 减少 |
| 登记发布数 | 首次进入 `PUBLISHED` 的状态事件发生在窗口内的不同 `publication_id` 数量 | 之后 VERIFIED、REMOVED 或 VERIFICATION_FAILED 仍保留在历史发布数中 |
| 验证通过数 | 上述登记发布 cohort 中，截至 `as_of` 至少存在一次 `VERIFIED` 事件的不同记录数 | 后续下线仍视为曾验证通过，不回删历史事实 |
| 验证通过率 | `verified_count / registered_published_count` | 分母为 0 时返回 `null`，UI 显示“—” |
| 新增异常数 | 窗口内首次进入 `REJECTED`、`REMOVED` 或 `VERIFICATION_FAILED` 的不同记录数 | 三个均为真实终态；不按 comment 分类 |
| 当前未解决异常数 | 截至 `as_of` 的 OPEN `PublicationAttention` 数 | 只包含具有显式关注闭环的 REMOVED/VERIFICATION_FAILED；REJECTED 不伪装成可解决关注 |

查询必须直接聚合状态事件和关注表；不得请求所有详情、遍历分页或使用 Dashboard 已有的两项简化统计。实现时对重复/异常历史使用 `COUNT(DISTINCT publication_id)` 保持口径稳定，但不通过容错逻辑掩盖数据库完整性问题。

## 6. 发布登记数据流

### 6.1 候选到待人工发布

1. `GET /publication-candidates` 返回已批准内容、锁定平台和 `matching_accounts`。
2. 用户打开候选 Drawer；`GET /publication-package` 返回锁定正文、标题、哈希和 canonical URL。
3. 用户复制内容、选择匹配账号、填写栏目 URL，可上传初始操作证据。
4. 前端以新 `Idempotency-Key`、CSRF 和附件 ID 调用 `POST /publication-records/manual`。
5. 服务端重验批准态、任务 OPEN、账号活跃/平台一致、栏目域名，以及文件 VERIFIED 与 `OPERATION_SCREENSHOT` 类别，创建 PENDING 记录和事件。
6. 成功后关闭或切换 Drawer，失效候选、记录、摘要、Dashboard 查询；失败保留表单并显示原始服务端错误。

### 6.2 待发布到已发布

1. 记录列表/详情返回 `available_actions`，Drawer 只显示允许动作。
2. `mark-platform-review` 表示真实平台审核中；不需要字段时只提交 comment。
3. `mark-published` 表单填写实际标题、最终 URL、发布时间、备注，可上传结果证据。
4. 服务端持有记录行锁，验证转换、URL 协议/域名和 VERIFIED `OPERATION_SCREENSHOT` 文件，原子写字段、附件和 PUBLISHED 事件。
5. 成功响应是绑定完成的唯一前端确认；409/422/403 原样呈现并重取详情，不自动改状态或猜测成功。

### 6.3 页面验证与异常

1. PUBLISHED 记录提供 `verify`、`remove`、`mark-verification-failed`。
2. 操作者打开最终 URL，对照锁定内容；验证成功必须提交 `content_matches=true` 与说明。
3. 服务端首次 VERIFIED 在同一事务完成原内容任务；并发的第二条过期命令因状态变化失败，不覆盖历史。
4. REMOVED/VERIFICATION_FAILED 原子创建唯一 OPEN attention；REJECTED 保留终态和事件，但不创建没有解决语义的 attention。

## 7. 异常类型唯一来源

异常摘要不新增字段：

- `REJECTED` → 平台拒绝，来源为发布记录当前状态。
- `PublicationAttention.trigger_status=REMOVED AND status=OPEN` → 页面已下线。
- `PublicationAttention.trigger_status=VERIFICATION_FAILED AND status=OPEN` → 页面验证失败。

自由文本 `PublicationStatusEvent.comment` 只作历史说明，不能用于分类。原型中的页面无法访问、URL 验证失败、内容与登记版本不一致暂缓；若产品后续需要分别统计，应新增服务端结构化 `reason_code` 并明确每个命令的赋值规则、历史迁移和状态关系，作为独立契约任务评审。

## 8. 数据库与查询设计

### 8.1 数据库变更

本计划不新增表、列、约束或迁移：现有 `publication_status_events` 能支持周期与动态，`publication_attachments` 已支持追加证据，`publication_attentions` 已支持显式解决。结果阶段附件只增加现有表的插入时机。

实现阶段必须在真实 PostgreSQL 上验证聚合查询计划和批量列表查询。只有 `EXPLAIN (ANALYZE, BUFFERS)` 或接近生产量级的集成数据证明现有索引不足时，才回到规划评审索引迁移；不得为猜测性能预先加索引。

### 8.2 N+1 消除

- 候选账号：先取所有候选平台 ID，再一次取活跃账号并按平台分组。
- 发布记录列表：一条分页主查询联接内容、任务、平台版本、平台和账号；最后验证时间用分组子查询或 lateral 聚合，不加载完整事件/附件。
- 关注列表：一次联接关注、发布记录、内容、任务、平台、账号和可选修复任务。
- 最近动态：一次查询最近 5 个状态事件并联接展示上下文。
- 详情接口可以继续加载单个对象的事件和附件；不得被列表循环调用。

## 9. 权限、并发与历史边界

- 摘要、候选、记录/关注列表与详情：`CurrentUser`，与当前发布读取权限一致。
- 创建记录、上传/完成文件、发布命令、创建修复任务、解决关注：保留 `EngineerUser/ContentEditor + CSRF`。
- 平台账号创建：工程师；删除：管理员；工作台不复制管理权限。
- 最近动态不读取 `/audit-logs`，避免向普通用户泄露管理员审计范围。
- PublicationRecord 通过数据库行锁、服务端转换表和发布字段不可变触发器阻止并发覆盖；不为满足形式增加 `revision` 字段。过期动作返回 409。
- PublicationAttention 继续使用显式 `expected_revision`；创建修复任务与解决动作各自锁行，且创建修复任务不隐式改变 attention 状态。
- 所有已发布、验证、下线、失败、拒绝和附件历史保留；UI 不提供删除或回退。

## 10. 视觉与响应式结构

### 10.1 视觉层级

- L0：现有应用背景和 ambient gradient。
- L1：列表、表单等高可读业务表面，保持较高不透明度。
- L2：流程摘要、辅助卡和 Drawer 使用现有 glass surface/border/blur/shadow Token。
- L3：Modal、Select、Dropdown 等继续由 Ant Design 主题映射控制。

玻璃只表达层级，不在每个表格单元叠加模糊。简单统计使用数字卡和 CSS 进度条；没有同比或趋势序列时不显示箭头、折线或百分比变化。

### 10.2 断点

- `>= 1280px`：流程五节点横排，列表全宽，Drawer 约 480–560px，辅助区按 4 列或 2+1+1 组织。
- `768–1279px`：流程摘要可两行；辅助区两列；Drawer 最大宽度 `min(520px, 72vw)`。
- `< 768px`：PageHeader 与筛选纵向，流程摘要紧凑化，表格只保证页面不溢出并由 `TableRegion` 内部横向滚动；辅助区单列；Drawer 宽 100vw、高度使用动态视口并考虑底部安全区。

1024px 和 375×812 是显式验收点，不只依赖断点推断。

### 10.3 键盘和辅助技术

- Ant Tabs、Table、Drawer、Form、Button 使用原生语义；图标按钮必须提供 `aria-label`。
- 打开 Drawer 后焦点进入标题/首个可编辑字段，Tab 不逃逸；Escape 关闭；关闭后返回触发按钮。
- 表单错误紧邻字段，并通过 `role=alert`/Ant Form 语义宣布；提交按钮有 loading 和 disabled。
- 表格滚动区域可聚焦并有可访问名称；排序/筛选状态由组件语义表达。
- 状态标签包含中文文本，不依靠红绿颜色；focus-visible 不被移除。
- 遵守 `prefers-reduced-motion`，系统主题变化不闪烁、不丢失焦点。

## 11. 缓存与刷新

新增独立 query key：`publications.workbenchSummary(windowDays)`。默认参数为 7，周期选择器只允许 7/30，并将选择写入 URL。成功写操作按影响失效：

- 创建 PENDING：候选、记录、摘要、Dashboard、相关内容任务。
- 状态命令：记录列表/详情、摘要、最近动态；若 VERIFIED 还失效内容任务/Dashboard；若产生 attention 还失效关注列表/详情。
- 结果附件：随 `mark-published` 同一失效路径，无单独“绑定成功”缓存。
- 解决 attention / 创建修复任务：关注列表/详情、摘要、内容任务。

不得为了“感觉实时”轮询所有详情；默认采用写后失效和正常 staleTime。

## 12. 回滚方案

- 前端回滚：恢复旧 `PublicationWorkspace` 布局和详情页操作；新只读摘要接口可暂时闲置，不影响状态机。
- 后端回滚：删除摘要 endpoint、列表专用投影和命令附件字段代码；由于没有数据库迁移，无 schema 回退。
- 契约回滚：OpenAPI、生成类型、运行时 schema 必须在同一回滚中恢复，禁止保留前后端不一致。
- 数据边界：通过新命令已追加的附件和状态事件是合法历史事实，不在回滚时删除；旧客户端仍可读取详情中的 attachments。
- 若聚合性能不满足要求，先关闭页面对应辅助模块并保留核心列表/登记，不使用分页拼接或缓存假数据兜底。

## 13. 设计风险与处理

| 风险 | 处理 |
|---|---|
| 用户把候选数理解为待人工发布状态 | 候选页签单独计数；流程节点只显示 `PENDING_MANUAL_PUBLISH` |
| 结果证据上传成功但状态命令失败 | UI 明确“已上传，尚未绑定”；只以成功响应的 attachments 为准 |
| 摘要与列表瞬时不一致 | 使用同一 PostgreSQL 状态源，写后同时失效；不以客户端乐观状态替代 |
| 周期选择器演变成通用报表配置 | 本任务只提供 7/30 两个枚举值，默认 7；自定义日期或更多周期有明确需求时再扩展 |
| 玻璃效果损害暗色对比度或性能 | 只用于 L2/L3，业务表面保持高不透明；实机验收 backdrop-filter 和 reduced motion |
| 列表字段过多导致手机不可用 | 核心字段优先、次要字段折叠/横向滚动、操作进入全屏 Drawer，不在页面级横向滚动 |
