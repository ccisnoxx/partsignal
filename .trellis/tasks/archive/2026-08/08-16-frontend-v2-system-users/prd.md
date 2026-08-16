# Frontend V2 System Users

## Goal

将 Frontend V2 的 `/system/users` foundation placeholder 替换为完整的 ADMIN-only Users Table，复用既有 V2 页面与交互原语，消费服务端权威 `UserList`、动作投影和 revision 合同，交付可恢复、可访问、不会泄露临时密码的用户管理体验。

## Background

- 本 Task 是 Frontend V2 Phase 7 的第一个独立任务；Phase 6 Exit Gate 已在当前权威迁移记录中判定为 `MET`。
- 规划已获用户批准；实施在唯一临时分支 `codex/frontend-v2-system-users` 中进行，不扩大业务范围。
- 实施阶段获准使用唯一临时分支 `codex/frontend-v2-system-users`，但必须等待本轮规划获得新的明确批准。
- 现有 backend、OpenAPI 和 V1 页面是行为证据；V2 不机械复制 Ant Design 页面，也不新增通用 Admin CRUD、DataTable、Bulk framework 或 Action Registry。

## Requirements

### R1. ADMIN-only 列表与 canonical URL

- `/system/users` 仅允许 ADMIN 使用；ENGINEER 直接访问页面及所有用户管理接口必须由服务端拒绝为 403。
- canonical URL 至少拥有 `q`、`accountType`、`status`、`page`、`pageSize`，并分别映射 API 的 `q`、`account_type`、`status`、`page`、`page_size`。
- 搜索、角色筛选、状态筛选、分页与 CSV export 均由服务端执行；direct URL、refresh、Back、Forward 恢复同一列表。
- 页面只消费 `UserList`，不得逐行请求、客户端 join、重算 summary 或权限；审计并决定是否把 `UserList.summary` 作为当前查询列表的紧凑摘要，不新增 dashboard。
- loading、empty、filtered-empty、error/retry、越界页必须可恢复。

### R2. 固定表格与响应式行为

- 固定列为：用户（Display name + `@username`）、角色、状态、登录安全、创建时间、操作。
- 操作列每行最多一个 Primary + overflow；375、768、1024、1440 四档均可用，页面根不得横向溢出。
- Dialog、overflow、表格与批量操作满足键盘行为及焦点恢复要求。

### R3. 服务端动作投影

- primary 只由 `primary_task` 的 `MANAGE_LOGIN_SECURITY`、`MANAGE_USER`、`ENABLE_USER` 决定。
- overflow 只消费 `available_actions` 的 `UPDATE`、`RESET_PASSWORD`、`ENABLE`、`DISABLE`、`DELETE`。
- 不根据 `is_active`、`account_type`、`must_change_password` 或当前操作者角色自行推导动作资格。
- unknown token、重复动作或矛盾 projection 必须显式失败；同一动作不得同时出现在 primary 与 overflow。
- 当前没有 User Detail route；不得创建查看详情、假链接、placeholder 或 `/system/audit` 页面。

### R4. 单用户管理动作

- 规划必须明确是否在本 Task 纳入：新增用户、编辑 `display_name/account_type/status`、重置临时密码、删除符合条件的停用用户、按服务端筛选导出 CSV；若拆分，必须给出可 review 的明确理由，不得静默删除已有核心管理能力。
- 创建、编辑、重置密码等短流程优先复用既有 Dialog/Form pattern。
- 启停、删除、重置密码必须说明会话撤销与不可恢复影响。
- 409 保留当前表单或确认上下文，禁止自动重放。
- 不添加客户端 last-admin 资格判断；服务端是 revision、账号状态、至少一个有效管理员及删除资格的最终权威。

### R5. 批量状态操作

