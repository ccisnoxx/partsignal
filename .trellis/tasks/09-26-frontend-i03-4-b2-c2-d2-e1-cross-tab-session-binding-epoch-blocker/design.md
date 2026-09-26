# I03-4-B2-C2-D2-E1 跨标签页认证边界设计约束

## 已确认缺口

- `authBoundaryIdentity()` 未包含 `session_binding`，同一公开 user 但新 session UUID 会被当成普通 refresh。
- transition generation、auth read generation 与 command epoch 都由单个 `AuthProvider` 的 `useRef` 持有，其他共享 Cookie 的标签页不可观察。
- principal epoch 保存在当前 `QueryClient` 的 `WeakMap`，不能表示浏览器同源层面的 session replacement。
- 现有测试把 binding 改变定义为保留缓存，并只在单 QueryClient 内做顺序 mock，没有真实双 page Cookie 交错。

## 必须保持的不变量

1. 原子 `/api/v1/auth/session` 继续是 user、CSRF 与 binding 的唯一客户端认证快照。
2. binding 改变先关闭旧 barrier、推进 epoch 并清空非 auth Query，再提交新 snapshot。
3. 跨标签页通知只传播不敏感的 transition/generation/binding 事实；canonical user 与 CSRF 必须由各标签页重新读取。
4. 旧 epoch 的 read、mutation callback、callback 内 await、retry 与 offline continuation 永远不能重新成为 current。
5. 同一 binding 的正常 refresh 不触发无谓的业务缓存清理。
6. 不改变服务端权限与 CSRF 最终裁决，不增加静默兼容或固定成功路径。

## 需要在实现前确认

- `BroadcastChannel` 与受控 `storage` generation 的唯一 owner、兼容边界和生命周期清理方式。
- command 开始与提交阶段的消息顺序，以及接收标签页如何避免自回环、重复清理和 refetch storm。
- page reload、浏览器恢复、后台标签页恢复和 channel 缺失时的收敛路径。
- 测试如何在同一 BrowserContext 中共享 Cookie，同时可确定性延迟并释放旧标签页请求。
