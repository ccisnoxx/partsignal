# I03-4-B2-C2-D2-E1-F1-G1 孤儿认证 transition 恢复约束

## 已确认反例

1. 标签页 B 发布并持久化 `STARTED`。
2. B 在 `finally -> finish() -> SETTLED` 前崩溃、关闭或被浏览器终止。
3. 存活标签页永久保留 remote transition；新页面把残留 marker 作为 baseline，但无法判断 owner 是否存活。
4. canonical session 读取即使成功也被 `STARTED` guard 拒绝，手动 Retry 与全页面重载均不能恢复。

## 必须保持的不变量

1. transition 通知不是认证裁决；恢复后的 user、CSRF 与 binding 只能来自原子 `/api/v1/auth/session`。
2. active transition 未收敛时不得重新开放旧主体窗口。
3. 孤儿回收必须推进 epoch/generation 并继续拒绝旧 continuation，而不是复用旧页面状态。
4. owner/lease 判断必须能跨 BroadcastChannel 丢失、页面关闭与浏览器重载收敛。
5. payload、日志、fixture 与 localStorage 不得包含凭据或敏感用户快照。

## 已冻结设计

- v2 durable marker 精确包含 `version/eventId/transitionId/ownerId/phase/leaseExpiresAt`；严格解析并拒绝旧版本、非法 ID/有效期和额外字段。marker 不包含 user、CSRF、session binding 或任何凭据。
- 本地认证命令先取得 origin-scoped 全局独占 Web Lock，再发布 `STARTED`；owner 在命令存续期持锁并每 2 秒续租，租约周期为 10 秒，正常结束时先发布 `SETTLED` 再释放锁。
- Web Lock 是 owner liveness 的权威：后台 timer 即使被节流，其他页面也不能在 owner 持锁时接管。接收方取得同一锁后仍等待当前 marker 的 lease deadline（最多一个 lease 周期），再重新核对 exact owner/transition/phase；仍为同一 `STARTED` 才合成 durable `SETTLED`。多个候选恢复者由独占锁串行，后继者会观察到已收敛 marker，避免重复 recovery/refetch。
- `STARTED` 首先推进 transition generation 与 principal epoch、终止旧 read/command、清理业务缓存并将 session 暂置匿名；barrier 存续时禁用 canonical auth query。只有真实 `SETTLED` 或成功孤儿回收后才重新开放并执行唯一 `/api/v1/auth/session` 读取。
- 页面关闭测试以被拦截且永不返回的真实 login POST 证明 owner 已发布 `STARTED`，随后直接关闭 owner page；存活页和全页面重载分别等待真实 Web Lock/lease 回收并精确断言一次 canonical session GET，不依赖 `beforeunload`、任意刷新或测试侧删除 marker。
- jsdom 环境由测试 setup 安装最小 FIFO exclusive Web Locks substitute；Playwright 使用浏览器原生实现。
