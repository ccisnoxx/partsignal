# 生产渲染热点诊断

测量使用 P1 完成后的 production build、Chromium 1440×1000、内存 API fixture，不使用开发服务器。

| 场景 | 结果 | 决策 |
| --- | --- | --- |
| 5KB Markdown 连续 20 次输入 | 中位数 8.3ms，p95 13.4ms，无 Long Task | 常用量级无阻塞 |
| 100KB Markdown 连续 20 次输入 | 中位数 46.9ms，p95 59.1ms，任务 50–58ms | 达到输入阈值，使用 useDeferredValue + 单点 useMemo |
| 100 条产品列表 | Ant Table 分页实际渲染 20 行，128.6ms 可见，无 Long Task | 不引入虚拟化 |

100KB Markdown 没有超过 200ms 的解析任务，因此不引入 Worker。路由和表格没有超过 200ms 的同步任务，因此不引入 startTransition。AuthProvider 的 `/auth/me` 与 `/auth/csrf` 串行关系保持不变；优化该关系需要单独评审未认证错误语义或认证 bootstrap 契约。
