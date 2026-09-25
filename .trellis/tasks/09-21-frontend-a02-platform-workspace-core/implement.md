# A02 实施顺序

1. 读取页面、route/API/model、合同、直接测试、strict fixture 与后台集成；记录本轮 baseline。
2. 根据只读审计结果修复权威 owner 的确认缺口，新增可观察交错回归。
3. 跑定向直接、PostgreSQL、production preview、typecheck/build/ESLint，按风险独立只读复核。
4. 检查实际 diff/工作树，记录证据、残余风险及 A03/A04，完成子任务。
