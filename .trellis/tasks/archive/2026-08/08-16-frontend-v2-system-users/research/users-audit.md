# Frontend V2 System Users 现状审计

## 1. 审计范围与前置证据

本记录只保留会改变 `frontend-v2-system-users` 方案的证据。已审计 Trellis 工作流与相关 specs、Frontend V2 01-09 文档、OpenAPI、identity schema/router/service/integration tests、V1 Users 页面与测试、V2 admin route、Table Kit、相邻列表 route/model/page/strict fixture，以及既有 Phase 7 决策记录。

- 2026-08-16 审计开始时主工作目录位于 `/Users/sc/PycharmProjects/partsignal`，分支为 `main`，业务工作树 clean；`main...origin/main [ahead 234]`，没有落后证据，因此没有 pull。
- `git worktree list` 只有主工作目录；本地和远端均不存在 `codex/frontend-v2-system-users`。
- `docs/frontend-v2/07-migration-plan.md:478` 记录 Phase 6 最终候选完整通过，open P0/P1/P2=`0/0/0`，Phase 6 Exit Gate=`MET`；`:482-486` 规定 Phase 7 先 Users Table + bulk，再 Audit。
- Trellis task `.trellis/tasks/08-16-frontend-v2-system-users/task.json` 已创建且保持 `planning`；未运行 `task.py start`、未创建分支或 worktree。

## 2. 页面、蓝图与 V1 证据

### 2.1 V2 placeholder 与既有原语

- `frontend-v2/src/routes/_app/_admin/system.users.tsx:3-12` 只有路由 metadata 和 foundation 文案，没有 search schema、loader、列表或动作。
- `frontend-v2/src/routes/_app/_admin/route.tsx:21-45` 已提供 loading/error/ADMIN UX boundary；这不是服务端权限替代，但无需再建页面权限框架。
- `frontend-v2/src/design-system/data-table/row-actions.tsx:117-220` 已实现一个 primary、overflow、确认框与焦点返回。
- `frontend-v2/src/design-system/data-table/bulk-action-bar.tsx:19-75` 已实现 `selectedCount=0` 时隐藏、批量确认、清除选择。
- `frontend-v2/src/design-system/data-table/table-shell.tsx:9-20` 已提供可聚焦的表格局部 overflow region；无需新 DataTable。

### 2.2 权威页面蓝图

