# K1 设计：未知终态与自权限 principal boundary

## 所有权

`AuthProvider` 继续唯一拥有认证快照、principal epoch、跨标签页 transition 和 durable marker
reconciliation。业务页面只报告“当前主体的 auth-boundary 字段可能已改变”，不得自己广播协议消息、
清全局缓存或拼接 session。

## 未知终态

本地认证命令的结果分为：

1. 服务端响应已被本页按 canonical snapshot/terminal contract commit；
2. 命令明确未发出或明确未到达服务端；
3. 结果未知，包括服务端可能已提交但响应丢失，以及 terminal marker 持久化失败。

第三类不能按普通 mutation error 结束。它必须保留 fail-closed barrier，把本地 owner 的 terminal
状态送入和远端 `SETTLED` 相同的 authoritative reconciliation，然后执行一次 canonical session
read。只有该 read 完成并推进/确认 principal identity 后，页面才可重新开放受保护路由和读取。

本地发布不能依赖 `BroadcastChannel` 自回送；发送方必须显式进入同一 reconciliation。不得让
`lastStateToken` 的去重在本地 terminal 尚未消费时提前吞掉这次收敛。

## 自权限变化

Identity domain 的 self edit、single enable/disable 与 bulk status 成功结果，在命中当前 actor 且会
影响 auth-boundary 字段时，调用 AuthProvider-owned boundary transition。Provider 先发布
`STARTED`，所有页面推进 epoch、清业务缓存并关闭旧窗口；命令完成后发布 `SETTLED`，各页从原子
session endpoint 收敛。

如果页面命令必须先完成后才能知道目标包含当前 actor，则成功回调仍需启动一个专用 boundary
transition，而不是普通 refresh；transition 开始前捕获的 continuation 不得写入。实现需明确
self edit 与 bulk partial success 的 exact successful target，不得因失败项或非当前用户误触发。

## 验证边界

- Provider 单元测试固定网络相位、marker 写入结果、auth read 次数、epoch 和缓存可见性。
- 真实 BrowserContext 双页面共享 Cookie，延迟发起页响应及另一页旧业务响应，分别验证 logout
  unknown terminal、自降权、自停用。
- terminal marker 写失败需使用受控 storage fault，不允许通过删除断言或接受额外请求放宽测试。
- 保留 secret scan、数据库/Redis/端口/临时目录清理与 J1 bind sentinel。
