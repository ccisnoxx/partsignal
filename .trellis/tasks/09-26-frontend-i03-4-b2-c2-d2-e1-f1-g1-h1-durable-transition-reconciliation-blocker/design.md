# I03-4-B2-C2-D2-E1-F1-G1-H1 持久 transition 收敛约束

## 已确认反例

1. Provider 初始 render 读到 `STARTED` 并关闭 auth read；effect 安装 channel 前 owner 已写 `SETTLED`。baseline terminal marker 未回放给 Provider，页面永久阻塞。
2. 页面处理了 T1 `STARTED` 但错过即时 `SETTLED`。恢复者读取 durable T1 `SETTLED` 后直接返回，T1 永久残留；后续 T2 即使正常收敛也无法清空 barrier。
3. marker key 存在但损坏、未知版本或读取失败时，parser/read 返回与“key 不存在”相同的 `null`；Provider 开放 auth read，不能证明旧主体窗口已关闭。
4. v1 与 v2 的 key、channel 和 lock 完全隔离；若存在跨版本共存，新旧页面不能互相观察 session replacement。

## 必须保持的不变量

1. durable marker 是跨丢消息、后台挂起和页面重载的权威状态；所有恢复入口必须把它 reconcile 到 Provider，而不是只去重即时事件。
2. barrier 的当前性由最新合法 durable state 与全局独占 owner lock 决定，不由事件到达次数或永久增长的本地 Set 决定。
3. 任何无法证明“没有 active transition”的状态都不得启用 canonical read；fail-closed 必须同时失效旧 epoch、清业务缓存且不恢复旧主体 UI。
4. 合法 recovery 最终只触发一次 canonical session read；canonical user、CSRF 和 binding 仍只来自原子 `/api/v1/auth/session`。
5. owner lock、lease、marker 与测试日志不得含凭据；服务端继续最终裁决权限和 CSRF。

## 已冻结实现

- durable read 使用 `ABSENT | VALID(message) | INVALID(reason, error)` 判别联合；`INVALID` 原因精确区分 malformed/unknown、legacy 和 storage unreadable。Provider 只有在 `ABSENT` 或合法 `SETTLED` 下开放 read。
- channel 不信任 BroadcastChannel 或 StorageEvent payload，而是把它们仅作为唤醒信号；初始化、即时通知、focus/visibility 与 recovery mismatch 都重新读取同一 durable slot 并交给同一 `onState` reconciliation。
- Provider 以单个 active durable transition、最后 event ID 与 fault 状态拥有 barrier。新 `STARTED` 替换旧 identity；合法 `SETTLED` 淘汰 active 或只观察到 terminal 的旧状态，并通过 exact auth query invalidation 保证一次收敛。重复 event ID 幂等，不再维护永久增长的 transition ID Set。
- 初始非法/不可读状态立即展示 Auth Error；Router 和 canonical query 均不启动。错误重试只强制重新 reconcile durable state，不会绕过 barrier 直接调用 session endpoint。
- v1 未出现在任何 remote-tracking branch 或 tag；同时保留显式 migration fence：检测到 v1 key 即 fail-closed。这样即使存在无法证明来源的旧页面或残留 marker，新页面也不会重开旧主体窗口。
