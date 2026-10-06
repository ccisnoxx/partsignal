# GEO-208 独立只读复核

critical_reviewer fresh上下文复核当前候选实现，未确认缺陷或阻断。审查User/资源/Plan锁序、旧新集合并集、锁后身份/revision重读、RC资格、ACTIVE修改/归档/copy/no-op、审计失败回滚、精确错误映射、RR读/秘密投影和501占位。代理未执行Git或测试；未观察到候选源码写入，mtime/哈希见review-source-evidence.json，主代理同期新增集成测试/文档另有工具变更证据。配置为read-only Profile；Digest中的模型与档位只是Agent TOML证据。

代理确认读取的133单元/32PG基线/117source mypy/contract成功证据，明确不把在写的新PG测试视为通过；后续主代理完成实际API/事务/并发/查询覆盖。未来Batch/Run不存在，真实冻结不可变性不能在208验证。

候选代码复核后未改行为实现；后续修改仅合同枚举测试、新增集成覆盖和一致文档。主代理验收复核交付符合风险与只读合同；所有验证以implement.md最终结果为准。
