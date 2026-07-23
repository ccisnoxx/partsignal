# 审计日志高保真复刻与审计闭环设计

## 1. 最小可行设计

在现有 `audit_logs` 上补齐少量强契约字段，保留现有 `action` 和 `details`，由同一个审计模块同时支持“当前业务事务内追加”和“业务回滚后独立追加”两种明确事务语义；新增一个全局审计查询/详情服务；前端在现有 `/audit` 页面和 AppLayout 上增量实现原型。除此之外不增加基础设施和通用框架。

复杂度的必要来源只有三项：失败记录必须跨越业务回滚、列表不能裸返回异构 JSONB、十余筛选必须由 PostgreSQL 组合查询。导航、刷新、详情和响应式都复用现有前端机制。

## 2. 已确认不变量

1. PostgreSQL `audit_logs` 是唯一业务审计来源。
2. 现有 `audit_logs_append_only` 触发器继续禁止 `UPDATE/DELETE`。
3. 成功业务状态和成功审计同事务：任一失败则整体回滚。
4. 失败/拒绝审计不允许修改业务状态，必须在原事务回滚后单独提交。
5. 前端不创建事件、不推断结果、不重算历史、不接收原始敏感载荷。
6. `action` 保持现有调用点字符串，是唯一事件标识；模块、中文标签和结果不是第二套事件源。
7. 详情和关联入口不绕过现有目标权限。

## 3. 数据模型

### 3.1 `audit_logs` 变更

| 字段 | 设计 | 原因 |
| --- | --- | --- |
| `business_module` | `VARCHAR(40) NOT NULL` + CHECK | 支持权威模块展示和筛选；新写入在调用点显式提供 |
| `outcome` | `VARCHAR(16) NOT NULL` + CHECK：`SUCCESS/FAILED/DENIED` | 结果不能从 HTTP 状态或摘要猜测 |
| `result_message` | `VARCHAR(500) NOT NULL` | 保存受控、可读且非敏感的结果说明 |
| `error_code` | `VARCHAR(100) NULL` | 失败/拒绝保留稳定机器码；成功为 null |
| `target_id` | 保持 `VARCHAR(100)`，改为可空 | 创建命令失败时对象尚未存在，不能伪造 ID |
| 既有字段 | 保留 | 避免第二张表和破坏对象历史投影 |

`details` 继续保存服务端白名单摘要，不保存完整对象。新写入约定为：

```json
{
  "changes": [
    {"field": "is_active", "before": true, "after": false}
  ],
  "facts": {"revision": 3}
}
```

- `field` 是稳定机器字段；中文标签由前端已知映射展示。
- `before/after` 只在服务端当次锁定对象已真实读取时写入；缺失即省略，不填猜测值。
- `facts` 只允许稳定状态、revision、计数和非敏感关联 ID。
- `result_message/error_code` 使用独立列，避免在异构 JSONB 中查找结果。

### 3.2 强类型所有权

新增聚焦的 `backend/app/audit_types.py`：

- `AuditModule`：真实业务模块值，初始集合为 `IDENTITY`、`PRODUCT_FACTS`、`CONTENT_PLANNING`、`CONTENT_PRODUCTION`、`CONTENT_REVIEW`、`PUBLICATION`、`GEO_OBSERVATION`、`CONFIGURATION`、`FILE_MANAGEMENT`。
- `AuditOutcome`：三个命令结果。
- `AuditEntry`：一次写入所需的 actor、module、action、target、request ID、outcome、message、error code 和安全 details。

这是长参数组和跨模块共享不变量的唯一值对象，不创建接口、工厂或事件层级。ORM 仍存字符串；Pydantic/OpenAPI 使用同值集合。

### 3.3 迁移和历史数据

新增线性 Alembic 迁移（基于实施时当前 head，不修改冻结旧迁移）：

1. 先加可空新列并解除 `target_id` 非空。
2. 用现有 action/target 的已核验集合一次性回填 `business_module`；迁移前查询未知组合，存在未分类记录则显式失败并报告，不写 `OTHER` 猜测值。
3. 一般历史记录回填 `SUCCESS` 和“操作已完成”。该结论来自现有写入只在成功事务中追加的架构。
4. 对权威文档已明确的 AI 测试/发现失败记录精确回填 `FAILED`：`ai_model.tested` 的 `test_status=FAILED` 或 `error_code`、`ai_channel.models_discovered` 的 `error_code`。不对其他 JSONB 模糊推断。
5. 新列设为非空并增加 CHECK；增加 `(created_at DESC, id DESC)` 索引。
6. 降级只移除新增列/索引并恢复 `target_id NOT NULL`；如果存在空 target 的失败创建事件，降级必须拒绝，避免静默丢失审计。

