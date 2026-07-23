# 业务设置用户管理技术设计

## 1. 设计结论

本任务扩展现有身份模块和 `/users` 页面，不引入新用户模型、权限引擎、数据库字段、迁移、缓存或平行管理页。PostgreSQL 中现有 `users`、`sessions`、`audit_logs` 和业务外键已经能表达账号类型、启停、强制改密、会话撤销与历史追溯；缺口应通过统一查询投影、一个批量状态命令、一个 CSV 导出和前端高保真编排补齐。

核心不变量为：

1. `users.id` 是业务身份唯一来源，任何启停、改名、角色修改和重新启用均更新同一行。
2. `users.account_type` 是权限唯一来源，服务端 `AdminUser` 是所有用户管理能力的最终权限边界。
3. 最后一个有效管理员不可停用或降权；所有单个/批量路径复用同一事务内检查，不复制判断。
4. 临时密码只以现有安全哈希保存，明文不进入响应持久化、URL、日志、审计或导出。
5. 列表、导出和当前总数共享同一筛选/稳定排序；统计卡只读取未筛选的实时 PostgreSQL summary。
6. 批量状态命令可部分成功，但每个成功项必须与单用户更新具有相同锁、修订号、会话撤销和审计语义。

用户已于 2026-07-23 确认 PRD 的五项最小契约包，本设计中的相关内容均为冻结契约。任务仍保持 `planning`，等待最终规划评审后的独立实施批准。

## 2. 信息架构与路由

### 2.1 导航归组

保留真实路由 `/settings`、`/users`、`/audit` 和 `/configuration/*`，只调整 `AppLayout` 的导航树：

- “业务设置”成为可展开分组，子项按原型顺序为：
  - `发布账号` → `/settings?tab=accounts`
  - `历史目标问题` → `/settings`（现有默认 topics）
  - `用户管理` → `/users`，`adminOnly`
  - `审计日志` → `/audit`，`adminOnly`
- “配置中心”保留平台、规则、Prompt、AI 渠道与模型，移除重复的用户/审计叶子。
- 工程师仍能看到业务设置中的前两个真实页面，不能看到或通过 API 使用用户管理/审计能力。

导航项继续用 URL 作为唯一目标。`matchesRoute` 在 `/settings` 下结合 `tab` 判断选中叶子；预取前先剥离查询参数，以便复用现有 `/settings` route loader。现有 `/settings?tab=accounts&platform_profile_id=...` 深链保持有效，不新增别名路由或兼容页面。

`/users` 的“业务设置 / 用户管理”面包屑由 `AppLayout` 全局顶栏唯一渲染；页面 `PageHeader` 只负责标题、说明和新增按钮，避免同一层级重复两次。AppLayout 为该路由增加局部 shell 修饰类，桌面侧栏约 186–190px；其他配置中心和业务页面宽度不受影响。

### 2.2 页面权限

前端继续对非管理员直接访问 `/users` 执行现有受保护导航行为；后端所有查询/导出/命令仍使用 `AdminUser`。不创建前端权限矩阵，也不把按钮隐藏视为授权。

## 3. OpenAPI 契约

### 3.1 用户列表与 summary

扩展 `GET /api/v1/users`：

| 参数 | 类型 | 语义 |
|---|---|---|
| `q` | `string?`, max 200 | 用户名或显示名称大小写不敏感的字面量包含搜索 |
| `account_type` | `AccountType?` | `ADMIN` 或 `ENGINEER` |
| `status` | `UserStatus?` | `ENABLED` 或 `DISABLED`；省略表示全部 |
| `page` | integer, default 1, ge 1 | 服务端页码 |
| `page_size` | integer, default 20, ge 1, le 100 | 服务端每页数量；原型控件和当前 API 均为 20，前端提供 10/20/50 |

新增契约：

```yaml
UserStatus: ENABLED | DISABLED
UserSummary:
  user_total: integer
  enabled_total: integer
  disabled_total: integer
  must_change_password_total: integer
  admin_total: integer
UserList:
  items: User[]
  page: integer
  page_size: integer
  total: integer
  summary: UserSummary
```

`total` 受当前筛选影响；`summary` 不受 `q/account_type/status/page/page_size` 影响，统计所有管理员可见用户：`admin_total` 包含启用和停用 ADMIN，`must_change_password_total` 包含启用和停用且标志为真的用户。这样五张卡不会随表格筛选跳变，也不会建立第二统计源。

