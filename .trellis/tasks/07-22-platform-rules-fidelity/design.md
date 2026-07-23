# 配置中心平台规则高保真复刻技术设计

## 1. 设计原则与不变量

本任务扩展现有平台规则版本能力，不建立新的规则域。以下不变量必须跨数据库、服务、OpenAPI、前端和测试一致：

1. `platform_profile_versions.rules` 是规则正文唯一来源；字段只由 `PlatformRules` 契约定义。
2. 每个平台最多一个 ACTIVE，当前规则由该 ACTIVE 版本派生，不保存 `current_rule_id`。
3. DRAFT 可编辑；ACTIVE/RETIRED 正文冻结。激活替代是原子状态切换，ACTIVE 不直接退役。
4. `ContentTask.platform_profile_version_id` 是引用、删除门禁和影响分析的直接边界；发布/GEO 不复制规则版本 ID。
5. 任何已有 ContentTask 引用都阻止物理删除；无引用时任何状态可删除，ACTIVE 删除不回退。
6. 审计只追加，不原地修正；Actor 删除后审计仍可读，身份明确为空。
7. 服务端拥有状态、引用、影响分桶、权限、revision 与可用动作；前端只负责显示和类型化差异。

## 2. 现有实现上的最小变化

不新增业务表、缓存、任务队列或规则字段迁移。现有 `platform_profile_versions`、`content_tasks`、`content_versions`、`publication_records`、`audit_logs` 和 `users` 足以提供原型已确认的真实信息。

实施只增加：

- 版本列表的批量管理投影；
- 单版本影响摘要只读接口；
- 内容任务精确规则版本筛选；
- 自动替换退役审计及命令评论详情；
- 通用审计接口对已删除演员事件的正确保留；
- 现有页面上的四列工作台、差异、状态命令和响应式交互。

如目标影响查询的真实执行计划证明缺少索引，再增加与已确认 SQL 完全匹配的新 Alembic revision；规划阶段不预设索引或修改历史迁移。

## 3. OpenAPI 契约

### 3.1 规则版本列表项

保留写接口返回的 `PlatformProfileVersionOut`。列表响应的 `items` 改用新增 `PlatformProfileVersionSummary`，包含原有全部字段并增加：

```yaml
created_by: uuid | null
activated_at: date-time | null
last_changed_at: date-time
reference_count: integer >= 0
available_actions: [EDIT | ACTIVATE | RETIRE | DELETE]
```

定义：

- `created_by` 来自该版本的 `platform_profile_version.created` 审计演员；缺失或演员已删除时为 `null`。
- `activated_at` 是该版本最新 `activated` 审计时间；从未激活为 `null`。
- `last_changed_at` 是版本 `created_at` 与该目标创建、更新、激活、退役审计时间的最大值。
- `reference_count` 是直接引用该版本的去重 ContentTask 数量。
- `available_actions` 由当前状态和引用数计算：DRAFT 有 `EDIT/ACTIVATE/RETIRE`，所有状态在引用数为零时有 `DELETE`。权限与竞态仍由命令端点复核。

全局 `GET /api/v1/platform-profile-versions` 和按平台 `GET /api/v1/platform-profiles/{id}/versions` 使用同一批量投影函数，保持排序语义不变。

### 3.2 影响摘要

新增：

```text
GET /api/v1/platform-profile-versions/{platform_profile_version_id}/impact
```

响应 `PlatformRuleImpactSummary`：

```yaml
as_of: date-time
bound_task_total: integer >= 0
unpublished_task_total: integer >= 0
reviewing_task_total: integer >= 0
published_task_total: integer >= 0
```

接口使用现有规则版本读取权限；版本不存在返回 404。响应保证：

```text
bound_task_total = unpublished_task_total
                 + reviewing_task_total
                 + published_task_total
```

分桶执行 PRD 已确认的优先级，按任务稳定 ID 去重。`as_of` 为服务端开始该只读投影的时间；单条 SQL 在同一 PostgreSQL 语句快照中计算四项，避免多个请求之间状态漂移。

### 3.3 内容任务筛选

扩展：

```text
GET /api/v1/content-tasks?platform_profile_version_id=<uuid>
```

