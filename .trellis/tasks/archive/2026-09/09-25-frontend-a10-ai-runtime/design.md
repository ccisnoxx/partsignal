# A10 设计边界

- Usage/Logs query key 分别绑定 channel、period 或 page/pageSize，且只在 active tab 启用。
- Logs 只消费服务端 actor/metadata；Audit Detail 使用全局 Audit query/renderer，不 dump raw JSON。
- URL、读取错误和 Detail intent 分离，失败重试只执行对应 GET。