不为旧记录回填 before/after、操作者快照或结果原因。

## 4. 写入与事务边界

### 4.1 同一审计模块，两种提交方式

`backend/app/audit.py` 保留为唯一写入所有者：

- `append_audit(db, entry)`：校验安全摘要后加入调用者当前事务，不 commit。所有成功业务事件和 AI 测试自身的确定结果使用它。
- `commit_audit(entry)`：仅在调用者已显式 rollback 后，用 `SessionLocal.begin()` 把失败/拒绝写入同一表。它复用完全相同的安全校验，不接受业务实体或回调。

两者不是平行审计服务；它们只表达必要的事务差异。禁止给 `append_audit` 增加 `commit=True/False` 隐式开关。

### 4.2 九类关键命令的失败/拒绝

为保持 action、target 和安全摘要显式，九类路由采用局部接线，不使用通用动态路由表：

1. 把账号类型判断抽成纯函数 `assert_account_types(user, allowed)`；现有 `require_account_types` 依赖继续复用它。
2. 经批准的九类 mutation 路由依赖 `CurrentUser` 和现有 CSRF，在 handler 的明确 `try` 边界内先调用纯权限判断，再调用原业务服务。
3. 捕获 `AppError` 后先 `db.rollback()`；`PERMISSION_DENIED` 写 `DENIED`，其他已进入命令的业务错误写 `FAILED`；随后原错误继续向上抛出。
4. 请求体解析、未登录、会话失效、强制改密和 CSRF 在 handler 前失败，不创建业务审计。
5. 数据库/编程异常不被广泛捕获为业务失败；它们继续失败并由访问日志暴露。若独立审计写入失败，不静默吞掉，返回服务器错误且绝不放行业务变更。

每个路由显式给出 action、module、target type/id 和允许的安全结果文案。创建失败的 `target_id=null`；已有对象命令使用路径 ID。原成功 action 不改名。

### 4.3 成功调用点

所有现有 `append_audit` 调用改为显式 `AuditEntry`，至少提供 module、outcome 和 result message；这能防止未来新 action 没有模块或误用成功结果。九类关键调用点额外补真实 changes。AI 测试/发现的现有失败事件显式使用 `FAILED`，不再依靠详情字段解释全局结果。

## 5. 敏感信息设计

### 5.1 写入边界

- `AuditEntry.details` 只接受 `changes/facts` 两个顶级字段和受限 JSON 标量/列表。
- 继续递归阻断现有敏感键，并补齐授权头、通用 token/secret/private key/prompt/response 等明确禁项；键黑名单只是防误用，不替代结构白名单。
- 关键业务调用点只传入已批准字段。Prompt 只记录配置状态/revision；AI 配置只记录字段名、状态、计数和稳定错误码；用户不记录密码、会话或临时密码；发布/GEO 不记录正文、URL Header、截图内容或第三方响应。
- `result_message` 来自 action/错误码的受控中文文案，不直接复制任意异常、SQL 或第三方消息。

### 5.2 读取边界

新增 `backend/app/services/audit_logs.py`，拥有列表/详情查询和安全投影：

- 只返回契约声明的摘要结构，不把 ORM `details` 原样输出。
- 历史旧格式按明确 action 和已批准键投影；未知键忽略，绝不“为了兼容”整包返回。
- 现有平台规则元信息和 AI 渠道历史依赖的安全键继续保留在 `change_summary`，通过测试锁定。
- 列表返回紧凑摘要；详情返回结构化 `changes`、`facts`、结果说明和关联状态。

## 6. 身份、时间与请求 ID

### 6.1 操作者

- 查询 `AuditLog.actor_id -> User`，返回当前 `display_name/account_type`。
- `actor_id=null` 或用户缺失时返回 `actor=null`，前端显示“已删除用户”和“未记录”。
- API 文档明确这是当前目录投影，不是历史身份快照；不增加 actor 快照列。
- 系统/服务账号未建模，本任务不创建占位用户。

### 6.2 时间

