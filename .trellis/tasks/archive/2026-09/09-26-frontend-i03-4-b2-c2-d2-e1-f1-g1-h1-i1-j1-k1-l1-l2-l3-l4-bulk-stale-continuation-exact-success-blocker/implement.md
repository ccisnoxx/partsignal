# L4 恢复顺序

1. 从固定阻断候选 `b7318ef67c40301cc2b2f745e04e7f543e40eab8` 与本任务记录恢复；不要重跑其完整门禁。
2. 在 `user-list-page.tsx:271-279` 及 AuthProvider transition/reconciliation owner 中决定最小合并合同：结果后
   boundary 只能在实际完成或被可证明更晚的 Provider reconciliation 覆盖后标记 handled。
3. 先增加 hold POST → 另一标签页完成较早 canonical GET → exact success 的确定性交错，证明现状可恢复旧 ADMIN
   snapshot/route 且旧命令借新 continuation 执行。
4. 修复后同时回归 exact success、explicit failure、unknown、uppercase UUID、LockManager failure、Provider unmount、
   POST once 与无 focus/visibility 请求风暴。
5. 运行最小定向检查与真实栈，形成新 fixed candidate；再在新的 `/Users/sc/...` detached checkout 做 26/26
   sentinel 和且仅一次完整 `make verify`。
6. 只有门禁、资源归零、identity 不漂移和另一名 fresh critical reviewer `NO BLOCKER` 后，才关闭 L4/L3 与父链。

以上为上一会话恢复点；本轮从该候选继续实施，仍不复用旧完整门禁、不创建 I04，也不执行
fetch/push/SSH/部署或 Hostdzire 写入。

## 已完成实现与定向验证

1. 先加入确定性单元反例并确认旧实现失败：POST in-flight 时推进同用户新 binding epoch，较早 canonical
   snapshot 仍为启用 ADMIN，exact self-disable 返回后旧实现没有调用 reconciliation。
2. `user-list-page.tsx` 的 exact current-actor success 改为结果已知后无条件 await Provider-owned
   `reconcileAuthBoundary()`；仅 resolve 后标记 handled，并始终返回命令前 continuation，不再捕获新 continuation。
3. `auth-provider.test.tsx` 证明较早 binding reconciliation 的 canonical GET 不能替代结果后的新 GET；后者收敛
   401、清 auth/业务 cache、route user 为 null、durable marker 为 `SETTLED`，focus/visibility 不增加请求。
4. 真实栈以 PostgreSQL `users` table lock 确认 bulk 事务已经进入并等待；同一 BrowserContext 的另一页建立
   同用户新 binding 并先完成 canonical 200，再释放事务得到 exact bulk 200；结果后 owner/observer 各一次 401，
   bulk POST 恰好一次，旧 Users route 不恢复，secret scan clean。
5. 定向结果：Vitest `4 files / 126 tests`；TypeScript、受影响 ESLint、`git diff --check` 全部 status `0`；
   system-admin real stack `2 passed`。真实栈前后资源快照逐字一致且所有受控资源为 0。

下一步只形成新的 fixed candidate，在全新 `/Users/sc/...` detached checkout 中先做 26/26 bind sentinel，再且仅一次
执行 `make verify`。若绿色且资源归零，才派发 fresh `critical_reviewer`；I04 继续禁止创建。

## fixed candidate、完整门禁与停止点

- fixed candidate `c85e282ab89fca0f2c8a5af3094f2202b9ead214` / tree
  `6aa82a5271edd8d62be11cd2cdec225a7f2ac206` 已形成，候选工作树干净。
- 全新 `/Users/sc/...` detached checkout 先通过 26/26 bind sentinel，随后唯一一次 `make verify` 退出 `0`；
  日志 `/tmp/partsignal-i03-l4-c85e282-make-verify.log`，253,479 bytes，SHA-256
  `80207f1ca200ed40ac41ac4f6d433cee6a8f11cef693659fa07f84f25c034d08`。
- pre/post resource snapshot 逐字一致，所有受控资源为 0；validation checkout 已归档并 prune，原检出区未变。
- fresh 只读高风险复核 audit
  `20260926T183412Z-i03-l4-fixed-candidate-final-critical-review-d33ad16c` 给出 `BLOCKER`：较早 canonical GET
  已读旧 ADMIN 但仍在途时，结果后的 reconciliation 被 command barrier 拒绝，旧 GET 仍可提交旧 snapshot。
- 按收尾规则已建立 L5 子任务；本会话不继续实现、不再次运行完整门禁、不关闭任何父阻断链，也不创建 I04。
