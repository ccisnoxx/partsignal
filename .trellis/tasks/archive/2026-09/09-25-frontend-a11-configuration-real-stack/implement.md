# A11 实施顺序

1. 复核 A03/A04/A06/A09/A10 证据、Configuration real-stack、Prompt Preview UI 与 provider/Usage 合同。
2. 为 Preview 和正式生成创建独立支持数据，加入真实 Preview 选择、确认、Job/ContentVersion 与精确计数断言。
3. 通过加固后的 `deploy/scripts/e2e-local.sh` 执行 production real-stack，核对 secret scan、数据库、Redis、端口、存储与子进程清理。
4. 执行类型、lint、相关直接/后端检查和独立复核；关闭 A06/A11，记录 W01 前置已满足。
