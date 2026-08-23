# Frontend V2 System 抽象回顾 — Design

## 1. 设计原则

本任务不设计新架构。目标是在保持现有 owner 和依赖方向的前提下，修复一个 gate blocker、一个输入边界，并删除确认无用的 glue。最短可验证 diff 优先。

## 2. 目标状态

```text
routes
  ├─ 读取 AuthProvider canonical session（仅 UX guard）
  └─ 组合 Identity / Audit pages
          ↓
domains/auth | domains/identity | domains/audit
  ├─ 消费 generated API contract
  ├─ 拥有各自 query/model/UI 状态
  └─ 不向 Design System 下沉业务语义
          ↓
design-system | shared/api
  └─ UI primitive、transport、generated types
```

服务端继续拥有 permission、transition、revision validation 和 action projection。前端 route/nav 的 admin 判断不构成安全控制。

## 3. 最小修改设计

### 3.1 Canonical auth session test setup

涉及：

- `frontend-v2/src/app/auth/auth-provider.tsx`
- `frontend-v2/src/domains/identity/user-list-page.test.tsx`
- `frontend-v2/src/domains/audit/system-audit-page.test.tsx`

设计：导出既有 `authSessionQueryKey`，两份测试在创建 router 前调用 `queryClient.setQueryData(authSessionQueryKey, { user: auth.user, csrfToken: auth.csrfToken })`。Router context 继续使用现有 `AuthContextValue` view；query cache 仍是 route guard 的唯一 canonical owner。

不采用：

- 不在测试硬编码第二份 `['auth', 'session']`。
- 不修改 route guard 读取 context view，否则生产路径会形成第二来源。
- 不创建通用 test router/provider factory；只有两处消费者且 setup 很短。
- 不 mock redirect/login route 来掩盖真实 owner。

### 3.2 Audit 时间输入边界

涉及：

- `frontend-v2/src/domains/audit/system-audit-page.tsx`
- `frontend-v2/src/domains/audit/system-audit-page.test.tsx`

设计：`AuditFilters.submit` 在严格转换前检查 `createdFrom` / `createdTo` 是否为空；为空时设置现有 `rangeError` 并返回。转换函数继续对非法值显式抛错，不增加默认时间或模糊 fallback。

组件测试扩展为一条独立场景：清空开始/结束时间之一，点击查询，断言 alert 可见、list 请求计数不增加、URL 不变、没有未捕获异常。

### 3.3 删除局部 glue

涉及：

- `frontend-v2/src/routes/_app/_admin/route.tsx`
- `frontend-v2/src/domains/audit/audit.api.ts`

设计：route config 直接使用 `component: Outlet`；删除全仓无引用的 `auditKeys.lists` / `auditKeys.details`。保留 `list/options/detail` key 和 `auditKeys` export，因为存在真实 query consumer/测试边界。

### 3.4 明确不提升的代码

- Identity/Audit 的本地 Select、Notice 不合并。
- Users selection/revision 不下沉 shared。
- Audit URL detail 不泛化为 master-detail framework。
- Admin route 不抽象 Permission boundary。
- real-stack E2E 与 secret scanner 不新增封装。

## 4. 测试职责

| 层 | 本任务职责 | 不重复的证据 |
| --- | --- | --- |
| Vitest | canonical auth cache setup、Audit 空时间、既有 Users/Audit owner | 不复制 real server 403/lifecycle |
| strict fixture E2E | Users/Audit/Auth production artifact 与响应式/焦点 | 不承担数据库/权限 truth |
| backend integration | 服务端 permission、revision、bulk、audit projection | 不复刻 UI 行为 |
| real-stack E2E | 复用既有 Auth/Admin 跨域闭环与 secret/cleanup | 不新增 spec 或 orchestration |
| `make verify` | Phase 7 最终候选总门禁 | 只在独立阶段已通过后执行一次 |

## 5. 文档设计

最终 gate 通过后只更新：

- `docs/frontend-v2/07-migration-plan.md`：将 Phase 7 abstraction review 标记完成，记录 Exit Gate `MET` 与最小修正。
- `docs/frontend-v2/08-testing-quality-and-acceptance.md`：记录独立阶段、最终 `make verify` 的实际结果和 System P0/P1/P2 closeout。

不更新 01/04/05/06/09、`.trellis/spec/`、OpenAPI 或 database contract，因为本设计不改变架构、业务合同、公共 API、数据模型或 ADR。若实际实施推翻此前提，停止并改走独立 blocker。

## 6. 回滚策略

- 所有实施发生在用户批准后的唯一临时分支，且没有 migration、数据写入或合同变更。
- 验证失败时保留未提交 diff 供审查；仅用 `apply_patch` 反向撤销本任务确切 hunks，不使用 `git reset --hard`、`git checkout --` 或宽泛删除。
- 不通过减少断言、关闭校验、增加 fallback 或修改测试预期制造通过。
- 真实栈 cleanup 只由既有 `e2e-local.sh` owner 执行；未知进程、端口、数据库或 Redis owner 只报告，不终止/删除。

## 7. 停止条件

出现以下任一项即停止实施并报告：

1. 需要修改 OpenAPI、database contract、permission contract、backend state machine 或旧 `frontend/`。
2. 发现 secret 进入 UI/日志/错误/测试产物，且修复超出当前明确 owner。
3. 独立阶段暴露未归因当前 diff 的 P0/P1 或环境 owner 冲突。
4. 要求建立第二个 auth/cache/selection/audit/orchestration owner 才能继续。
5. 最终 `make verify` 非零；先完成仍安全的独立诊断并判 `NOT_MET`，不机械重跑。
