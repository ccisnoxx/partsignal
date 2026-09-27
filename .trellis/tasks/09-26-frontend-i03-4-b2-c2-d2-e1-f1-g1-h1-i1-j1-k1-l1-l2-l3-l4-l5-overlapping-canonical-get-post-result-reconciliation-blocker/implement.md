# L5 下一恢复顺序

1. 从 `c85e282ab89fca0f2c8a5af3094f2202b9ead214` 恢复，保留当前未提交的 L5/L4 Trellis 记录；不要重用
   L4 的完整门禁作为新候选结果。
2. 先在 AuthProvider 单测与真实栈建立双闸门反例：旧 canonical GET 服务端已读 enabled ADMIN、客户端 response
   延迟；bulk exact success 返回后再放行旧 response。
3. 从 `auth-provider.tsx:306-317,408-417,443` 定位 command barrier 与 transition owner，在 Provider 内实现晚于
   result 的 reconciliation fence/队列；不得把重试或 epoch ownership下放给 UserListPage。
4. 同时验证 exact success 不变为 mutation error、POST once、旧 continuation 不执行 callback/navigation、旧 GET
   不恢复 route/cache，以及 lock failure、unmount、marker/lease、retry/offline resume。
5. 更新必要稳定规范与 L5 记录，完成定向验证后形成新 fixed candidate。
6. 新候选只能在全新的 `/Users/sc/...` detached checkout 中运行 26/26 sentinel 和单次 `make verify`；绿色且资源
   归零后再做 fresh 完整候选高风险复核。
7. 只有 fresh review 为 `NO BLOCKER` 才能关闭 L5、L4 与上游链；否则继续建立准确叶子并停止。不得创建 I04。

L4 绿色门禁只是 blocked candidate 的历史证据：日志 `/tmp/partsignal-i03-l4-c85e282-make-verify.log`，SHA-256
`80207f1ca200ed40ac41ac4f6d433cee6a8f11cef693659fa07f84f25c034d08`。禁止把它登记为 L5 新候选门禁。

## 本会话实施与定向证据

1. 新增双闸门 AuthProvider 反例：旧 GET 在第一闸门记录已读 enabled ADMIN，在第二闸门延迟
   client settle。修复前精确失败为 `ActivePrincipalCommandError`。
2. `AuthProvider` 新增 result-reconciliation mode、活动 canonical read 跟踪、同步 fence 登记与保守
   串行队列。旧 GET settle 之前不发新 GET；旧快照无法提交或释放 barrier。
3. `UserListPage` 继续只在 exact current-actor success 或 unknown outcome 后调用 Provider。Provider 失败不改写
   三态分类；POST 不重放，页面不创建新 continuation 或自行恢复 auth。
4. 新增单元覆盖：双闸门顺序、并发 fence 串行、Provider unmount durable fail-closed、exact/
   unknown 分类不被 fence error 覆盖。既有 lock 缺失/拒绝、marker 失败、uppercase UUID、explicit
   failure、retry/offline resume 与 no-storm 测试继续通过。
5. 定向 Vitest `4 files / 131 tests`、TypeScript、受影响 ESLint、`git diff --check` 均通过。
6. system-admin 真实栈 `2 passed`；交错顺序为 old GET start/read 200 → bulk exact 200 → old client
   settle 200 → post-result GET read 401。发送页在两个 response gate 期间都无 Users route，POST 一次、
   后续两页 401、durable marker `SETTLED`、secret scan clean。
7. 定向资源 pre/post 快照逐字一致：2,472 bytes，SHA-256
   `e1017f63c6d97a24e35484753f7fe4d98a5c5d129e334f45969983eccb6df031`；所有受控资源为 0。

下一步：检查完整 diff 并形成 L5 fixed candidate，然后仅在全新 `/Users/sc/...` detached validation
checkout 中执行 26/26 sentinel 和单次 `make verify`。
