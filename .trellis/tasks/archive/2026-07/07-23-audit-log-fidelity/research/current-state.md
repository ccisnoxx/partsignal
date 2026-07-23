# 审计日志现状与功能差异

## 1. 调查边界与证据

- 权威契约：`contracts/openapi.yaml:223-237`、`contracts/openapi.yaml:2171-2192`、`contracts/database.md:5-11`。
- 服务端：`backend/app/models/identity.py:69-92`、`backend/app/audit.py:12-62`、`backend/app/routers/identity.py:271-314`、各业务服务的 `append_audit` 调用点。
- 前端：`frontend/src/features/configuration/AuditLogPage.tsx:14-32`、`frontend/src/app/AppLayout.tsx:33-52`、`frontend/src/app/AppLayout.tsx:127-173`。
- 测试和文档：身份管理、发布审核闭环、AI 配置、平台规则现有测试，以及 `docs/GEO多平台内容运营系统方案设计.md`、`docs/GEO系统前后端技术与部署方案.md`。
- 附件原型：原始尺寸 `1581 × 995`，作为已批准视觉与交互规格；未使用 ImageGen。
- 运行态：2026-07-23 只读访问 `http://localhost:5173/audit` 返回 `ERR_CONNECTION_REFUSED`，本地前端未运行。本阶段不为调查启动或修改服务；浏览器验证列入实施验收。

## 2. 功能分类

| 原型能力 | 分类 | 当前事实 | 最小差异 |
| --- | --- | --- | --- |
| `/audit` 路由、管理员入口 | 已存在，可直接复用 | 路由和菜单均存在，前后端都限制为 `ADMIN` | 调整面包屑、页面壳和选中态视觉 |
| 追加式审计表与同事务成功审计 | 已存在，可直接复用 | `audit_logs` 是 PostgreSQL 权威来源；成功审计与业务变更同事务提交 | 保留该不变量 |
| 审计记录禁止更新/删除 | 已存在，可直接复用 | 数据库触发器在 `UPDATE OR DELETE` 前抛出 `55000`，见 `backend/alembic/versions/0001_identity_audit.py:31-41` | 补数据库集成测试，防止迁移漂移 |
| 分页总数 | 后端已存在但前端缺失 | API 支持 `page/page_size` 和 `total` | 页面改为 URL 驱动的服务端分页 |
| 对象类型、对象 ID 筛选 | 后端已存在但前端缺失 | API 仅支持这两个业务筛选 | 纳入统一组合查询 |
| 时间、操作者、模块、动作、结果、请求 ID、关键字筛选 | 需要新增后端/API/索引 | 当前契约没有这些参数 | 新增明确、可组合的服务端查询契约 |
| 自动刷新、手动刷新、重置筛选 | 可由前端实现，但依赖真实查询 | TanStack Query 已存在；页面未实现 | 复用查询缓存，不引入 WebSocket/队列 |
| 详情面板 | 需要新增后端和前端 | 无详情端点，列表直接返回原始 `details` | 新增按日志 ID 的管理员详情投影和右侧面板 |
| 操作者名称、账号类型 | 需要新增 API 投影 | 当前只返回可空 `actor_id` | 按项目既有约定联结当前用户；删除后明确显示“已删除用户” |
| 业务模块 | 业务字段当前缺失 | 现有权威字段只有 `action/target_type` | 写入时增加强类型模块，不从前端猜测 |
| 执行结果、结果说明、机器错误码 | 业务字段当前缺失 | 九类关键业务调用点只写成功；AI 测试/发现把失败状态放在 `details` | 增加持久化结果；失败/拒绝需独立事务边界 |
| 非敏感变更摘要 | 部分存在 | `details` 结构不统一，通常只有新状态、revision 或关联 ID | 对已知字段做服务端安全投影；缺失旧值不反推 |
| 关联入口 | 前后端均缺失 | 无对象类型到路由/可访问状态投影 | 只为已有明确路由做固定映射，不建动态路由框架 |
| 移动端 | 现有壳可复用 | AppLayout 已有 Drawer 和断点 | 桌面还原原型；窄屏详情使用现有 Drawer |

