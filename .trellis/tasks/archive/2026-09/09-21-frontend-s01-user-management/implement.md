# S01 实施顺序

1. 读取页面、model/API/route、合同、直接测试与 strict fixture；记录本轮 baseline。
2. 修复已确认的三个生命周期边界，新增可观察反例测试，保持原权限、partial 与失败语义。
3. 跑定向直接、PostgreSQL、production preview、typecheck/build/ESLint；对权限和敏感值边界独立只读复核。
4. 检查实际 diff/工作树，记录证据、残余风险及 S02，完成子任务。