- 与已有 `platform_profile_id` 同时提供时使用 AND，必须同时匹配。
- 省略两者时保持当前全量列表语义和排序。
- 不增加前端全量过滤、兼容参数别名或候选路径。

### 3.4 审计演员可空

数据库 `AuditLog.actor_id` 已因 `ON DELETE SET NULL` 真实可空，但当前 `AuditLogOut.actor_id` 错误声明为必填，并在路由层丢弃演员为空的历史。把契约改为 `uuid | null`，通用审计列表不再过滤这些记录，`total` 与 `items` 一致。

平台规则页复用现有管理员 `/users` 列表把非空 Actor ID 显示为姓名；用户已删除时显示“已删除用户”，不新增重复 Actor 投影。该修正只改变历史可见性，不改写审计记录。

## 4. 服务端投影与查询

### 4.1 版本批量投影

在配置/投影服务中新增一个接收 `db` 和版本列表的批量函数，执行固定数量查询：

1. 一次按版本 ID 分组统计 `ContentTask` 引用数；
2. 一次读取这些目标的相关审计，使用条件聚合得到创建演员、激活时间和最后变更时间；
3. 组装 `PlatformProfileVersionSummary` 与动作数组。

禁止在循环中查任务、审计或用户。`created_by` 只认明确 `created` action；没有该事实就返回 `null`。`last_changed_at` 可以使用版本自己的 `created_at`，因为它是同一对象的权威时间，不是猜测回退。

现有 `platform_version_out` 继续服务创建、更新、激活和直接退役响应；写成功后前端重新获取列表投影，不在命令服务重复运行管理聚合。

### 4.2 影响分桶 SQL

影响查询以目标版本直接引用任务为 `bound_tasks` CTE，并用 `EXISTS` 避免多版本/多发布重复：

- `published`：存在 `ContentVersion.task_id = task.id` 且其 `PublicationRecord.status IN ('PUBLISHED', 'VERIFIED')`；
- `reviewing`：不满足 `published`，且存在 `PublicationRecord.status = 'PLATFORM_REVIEW'` 或 `ContentVersion.status = 'PENDING_REVIEW'`；
- `unpublished`：前两者均不满足。

最终一次条件聚合返回总数和三桶。不得用 `NOT IN` 处理可空关系，不读取分页列表后计数，不把 ContentTask 自身 `OPEN/COMPLETED/CANCELLED` 当作发布阶段。

实施时对生成 SQL 运行目标集成测试，并在可用数据库上检查 `EXPLAIN`。已有 `ix_content_tasks_platform_profile_version_created_at`、`ContentVersion(task_id, version)` 唯一索引和发布状态索引先作为基线；只有执行计划显示重复扫描或数据规模证据时才增加复合索引。

### 4.3 审计闭环

直接 DRAFT 退役仍写 `platform_profile_version.retired`，详情增加：

```json
{"reason":"DIRECT","revision":2,"comment":"..."}
```

激活替代时，在同一事务和既有锁内：

1. 旧 ACTIVE 改成 RETIRED、revision 加一；
2. 给旧版本追加 `retired` 审计：`reason=REPLACED`、`replacement_version_id`、`revision`、激活命令 `comment`；
3. flush 释放部分唯一索引 ACTIVE 槽位；
4. 目标 DRAFT 改成 ACTIVE、revision 加一；
5. 给新版本追加 `activated` 审计：`previous_active_version_id`、`revision`、`comment`；
6. 单次 commit。

没有旧 ACTIVE 时，新版本激活审计的 `previous_active_version_id` 为契约化 `null`。任一步失败整体回滚。创建/更新请求当前没有评论字段，本任务不添加人工摘要，也不伪造历史说明。

### 4.4 状态和删除竞态

激活继续先锁平台行，再锁目标版本；同平台激活请求因此串行。读取旧 ACTIVE 后同事务切换，数据库部分唯一索引提供最终约束。

`available_actions` 只用于展示。编辑、激活、直接退役继续校验最新 revision 和状态；删除继续锁版本并重新统计 ContentTask 引用。即使列表显示可删除，随后新增引用或状态改变，服务端仍返回真实冲突，前端刷新当前查询。

