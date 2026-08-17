# Frontend V2 System Vertical Slice 审计

## 1. 审计结论

当前 System/Auth 架构没有发生方向性漂移：route、domain、Design System/shared 的依赖方向正确，服务端权威仍被保留，Auth/Users/Audit 的关键状态各有单一 owner，也没有提前出现通用 Admin/CRUD/Permission/Audit/workflow framework。

任务内审计发现的一个 P1、两个 P2 已按批准范围最小修正，System/Auth 定向验证、strict fixture E2E 和 backend authority integration 均全绿；没有证据要求修改 OpenAPI、数据库、权限合同或业务 state machine。

Phase 7 Exit Gate 最终判定为 `NOT_MET`。仓库级独立诊断发现 backend schema unit fixture、跨 domain frontend-v2 unit harness、Fact Review E2E 与 Platform Types E2E 共四个独立 owner 阻塞；它们不属于本任务可扩修范围，且使最终 `make verify` 不再合理预期通过。

## 2. 前置检查证据

| 检查 | 观察结果 |
| --- | --- |
| 主工作区分支 | `main` |
| 初始工作树 | 创建 Task 前 clean；创建后仅新增当前 `.trellis/tasks/08-17-frontend-v2-system-abstraction-review/` |
| 主分支同步状态 | `main...origin/main [ahead 247]`；按约束未 pull/push |
| 前置任务合入 | `21bcde1e test(frontend-v2): add system admin real-stack e2e`、`9f235063 chore(task): archive frontend-v2-system-admin-e2e`、`23e78f69 chore: record journal` 已在 `main` 历史 |
| 遗留分支 | 本地和 remote-tracking 均无 `codex/frontend-v2-system-admin-e2e` |
| 遗留 worktree | 仅主工作区 `/Users/sc/PycharmProjects/partsignal`，无 admin-e2e worktree |
| 禁止操作 | 未执行 pull、push、PR、历史改写、分支创建或完整 `make verify` |

## 3. 阅读与审计范围

已完整读取本任务要求的 AGENTS、Trellis workflow/相关 frontend 与跨层 specs、Frontend V2 README/01/04/05/06/07/08/09 相关章节，以及归档任务：

- `frontend-v2-system-users`
- `frontend-v2-system-audit`
- `frontend-v2-auth-session-ui`
- `frontend-v2-system-admin-e2e`

代码审计覆盖：

- `frontend-v2/src/app/auth/**`、`app/layout/**`、navigation、providers、query client。
- `_app`、`_admin`、login、security、System Users/Audit routes。
- `domains/auth/**`、`domains/identity/**`、`domains/audit/**` 的实现和 tests。
- System/Auth 使用到的 Design System、`shared/api/client.ts`、generated schema。
- strict fixture 与 real-stack Auth/Users/Audit/Admin E2E、fixture、secret scanner、Playwright config、`e2e-local.sh`。
- `Makefile` 的 `contract-check → lint → typecheck → test-unit → test-integration → build → e2e → compose config` 实际顺序。

## 4. Findings

### F01 — Keep in System/Auth Domain（P0/P1/P2：无缺口）

**结论：** Auth session、CSRF、`must_change_password` 和业务 query 清理由 `AuthProvider` 唯一拥有，应保持现状。

**证据：**

- `frontend-v2/src/app/auth/auth-provider.tsx:27-37` 定义唯一 `authSessionQueryKey`，route guard 只从该 cache 读取。
- `auth-provider.tsx:45-57` 顺序读取 `/auth/me` 与 CSRF；`auth-provider.tsx:121-132` 改密后重新读取服务端 session，不在浏览器推导 `must_change_password`。
- `auth-provider.tsx:30-33,76-79,110-119` 在身份切换时清除非 auth query 并写回唯一 session。
- `frontend-v2/src/routes/_app/route.tsx:8-13` 只把 canonical session 投影为 UX redirect。