省略全部新过滤参数时仍返回全账号的第 1 页 20 条，修正当前“声称 page_size=20 却可能返回任意条数”的不一致。稳定排序为 `created_at ASC, id ASC`，保持现有按创建时间从早到晚的可见顺序并消除同时间不确定性。

### 3.2 新建用户

把 `UserCreate.password` 明确改为 `temporary_password`，创建语义冻结为：

- 用户名规范化、显示名称、账号类型和最小 12 字符校验沿用现有规则；
- 新账号默认 `is_active=true`，与当前服务行为一致；
- `must_change_password=true`，管理员输入只用于本次请求和哈希计算；
- 响应继续为不含任何密码信息的 `User`。

仓库内只有当前前端调用该字段；OpenAPI 与生成类型同步替换，不增加双字段、别名或兼容分支。

### 3.3 批量状态契约

新增管理员写接口：

```text
POST /api/v1/users/bulk-status
X-CSRF-Token: required
```

请求与响应冻结为：

```yaml
UserBulkStatusItem:
  user_id: uuid
  expected_revision: integer >= 0
UserBulkStatusRequest:
  items: UserBulkStatusItem[1..100], user_id 唯一
  status: ENABLED | DISABLED
UserBulkStatusFailure:
  user_id: uuid
  code: string
  message: string
UserBulkStatusResult:
  succeeded: User[]
  failures: UserBulkStatusFailure[]
```

整个请求的认证、权限、CSRF、空/重复/超限和枚举错误按标准 401/403/422 整体失败。合法请求返回 200；逐项用户不存在、修订冲突和最后管理员保护进入 `failures`，其余项继续。响应不回显请求中的密码或任何会话数据。

静态 `/users/bulk-status` 和 `/users/export` 路由必须注册在动态 `/users/{user_id}` 之前，或显式使用 UUID path converter，并用契约/路由测试锁定，避免被动态段截获。

### 3.4 CSV 导出

新增管理员只读 `GET /api/v1/users/export`，接受与列表相同的 `q/account_type/status`，忽略分页。唯一输出为带 UTF-8 BOM 的 `text/csv`：

```text
用户名,显示名称,账号类型,状态,必须修改密码,创建时间
```

状态值使用稳定机器值 `ENABLED/DISABLED`，布尔使用 `YES/NO`，创建时间使用 ISO 8601 UTC；不包含 UUID、revision、密码/哈希、临时密码、Cookie、Token、会话和审计详情。文件名为 `users-YYYYMMDD-HHMMSSZ.csv`。

导出服务先在内存完整生成 CSV bytes，生成成功后再用现有 `append_audit` 记录 `user.exported` 并提交，最后构造普通 `Response`；不使用可能在提交审计后才失败的流式生成。`target_type="UserExport"`、`target_id=actor.id`，details 仅含规范化后的非敏感筛选和值域、`row_count`，不保存 CSV 正文。响应读取仍不要求 CSRF，权限由 `AdminUser` 控制。

## 4. 后端查询与命令

### 4.1 统一查询

在现有 `backend/app/services/identity.py` 中增加用户查询能力，而不是新建只有一层转发的 repository/query service：

