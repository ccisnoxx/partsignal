# A08 实施顺序

1. 读取页面、model/API、直接测试、strict fixture、后端集成与状态管理 spec，确认 A07 已完成。
2. 修复 secret pending 生命周期、跨表单 baseline 与 reload 成功判定，补最小可观察交错回归。
3. 执行直接测试、PostgreSQL、production preview、typecheck/ESLint，并请求独立只读复核。
4. 检查实际 diff/工作树，记录证据、残余风险及 A09/A10，完成子任务。