## 3. 用户要求的 12 项差异结论

### 3.1 当前实现与原型的视觉差异

- 当前页面只有标题和单卡片四列表格；原型包含两行筛选器、关键字行、记录工具栏、十列表格、分页和常驻右侧详情栏（`frontend/src/features/configuration/AuditLogPage.tsx:24-31`）。
- 当前审计页沿用管理壳 `220px` 侧栏，原型约 `188px`；`AppLayout` 仅用户管理页使用 `188px`（`frontend/src/app/AppLayout.tsx:127-159`）。
- 当前面包屑为“业务设置 / 审计日志”，原型要求“审计与安全 / 审计日志”（`frontend/src/app/AppLayout.tsx:170-173`）。
- 当前表格横向最小宽度 `900px`、无详情区和分页；原型主列表约 `1035px`、右侧详情约 `315px`、间隔约 `13px`。
- 当前页面没有原型的浅蓝白背景层次、筛选表面、紧凑状态标签、选中行、详情时间线和底部分页密度。

### 3.2 已有及缺失功能

- 已有：管理员入口、服务端分页、总数、对象筛选、成功事件写入、请求 ID、JSONB 详情、加载/空/错误状态、数据库不可变触发器。
- 缺失：绝大多数筛选、稳定排序、真实结果字段、失败/拒绝审计、详情端点、操作者/账号类型/模块投影、结果说明、结构化变更、关联入口、自动/手动刷新、URL 状态和分页控件。

### 3.3 可复用组件、类型和服务

- `AppLayout`、`PageHeader`、`TableRegion`、`AsyncState`、`StatusTag`、Ant Design Table/Select/DatePicker/Switch/Pagination/Drawer。
- 用户管理页的 URL 规范化和分页模式：`frontend/src/features/users/UserManagementPage.tsx:65-87`、`:333-378`。
- TanStack Query 与生成的 OpenAPI 类型；对象历史查询封装见 `frontend/src/shared/api/queryOptions.ts:108-120`。
- `append_audit`、现有 `audit_logs` 表和所有既有 action 字符串继续作为唯一审计体系。

### 3.4 当前权威数据模型

`audit_logs` 当前字段为：UUID `id`、可空 `actor_id`、`action`、`target_type`、字符串 `target_id`、JSONB `details`、`request_id`、UTC `created_at`（`backend/app/models/identity.py:69-92`）。公共契约却把 `target_id` 固定为 UUID（`contracts/openapi.yaml:2171-2183`），服务端也强制 `uuid.UUID(record.target_id)`（`backend/app/routers/identity.py:297-307`），模型与接口形状存在收窄差异。

### 3.5 业务覆盖

九类原型提示的关键操作均存在成功审计调用点；没有统一的失败或账号类型拒绝事件。平台账号只有删除命令，模型虽然有 `is_active`，但没有查到显式启停 API。完整证据见 `research/audit-coverage-matrix.md`。

### 3.6 字段真实来源

- 时间：PostgreSQL `server_default=now()`，UTC。
- 操作者：路由依赖解析的当前启用用户 `actor.id`；列表目前不联结名称或账号类型。
- 动作、对象类型和对象 ID：各服务端成功调用点显式传入。
- 结果：当前无统一字段；多数记录只能证明事务成功提交，AI 测试/发现是局部例外。
- 请求 ID：中间件读取客户端 `X-Request-ID`，缺失时生成 UUIDv4（`backend/app/main.py:51-57`）。
- 变更摘要：调用点提供的 `details`，不是完整快照；多数没有旧值。

### 3.7 不可修改、不可删除

- 应用没有审计更新/删除 API。
- PostgreSQL 的 `audit_logs_append_only` 触发器禁止任意更新和删除，因此不是仅靠前端说明实现。
- 当前测试没有直接验证该触发器；实施需补真实 PostgreSQL 集成测试。

