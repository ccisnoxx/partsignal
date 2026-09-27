# L5 设计边界

## 权威所有者

结果已知型 reconciliation fence 必须由 `AuthProvider` 统一拥有。业务页面只能报告 exact current-actor success 已经
确定，并等待 Provider 返回；页面不能推进 epoch、拼装 auth snapshot、轮询 barrier、重放 POST 或捕获新 continuation。

## 需要区分的两个覆盖点

- 结果前 canonical GET：即使 response/commit 晚到，其服务端读取点仍早于 bulk commit，不能满足结果后的覆盖要求。
- 结果后 reconciliation：覆盖 fence 在 exact result 已知后登记，最终 canonical 读取点必须晚于该 fence。

并发合并只有在 Provider 能证明正在进行的 reconciliation 覆盖点晚于 fence 时才允许；否则必须排队新的
transition/canonical GET。结果后请求不能被当前 command barrier 直接拒绝，也不能释放旧 continuation。

## fail-closed

fence 登记后直至更晚 canonical reconciliation 完成，principal barrier、epoch、QueryClient 清理与 route 关闭均由
Provider 维护。Web Lock 缺失/acquire 拒绝、canonical GET 失败、durable marker 异常和 Provider unmount 都不能恢复旧
principal 或回调；失败语义必须与 exact 业务结果分类分离。

## 回归交错

测试必须控制“服务端读取完成”和“客户端 response settle”两个独立闸门，证明较早 GET 的读取时间早于 bulk commit，
但 response 晚于 exact success。仅先等待旧 GET 完成再释放 bulk 不足以覆盖 L5。

## 实现结构

- Provider 用单一 `pendingResultReconciliationsRef` 保护共享 command barrier，用一个 Promise tail 串行无法证明
  覆盖点的 result fence。不新增全局 store，也不向页面暴露 epoch、barrier 或 retry 权限。
- useQuery 的 canonical `loadAuthSession()` 由 Provider 登记到活动读取集合。result transition 先持久化
  `STARTED`，然后等待旧读取 Promise 真正 settle，最后复用既有 transition `finish()` 的 canonical
  reconciliation 与 durable `SETTLED` 合同。
- fence 登记会立即推进 principal epoch、移除业务 cache 并把 auth snapshot 置为匿名；之后的较早
  response 受 generation/active-command/durable-marker 三重 guard 拒绝。只有最后一个排队 fence 成功完成
  canonical read 后才释放 barrier。
- 页面对 reconciliation 失败只保留 Provider 已建立的 fail-closed：exact success 继续作为 exact
  success，unknown 继续抛原始 unknown error。页面不发起第二次 auth refresh，不捕获新 continuation，
  也不执行 selection/cache/navigation callback。
