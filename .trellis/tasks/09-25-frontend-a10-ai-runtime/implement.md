# A10 实施顺序

1. 读取 Usage/Logs page/model/API、Audit Detail、直接测试、strict/real-stack fixture、后端集成与合同。
2. 修复 lazy query、URL、聚合/分页、actor、Detail、错误/focus/unknown 边界并补回归。
3. 执行直接、PostgreSQL、production browser/真实栈、typecheck/ESLint 与独立复核。
4. 检查实际 diff/工作树，记录证据并完成 A10，交接 A11。