**Owner：** `src/app/auth/auth-provider.tsx`。不创建 auth store、CSRF helper store 或第二个 query owner。

### F02 — Keep in System/Auth Domain（无缺口）

**结论：** Users 没有依据 role/status 自行推导服务端操作资格；revision、selection、bulk partial 和 cache invalidation ownership 清晰。

**证据：**

- `frontend-v2/src/domains/identity/user-list.model.ts:109-165` 只把服务端 `primary_task` / `available_actions` 映射为 UI command，并显式拒绝重复、缺失和矛盾 projection。
- `frontend-v2/src/domains/identity/user.api.ts:67,83,109` 所有修改/重置/删除携带 canonical revision。
- `frontend-v2/src/domains/identity/user-list-page.tsx:135,179` mutation 只 invalidates Users list，bulk 使用选择时 revision；页面代码在 background revision 变化时清空整组 selection。
- `user-list-page.tsx:570,749` 密码 mutation 使用 `gcTime: 0` 并在生命周期结束时销毁变量。

**Owner：** `domains/identity`。不抽取通用 CRUD、selection controller 或 permission framework。

### F03 — Keep in System/Auth Domain（无缺口）

**结论：** Audit 的 list、URL selection、lazy detail、安全投影和 immutable history ownership 清晰。

**证据：**

- `frontend-v2/src/domains/audit/audit.model.ts:74,110-119` 将 `logId` 作为 URL-owned selection，但 `auditSearchToApiParams` 不把它送入 list API。
- `frontend-v2/src/domains/audit/system-audit-page.tsx:62-92,161-184` 由 URL `logId` 控制选择、焦点恢复、desktop side panel 与 mobile Sheet。
- `system-audit-page.tsx:304` 仅选中时执行 detail query。
- `audit.model.ts:166-229` 对 action、facts、changes 和 related entry 使用显式白名单/投影；`audit-detail-content.tsx:73` 明确保留已删除对象的历史语义。
- Audit domain 没有 mutation，因此不存在自行维护可变 history cache 的第二来源。

**Owner：** `domains/audit`。不抽取通用 Audit/workflow framework。

### F04 — Keep in Design System/shared（无缺口）

**结论：** Design System 只拥有视觉和交互语义，shared 只拥有 API transport/generated types；没有反向导入业务 domain。

**证据：** 全量 import 搜索没有发现 `src/design-system/**` 导入 User、Audit、role、permission 或 `src/domains/**`；`src/shared/**` 也没有导入 routes/domains。System 页面只消费 TableKit、Form、Dialog、Sheet、Badge 等既有 UI primitive。

**Owner：** 既有 Design System/shared。保留已被多个真实页面消费的 TableKit/Form/primitive；不移动业务 DTO 或 action token。

### F05 — Keep in Design System/shared（无缺口）

**结论：** `tests/e2e/secret-artifact.ts` 是已有且被 Auth fixture、Auth real-stack、System Admin real-stack 三个消费者证明的共享测试 helper，应保留，不另建 scanner。

**证据：** `frontend-v2/tests/e2e/secret-artifact.ts:18-27` 递归扫描 test output；三份 spec 都调用 `expectSecretsAbsent`。Auth/Users/Audit/System Admin specs 显式关闭 trace，real-stack config 也在真实栈模式关闭 trace。

### F06 — Keep in System/Auth Domain（无缺口）

**结论：** 服务端仍是权限和状态转换最终权威，前端 role 判断只用于 UX。

**证据：**

- `frontend-v2/src/routes/_app/_admin/route.tsx:8-11` 与 navigation 的 `isAdmin` 只控制 route UX/nav visibility。
- `system-admin-real-stack.spec.ts` 对 ENGINEER 的 Users list/bulk/export、Audit list/options/detail 六个真实 API 逐一断言 `403/PERMISSION_DENIED`，同时验证直接 URL 的 403 页面。
- Users command 来自 server action projection，mutation 仍接受服务端 revision/业务规则校验；没有 role/status eligibility branch。