## 5. 前端状态与数据流

### 5.1 URL 是可恢复界面状态

`PlatformRulesPage` 使用：

- `q`：已提交的平台名称搜索；
- `platform_profile_id`：选中平台；
- `version_id`：选中规则版本。

搜索提交时清除平台与版本选择，再由当前服务端排序结果选择第一项并用 `replace` 写回 URL。平台列不提供启用/停用筛选，也不展示平台状态；直接进入且无选择时默认当前搜索结果第一平台。版本优先选 ACTIVE，否则选最高版本。URL 指向不存在、无权限或不属于当前平台的版本时显示局部错误，不自动换到别的版本。

平台或版本选择、浏览器前进/后退和刷新只由 URL 驱动；React Query 管理平台、版本、影响、审计和用户服务端状态；Modal/Drawer、表单 dirty 与比较目标是局部状态。不增加全局 Store。

### 5.2 Query 结构

- 平台：复用 `platformProfilesQueryOptions({q, status})` 的全量兼容模式；不重复平台管理查询。
- 版本：保留并复用 `platformProfileVersionsForProfileQueryOptions(profileId)`，扩展列表项生成类型。
- 影响：新增按版本 ID 的 query key/options，只在选中版本时启用。
- 审计：扩展通用 audit key，使其包含 `target_type/target_id/page/page_size`，避免所有审计共享一个静态 key。
- 用户：复用现有 `/users` 查询，为创建人和历史演员显示姓名。
- 引用详情：由任务页自己的 `ContentTaskListQuery` 发送 `platform_profile_version_id`。

写成功后失效：受影响平台的版本列表、选中版本影响、目标审计、平台集合/详情及生成候选所需当前规则查询。不要无差别 `queryClient.clear()`。

### 5.3 组件边界

保留 `PlatformRulesPage.tsx` 作为 URL、查询、命令和平台/版本列编排。仅按真实职责拆出：

- `PlatformRuleDetail.tsx`：只读规则键值行和类型化差异 Modal；
- `PlatformRuleMetaPanel.tsx`：版本状态、影响、历史和危险操作；移动端复用为 Drawer 内容。

现有 `RuleEditor` 可留在页面文件；不抽取通用四列工作台、规则仓库、动作框架或 Provider。新增 TypeScript 文件添加简洁中文文件职责说明。

## 6. 差异模型

前端维护一个与 `PlatformRules` 生成类型一一对应的显示描述数组，包含稳定 key、中文标签、图标和格式化函数。这同时驱动详情行和差异比较，避免两套字段顺序与文案。

比较规则：

- 字符串与数值直接比较；标题/正文范围分别作为一个业务行比较；
- 布尔值显示“允许/不允许”；
- `prohibited_phrases` 和 `sections` 按有序完整值比较，因为当前契约保留数组顺序；
- URL 使用契约值，不重新规范化；
- 差异数按业务行计数，不按字符串字符或数组元素计数。

默认比较同平台中版本号小于当前版本的最大版本；用户可选择其他版本。首版本显示“首个版本”，相同内容显示“无规则字段变化”。不增加 JSON diff 依赖、HTML diff 或数据库差异记录。

## 7. 页面与交互结构

### 7.1 桌面

- `AppLayout` 把平台规则路由纳入约 190px 配置中心侧栏和对应顶栏网格修饰类，与批准原型对齐；不改变非配置页面。
- 页面主体按 `research/visual-spec.md` 使用约 165/215/自适应/287px 四列，列内独立滚动。
- 平台列显示返回平台管理入口、搜索和仅含真实 Logo、名称、版本数的平台行；不复制相邻“规则版本”页签或平台状态。版本列显示创建草稿与版本卡；中央显示规则；右栏显示四个信息卡。
- 主按钮“创建规则草稿”；版本状态动作进入中央“更多操作”或右栏危险区。相同命令不实现第二套 mutation 函数。

### 7.2 移动与窄屏

