# I03-4-B2-C2-D2-E1-F1-G1-H1-I1-J1-K1 Blocker 发起页终态收敛与自权限跨标签页边界

## Goal

修复固定候选 `d10217f2177f7dc47f4df6acfcaedb2c451cc3ef` 的 fresh
`critical_reviewer` 确认的两项 P1：认证命令已由服务端提交但客户端响应丢失时，发起页未执行
canonical 终态收敛；当前主体自降权或自停用时，只刷新发起页而未推进其他同源标签页的
principal boundary。I03 与 I04 在本任务完成并经新的完整候选复验前保持暂停。

## Requirements

- 登录、退出和改密等本地认证命令必须区分“已 commit”与“结果未知”。服务端可能已提交、但客户端
  响应丢失或 `SETTLED` marker 持久化失败时，发起页不得重新开放旧 session、路由或认证读取。
- 结果未知的发起页必须通过与远端合法 `SETTLED` 相同的唯一 authoritative reconciliation
  入口，恰好执行一次 canonical `GET /api/v1/auth/session`；收敛完成前保持 fail-closed，并继续
  阻止旧 principal continuation、缓存写入和导航。
- 当前主体的 role、status、must-change-password 或其他 auth-boundary 字段被管理员命令改变时，
  必须由 `AuthProvider` 拥有的 transition API 发布同源 `STARTED/SETTLED`，而不是只调用当前页
  `auth.refresh()`。self edit、single status command 与 bulk status command 使用同一所有权边界。
- 所有同源页面在边界开始时先推进 principal epoch、清除非 auth QueryCache 并关闭旧读取窗口；
  terminal 收敛后各自只读取原子 `/api/v1/auth/session`，不得从 transition 消息拼接 user、CSRF 或
  session binding。
- 不以服务端后续 401/403、focus refetch、TTL、页面重载或普通 Query invalidation 代替客户端
  principal boundary；不在消息或日志中携带 credential、session binding、Cookie、token 或密码。
- 保留既有 durable v1/v2 marker fail-closed、Web Lock owner/lease、孤儿回收、pre-request barrier、
  active command 零 auth read、stale continuation 和 secret artifact 合同。
- 增加确定性单元和真实同一 BrowserContext 双页面验证，覆盖 logout 已在服务端撤销但响应丢失、
  terminal marker 写失败、自降为 ENGINEER、自停用，以及旧 callback/cache 被延迟后释放。

## Acceptance Criteria

- [x] 发起页的未知终态保持 fail-closed，并恰好一次完成 canonical session recovery；旧 ADMIN
      session、路由、缓存和 continuation 不可恢复。
- [x] `SETTLED` 持久化失败与服务端已提交但响应丢失均有稳定、可观测且不泄密的失败行为。
- [x] 当前主体自降权和自停用都推进所有同源页面的 principal epoch，并在旧 callback/cache 可写前
      完成失效；每页 canonical recovery read 次数精确且无请求风暴。
- [x] self edit、single status 与 bulk status 不复制 transition 协议，统一调用 AuthProvider-owned
      auth-boundary API；后端权限、事务、session 撤销与审计合同不弱化。
- [ ] 定向 Vitest、TypeScript/ESLint、真实栈 BrowserContext 与资源清理通过，形成新的固定
      candidate commit/tree。
- [ ] 在 `/Users/sc/...` 下新建 detached checkout，bootstrap 后先通过 26/26 bind sentinel，随后只
      运行一次完整 `make verify`；退出 0、资源归零且 identity 未漂移。
- [ ] fresh `critical_reviewer` 对新候选给出 `NO BLOCKER` 后，才允许完成 I03、创建 I04 或发生首次
      远程写入。

## Notes

- 阻断复核 audit id：
  `20260926T121350Z-i03-j1-fixed-candidate-final-critical-review-aa00ca69`。
- J1 唯一完整门禁本身可信：backend unit `683`、Vitest `91 files / 794 tests`、PostgreSQL
  integration `337`、real-stack `19`、fixture Playwright `494 passed / 40 skipped`，以及全部
  lifecycle、secret、deploy harness 与 Compose 门禁通过；pre/post 资源 snapshot 逐字一致且全部为
  `0`。绿色结果未覆盖本任务的两个反例。
- 本轮未创建 I04，未 fetch、push、SSH 或执行任何 Hostdzire 写入。
