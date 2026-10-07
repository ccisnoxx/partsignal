独立复核 1：确认两项 P2。
1. geo_catalog_queries.py:24：认证 last_seen_at 在 RR 内 autoflush，同 Cookie 并发写可使 GET 序列化失败500。修复要求纯读禁用 autoflush 并真实认证同步反例证明无session UPDATE。
2. geo_catalog_queries.py:173：搜索 q 用NFKC/casefold而当前Product/display_name只SQL lower；全角型号/ß会漏查。修复要求统一规范化并保持当前Product owner。
其余锁/revision/精确映射/删除引用/审计边界未确认新问题。复核实际执行只读PostgreSQL16.15 SELECT，没有新API测试。原始完整结论见本轮代理返回。
