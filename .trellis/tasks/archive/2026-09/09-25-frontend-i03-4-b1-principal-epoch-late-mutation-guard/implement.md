# I03-4-B1 执行计划

1. 完成 auth/provider/QueryClient owner 与 mutation/canonical 调用清单，记录共享边界覆盖和显式消费者。
2. 实现 per-QueryClient principal epoch、AuthProvider 提交顺序、MutationCache stale continuation safety net 与 Router subtree 身份边界。
3. 迁移 AI Channel Workspace 的配置、API Key、Header、lifecycle/model 等手工 continuation，在任何客户端副作用前检查当前 principal。
4. 增加 ADMIN→ENGINEER/匿名/另一用户 deferred PATCH/PUT 反例和同主体 refresh 正向测试；补 AuthProvider epoch 顺序与 MutationCache 边界测试。
5. 运行授权的定向 Vitest、ESLint、typecheck、diff check；完成 fresh `critical_reviewer`，只修复本任务内阻断。
6. 记录真实结果，精确 staging，核对 staged diff/name-status/stat，创建本地修复提交并关闭 B1；父任务链保持 in_progress。

## 实际收敛

- 首轮独立高风险复核确认两个 P1：业务 callback 内部 await 缝隙，以及 MutationObserver options 覆盖/离线恢复旁路；两项均已按根因修复。
- shared owner、configuration/identity、Content、Product、GEO、Publication 与对应 route callback 已迁移；两个互不相同的 callback-mid-await deferred 测试覆盖 GEO Observation 和 Product Delete。
- 定向 Vitest：32 个直接测试文件、380 个测试通过；其中 platform per-call 测试文件 12/12、QueryClient 精确 Observer 恢复/retry 竞态 7/7 通过。
- 全部修改 TS/TSX ESLint、frontend TypeScript typecheck 与 `git diff --check` 通过。
- 最终 fresh 独立高风险复核运行前端完整 Vitest 91 个文件、774 个测试、完整 lint、typecheck 与 diff check，结论为 `NO BLOCKER`。仅剩精确 staging 与本地修复提交。

## 排除

- 不运行完整 `make verify`、完整 Playwright、Docker build、PostgreSQL integration 或远端 Actions。
- 不修改后端、OpenAPI、数据库合同、部署或发布配置，不进入 I04。
