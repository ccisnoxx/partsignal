# Frontend V2 Platform Workspace Accounts

## 1. Goal

在 Core 已交付的 `/settings/platforms/$platformId?tab=accounts` 中补齐发布账号管理闭环：创建、编辑、启停、删除、blocker、revision conflict、移动端动作和精确 cache invalidation。服务端继续拥有权限、唯一性、状态和并发权威。

本 Task 是父 Task `frontend-v2-platform-workspace` 的第二个子 Task。计划分支为 `codex/frontend-v2-platform-workspace-accounts`；只有 Core 已合入 `main` 且用户批准本子 Task 最新规划后才可创建。

## 2. Hard Dependency

- `frontend-v2-platform-workspace-core` 必须完成 Required validation、提交、Trellis 归档、fast-forward 合入 `main` 并删除其临时分支。
- 本 Task 必须从更新后的干净 `main` 创建唯一分支，不能从 Core 临时分支派生或并行开发。
- 复用 Core 的 route、Detail、URL tabs、Accounts read query、fixture 和 page owner；不得创建第二 route、第二 Account List 或兼容层。

## 3. In Scope

### 3.1 Account action projection

- 行级 `primary_task / workflow_stage / available_actions / deletion / revision` 继续由现有 PlatformAccount projection 权威提供。
- 当前真实角色为 ADMIN、ENGINEER：两者可 UPDATE/ENABLE/DISABLE，仅 ADMIN 获得 deletion/DELETE。
- 创建账号按稳定 action spec 属于页面级 create action，不新增资源 `CREATE` token。当前全部真实已认证角色都是 ADMIN/ENGINEER，既有 create endpoint 均允许；前端不使用 `isAdmin`。
- 平台停用时，行级 projection 保持 `PLATFORM_DISABLED / HANDLE_PLATFORM`，既有账号仍可 UPDATE 和启停；create POST 继续由服务端锁定平台并以 `PLATFORM_DISABLED` 最终拒绝，不从 row token 推导集合资格。
- 未知行级 token 必须由 generated type/exhaustive mapping 显式失败。

### 3.2 Commands

- 创建：`platform_profile_id + label + account_identifier`。
- 编辑：`label + account_identifier + expected_revision`。
- 启停：现有 RevisionRequest。
- 删除：将 `DELETE /platform-accounts/{id}` 收紧为 required `expected_revision` query。
- 删除 service 复用既有 Platform → Account 固定锁顺序，锁定后先比较 revision，再实时检查非终态 PublicationWork blocker；PublicationWork 创建使用同一锁序，因此不能越过删除复核。不允许 optional revision 或先 GET 再 DELETE。
- 账号标识唯一性继续由同平台 `lower(btrim(account_identifier))` 数据库约束权威保证；业务预检与约束竞态路径统一返回 `PLATFORM_ACCOUNT_IDENTIFIER_EXISTS`，并携带 `details.errors[].loc=["body","account_identifier"]`，前端不解析 message。

### 3.3 UI and Error Behavior

- 平台上下文中不重复 Platform 列；桌面/平板列为业务标签、内部账号标识、状态、操作。
- 375px 使用移动列表/卡片，label、identifier、status、primary/overflow actions 均可达。
- create/edit 使用 React Hook Form + Zod Dialog；不增加 credential 字段。
- 行级 primary/overflow 只消费 server tokens；`HANDLE_PLATFORM` 返回 Overview。
- blocker 显示 `PUBLICATION_WORK` 数量；当前 Publication Work List 没有账号筛选合同，因此不伪造“精确下钻”。无 blocker 且含 DELETE 才显示危险确认。
- 409 保留表单或 Dialog 上下文，要求显式 reload；identifier conflict 定位字段。
- Dialog 关闭、保存或命令完成后焦点返回真实触发器。

### 3.4 Compatibility and Cache

- 两套 generated schema同步。
- V1 `SettingsPage` 只做 Account DELETE 携带 row revision 的单点适配和直接测试，不重构 V1。
- Account mutation 精确失效 Platform List、Workspace Detail、当前 Accounts、Publication ready/work list/workspace context；不刷新终态 PublishedArticle snapshot，不清空整个 QueryClient。

## 4. Acceptance Criteria

- [x] ADMIN/ENGINEER 均可读取和 create/update/enable/disable；仅 ADMIN 得到 delete projection 和入口。
- [x] create 作为页面动作对当前两个真实角色可达；平台停用提交由服务端明确拒绝，前端不按 `isAdmin` 或 row token 补集合资格。
- [x] empty/create/edit/enable/disable/delete/blocker 都有 component 和 production-artifact 证据。
- [x] create/update 的预检与真实约束竞态都使用相同稳定字段错误和 `account_identifier` 位置，表单输入保留。
- [x] update/status/delete 始终提交当前 revision；stale delete 返回 `REVISION_CONFLICT` 且无副作用。
- [x] 删除前实时复核非终态 PublicationWork；只有终态历史时允许删除。
- [x] unknown token 显式失败；409 不自动重放。
- [x] mutation cache invalidation 精确命中 Platform 与非终态 Publication consumers。
- [x] 375px 无不可操作宽表，Dialog 和 RowActions 焦点正确返回。
- [x] OpenAPI、runtime schema、两套 generated types、V1/V2 调用、测试和直接相关文档一致。

## 5. Out of Scope

- Core 的 route、Overview、Logo、Generation 或 Platform lifecycle 新功能。
- Credential/API key/secret/Cookie 管理。
- Publication Workbench 功能改造、终态 snapshot 改写或数据库 migration。
- 通用 CRUD/Action Registry/DataTable、Phase 6 完整 real-stack E2E 和无关清理。

## 6. Blocking Questions

无。依赖和范围已明确；本规划仍需一次新的实施批准。
