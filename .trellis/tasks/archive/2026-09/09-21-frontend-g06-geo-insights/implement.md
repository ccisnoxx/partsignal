# G06 实施顺序

1. 核对合同、OpenAPI、read model/model/page/route 与严格 fixture；运行当前直接、PostgreSQL 和 production preview 基线。
2. 针对确认差距在 Insights 的权威 owner 修复查询/命令状态边界，保留服务端动作投影，增加证明可观察交错的最小回归。
3. 验证直接测试、隔离 PostgreSQL、移动/桌面 production preview、typecheck/build、定向 lint；高风险命令状态由独立只读复核。
4. 检查实际 diff/工作树，记录代码、证据、残余风险及 G07 下一步，完成子任务。
