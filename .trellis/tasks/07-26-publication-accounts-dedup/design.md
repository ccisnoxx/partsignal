# 技术设计

## 1. 最小可行设计

不新增账号凭据模型、发布策略层或重复内容表。继续以现有 `PlatformAccount`、`PublicationRecord` 和追加式 `PublicationStatusEvent` 为唯一业务来源：

- 给可编辑的 `PlatformAccount` 补齐 revision、规范化唯一索引和编辑/启停命令。
- 账号的具体平台归属保持不可变；同平台多账号继续由多行 `PlatformAccount` 表达。
- 用一个发布服务内部函数统一执行“平台 + 内容哈希”锁和冲突判断，创建登记与 `mark-published` 两条写路径复用。
- GEO 问题库只移动前端路由和导航，不修改 QueryTopic 契约或数据。

## 2. 数据与契约

### 2.1 PlatformAccount

新 revision `0026_publication_account_dedup`：

- `platform_accounts.revision INTEGER NOT NULL DEFAULT 0`
- `CHECK (revision >= 0)`
- `CHECK (length(btrim(label)) > 0)`
- `CHECK (length(btrim(account_identifier)) > 0)`
- 唯一表达式索引：
  `UNIQUE (platform_profile_id, lower(btrim(account_identifier)))`

迁移先检查空标签、空标识和规范化重复组；发现异常时以 `55000` 明确失败，不能选择一条保留或删除历史。预检通过后安全地 `btrim` 既有标签与标识，再创建约束和索引。大小写原值保留用于界面展示。

OpenAPI / Pydantic：

- `PlatformAccountCreate`: `platform_profile_id`, `label`, `account_identifier`
- `PlatformAccountUpdate`: `label`, `account_identifier`, `expected_revision`
- `RevisionRequest`: 复用现有通用 `{expected_revision}` 作为启停请求
- `PlatformAccount`: 增加 `revision`

接口：

- `PATCH /api/v1/platform-accounts/{platform_account_id}`
- `POST /api/v1/platform-accounts/{platform_account_id}/enable`
- `POST /api/v1/platform-accounts/{platform_account_id}/disable`

工程师和管理员可创建、编辑、启停；管理员继续独占物理删除。所有修改按“锁具体平台行 → 锁账号行 → 校验 revision/唯一性 → 写审计 → 提交”的顺序执行。平台归属不进入更新载荷。

重复标识使用稳定错误 `409 PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`。服务端保存前只做 `strip()`，比较与数据库索引统一使用 PostgreSQL `lower(btrim(...))`。审计只记录变化字段和平台/修订号，不记录手机号、持有人或完整运营账号标识。

### 2.2 重复公开发布

发布身份键：

```text
publication:<platform_profile_id>:<content_hash>
```

服务内部共用一个门禁：

1. 使用现有 `pg_advisory_xact_lock(hashtextextended(:key, 0))` 获取事务锁。
2. 查询同平台、同 `PublicationRecord.content_hash`、排除当前记录后的其他发布记录。
3. 任一记录存在 `PUBLISHED | VERIFIED` 状态事件，返回 `409 DUPLICATE_PLATFORM_CONTENT`。
4. 没有公开历史，但存在当前状态不为 `REJECTED` 的记录，同样返回冲突。
5. 只有全部既有尝试均为未公开 `REJECTED` 时允许继续。

调用位置：

- `create_manual_publication`：保留原幂等键锁和重放判断；解析锁定平台与内容哈希后，再执行发布身份门禁，随后创建记录。
- `command_publication(command="mark-published")`：锁定当前记录和任务后，在写入实际标题、URL、附件及 `PUBLISHED` 事件前执行同一门禁。

数据库仍保存全部被拒绝尝试和公开历史，不增加可变“已发布哈希”汇总列或缓存。Redis 不参与判重。

## 3. 前端边界

### 3.1 路由和导航

- 新增 `/observations/topics`，渲染独立 `GeoTopicsPage`。
- GEO 导航顺序：观测记录、分析洞察、GEO 问题库。
- `/settings` 页面只维护发布账号；保留 `tab=accounts` 查询参数，以兼容当前内部链接和定向恢复入口，但不再渲染 Tabs。
- 移除 AppLayout 对 settings topics/accounts 双 Tab 的特殊选中逻辑。
- 缺账号链接固定为：
  `/settings?tab=accounts&platform_profile_id=<row.platform_profile_id>`。

不保留旧 `/settings?tab=topics` 的兼容页面；内部导航和文档全部切换到新路由。

### 3.2 账号页面

- 页面标题改为“发布账号”，字段文案改为“运营账号标识（内部）”。
- 说明允许“平台用户名”或“注册手机号 + 持有人”，并明确不保存密码、Cookie、令牌。
- 复用现有表格和更多操作菜单，增加编辑、停用/启用；删除继续只对管理员显示。
- 编辑 Modal 只包含业务标签、运营账号标识和隐藏 `expected_revision`；平台只读展示。
- 所有成功修改失效 `queryKeys.platformAccounts.all`，不新增全局状态。

### 3.3 人工发布

- 现有单选账号 `Select` 保持不变。
- 在字段说明中显示“本篇文章只能选择一个账号”。
- 服务端冲突通过现有错误组件原样显示，不在前端复制判重状态机。

## 4. 数据流和权威所有者

```text
账号表单
→ OpenAPI 请求
→ publication 服务行锁/revision/唯一校验
→ platform_accounts + audit_logs
→ 候选查询只投影启用账号
→ Drawer 单选一个 platform_account_id
→ 发布服务按平台+内容哈希 advisory lock
→ publication_records + publication_status_events
```

- 账号规范化与唯一性：PostgreSQL 索引最终权威，服务提供明确业务错误。
- 发布重复判断：发布服务统一函数权威，追加式状态事件提供“曾公开”事实。
- 界面只投影服务端状态，不维护重复账号或重复文章集合。

## 5. 兼容、迁移与回滚

- 历史 `PlatformAccount.id`、发布外键和账号展示原值保留；只去除既有两侧空白。
- 已存在的规范化重复账号会阻断迁移，部署前必须人工确认并通过现有引用规则处理，迁移不自动合并。
- 既有重复发布历史不回填、不删除；新门禁只约束后续写命令。若已有多条进行中记录，必须先把多余记录显式拒绝，才能公开其中一条。
- downgrade 可删除新索引、检查约束和 revision 列；不会删除账号或发布历史。已升级代码不能在 downgrade 后继续运行。

## 6. 取舍

- 不增加账号凭据加密列：本任务只保存运营识别文本，不保存认证秘密；手机号属于内部个人数据，因此限制在已认证工作台并禁止进入日志/审计详情。
- 不增加发布哈希登记表或部分唯一索引：允许多个被拒绝历史与一次有效重试，单表唯一约束无法表达该状态历史规则；共用服务门禁加 PostgreSQL事务锁是最小正确机制。
- 不在候选查询复制完整判重逻辑：候选仍表达批准内容和可用账号，写入门禁是最终权威，避免出现第二套状态判断。
