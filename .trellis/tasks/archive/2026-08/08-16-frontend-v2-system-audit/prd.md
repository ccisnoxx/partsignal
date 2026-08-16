# Frontend V2 System Audit

## Goal

实现 ADMIN-only 的 `/system/audit`：以服务端筛选和稳定分页的七列 Audit Table 为主，整行按需打开只读安全详情；1280px 及以上使用右侧 Detail Pane，较窄视口使用现有 Sheet。页面必须可通过 canonical URL 恢复筛选与 `logId`，不请求 Users 或业务对象详情，不暴露审计原始 JSON、`change_summary` 或任何敏感值。

## Background

- 本 Task 是 Frontend V2 Phase 7 的第二个独立任务；`frontend-v2-system-users` 已归档并合入 `main`。
- Users 删除 blocker 已预留 `/system/audit?actorId=<user-id>` handoff，本 Task 负责补齐入口。
- 现有 Audit API 基础完整，但 list 仍携带 `change_summary`，detail schema/value shape 过宽，read allowlist 与实际写入已漂移，未知结构会静默过滤；必须先做最小 contract-first 收紧。
- 规划批准后才允许运行 `task.py start` 并创建唯一临时分支 `codex/frontend-v2-system-audit`。不 push、不建 PR，提交前另行展示 commit plan 并等待确认。

## Requirements

### R1. ADMIN-only route 与 canonical URL

- `/system/audit` 位于现有 `_admin` route boundary；ENGINEER 页面访问和 list/filter-options/detail 三个 API 均必须真实返回 403。
- canonical URL 至少拥有 `page/pageSize/createdFrom/createdTo/actorId/module/action/targetType/targetId/outcome/requestId/keyword/logId`，只按批准的一一映射生成 API snake_case。
- direct URL、refresh、Back、Forward 恢复列表筛选和选中详情；canonical correction 使用 replace，用户交互使用 push。
- 默认时间范围为北京时间语义的近三天，URL/API 保存 timezone-aware ISO instant；服务端半开区间为 `[created_from, created_to)` 且要求 `created_from < created_to`。
- 搜索、筛选、分页和稳定排序全部由服务端执行；筛选变化通常回到 page 1，server-known 越界页规范到最后有效页。

### R2. 固定七列 Audit Table

- 固定列：时间、操作者、模块、动作、对象、结果、Request ID。
- 没有操作列，不显示“查看详情”按钮，不通过 `target_type` 猜链接。
- 整行是唯一详情 trigger，支持 pointer、Enter、Space、清晰 focus 与 selected state；关闭、Escape 或 history 导致详情关闭后焦点返回触发行。
- actor 缺失时显式显示“用户已删除/未记录”；不得请求 Users 补 actor。
- 375、768、1024、1440 四档均可操作，页面根无横向 overflow；TableShell 的局部 overflow 可以保留。

### R3. 独立 server queries 与可恢复状态

- list 首屏不得逐行请求 detail；detail 只在 `logId` 存在时请求 `GET /api/v1/audit-logs/{audit_log_id}`。
- action/targetType 只来自 filter-options；module/outcome 只来自 OpenAPI enum；不得从当前页 rows 拼选项。
- list、filter-options、detail 使用窄且稳定的独立 query keys；选择详情不改变 list key。
- loading、empty、filtered-empty、initial error/retry、background error/retry、filter-options error 和越界页均可恢复。
- 不增加自动刷新、polling、SSE、WebSocket 或手动“同时刷新所有内容”的隐藏 waterfall。

### R4. Desktop Pane 与 adaptive Sheet

- `min-width:1280px` 在 table 右侧显示只读 Detail Pane；375/768/1024 使用现有 Base UI Sheet。
- 同一个 URL `logId` 和同一个 detail query 驱动两种容器，切换 viewport 不关闭或复制选择状态。
- valid direct `logId` 即使不在当前页也可独立读取；404/403/projection error 在详情容器内可恢复，列表保持可用。

### R5. 详情内容与相关对象

- 详情必须展示时间、操作者、模块、动作、对象类型/ID、结果、Request ID、`result_message`、`error_code`、`changes`、`facts`、`related_entry`。
- 只消费 Audit Detail，不请求业务对象详情补装内容。
- `AVAILABLE/MISSING/UNSUPPORTED` 使用不同文案；只有 server `kind/parent_id` 与现有 V2 route 有精确映射时才提供链接。
- `primary_task` 只允许 `VIEW_LOG_DETAIL`；未知 token 显式投影失败。
- Audit 始终只读，无 mutation、available actions 或业务命令。

### R6. 服务端安全投影

- `AuditLogList` 不再携带七列表格不消费的 `change_summary`；保持唯一 `AuditLog` item，不增加第二 DTO。
- `facts` 与 change before/after 只允许 null/string/number/boolean 或这些 scalar 的一维 list。
- 九个 AuditModule 的 fact/change allowlist 必须覆盖当前 retained write sites，并由写/读共享一个 registry。
- 新写入的未知 key/value shape 在 audit write boundary 失败；历史 row 在 Detail read 返回不泄漏 key/value 的结构化 `AUDIT_PROJECTION_FAILED`，不得静默过滤或 raw JSON fallback。
- List 不读取 details；坏历史 detail 不拖垮列表首屏。
- keyword 只搜索批准的 metadata/current actor fields，不搜索 `details::text` 或 JSON facts。

