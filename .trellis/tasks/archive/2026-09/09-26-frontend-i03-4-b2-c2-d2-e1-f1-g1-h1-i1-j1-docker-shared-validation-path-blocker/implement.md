# J1 恢复点

## 当前状态

I1 测试 owner 修复已经提交为 `3d8d857a7c5c457f2d02056e6ebdf6377a762c52` / tree `ac10b6ec0cb41a2e50a3192614883011edefd95f`。其唯一一次完整门禁证明 frontend Vitest 已恢复全绿，但 PostgreSQL integration 因 `/private/tmp` bind mount 在 Docker Desktop 内不可见而失败。该 checkout 和所有测试资源已清理。

## 下一步

1. 将 J1/H1/I1 暂停记录形成新的固定 commit/tree；不得重跑 `3d8d857a`。
2. 在 `/Users/sc/...` 的 Docker 共享路径创建全新 detached validation checkout。
3. bootstrap 并确认 identity、tracked/nonignored cleanliness。
4. 在完整资源前置检查后执行 disposable `backend-test` bind sentinel；精确验证 integration 目录、`test_migrations.py` 和 tracked 测试数量。
5. sentinel 清理和资源归零成立后，只运行一次完整 `make verify`。
6. 只有门禁退出 0、后置资源归零、identity 未漂移时，才派发 fresh `critical_reviewer`。

## 禁止事项

- 不在 `/tmp` 或 `/private/tmp` 再建 Docker-backed validation checkout。
- 不把 `backend-test` 路径不存在解释为候选测试删除。
- 不修改 Compose bind mount、pytest command 或 Makefile 掩盖宿主共享问题。
- 不复用或重跑 `3d8d857a` 的完整门禁。

## 本轮结果

- 新固定候选：commit `d10217f2177f7dc47f4df6acfcaedb2c451cc3ef`，tree
  `3fd475c313a2b6c2e4ad515b2d6f7fade22eebf9`。
- 新 detached checkout 位于 `/Users/sc/...`，bootstrap 仅产生 ignored 内容；bind sentinel 证明
  `/app/tests/integration/test_migrations.py` 可见，container/checkout tracked integration 文件均为
  `26`。
- 唯一完整 `make verify` 退出 `0`；backend unit `683`、Vitest `91/794`、PostgreSQL integration
  `337`、real-stack `19`、fixture `494 passed / 40 skipped`，其余 lifecycle、secret、deploy harness
  与 Compose 门禁均通过。pre/post 资源 snapshot 逐字一致且全部为 `0`，validation checkout 已移除。
- fresh `critical_reviewer` 结论为 `BLOCKER`；审计包
  `20260926T121350Z-i03-j1-fixed-candidate-final-critical-review-aa00ca69` 已关闭并验证。两项 P1 已转入
  K1 子任务，未完成 J1/I03，未创建 I04，未发生 fetch、push、SSH 或远程写入。