### 3.8 敏感字段机制与风险

- `backend/app/audit.py:12-37` 递归拒绝一组精确键；成功写入与业务事务同回滚。
- 该检查只看键名，不检查值，也未覆盖 `authorization`、`headers`、`secret`、通用 `token`、完整 Prompt、第三方响应等命名；`comment` 等自由文本可携带秘密而不触发。
- 列表当前把原始 `details` 直接作为 `change_summary` 返回（`backend/app/routers/identity.py:297-307`），详情端点不能复用该裸返回方式。
- 最小修复是“写入白名单结构 + 读取再次安全投影”，而不是扩充黑名单后继续返回任意 JSON。

### 3.9 查询、筛选、分页和自动刷新

- API 仅有 `page/page_size/target_type/target_id`（`contracts/openapi.yaml:223-237`）。
- 全局排序只有 `created_at DESC`，同一时间戳没有 `id DESC` 次序；AI 渠道历史已有稳定双键排序，可复用约定。
- 页面固定请求第一页 100 条，无分页控件、无 URL 状态、无刷新开关（`frontend/src/features/configuration/AuditLogPage.tsx:16-21`）。
- 项目没有审计刷新周期配置；规划建议把“启用后 30 秒刷新、页面不可见时暂停”写成显式产品规则，不能藏在未说明常量里。

### 3.10 跨层影响

- 前端：页面、AppLayout 审计壳状态、查询键/选项、生成类型、组件测试、页面样式。
- 后端：审计模型/写入边界、身份查询路由与 Schema、九类关键命令的失败/拒绝边界、请求 ID 校验。
- 契约和数据库：OpenAPI、database contract、Alembic 迁移、查询索引。
- 权限：全局列表和详情仍仅 `ADMIN`；关联对象继续由目标路由二次校验。
- 测试和文档：数据库不可变、脱敏、组合筛选、结果事务、前端交互、Browser fidelity ledger、架构/产品方案同步。

### 3.11 最小实现与验证

最小方案是扩展现有表和现有审计模块，不新增第二套事件框架：持久化模块/结果/安全说明；成功继续同业务事务；经批准的关键命令在回滚后用同一审计模块独立记录失败或拒绝；新增全局列表/详情投影；在现有页面上完成原型结构。验证命令和顺序见 `implement.md`。

### 3.12 需要用户确认的业务未知项

1. **阻塞实施：失败/拒绝覆盖范围。** 推荐本任务只覆盖原型点名的九类关键命令；把所有写路由一次性纳入会显著放大事务、权限和测试范围。
2. 刷新周期没有现有契约；提案为用户开启后每 30 秒刷新，页面隐藏时暂停。
3. 时间边界没有现有契约；提案为 UTC API、北京时区显示、半开区间 `[from, to)`。
4. 操作者历史快照没有现有契约；提案沿用项目当前用户投影：名称/账号类型显示当前目录值，用户缺失时明确标记，不声称是事发时快照。
5. 请求 ID 是相关 ID 而非唯一键；提案校验长度/字符但允许重复。
6. 审计保留期限没有权威规则；本任务不新增归档或删除能力，保持无限追加的当前行为。
7. 后台任务没有用户 actor/request ID 传播契约；本任务只覆盖已核验的同步 HTTP 关键命令，不虚构“系统用户”。

## 4. 关键结构性结论

- **共享不变量确实存在：**成功业务变更与成功审计必须同事务；失败/拒绝要留痕则必须在业务事务回滚后另行提交审计，不能复用当前同事务路径。
- **最小权威所有者：**`backend/app/audit.py` 继续拥有安全写入与敏感边界；全局查询/详情由一个专用审计投影服务拥有，路由只做参数和权限接线。
- **不采用：**前端造事件、从当前对象反推历史、第二张表、事件总线、Outbox、WebSocket、Redis 审计状态、全文搜索服务、通用动态对象路由。