- `_user_search_conditions(q)` 使用项目既有反斜杠转义模式，把 `\`、`%`、`_` 当普通字符后对 `username/display_name` 使用 `ILIKE ... ESCAPE '\\'`。
- `_filtered_users_query(q, account_type, status)` 构造列表与导出共用的过滤和 `created_at, id` 排序。
- `list_users(...)` 计算过滤总数、分页 items 和一个不受筛选影响的 `_user_summary(db)`。
- `export_users(...)` 复用同一查询并用 Python 标准库 `csv` 生成 UTF-8 BOM；不引入 Excel/CSV 新依赖。

用户量当前没有慢查询或规模证据，不新增 `pg_trgm`、display_name 索引、缓存、物化视图或统计表。若实施验证出现真实慢查询，再单独提出索引方案。

### 4.2 单个更新共享不变量

当前 `update_user` 已正确使用 `LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE`、目标行 `FOR UPDATE`、`expected_revision` 和最后管理员计数。实施时把“锁定后校验并应用更新、写审计、必要时撤销会话”提取为同文件的事务内私有函数：

- 单用户 `update_user` 调用私有函数后提交；
- 批量命令只获取一次表锁，按用户 UUID 稳定顺序处理并在一个外层事务结束时提交；
- 私有函数不提交、不吞异常，避免单个/批量形成两套状态规则。

该内部边界有两个真实调用方且拥有明确事务职责，不新增接口、类、策略或通用命令框架。

### 4.3 批量部分成功

批量请求先验证 UUID 唯一和上限，再获取用户表锁。为避免并发批次以不同选择顺序锁行，服务按 UUID 稳定顺序处理；响应按请求顺序还原结果。

每项执行：

1. `SELECT ... FOR UPDATE` 读取目标；
2. 校验存在与 `expected_revision`；
3. 只改变 `is_active`，保留显示名称和账号类型；
4. 若移除有效管理员，使用同一事务内当前状态计数保护最后管理员；
5. 递增 revision，停用时撤销该用户全部活动会话；
6. 追加现有 `user.updated` 审计，并在非敏感 details 中标记 `source=BULK_STATUS` 和目标状态。

只捕获预期的 `AppError` 并转为逐项 failure。逐项 404、修订冲突和最后管理员错误都在失败 SQL 或状态写入前产生，因此不会把 SQLAlchemy Session 置为 failed；不得捕获 `IntegrityError` 后继续。数据库、编程或审计敏感字段异常不降级为部分失败，必须回滚整个事务并由统一错误处理暴露。这样不会用宽泛 `catch` 掩盖数据完整性问题；测试需注入一次审计或数据库意外异常并确认先前成功项也未提交。

批次内先成功停用一名管理员后，后续停用导致只剩零名时后续项失败，前一项保留为成功，最终仍至少有一名有效管理员。批量包含当前操作者沿用现有允许规则；若其停用成功，外层提交同时撤销当前会话，前端随后按统一认证失效流程回到登录页。

### 4.4 密码和审计

- 创建写 `must_change_password=true`；重置与改密逻辑继续复用现有 Argon2、会话撤销和服务端强制改密白名单。
- 不返回、记录或导出管理员输入的临时密码；前端 Modal `destroyOnHidden`，成功/取消后不保留表单值。
- 现有 `SENSITIVE_KEYS` 已覆盖相关字段；新增导出/批量审计只写非敏感枚举、计数和用户目标。
- `user.updated` 详情只写本次实际变化的 `display_name/account_type/is_active`；批量状态审计另写 `source=BULK_STATUS` 和目标 `status`，不把未变化字段伪装为变更。
- 用户创建、单个编辑/状态、每个批量成功项、重置和导出均可在 `/audit` 查到。失败请求继续遵循项目现有行为，不伪造成功审计。

## 5. 数据库与历史完整性

本任务无数据库迁移：

- 五项 summary 均由 `users` 实时聚合；
- 批量状态只更新 `users.is_active/revision`；
- 临时密码继续使用 `password_hash/must_change_password`；
- 会话撤销继续更新 `sessions.revoked_at`；
- 审计继续追加 `audit_logs`。

`contracts/database.md` 应补充而不是新增结构：新账号初始改密语义、用户列表 summary 口径、批量逐项状态语义、导出审计以及“无应用删除、历史外键不改写”的不变量。

不增加 display-name 快照。历史记录继续持有稳定 user UUID；用户当前资料变化可能影响投影中的当前名称，但不会修改历史业务行、批准内容或审计事件。停用/重新启用不触发业务表写入。

## 6. 前端数据流

### 6.1 URL 与 Query

用户页解析：

```text
q=<trimmed text>
account_type=ADMIN|ENGINEER
status=ALL|DISABLED     # 省略表示页面默认 ENABLED；显式 ENABLED 规范化为省略
page=<positive integer> # 1 省略
page_size=10|20|50      # 20 省略
```

前端视图状态 `ENABLED | DISABLED | ALL` 是状态选择器和开关的唯一来源：

- `ENABLED` → API `status=ENABLED`、开关关闭；
- `DISABLED` → API `status=DISABLED`、开关打开；
- `ALL` → API 省略 status、开关打开。

开关从关闭切到打开设置 `ALL`，从打开切到关闭设置 `ENABLED`；状态选择器直接写同一值。旧 `inactive` 参数不再作为第二兼容状态读取，实施时同步更新 README/spec；URL 中出现时作为无效旧参数移除。

`queryKeys.users` 改为层级键：

```text
users.all
users.list({q, account_type, status, page, page_size})
```

列表 query key 包含完整服务端请求。成功写操作失效 `users.all`；自我更新额外刷新 `auth.me`。不在组件中从全量 items 重新计算筛选、分页或 summary。

若 URL 页码超出服务端 `total` 的最后一页，页面在获得响应后显式 replace 到合法末页并重新请求，不把空页静默解释为第 1 页。

### 6.2 页面结构

`UserManagementPage` 负责 URL、Query/Mutation、选择和弹窗状态；表单与说明栏保持 feature-local 的小组件，不创建通用用户框架。只有当主文件在实施中因三个表单和右栏变得难以审阅时，才按“用户对话框”和“用户说明栏”两个稳定职责拆文件。

桌面结构：

```text
PageHeader
UserSummaryGrid (5 cards)
UserWorkspace
  main
    FilterToolbar
    UserTable
    Pagination
  aside
    AccountTypeHelp
    TemporaryPasswordHelp
    ImportantNotes
    QuickActions
