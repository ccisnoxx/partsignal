# I03-4-B2-C2-D2 执行计划

1. 核对固定 commit/tree、候选/原检出区、父链状态、D1 复核结论与 I04 不存在。
2. 从固定提交创建新 detached validation worktree，证明 clean 状态与维护源 tracked 完整性。
3. 仅在 validation bootstrap；核对 PostgreSQL/Redis 测试基础设施并生成门禁前完整资源快照。
4. 只覆盖指定数据库与 Redis URL，单次运行 `make verify`，保存日志、状态、大小和 SHA-256。
5. 从日志提取实际门禁覆盖；生成门禁后资源快照，核对 fixed tree、`git diff --check` 与三个工作区边界。
6. 全部前置条件成立后，按持久化多代理审计流程派发 fresh `critical_reviewer`。
7. 只有结论为 `NO BLOCKER` 才更新并完成 I03 父链、移除 validation worktree，并创建 I04 计划。

## 排除

- 不运行第二次完整 `make verify`，不以定向诊断替代门禁。
- 不在 D2 修改产品代码或门禁实现。
- 在 D2 通过前不执行 push、发布、部署或任何远程写入。

## 2026-09-26 执行结果

- validation：`/Users/sc/.codex/worktrees/frontend-redevelopment-i03-d2/partsignal`，detached `ff018cb90f932e54cacda9cead06c74c7880ab42`，tree `20c544cec50073af26c217401007834827cfea21`；bootstrap 后只有 ignored 环境、依赖和缓存。
- 门禁前资源清单为 0；按指定 PostgreSQL/Redis URL 单次运行 `make verify`。
- 门禁在真实栈 Playwright 停止：`system-admin-real-stack.spec.ts:774` 收到两条 `response: reset-invalid-session: 401 GET http://127.0.0.1:8000/api/v1/auth/session`，最终 `15 passed / 1 failed`，secret scan clean，顶层退出 `2`。
- 最小诊断定位到同文件 `watchRuntime()`：`allowedHttpErrors` 仍允许 `/api/v1/auth/me`，而 D1 后 reload 的规范化会话读取为 `/api/v1/auth/session`。需在子 blocker 中确认两次读取的 owner/预期，再做最小测试修复，不能用宽泛 4xx 忽略掩盖异常。
- 清理后 Redis DB 14、固定端口、隔离数据库、临时对象存储、secret fixture 和已知 harness 临时目录均为 0；validation HEAD/tree、tracked/non-ignored untracked 与 `git diff --check` 均未漂移。
- 条件 A 未通过；停止于首次远程写入前，不执行 I04。

## 2026-09-26 第二次执行结果

- 修复 System Admin 测试编排后，固定候选更新为 commit `4e739f68f3ef87286d7b22e77ebfd353bafda6e8`、tree `425ec420f117ddf094172bd862ffd059f59cde45`；新 validation 位于 `/Users/sc/.codex/worktrees/frontend-redevelopment-i03-d2-r2/partsignal`。
- 门禁前资源清单为 0；按相同数据库与 Redis URL 单次运行完整 `make verify`。真实栈 Playwright `16/16` 通过，secret scan clean；fixture Playwright 执行 528 项，结果 `492 passed / 34 skipped / 2 failed`。
- 唯一失败场景 `platform-types.spec.ts:34` 在 mobile/desktop 各失败一次：三项写请求实际携带 `platform-types-csrf`，断言仍期望其他 fixture 的 `platforms-e2e-csrf`。最小诊断确认 fixture 自己发放前者，因此这是精确断言漂移。
- 顶层退出 `2` 后未运行剩余 lifecycle/deploy/Compose 门禁；没有重跑完整 `make verify`。门禁后临时目录、固定端口、Redis DB 14、隔离数据库与 frontend test 容器均为 0，三个工作区没有产品代码漂移。
- 已创建子 blocker `09-26-frontend-i03-4-b2-c2-d2-platform-types-fixture-csrf-blocker`。条件 A 仍未成立，因此不派发最终独立复核、不完成 I03、不创建 I04，也不执行任何远程操作。