### R7. 敏感信息边界

- List、Detail、DOM、query key、console、fixture artifact、trace 和错误信息不得出现 API Key、password/hash、session/CSRF token、Header value、Provider 完整配置、Markdown 正文或不可变业务 snapshot 原文。
- 前端只做严格 shape/key projection，不以敏感词 blacklist 代替服务端正向 allowlist。
- fixture 使用 secret sentinel 模拟原始不安全数据，但 sentinel 不得进入 HTTP response、controller records、DOM、console、error 或 trace；未声明 API/非预期 HTTP/browser error 必须使 E2E 失败。

### R8. 最小公共 Audit owner 与兼容

- global Audit list/filter/detail query、detail query key、安全 value/key projection 和详情内容只能有一个最小 V2 owner。
- AI Channel Runtime 复用相同 detail query/renderer；channel logs list/workspace/handoff 继续留在 Configuration。
- 移除 shared list `change_summary` 后同步适配 V1 generated types/fixtures 和 V2 AI Runtime；不得引入 optional compatibility field、双分支或第二套 Audit DTO。
- Users blocker 只增加 actorId link，不请求 Audit。

### R9. Contract/backend/data boundary

- 合同变化遵循 `contracts/openapi.yaml` → runtime schema/service → generated V1/V2 types → consumers/tests 顺序。
- 保持 PostgreSQL audit table、append-only、retention/deletion exception、权限模型和历史数据不变。
- list 保持固定查询次数和 actor outerjoin；filter-options 保持排序、去重和固定次数；detail 每次最多一个明确 related lookup。
- 若需要数据库 schema/history rewrite 或权限变化才能满足要求，停止并报告。

## Acceptance Criteria

- [ ] AC1：ADMIN 可从导航进入 `/system/audit`；ENGINEER 页面及三个 Audit GET 均被最终 403。
- [ ] AC2：URL 覆盖全部批准字段并准确映射 snake_case；invalid/blank/date-range/page 越界显式 canonicalize，direct/refresh/Back/Forward 恢复。
- [ ] AC3：固定七列表格无操作列/详情按钮，row click/Enter/Space 打开详情，关闭/Escape/history 后返回触发行焦点。
- [ ] AC4：1280+ 使用右 Pane，375/768/1024 使用 Sheet；四档无页面根 overflow。
- [ ] AC5：list/filter-options/detail query 独立；首屏无逐行 detail、无 Users、无业务 detail，详情严格 lazy GET。
- [ ] AC6：loading、empty、filtered-empty、error/retry、filter-options error、越界页与 valid detail 404/projection error 都可恢复。
- [ ] AC7：详情完整展示批准字段，安全处理 primitive/null/一维 list，unknown key/value/object/nested shape/primary token 显式失败，无 raw JSON/change_summary dump。
- [ ] AC8：related AVAILABLE/MISSING/UNSUPPORTED 清楚区分，仅精确稳定 route 产生 link。
- [ ] AC9：OpenAPI/runtime/generated types 移除 list `change_summary` 并收紧 `AuditSafeValue`；写/读 allowlist 共用且覆盖当前 retained writes。
- [ ] AC10：keyword 只搜索批准 metadata/current actor fields；list/filter-options/detail 权限、稳定排序、时间半开区间、deleted actor 和固定 SQL 有 PostgreSQL integration 证据。
- [ ] AC11：AI Channel Runtime 复用 global detail owner且兼容回归通过；Users blocker link 进入 actorId filter但 Users 不发 Audit 请求；V1 shared contract 兼容通过。
- [ ] AC12：strict production fixture 拒绝未声明 API/浏览器错误，secret sentinel 不出现在 response、DOM、console、error、query key、fixture records 或 trace artifact。
- [ ] AC13：代码、OpenAPI、database contract、Trellis specs 与 V2 02/03/05/07/08/09 文档一致；无数据库 migration、依赖、mutation、auto refresh 或通用 framework。

## Planning Gate（本轮）

- [x] PG1：创建 Trellis Task 并保持 `planning`。
- [x] PG2：完成代码/合同/V1/V2/测试审计，并记录 14 项重点结论与 file:line 证据。
- [x] PG3：完成可 review 的 `prd.md`、`design.md`、`implement.md`，区分 Required 与 Optional validation。
- [x] PG4：未运行 `task.py start`、未创建分支、未修改业务代码。

## Out of Scope

- Audit mutation、删除、编辑、重跑、export、操作列或行内详情按钮。
- 自动刷新、polling、SSE、WebSocket。
- Users join、业务对象 detail join、按 target type 猜全量路由、恢复原始 snapshot。
- 通用 Audit/Timeline/JSON Viewer/DataTable framework、新依赖。
- 数据库 migration、历史数据重写、append-only/permission 改造。
- Phase 7 管理员权限完整 real-stack E2E、Phase 7 抽象回顾、Phase 8 Workbench。
- 无关 V1 重构、pull、push、PR 或其他分支处理。

## Blocking Questions

当前无产品决策问题；实施授权仍被 planning approval gate 阻挡。若用户批准本规划，下一步才运行 `task.py start` 并创建唯一临时分支。
