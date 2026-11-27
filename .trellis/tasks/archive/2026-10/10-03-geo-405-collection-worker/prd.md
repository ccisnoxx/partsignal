# GEO-405 Task Brief

## 1. 基本信息
Task ID：GEO-405；R3；负责人：777；状态：done（Trellis completed，2026-10-03 本会话用户人工验收）；分支：geo/GEO-405；依赖 GEO-303、GEO-404、GEO-004 均 done；无 PR/Commit。

## 2. 目标
数据库权威的采集执行链，提交后投递 run ID、claim/lease、单次调用、原子结果、PENDING 补投递和过期 lease 扫描。

## 3. 关联需求
CAP-GEO-05/06/16；REQ-GEO-RUN-006/008/010；Worker 文档第 6–9 节；WBS GEO-405 完整任务行。

## 4. 必读文档
已读取用户指定的 README、roadmap、WBS、执行指南、task-template、manifest、核心 PRD、领域模型、状态机、技术/数据/API/Worker/安全/测试/运维文档、ADR-001/002/003/005、OpenAPI/database、0048–0052 迁移、依赖任务记录及适用 spec。依赖和准入检查通过。

## 5. 当前行为
工厂提交 QUEUED Batch/PENDING Run 和冻结输入；Collector 完成发送前 callback/网络安全；数据库已有 token、expiry、dispatch、revision。没有 GEO Worker 接线。API adapter 默认未批准；工厂 INTERNAL 不具有外发授权。前端读取既有状态。

## 6. 目标行为
消息仅含 run ID；数据库重载和行锁裁决 claim、发送、提交；重复消息不会再次调用；PENDING 可恢复投递；过期 RUNNING 保守 FAILED/WORKER_LOST，不自动恢复到 PENDING。

## 7. 范围内
- [x] Worker/Beat、dispatch、claim/lease、执行和原子结果。
- [x] PENDING 限批次补投递、expired lease 扫描。
- [x] 真实 Redis/Celery/PG 验证、对应配置和文档。

## 8. 范围外
GEO-406/407/506、分析/指标/机会、Browser、retry attempt、迟到证据、usage/cost/预算结算/rate limit、真实 AI、无关重构。

## 9. 业务不变量
PG 唯一权威；Redis run UUID；Provider 在事务外；每步重新加载；terminal/答案不可变；发送失败不得自动重发；冻结输入不猜测 PUBLIC；当前资格与安全门禁不放宽。

## 10. 契约变化
OpenAPI 无字段/operation 变化；Worker/数据库运行行为说明更新。数据库复用既有列和 0052 head，无新 Alembic/历史迁移。

## 11. 后端实现
Application Service 拥有事务；配置 Channel→Model→Surface→Profile，随后 Batch→Run。claim/token/expiry/状态联合守卫；发送前当前配置再次裁决；网络无事务；答案与 COLLECTED 原子提交；Batch 复用唯一纯投影；实际 UPDATE revision+1。Broker 故障保留创建回执和 PENDING，诊断不记录异常正文。

## 12. 前端实现
无路由、search params、query key、generated 类型或交互变更。

## 13. 测试计划
现有策略/Collector/config 基线；PG lifecycle/锁/结果反例；真实 Redis/Celery run ID 和重复消息；安全资格撤销；Broker 故障/补投递/expired；用户指定 lint/typecheck/unit/integration。CI fake/local provider。

## 14. 验收标准
同一 ID 并发/重复投递至多一次 provider；正文答案与状态一致；过期 token 不可提交；PENDING 超龄补发且节流；RUNNING/terminal/MANUAL 不补发；发送后失败终态保留。

## 15. 验证命令
`git diff --check`、`make lint`、`make typecheck`、`make test-unit`、`make test-integration`（隔离 Compose）；定向 pytest 记录到 implement.md。

## 16. 数据和上线
开关和 registry 未批准保持；无回填。关闭开关阻止新发送；停 Worker/Beat 安全停止，已有 SENT 不重发。预算执行留 GEO-407；有预算请求本阶段明确失败而非忽略。

## 17. 风险与停止条件
锁序、发送边界、重复消息和过期提交以定向 PG/Celery 测试与独立审查验证。仅用户列明真实 blocker 才 blocked。初始 Docker 默认 socket 不可用；恢复本地 Colima 获取集成证据。

## 18. 完成证据
见 implement.md、evidence/；基线：`UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_run_policy.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_openai_collector.py backend/tests/unit/test_geo_configuration.py -q`，exit 0。工作树基线和原文件副本已保存，保留既有修改。

人工验收：2026-10-03，本会话用户明确接受 GEO-405 的实现与测试证据；详见 implement.md 的人工验收记录。

## 19. 后续任务
GEO-406、GEO-407、GEO-506，不在本任务实施。