- 数据库存储和 API 传输 UTC。
- `created_from` 使用 `>=`，`created_to` 使用 `<`；若 `from >= to` 返回 `VALIDATION_ERROR`。
- 前端 DatePicker 将北京时区输入转换为 UTC，列表/详情使用 `Intl.DateTimeFormat(..., {timeZone: 'Asia/Shanghai'})`。
- 默认时间范围提案为当前北京时间向前 3 天，值在筛选器和 URL 中可见且可清除，不写死原型日期。

### 6.3 请求 ID

- 中间件继续优先使用 `X-Request-ID`，否则生成 UUIDv4。
- 新增边界校验：1-100 个可打印 ASCII 字符，拒绝控制字符；超限返回明确 400，不让审计插入因列长度失败。
- 不加唯一约束；客户端可重复请求 ID 以关联一次业务链路。
- 当前后台任务没有传播契约，保持范围外。

## 7. API 设计

### 7.1 列表

`GET /api/v1/audit-logs`

新增查询参数：

- `created_from`, `created_to`: date-time。
- `actor_id`: UUID。
- `business_module`: `AuditModule`。
- `action`: 现有 action 精确值。
- `target_type`: 精确值。
- `outcome`: `SUCCESS | FAILED | DENIED`。
- `request_id`: 精确值。
- `keyword`: 1-100 字符，搜索 target ID 和白名单摘要标量。
- `page`, `page_size`: 沿用现有，`page_size <= 100`。

`AuditLogListItem` 包含原型表格需要的字段：

- `id`, `created_at`, `actor`, `business_module`, `action`, `target_type`, nullable `target_id`, `outcome`, `request_id`。
- `change_summary` 保留为服务端安全投影，兼容现有 AI/规则页面；不含结果说明和完整详情。

筛选为 AND 组合，单值参数内部不猜测别名。时间、action、对象、outcome、request ID 和 actor 都直接作用于 SQL；模块是持久字段。

### 7.2 详情

`GET /api/v1/audit-logs/{audit_log_id}`

返回 `AuditLogDetail`：列表字段 + `changes`、`facts`、`result_message`、nullable `error_code`、`related_entry`。

`related_entry` 只包含：

- `status`: `AVAILABLE | MISSING | UNSUPPORTED`。
- `kind`: 已知目标类型。
- 构造路由所需的真实 ID/父级 ID；没有明确现有路由则为 `UNSUPPORTED`。

后端只做固定对象存在性/父级查询，不返回任意 URL。前端使用一个小型固定映射生成现有路由，例如内容、发布、产品、平台/规则等；目标页面继续鉴权。不得实现基于表名或 target type 的通用动态路由。

### 7.3 操作者和筛选选项

- 操作者复用管理员已有用户列表的服务端搜索，不新建第二份身份 API；已删除 actor 仍可通过日志中已选值查询，但不出现在新选择器列表。
- 模块选项来自 OpenAPI 枚举。
- 动作和对象类型采用 `GET /api/v1/audit-logs/filter-options` 返回数据库当前存在的 distinct action/target type，管理员权限相同、值只来自真实记录；不把 action 硬编码成第二套事件列表。前端中文标签只对已知 action 做展示映射，未知值原样显示。

## 8. 查询与索引

### 8.1 查询形状

- 基础查询和 count 使用同一组 SQLAlchemy 条件。
- 排序 `created_at DESC, id DESC`，offset/limit 沿用项目现有分页契约。
- 关键字只 OR 搜索 `target_id` 和安全白名单路径；不做 `details::text ILIKE`。
- 列表 actor 使用一次外联/批量投影，避免逐行查询。

### 8.2 索引策略

必需索引：

- 保留 `ix_audit_logs_target_created_at(target_type, target_id, created_at DESC)`。
- 新增 `ix_audit_logs_created_id(created_at DESC, id DESC)`，支撑默认全局稳定分页。

候选索引在代表性数据量和真实组合筛选上用 `EXPLAIN (ANALYZE, BUFFERS)` 决定：

- `(request_id, created_at DESC)`。
- `(actor_id, created_at DESC, id DESC)`。
- `(business_module, created_at DESC, id DESC)`。
- `(action, created_at DESC, id DESC)`。
- `(outcome, created_at DESC, id DESC)`。

不一次性全部创建；只把能消除已观察慢扫描的最小集合写进迁移和 database contract。关键字性能不足时先要求显式时间范围，不引入新 PostgreSQL 扩展或搜索服务。