### F07 — Keep in System/Auth Domain（测试职责无冲突）

**结论：** 现有测试层次互补，不应合并或复制。

- Vitest：证明 Auth owner、Users action/revision/selection/cache、Audit URL/lazy detail/safe projection。
- strict fixture E2E：证明 production artifact、响应式、键盘/焦点和客户端错误边界。
- `auth-session-real-stack.spec.ts`：证明 seed ENGINEER 的独立 Auth 生命周期与 logout。
- `system-admin-real-stack.spec.ts`：以新建 ENGINEER 为前置，证明 Admin→Users→Auth→403→Audit→delete 的跨域闭环；其 forced-change/403 步骤是闭环前置，不是第二套 Auth orchestration。
- 唯一真实栈 owner 仍是 `deploy/scripts/e2e-local.sh`；没有第二套 process/database/Redis/storage cleanup。

### F08 — Promote only after proven consumers（当前不提升）

**结论：** 以下相似代码语义并不稳定相同，当前不得提升：

- Identity `UserFilterSelect` 与 Audit `AuditSelect` 的选项、宽度和业务筛选 contract 不同。
- Identity `Notice`（可关闭、warning/danger）与 Audit `Notice`（retry）行为不同。
- Users selection/revision controller、Audit URL selection/detail、Auth route guard 各只有一个业务 owner。

若未来至少两个真实消费者具有相同 props、状态和错误语义，再评估提升；本任务不新建 shared component/framework。

### F09 — Confirmed defect requiring change（P1，任务内）

**症状：** System/Auth 定向 Vitest 实测 `2 failed | 7 passed` 文件、`8 failed | 32 passed` tests。`user-list-page.test.tsx` 7 条与 `system-audit-page.test.tsx` 1 条均在路由转到 login 后抛出 `useAuth 必须在 AuthProvider 内使用`。

**根因：** 两个测试只向 Router context 注入 `auth` view（Users `:70-84`；Audit `:64-76`），但 `_app` route guard 的权威来源是 `authSessionQueryKey` cache（`_app/route.tsx:8-10`）。测试没有写入 canonical session，维护了一个与真实 owner 不一致的测试前置条件。

**最小修正：** 从 Auth owner 导出既有 `authSessionQueryKey`，两份测试用该 key 预置 `{ user, csrfToken }`；不导出新 store、不 mock route guard、不包一层测试 framework、不复制字符串 key。

**实施结果：** 已导出既有 key 并在两份测试写入 canonical session；R2 恢复为 9 files、41 tests 全绿，R3 的 Auth/Users/Audit 22 tests 全绿。

### F10 — Confirmed defect requiring change（P2，任务内）

**症状：** Audit 的两个 `datetime-local` 输入没有 `required`，用户可清空后提交。

**根因：** `system-audit-page.tsx:233-235` 在检查范围前无条件调用 `fromBeijingDateTimeInput`；该函数在 `audit.model.ts:142-145` 对空值抛出 `审计时间格式无效`。事件处理异常未转化为页面校验反馈。

**最小修正：** 在 `submit` 的 owner 处先校验两个 draft 值存在，复用现有 `rangeError` alert；增加一条页面组件测试，证明空值不发请求/不改 URL且显示明确错误。保留 model 的严格转换合同，不增加 silent fallback 或默认日期。

**实施结果：** 已在转换前拒绝空时间并增加一条可观察行为测试；定向 Vitest、lint、typecheck、build 与 strict fixture Audit E2E 均通过。

### F11 — Simplify locally（P2，任务内）

**结论：** 删除两类无行为 glue：

- `src/routes/_app/_admin/route.tsx:17-22` 的 `AdminBoundary` 只返回 `<Outlet />`，可直接使用 `component: Outlet`。
- `src/domains/audit/audit.api.ts:21-27` 的 `auditKeys.lists()` / `details()` 全仓无消费者；Audit 没有 mutation invalidation 需求，删除即可。

