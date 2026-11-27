# GEO-404 Task Brief：OpenAI-compatible GEO Collector

## 1. 基本信息
GEO-404 / R3；状态 done（Trellis completed，2026-10-03 本会话用户人工验收）；负责人 Codex 主代理；分支 geo/GEO-404（会话起点已存在）。依赖 GEO-401、GEO-403 在 manifest 均为 done，Task Brief/实施证据记录 2026-10-03 人工接受。无 PR/Commit/发布。

## 2. 目标
受控调用方可以用冻结问题执行一次无品牌污染的 Chat Completions，并获得符合既有存储合同的原始回答、引用和已报告元数据，失败保留严格大小、安全摘要及明确发送状态。

## 3. 关联需求
WBS GEO-404 完整行；CAP-GEO-03、AC-RUN-01/02/03、AC-SEC-02；Accepted ADR-001/002/003/005。

## 4. 必读文档
用户指定的 README、roadmap、WBS、execution-guide、task-template、manifest、core PRD、domain/workflows、technical/data/API/worker/security/testing/deployment 及四份 Accepted ADR 已读取。根/backend AGENTS、Trellis workflow/backend 索引、AI 配置/错误/质量规范及 GEO-401/402/403 记录已定位。当前权威为根 OpenAPI、database、0048/0050/0052 与 Collector/Transport/Profile 源码测试。

## 5. 当前行为
已有 GeoCollector、不可变请求/结果及稳定错误。Registry 的 openai-compatible-chat 仅 answer_text 固定诊断、approved=false。Pinned transport 固定 DNS/peer/TLS，禁止 redirect/retry，但没有发送授权回调和可消费发送阶段。没有生产 collect/estimate 实现，内容生成客户端解析 GeneratedDraft。人工/历史不变。基线 177 passed，精确命令见 evidence/baseline.log；起点哈希及工作树见 evidence。

## 6. 目标行为
原 prompt 为唯一 user 消息、stream=false，不注入品牌/事实/system/tool 上下文。独立解析 string content、结构化引用、来源、搜索三态、partial usage 和有限精确费用；未知为 None。响应不修复、不截取成功；非法/超限/截断明确失败。发送回调恰在首字节前，失败零请求。

## 7. 范围内
- [x] 受控内存配置的 OpenAICompatibleGeoCollector、纯校验、unknown estimate。
- [x] 独立原始响应解析及最小 pinned transport 扩展。
- [x] 真 Collector contract、请求与响应金标、SSRF/TLS/脱敏及指定门禁。
- [x] 当前实施说明、Task Brief/证据与 manifest in_progress→review。

## 8. 范围外
GEO-405 Worker/claim/lease/dispatch；GEO-406 恢复；GEO-407 持久化费用/预算/限速；GEO-408 UI/完整自动观测 E2E；分析/指标/机会/Browser；真实平台；依赖升级；历史迁移；提交/PR/部署。Registry approved=false 和现有诊断资格不改变。

## 9. 业务不变量
PostgreSQL 唯一业务状态，Redis 只 ID，Collector 不持有 Session 或决定状态/指标。发送后不 retry/redirect/换地址。PUBLIC 仍须调用方授权；无独立 INTERNAL 外发授权输入时 Collector 拒绝非 PUBLIC，不将已有 INTERNAL 批次当许可。未知搜索/费用/usage 不补零，不用能力推导事实。凭据/debug/header/cookie 不进入结果、摘要或错误。

## 10. 契约变化
仅内部 Python transport 扩展和 adapter。无 OpenAPI operation/schema/enum、数据库表/列/索引/约束，Alembic head 0052_geo_profile_tests 无变化，无前滚、回填或生产迁移。

## 11. 后端实现
Router/Application Service/Read Model 不变。Collector 使用受控一次调用内存配置，绑定 channel/model UUID，直接依赖 pinned transport；外发当前资格及 SENT 由 before_send 的未来服务实现裁决。Transport 唯一拥有 URL/DNS/peer/TLS/发送和限额，错误提供细阶段，GEO 映射闭合稳定错误，不改变既有 AppError wire。

## 12. 前端实现
无路由、query key、URL、generated 类型或页面状态变更。

## 13. 测试计划
Unit/Contract：无品牌请求、配置/分级/绑定拒绝、原文、结构化引用位置/安全URL、partial usage、cost unknown/精度/零、非法JSON/content/截断及大小、固定错误。真实本地 TCP/TLS：callback 时点/拒绝、send失败不切地址、429/timeout/disconnect/redirect/chunked大小、混合DNS/peer/证书/SNI/Host，secret scan。无数据库/Worker/页面新行为，不增加 PostgreSQL/Redis/E2E 验收。

## 14. 验收标准
不调用 GeneratedDraft/parser；只有原 user prompt；未知搜索/费用 None。一次 collect 最多一个请求，回调拒绝为零；已发送失败不 SAFE_BEFORE_SEND。响应字段满足既有持久化大小/文本/URL/精度，无敏感 raw 或异常内容。Registry 及平台授权边界不放宽。

## 15. 验证命令
基线：UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_collector_contract.py backend/tests/unit/test_geo_collector_registry.py backend/tests/unit/test_geo_collector_suite.py backend/tests/unit/test_geo_profile_test_policy.py backend/tests/unit/test_pinned_http.py。
新增定向 pytest；make test-geo-collector-contract；git diff --check；make contract-check；make lint；make typecheck；make test-unit；文档 SHA 校验。实际结果见 implement.md，未运行不声称通过。

## 16. 数据和上线
无迁移/数据写入/新配置项，自动开关默认关闭。不注册生产执行工厂或派发任务；未来 Worker 接入时重读权威资格、绑定和分级。恢复可撤销本任务实现；历史不变。

## 17. 风险与开放问题
发送阶段误判、参数污染、非法响应变成功由真实故障和金标反例保护。现有 INTERNAL 批次没有外发授权；本任务显式拒绝，授权装配属于 Worker 任务。只在用户列明五类阻断时 blocked。参数白名单和响应支持字段以 design.md 为当前 adapter 内部合同。

## 18. 完成证据
Task evidence 含起点哈希/副本、基线及后续增量/测试/独立复核。最终 implement.md 记录实际命令、范围及限制，不把运行状态当独立复核验收。

## 19. 后续任务
GEO-405、GEO-406、GEO-407、GEO-408；仅列交接，不实施。