## 9. 前端设计

### 9.1 状态所有权

- 服务端状态：TanStack Query；新增全局列表、详情和 action 选项 query keys/options。
- URL：时间、actor、module、action、target type、outcome、request ID、keyword、page、page size。
- 局部状态：自动刷新开关、当前选中日志 ID、窄屏 Drawer 开关。
- 不新增 Context、全局 Store 或包装单个 query 的自定义 Hook。

URL 解析沿用用户管理页模式：白名单枚举、长度限制、正整数解析、canonical URL；筛选变化重置到第 1 页。非法参数被规范化移除，不转换成另一个业务值。

### 9.2 组件边界

- `AuditLogPage.tsx`：页面状态、查询、筛选、表格、分页和详情选择。
- `AuditLogFilters.tsx`：仅负责原型筛选表单和受控值；不发请求、不拥有业务默认。
- `AuditLogDetailPanel.tsx`：展示详情、变化、结果和关联入口；桌面 aside 与移动 Drawer 复用同一内容。
- 若实现后单文件仍清晰，可把筛选和详情保留在页面文件；不为满足目录形式提前拆分。

共享组件只复用 `TableRegion/AsyncState/StatusTag/PageHeader`。扩展 `StatusTag` 的 `SUCCESS/FAILED/DENIED` 语义映射，不创建页面专用 Tag 系统。

### 9.3 AppLayout 与视觉

- 增加 `isAuditLog` 路由状态：桌面侧栏宽度对齐原型约 `188px`，面包屑显示“审计与安全 / 审计日志”，导航仍使用现有唯一菜单定义。
- 不复制 AppLayout、不创建审计专用全局导航。
- 页面 CSS 使用现有 `theme.ts/global.css` 语义变量；具体像素、网格和状态见 `research/visual-spec.md`。
- 详情关闭时 grid 改为单列；详情打开时主列 `minmax(0,1fr)` + 约 `315px`。

### 9.4 刷新

- `refetchInterval` 仅在开关开启且 `document.visibilityState === 'visible'` 时返回 30 秒，否则 false。
- 使用 React Query 替换响应，不维护第二份 items 数组。
- `placeholderData`/已有数据保持表格稳定；刷新按钮用 query `isFetching` 显示状态。
- 页面隐藏/显示监听只服务本页且在 effect 清理；不提取全局 Hook，除非实施时发现第二个真实消费者。

## 10. 兼容、回滚和失败模式

- OpenAPI 为显式版本内演进：更新现有 AuditLog schema 和生成类型，现有对象历史消费者同步改用新字段；不增加旧/新双端点或兼容别名。
- 旧 `details` 由服务端安全投影兼容；未知键丢弃，不裸回退。
- 迁移回填前验证 action/module 组合，不能分类则停止迁移。
- 独立失败审计若写入失败，不吞异常；原业务事务已回滚，系统返回服务器错误并保留访问日志 request ID。
- 详情目标已删除时只返回 `MISSING`；不得因此删除或改写审计。
- 降级遇到 nullable target 的记录必须拒绝，要求备份或前向修复，不删除失败历史。

## 11. 未采用方案

| 方案 | 不采用原因 |
| --- | --- |
| 前端根据 HTTP 状态生成失败记录 | 前端不是审计权威，且无法保证事务和身份真实性 |
| 第二张失败审计表 | 形成第二来源并破坏统一查询/不可变约束 |
| 中间件记录所有错误 | 缺少准确 action/target/安全摘要，容易把认证和解析噪声误作业务事件 |
| 更新一条 PENDING 审计为终态 | 违反 append-only |
| Outbox/事件总线 | 当前同步模块化单体和九类命令不需要该复杂度 |
| `details::text` 全文检索 | 会扫描未批准载荷并放大敏感泄露风险 |
| actor 历史快照 | 现有项目采用当前目录投影，需求未批准新增身份快照 |
| 通用 target type 动态路由 | 跨模块耦合和权限不可控；固定映射足够 |

## 12. 已确认实施边界

用户已于 2026-07-23 确认“九类关键命令补齐失败/拒绝，其他写命令后续扩展”。本设计不再有未决产品问题；在用户评审最终规划摘要并明确批准进入实施前，仍不修改契约、数据库、权限依赖或业务调用点，也不执行 `task.py start`。
