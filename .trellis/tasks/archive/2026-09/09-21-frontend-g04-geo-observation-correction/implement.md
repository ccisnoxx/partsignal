# G04 实施顺序

1. 读取页面、model、route、上传 owner、API、fixture、OpenAPI 和现有测试，记录本轮基线并核对 G03 的 query key 变更对更正页的影响。
2. 在更正页面和 model 的权威责任边界修正上下文冻结、显式刷新、上传门禁与成功 ID 交接；只增加能证明可观察状态和失败路径的测试。
3. 执行直接测试、隔离 PostgreSQL 集成、production preview 移动/桌面浏览器与受影响的 G03/G02 交接回归；独立只读高风险复核，检查实际 diff 与工作树。
4. 将实际代码、检查结果、覆盖边界和 G05 下一步写回 PRD，并完成 Trellis 子任务。
