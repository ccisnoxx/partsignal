# G06 设计边界

- 七参数 URL 和 API 映射由 Insights model 与 route 单点维护；所有可见指标与可操作行直接读取服务端 GeoInsights 投影。
- 优化 Dialog 的 source 取打开时的服务端 `optimization_action`，target 由用户从按需 creation-options 明确选择。提交前检查当前 Insights/options 查询与 source 身份；读失败或源变化应冻结旧写入，显式成功刷新才恢复。
- 非幂等优化命令的完整 body 决定 Idempotency-Key 复用。POST 被服务端接受后的 ID 属于终态，缓存失效和导航不能把成功转为可再次 POST；导航失败只重试打开已创建任务。
- 质量状态、空与部分结果保留数据缺口，不用客户端推测事实或动作。Print 由 G07 复用同一 read model。