- 1199px 以下先把右栏转成 Drawer；平台/版本和详情采用两段布局。
- 767px 以下按平台→版本→详情分步，顶部提供返回和当前平台/版本上下文；创建和状态操作仍可键盘访问。
- Drawer 打开后聚焦标题，关闭后归还触发按钮；详情/差异 Modal 使用 Ant 焦点圈定和 Escape 行为。

### 7.3 加载和局部失败

平台查询是页面身份边界；失败时显示整页 `QueryFailure`。版本失败只占版本与后续区；影响或审计失败只在对应右侧卡显示错误和重试，中央规则保持可读。无平台、无版本、首版本、无审计、零引用都有明确空状态。

## 8. 权限、安全和错误

- 页面沿用配置中心管理员守卫；创建、更新、激活、直接退役继续使用现有系统管理员权限，删除沿用管理员权限，所有写操作保留 CSRF。
- 列表和影响读取保留当前规则版本读取权限，不因为管理页面而意外收紧工程师现有选择器；审计和用户列表仍是管理员接口。
- 服务端继续返回 `REVISION_CONFLICT`、`INVALID_STATE_TRANSITION`、`PLATFORM_PROFILE_VERSION_IN_USE` 和标准认证/授权错误；前端显示错误码与 request ID，不添加宽泛 catch 或成功回退。
- 审计 comment 是管理员已提交的业务文本，只按普通文本显示，不作为 HTML；规则 URL 用安全链接属性，长文本换行。

## 9. 测试设计

### 后端

- 版本批量投影：创建演员、激活时间、最后变更、引用数、动作矩阵、审计缺失和已删除演员。
- 影响分桶：零引用、单任务、多内容版本、多发布记录、三个桶、发布优先、审核优先、移除/失败回到未发布及总和不变量。
- 内容任务筛选：仅平台、仅版本、两者一致、两者不一致、无参数兼容。
- 状态：DRAFT 编辑/激活/退役、ACTIVE 替换、双审计、命令 comment、revision 冲突、两个激活并发、失败回滚。
- 删除：三状态零引用允许、任意任务引用阻断、竞态重检。
- 审计 API：Actor 存在/删除均返回，`items` 与 `total` 一致。

### 前端

- URL 默认选择、显式选择、非法 ID、搜索/状态、前进后退和平台管理深链。
- 四列加载/空/局部错误、版本卡元数据、引用数、用户姓名与删除用户。
- 规则详情全部现有字段、差异各种类型、首版本和无变化。
- 创建、编辑、激活、DRAFT 退役、三状态删除动作及服务端拒绝；mutation 载荷包含最新 revision/comment。
- 影响三桶、审计时间线、完整历史和引用详情链接。
- 键盘、焦点、Modal/Drawer、长文本和移动布局语义。

### Browser/E2E

按 `research/visual-spec.md` 在真实数据与 1581×995 视口完成多轮截图比较；E2E 通过真实 API 建立同平台多版本和任务/内容/发布状态，验证核心状态与引用闭环，不把原型示例写入 fixture。

## 10. 文档与回滚

- `contracts/openapi.yaml` 是 HTTP 契约权威；生成前端类型后只消费生成结果。
- `contracts/database.md` 更新规则版本状态、自动退役审计、引用/影响口径和无新表结论。
- `docs/GEO多平台内容运营系统方案设计.md` 与技术部署方案更新当前规则工作台和影响定义，并修正固定平台类型旧描述。
- 稳定约束确有新增时才更新 `.trellis/spec/`，不把任务实现步骤复制为规范。

本任务没有计划中的数据迁移，代码回滚可移除投影/API/UI 并恢复旧审计响应；已追加的自动退役审计属于合法历史，不应在回滚时删除。若实施期因执行计划新增索引，索引可独立安全降级，不改变业务数据。

## 11. 规划取舍

- 用列表批量投影 + 单影响接口，而不是大而全 workspace API、前端全量拼装或多张统计表。
- 用同一字段描述驱动详情与差异，而不是通用 JSON diff 或人工摘要字段。
- 修正通用审计 Actor 可空契约，而不是在规则页隐藏被删除演员的历史或建立第二套审计表。
- 保持已验证的状态机和删除矩阵；高保真复刻服从权威业务契约，不复制原型冲突动作。