- 仅 `selection > 0` 时显示 `BulkActionBar`，内容为 `N selected / 启用 / 停用 / 清除选择`。
- selection 是页面局部临时状态，不进入 URL；必须绑定当前 canonical 查询窗口与观测到的 user revision，不能跨筛选、分页或后台刷新误用旧 revision。
- bulk request 为每项发送 `user_id` 和 `expected_revision`；批量停用必须确认。
- partial success 逐项展示成功数，以及失败项的 username、code、message；不得伪装为全部成功。
- 设计必须明确响应后成功项、失败项和 selection 的保留/清除规则。

### R6. 临时密码与敏感信息

- 创建用户和重置密码的 `temporary_password` 仅存在于对应 mutation 生命周期。
- 密码不得进入 query cache、query key、日志、错误详情、DOM 残留、测试快照、fixture artifact 或持久化状态。
- Dialog 关闭或成功结束后销毁敏感表单。
- 不显示 password hash、session token、CSRF token 或其他凭据。

### R7. 合同审计与最小 contract-first 修正

- 审计 delete/reset-password 的 `expected_revision`、删除命令锁内重校验、reset 后 canonical revision、bulk error code 稳定性、自操作规则、deletion blockers audit handoff、UserList 查询数及 ENGINEER 403。
- 若现有合同不足，允许 contract-first 同步调整 `contracts/openapi.yaml`、backend identity owner、V1/V2 generated types 与相关测试，只补 Users Table 和当前命令的最小真实缺口。
- 不添加兼容字段、silent fallback、客户端权限判断或第二套 User DTO。
- 若满足需求必须改变数据库结构、认证模型或权限体系，停止并报告，不进入实施。

## Acceptance Criteria

- [x] AC1：planning audit 用 `file:line` 或命令证据说明 placeholder、V1、backend/OpenAPI 与 V2 蓝图的差距，并回答八项重点合同问题。
- [x] AC2：规划明确 in-scope/out-of-scope、精确文件责任、component hierarchy，以及 URL、Query、Form、selection、mutation 的唯一 owner。
- [x] AC3：规划覆盖固定列、`UserList.summary`、所有列表状态、canonical URL/API 参数映射和服务端分页筛选。
- [x] AC4：规划给出 primary/overflow token 映射、unknown/重复/矛盾 projection 的显式失败策略，不新增详情或 audit placeholder。
- [x] AC5：规划给出单用户动作、revision/409/cache invalidation matrix、temporary password 生命周期和 deletion blocker handoff。
- [x] AC6：规划给出批量选择边界、每项 revision payload、停用确认、partial-success 展示及响应后的 selection 规则。
- [x] AC7：规划列出最小 backend/OpenAPI 变化；若无需变化，给出代码和合同证据。
- [x] AC8：`implement.md` 区分 Required 与 Optional validation，列出准确命令，并覆盖用户要求的 unit/integration/generated/lint/typecheck/build/contract/diff 条件分支。
- [x] AC9：Playwright 计划覆盖 strict production artifact、四档 viewport、页面根无横向溢出、键盘/焦点及未声明 API、console/page/request failure 拒绝。
- [x] AC10：规划列出风险、停止条件、未来 `/system/audit?actorId=...` handoff，以及 commit、归档、fast-forward 合入 main、删除临时分支计划。
- [x] AC11：规划阶段的 `prd.md`、`design.md`、`implement.md` 已自审，Task 在用户批准前保持 `planning`，且当时未启动实施。

## Out of Scope

- `/system/audit` 页面、Audit Detail Pane/Sheet、用户详情页或 Audit placeholder。
- 权限/角色体系重构、OAuth、SSO、邀请邮件、头像上传、自定义角色或权限矩阵。
- 数据库 migration、认证模型变化、权限体系变化。
- 通用 Admin CRUD framework、新 DataTable、Bulk framework 或 Action Registry。
- Phase 7 完整管理员真实栈 E2E、Phase 7 抽象回顾、无关 V1 重构。
- 与本 Task 无关的远程分支处理、pull、push 或 PR。

## Blocking Questions

当前无用户决策问题；实施未引入数据库、认证模型或权限体系变化。
