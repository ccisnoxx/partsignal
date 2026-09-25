# G08 执行顺序

1. 核对 `geo-real-stack.spec.ts`、现有隔离脚本与环境预检，确认无需覆盖其他会话的数据库/端口。
2. 在当前 worktree 运行单一 GEO real-stack spec；记录 Flow A/B 与清理输出。
3. 如有失败，定位权威 owner，做最小修复、定向复验和必要独立复核；不把 fixture 通过视为真实栈通过。
4. 核对 GEO 状态/证据归属、实际 diff 与剩余风险，记录后继任务并完成 G08。