- `docs/frontend-v2/03-page-and-workflow-blueprint.md:423-436` 固定 Users Table 六列与选择后 BulkActionBar。
- `docs/frontend-v2/04-design-system-and-interaction-spec.md:44-63` 要求 domain 自行组合 Table Kit，禁止万能表格；`:86-120` 规定最多一个 primary、overflow、server revalidation 和 partial failure。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md:97-108` 要求核心列表 URL/router E2E 与 375/768/1024/1440；`:152-166` 要求 production artifact 和未声明 API 拒绝。

蓝图中的 Avatar 不是用户本轮固定列要求，且系统没有 User Detail route；本 Task 使用“Display name + `@username`”主单元，不增加头像数据或假链接。

### 2.3 V1 是行为证据，不是 V2 UI 模板

- `frontend/src/features/users/UserManagementPage.tsx:140-151` 已把 URL 状态映射为服务端 `UserList` 与 export query。
- `:197-251` 已覆盖 create/update/reset/delete/status/bulk/export；`:220-234` 已按每项 revision 发送 bulk 并展示 partial result。
- `:255-257` 当前 selection 绑定 `canonicalSearch:dataUpdatedAt`；V2 将改为更明确的 canonical query + 观测 revision 快照，而不是复制 timestamp 技巧。
- `:301-316` 已消费服务端 action projection；`:387-391` 已按 `primary_task` 选择主动作。
- `:426-459` 已证明短 Dialog/Form 可以承载 create/edit/reset，关闭时销毁；V2 复用自己的 Base UI + RHF/Zod 模式。
- `:296`、`:424` 当前 V1 blocker 指向旧 `/audit?actor_id=`；V2 不复制该链接，未来只交接 `/system/audit?actorId=`。
- `:416-417` V1 根据行 action 客户端禁用 bulk；本轮 V2 不复制此资格推导，两个 bulk 命令始终交给服务端逐项裁决。

结论：创建、编辑、重置、启停、删除、导出和 bulk 已是同一 Users 管理切片中的真实能力。拆分只会留下半成品页面和重复上下文，因此全部纳入本 Task；不纳入用户详情和 Audit 页面。

## 3. OpenAPI 与后端读模型

### 3.1 UserList 合同

- `contracts/openapi.yaml:107-125` 的 `GET /api/v1/users` 已支持 `q/account_type/status/page/page_size`，并声明返回稳定分页与不受筛选影响的全局摘要。
- `contracts/openapi.yaml:164-183` export 已复用 `q/account_type/status`，输出 CSV。
- `backend/app/routers/identity.py:178-197` 把这些参数传给唯一 list query，并使用 `AdminUser`。
- `backend/app/services/identity.py:204-216` 在数据库中组合搜索、角色、状态和稳定排序；`:239-263` 分别查询 total、当前页、动作投影和全局 summary。
- `backend/app/services/identity.py:132-182` 只对整页执行一次 active-admin 统计和一次跨业务引用聚合，没有逐行 SQL。
- 因此非空页面固定为 5 条 SQL（total、rows、active-admin count、business-reference aggregate、global summary），空页为 3 条；次数不随返回行数增长。当前没有固定查询数回归，需要补测试，不需要改读模型。
- `backend/app/schemas/common.py:55-85` 的 `UserOut/UserList` 已直接包含表格、workflow/action、deletion、revision 与 summary 所需事实，没有第二 DTO 的理由。

`UserList.summary` 在 `backend/app/services/identity.py:219-236` 明确是全局实时统计，且 integration `backend/tests/integration/test_identity_management.py:240-268` 证明筛选前后 summary 不变。V2 只以一条紧凑“全局用户摘要”展示五项计数；不称为当前筛选摘要、不重算、不做 dashboard。

### 3.2 权限

- `backend/app/deps.py:108-124` 的 `AdminUser` 和 `assert_account_types` 是服务端权威权限点。
- list/create/export/delete/reset 使用 `AdminUser`；update/bulk 在 router 内调用同一 `assert_account_types`（`backend/app/routers/identity.py:178-329`）。
- integration 已证明 Engineer list `403`（`backend/tests/integration/test_identity_management.py:237`）、delete `403`（`:517-522`）和 audit `403`；但没有用一个回归锁住全部 Users management interfaces。

决定：不改权限模型，只新增参数化 integration，覆盖 list/create/bulk/export/update/delete/reset 对 ENGINEER 均为 403；V2 `_admin` route 只负责可用 UX。

## 4. 九项重点合同审计结论

### 4.1 DELETE 是否缺 `expected_revision`？

是。

- OpenAPI delete 参数只有 `user_id` + CSRF（`contracts/openapi.yaml:206-220`）。
- router/service 均未接收 revision（`backend/app/routers/identity.py:288-306`；`backend/app/services/identity.py:587-636`）。

最小修正：DELETE 增加 required query `expected_revision >= 0`，service 在表锁、行锁和存在性检查后，状态/引用检查前比较 revision，stale 返回 `REVISION_CONFLICT/409`。同步 V1 调用与两套生成类型，不做兼容默认值。

### 4.2 reset-password 是否缺 `expected_revision`？

是。

- `ResetPasswordRequest` 只有 `temporary_password`（`backend/app/schemas/common.py:123-124`；`contracts/openapi.yaml:3449-3454`）。
- service 虽有行锁，但没有 revision 比较（`backend/app/services/identity.py:639-655`）。

最小修正：`ResetPasswordRequest` 增加 required `expected_revision`；行锁后比较，stale 返回 `REVISION_CONFLICT/409`。

### 4.3 DELETE 是否在锁内重检账号状态与业务引用？

是，保留现有实现。

- `backend/app/services/identity.py:595-607` 先持有共享用户表锁和用户行锁，再检查 active 状态与实时业务引用。
- `:613-620` 在 flush 时仍把 FK 竞态映射为明确 `USER_IN_USE/409`。

本 Task 只把 revision 校验插入同一锁内，不改数据库、删除例外或历史保留规则；测试补 stale delete，并保留 active/in-use/session/audit 断言。

### 4.4 reset 后怎样获得 canonical revision，是否返回安全 User？

当前做不到，需要改为返回安全 `User`。

- reset 会设置 `must_change_password`、递增 revision、撤销全部会话（`backend/app/services/identity.py:653-659`），但 router 返回 204（`backend/app/routers/identity.py:309-328`；`contracts/openapi.yaml:221-238`）。
- V2 若只猜 `revision + 1` 或仅 invalidate，会在对话框和 partial UI 间失去命令的 canonical 结果。

决定：reset 成功改为 `200 User`，复用 `present_managed_user` 输出无密码的 actor-aware projection；临时密码绝不进入响应。V1 只适配新 body/状态，不增加第二响应类型。

### 4.5 bulk error code 是否稳定？账号状态是否最终校验？

只完成一半。

- runtime allowlist 当前固定 `NOT_FOUND/REVISION_CONFLICT/LAST_ADMIN_REQUIRED`（`backend/app/services/identity.py:52-54`），但 schema/OpenAPI 的 failure code 是自由字符串（`backend/app/schemas/common.py:149-152`；`contracts/openapi.yaml:3501-3508`）。
- bulk 复用 revision/last-admin 锁内路径（`backend/app/services/identity.py:548-584`），但同状态 ENABLE/DISABLE 会照样递增 revision 并写成功审计（`_update_user_locked:462-515`），不符合“账号状态最终校验”。

最小修正：failure code 改为 typed enum/Literal，增加 `INVALID_STATE_TRANSITION`；仅 bulk 调用共同锁内更新时要求真实状态变化。同状态项作为预期逐项失败，其他项继续 partial success；单用户完整 PATCH 仍可同时编辑资料与状态，不受误伤。

### 4.6 自操作规则是什么？

- reset 自己由 service 明确拒绝为 `VALIDATION_ERROR/422`，要求走自助改密（`backend/app/services/identity.py:647-650`）；`_user_actions` 也不向自己投影 `RESET_PASSWORD`（`:116-119`）。
- 自降级和自停用不是 blanket 禁止；只要不会移除最后一个有效管理员，就与其他用户共用 last-admin 约束（`_update_user_locked:445-460`）。现有 integration 已证明有第二管理员时 self demotion 成功（`backend/tests/integration/test_identity_management.py:803-849`）。
- 自停用成功会撤销自己的活动会话（`backend/app/services/identity.py:516-521`）；自降级后 auth refresh 使 `_admin` route 转 403。

决定：不在前端推导自操作资格。只消费 action token；任何影响当前 actor 的成功响应都触发 auth session refresh。

### 4.7 deletion blocker 如何交接未来 Audit？

- `UserOut.deletion` 对停用、非自己的账号投影 `USER_BUSINESS_HISTORY` count（`backend/app/services/identity.py:158-179`）。
- Audit API 已支持 `actor_id`（`contracts/openapi.yaml:239-264`；`backend/app/routers/identity.py:331-353`）。

本 Task 在 blocker Dialog 中显示事实和 count，但不创建不可达链接。下一独立 Audit Task 接管 canonical `/system/audit?actorId=<user-id>` 并映射 API `actor_id`；在该 route 真正存在前，本页不输出 href/placeholder。

### 4.8 UserList 查询数是否随行数增长？

否，当前实现已批量投影；缺少回归测试。见 3.1 的 5/3 条固定 SQL 推导。新增 PostgreSQL integration 用空、稀疏、密集业务引用页面比较 SQL 数，不为了测试改实现或新增缓存。

### 4.9 ENGINEER 页面和所有 interfaces 是否 403？

页面由 V2 `_admin` boundary 显示保留地址的 403；服务端各路由都经过 ADMIN 检查，代码合同成立，但测试覆盖不完整。新增后端参数化接口 403 测试和 strict fixture 的 ENGINEER direct URL 场景，确保 UI 与 server 两层均有证据。

## 5. 动作 projection 审计

- `user_stage` 只产生 `MANAGE_LOGIN_SECURITY/MANAGE_USER/ENABLE_USER`（`backend/app/services/identity.py:59-65`）。
- `_user_actions` 只产生 `UPDATE/RESET_PASSWORD/ENABLE/DISABLE/DELETE`，并按 actor、last-admin 与引用事实投影（`:108-129`）。
- OpenAPI 对 primary/action token 已是 enum（`contracts/openapi.yaml:3419-3424`）。

V2 model 必须做穷尽解析：

| primary_task | 必须存在的同义 action | 主操作 |
| --- | --- | --- |
| `MANAGE_LOGIN_SECURITY` | `RESET_PASSWORD` | 打开重置密码 Dialog |
| `MANAGE_USER` | `UPDATE` | 打开编辑 Dialog |
| `ENABLE_USER` | `ENABLE` | 启用确认 |

同义 token 从 overflow 去重；其余 action 原序映射。unknown token、重复 token、缺少 primary 同义 action、`DELETE` 与非空 blocker 同时存在、或 deletion 形状与 action 矛盾都抛出明确 projection error，由 route error boundary 显示可恢复错误，不能静默隐藏。

## 6. 最小 contract-first 影响面

需要修改：

- `contracts/openapi.yaml`：delete revision、reset revision + `200 User`、bulk failure enum。
- `backend/app/schemas/common.py`、`backend/app/routers/identity.py`、`backend/app/services/identity.py`：严格实现上述合同与 bulk no-op。
- `backend/tests/unit/test_contract.py`、`backend/tests/integration/test_identity_management.py`：合同、权限、revision、partial/no-op、固定查询数。
- V1 Users 直接消费者/测试/E2E，以及 V1 AI 管理 E2E 中用于准备测试账号的 reset 调用、V1/V2 generated schema。`artifacts/full-project-acceptance/` 下的历史验收探针是不可回写的归档证据，不作为运行时消费者修改。

不需要修改：

- `contracts/database.md`、Alembic、模型表结构、认证模型、权限体系、Redis、部署或依赖。
- `UserList` 响应形状和现有 actor-aware action/deletion owner。

## 7. 风险与停止条件

- DELETE/reset 是共享破坏性合同收紧，必须全仓搜索调用者并让 V1/V2 同一提交完成；禁止 optional revision 或旧 204 分支。
- bulk no-op 新失败码会改变既有测试期望，但它修复的是当前明确缺口；失败仍是 200 partial result，不改变事务模型。
- 临时密码在 409 时可在仍打开的密码输入中保留，以满足“保留当前输入”；关闭/成功后必须卸载表单和 reset mutation，且 mutation `gcTime=0`，不得进入 query cache/URL/log/error/fixture artifact。Users Playwright spec 必须关闭 trace，fixture controller 只记录脱敏元数据，避免 request body 进入失败 trace。
- 若实施发现上述方案必须改数据库结构、认证模型或权限体系，立即停止并回到设计评审；不得用 fallback 或客户端资格判断绕过。

## 8. 审计结论

最小完整交付是一个 contract-first Users 纵向切片：补三处现有命令合同缺口，保持既有单一 `UserList` 与服务端 action owner，做 V1 最小兼容，再用 V2 已有 Table Kit/Dialog/Form 模式完成页面。没有数据库、权限、依赖或通用框架阻塞；当前唯一门禁是用户对规划的明确批准。