不为这些删除创建 helper 或新测试；由现有 route/System tests、typecheck 和 build 证明行为保持。

**实施结果：** 已直接使用 `Outlet` 并删除两个无消费者 key factory；现有 route/System tests、typecheck 和 build 全绿。

### F12 — Deferred product/UX decision

**结论：** 无。本次未发现需要产品决策才能判定的 System/UX 问题。

### F13 — Out-of-scope blocker requiring independent Task

**结论：** 实施后的仓库级独立诊断发现四个阻塞，均不由 System/Auth 本次改动引入，也不授权本任务跨 owner 修复。

| 阻塞 | 证据 | Owner 与建议 |
| --- | --- | --- |
| backend identity schema unit fixture | `make test-unit`：`test_temporary_password_minimum_lengths_remain_unchanged` 构造 `ResetPasswordRequest` 时缺少当前必填 `expected_revision`；200 passed、1 failed | backend identity tests；独立最小修复 fixture，并确认 revision contract，不改 runtime schema |
| frontend-v2 跨 domain route test harness | 独立 `npm --prefix frontend-v2 run test`：60 files passed、19 failed；311 tests passed、146 failed，主症状为多个非 System route harness 未提供 canonical Auth session，触发 `useAuth 必须在 AuthProvider 内使用` | frontend-v2 shared test setup/各 domain test owner；独立审计统一测试前置条件，不能在 System Task 批量改 19 files |
| Fact Review 409 E2E | `make e2e` 的 mobile/desktop 均显示请求实际 `expected_revision: 1`，测试仍期待 `0` | Products/Fact Review E2E owner；独立判断 fixture 还是断言过期，保持服务端 revision 权威 |
| Platform Types 非管理员 E2E | `make e2e` 的 mobile/desktop 均等待 GET 请求超时；route 已在进入页面前拒绝，requests 计数为 0，测试却要求大于 0 | Platform permissions E2E owner；独立澄清“route 与 server 双重拒绝”的测试编排，不在 System route 中制造请求 |

这些问题未要求修改 OpenAPI、数据库、权限合同或公共 API；当前证据指向测试 owner。修复后需各自运行最小相关检查，并重新建立仓库级 Gate candidate。

## 5. P0/P1/P2 汇总

| 等级 | 数量 | 处理 |
| --- | ---: | --- |
| P0 | 0 | 无 |
| P1 | 1 | F09 已在任务内修复并通过 R2/R3 |
| P2 | 2 | F10/F11 已修复并通过相关定向检查 |
| 独立 blocker | 4 | F13；需由各 owner 独立处理，当前 Exit Gate `NOT_MET` |

## 6. 最终验证证据边界

- R1–R4 全绿：System/Auth 定向 Vitest 41 tests、strict fixture E2E 22 tests、backend authority integration 6 tests。
- `contract-check`、`lint`、`typecheck`、integration 117 tests、build、dev/prod compose config 均通过。
- `make test-unit` 与 `make e2e` 因 F13 非零；旧 frontend unit/visual/real-stack 均独立通过并完成 real-stack cleanup。
- 最终 `make verify` 未运行：candidate 已明确不满足“一次最终 fail-fast gate”的前提，重复完整门禁不会增加证据。
- 相关 Auth/System sensitive paths 的 strict fixture/real-stack tests 保持 trace 关闭并执行既有 secret artifact assertions；本任务未创建浏览器临时 session、重复 scanner、trace/video 或测试报告入口。

## 7. Phase 7 Exit Gate

**判定：`NOT_MET`。** System vertical slice 本身的任务内缺口已关闭，依赖方向、服务端权威、单一状态 owner、敏感路径和测试编排的定向证据均成立；但 Required Validation 仍存在 F13 四个独立 blocker。按批准规则，不更新 07/08 的 Phase 7 完成状态，不开始 Phase 8，也不以本任务跨 owner 修复。
