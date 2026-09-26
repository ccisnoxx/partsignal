# L4 设计边界

## 根因

`UserListPage` 在 bulk mutation 发起前捕获 continuation。exact current-actor success 返回时，现有实现只在该旧
continuation 仍 current 时调用 `runAuthBoundary()`；但无论 boundary 是否执行，随后都把结果记为 handled 并捕获
新的 continuation。跨标签页 transition 可在 POST in-flight 期间推进 epoch，并且其 canonical GET 可能早于 bulk
self-disable 的提交，因此“已有更新 epoch”不能证明“已观察到本 bulk 结果”。

## 所有权

- 业务页面只分类 exact success、explicit failure 与 unknown，不自行推进 epoch 或拼接 auth snapshot。
- AuthProvider 继续唯一拥有 principal barrier、transition、canonical session reconciliation、QueryClient 清理与
  continuation 生命周期。
- Provider 若合并并发 reconciliation，必须证明覆盖点晚于 bulk 结果已知；较早完成的 transition 不能替代本次
  post-result boundary。

## 必须保持的不变量

- POST 不重放；exact success 不降格为 unknown 或 explicit failure。
- 旧 continuation stale 时，不能捕获新 continuation 来延续旧命令回调。
- 结果后 reconciliation 完成前，旧 ADMIN route/cache/query/mutation/retry/offline continuation 保持关闭。
- Web Lock acquire failure 仍按 L3 本地 fail-closed，不伪造 owner、STARTED、SETTLED 或 lease。
- session/user UUID 继续使用 shared canonical owner 后 exact comparison。

## 目标测试交错

```text
bulk self-disable POST (held)
  -> other tab starts and completes same-user new-binding transition
  -> first canonical GET observes still-enabled ADMIN
  -> old command continuation becomes stale
  -> release bulk transaction; exact success returns and sessions are revoked
  -> require a post-result Provider reconciliation
  -> canonical session becomes anonymous/401
  -> old command callback/navigation remains stale
```

测试必须同时断言 POST 次数、canonical GET 次序与次数、barrier/epoch、auth cache、route、业务 cache、回调和
durable marker；不能只断言提示文本。

## 已采用的最小合同

- exact current-actor success 与 unknown 继续由页面分类，但两者都只请求 `AuthProvider` 已有的无业务回调
  canonical reconciliation；页面不自行创建 transition、推进 epoch 或拼 auth snapshot。
- exact success 的 reconciliation 在 `bulkUpdateUserStatus()` 返回且精确分区确认 current actor success 后才开始，
  因而覆盖点严格晚于本结果；较早的新 binding transition 及其 canonical GET 不能合并替代。
- 页面只在该 reconciliation resolve 后设置 `authBoundaryHandled=true`；返回给 mutation lifecycle 的仍是命令发出前
  continuation。Provider 进入 boundary 时会使其 stale，因此旧 `onSuccess`、selection 清理、Users invalidation、
  feedback、navigation 和其他 callback 均不能借用新 epoch。
- POST 不进入 reconciliation callback，也不重发；explicit failure 不执行 reconciliation，unknown 仍保留原始
  unknown error 与一次 Provider recovery。
