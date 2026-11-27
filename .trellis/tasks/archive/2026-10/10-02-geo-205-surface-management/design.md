# GEO-205 设计

详细边界见prd第10–12节。安全摘要+可空管理员配置显式角色投影；typed动作与当前资格阻断为UI权威。两聚合独立revision，Profile的Surface/模式不可变。0046足以承载CRUD，不建立第二份测试状态或资格缓存。

Application Service是事务owner，读取使用一致快照与批量查询；写按User→Channel→Model→Surface→Profile锁序，锁后重新比对绑定。Registry/evaluate_profile复用GEO-204，不实现Collector或连接测试。