Create / Edit / Reset dialogs
```

统计区直接读取 `users.data.summary`；加载时使用 Skeleton，不用 0 伪装未加载。右栏权限摘要来自当前服务端两类账号的权威文档语义，运行时类型值仍只消费 OpenAPI `AccountType`；不维护可授权权限映射或用说明文案决定按钮权限。

表格增加 Ant `rowSelection`。选择只保留当前响应中的 ID；q、类型、状态、页码、每页数量或列表 revision 变化时清除不可见选择。快捷操作与表格操作共享同一 batch mutation，禁止另一套选择数组或 DOM 读取。

### 6.3 Mutations 与反馈

- 新增、编辑、重置继续使用生成 Schema 和现有 CSRF client。
- 单个启停通过现有 PATCH 构造完整 `UserUpdate`，以行内当前显示名称/类型和 revision 为准；成功失效用户集合。
- 批量请求成功后，即使存在 failures，也先失效集合并以结果 Drawer/Modal 或 Alert 列出失败项、code/message；仅当 failure 的 UUID 仍存在于本次精确选择快照时显示对应用户名，否则显示 UUID，不猜测名称。不得只 toast“成功”。
- CSV 沿用平台页已验证的 Blob/Content-Disposition 下载模式，mutation loading 时禁用重复点击，失败使用统一 `errorMessage`。
- `409 REVISION_CONFLICT` 保留在编辑/操作上下文并提供刷新列表；`LAST_ADMIN_REQUIRED` 显示真实原因；不自动重试写命令。
- 自我停用导致后续 auth refresh/请求 401 时复用全局 `partsignal:auth-expired` 流程清理 CSRF/query 并回登录页。

## 7. 高保真样式与可访问性

量化规格见 `research/visual-spec.md`。实现只在现有全局样式中增加 `.app-shell-user-management`、`.user-management-*` 局部规则：

- 1581×995 时侧栏约 186–190px；五卡单行等宽约 123px 高；主表格区与 300px 右栏按原型比例排列。
- 统计卡、筛选区、表头、50px 行高、图标按钮、分页和说明卡使用现有语义 Token、Ant 线性图标和现有表面/焦点规则。
- 用户头像使用稳定首字符/账号图标和 Token 色，不使用远程图片、Emoji 或新增字段。
- 表格选择列是批量功能的必要有意差异；通知、帮助、应用切换因没有真实项目能力而不渲染空按钮。
- 1199px 以下右栏移到主区之后，表格只在区域内横向滚动；375/768/1024/1440 和 200% 缩放不产生页面级横向溢出。
- 表单字段有可见 label，图标按钮有 Tooltip/`aria-label`，状态含文字，键盘焦点可见；确认弹窗关闭后焦点归还触发按钮。

Browser 是实施期第一验收工具。需在原型 1581×995 视口进行多轮截图并用 `view_image` 同轮对照原型与最新实现，维护 `artifacts/fidelity-ledger.md`；Browser 不可用或不可靠时才使用项目 `playwright-cli` 并记录原因。

## 8. 测试设计

### 8.1 后端与契约

新增身份管理专用集成测试，覆盖：

- 列表权限、q 字面量通配符、类型/状态组合、稳定排序、分页边界、过滤 total 和未筛选五项 summary；
- 新账号临时密码、强制改密白名单、改密后旧密码失效、其他会话撤销；
- 编辑字段、用户名不可变、修订冲突、停用/重启、允许自我停用与最后管理员拒绝；
- 批量全部成功、部分 revision/404/最后管理员失败、重复/空/超限、会话撤销、逐项审计和整批权限/CSRF；
- 在另有有效管理员时自我降权和自我停用成功，自停用提交后当前会话被拒绝并进入登录流程；最后管理员的同类操作仍为 409；
- CSV 与列表过滤/排序一致、BOM/表头/字段安全、空导出、普通用户 403 和 `user.exported` 审计无敏感详情；
- 停用后从至少一个 `RESTRICT` 历史引用投影仍能解析同一用户 UUID，不删除业务行。

运行 `make contract-check` 锁定 OpenAPI 与运行时/生成类型一致；无需迁移测试，因为没有 Schema 变化。

### 8.2 前端

扩展 `UserManagementPage.test.tsx`，覆盖 URL 参数与 API query、五卡 summary、状态选择器/开关联动、重置、服务端分页、每页数量、选择清理、单个操作、批量部分失败、CSV 下载、Modal 敏感字段销毁、403/409/空/错状态。

更新 `AppLayout.test.tsx` 和路由预取测试，验证管理员/工程师的业务设置分组、顺序、选中态、查询参数路由和配置中心不重复用户/审计。

真实 Browser 流程覆盖新增/编辑、临时密码登录与强制改密、单个启停、批量部分失败、导出、无权限 API、最后管理员保护、加载/空/错误、响应式和视觉。可稳定重复的流程再固化为现有 Playwright E2E，不先创建一次性大脚本。

## 9. 文档同步

- `contracts/openapi.yaml`：列表、summary、批量状态、导出、创建临时密码字段与错误响应。
- `contracts/database.md`：不新增表，但补身份初始改密、批量状态、导出审计和历史身份不变量。
- `frontend/README.md`：业务设置导航归组及用户页 URL 状态从 `inactive/page` 更新为新参数。
- `docs/GEO多平台内容运营系统方案设计.md`：用户管理能力、权限、强制改密、批量/导出和导航关系。
- 必要时更新 `.trellis/spec/frontend/state-management.md` 的用户 URL 参数，以及后端数据库/错误规范中可长期复用的不变量；不在多处重复 OpenAPI 字段表。

## 10. 性能、并发与回滚

- 每次列表最多返回 100 条；summary 使用单条条件聚合；不按用户循环查询。items、total、summary 在同一请求和数据库事务中读取；PostgreSQL 默认 `READ COMMITTED` 下不宣称跨语句严格快照一致，极短并发窗口由下一次失效/刷新收敛，不为管理页引入更高隔离级别或复杂单语句 JSON 聚合。
- 用户更新继续由 SHARE ROW EXCLUSIVE 表锁串行保护管理员不变量。批量只取一次表锁并按 UUID 锁行，避免同一批内重复锁和跨批死锁顺序差异。
- CSV 全量读取当前筛选集合。内部用户规模暂无大数据证据；不先加异步导出、队列、压缩或上限。若真实规模/响应时间超出同步请求能力，另立任务设计。
- 产品代码回滚只需移除新增 API/页面逻辑并恢复旧 UserList；无数据库迁移可回滚。已写审计是追加式历史，不因代码回滚删除。

## 11. 主要取舍与风险

- 使用一个批量端点而不是前端 `Promise.allSettled(PATCH)`，因为最后管理员保护、事务结果和审计必须由服务端统一拥有。
- 使用现有 UserUpdate 完成单个启停，不增加一对薄的 enable/disable API；批量端点只因真实的逐项事务契约而存在。
- summary 实时聚合且无趋势，避免快照表和从审计推断历史；可见代价是原型趋势行改为无基线文案。
- CSV 复用标准库和平台页下载模式，避免 Excel 依赖和多格式选择；同步导出适用于当前内部账号规模。
- 当前服务允许在还有其他管理员时自我停用/降权，本任务沿用而不增加未经批准的自保护规则；其 UX 风险通过确认与会话失效流程处理。
- 创建用户首次强制改密、状态控件映射、无趋势、批量部分成功和 CSV 列均已确认；没有阻塞规划的开放问题，下一门禁是用户对最终规划摘要的独立实施批准。
