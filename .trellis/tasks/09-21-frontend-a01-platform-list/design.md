# A01 设计边界

- 页面和路由沿用当前 `platformListQueryOptions` 与 URL schema，命令只使用 server projection。复核删除 intent 的当前列表身份、查询读取状态、revision 和 blocker。
- 将状态写入与读取失败分开，删除 204 之后保证旧缓存不再提供动作；409 的冻结归页面/命令会话所有，被动 refresh 不解冻。
- 严格 fixture 只证明页面与请求边界；PostgreSQL integration 证明权限/readiness/实时阻断。共享缓存或持久化合同如需修改，单独独立复核。
