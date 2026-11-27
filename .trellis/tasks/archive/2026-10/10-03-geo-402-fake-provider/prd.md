# GEO-402 Task Brief：GEO fake provider 与 Collector 合同套件

## 1. 基本信息

GEO-402 / R3；状态 completed（manifest=done，2026-10-03 本会话用户人工验收）；负责人为本会话主代理。依赖 GEO-401、GEO-005 均 done，已核对人工接受记录。当前分支 geo/GEO-402。无提交、PR、推送、部署或归档。

## 2. 目标

提供完全本地、可脚本化的真实 TCP provider 替身及 Collector 合同套件，检测每 attempt 请求次数、发送后自动重试/重定向、失败语义和敏感信息泄漏。

## 3. 关联需求

WBS GEO-402 完整任务行、Worker/Collector §17、质量策略 §5、PRD AC-RUN-02/03/05 与 AC-SEC-02。WBS 未给独立 CAP 编号；关联追踪矩阵 REQ-GEO-EVIDENCE-005，本轮仅验收本地 Collector 日志/产物边界。

## 4. 必读资料

根/后端 AGENTS、Trellis workflow、后端和 CI spec；用户列出的 GEO README、路线图、WBS、执行指南、模板、manifest、PRD、领域模型、状态机、技术/数据/API/Worker/安全/质量/部署设计及四份 Accepted ADR。大型文档按结构及本任务相关完整章节读取。GEO-401/GEO-005 任务与人工接受记录；当前 OpenAPI 的 Run/Answer/Profile 组件、数据库对应合同、0048/0050/0051 迁移及当前 Collector/fixture/pinned transport 和测试。

## 5. 当前行为

GEO-401 仅定义不可变请求/结果/稳定错误与 before_send，默认 Registry 只有 manual。GEO-005 有版本化虚构语料。现有内容生成 fake 服务保存请求全文且使用 GeneratedDraft，不适合作为 GEO 替身。无 GEO 故障/计数网络套件。

## 6. 目标行为

真实回环 TCP 模拟 success/citations/429/timeout/disconnect/redirect/oversize/invalid response；按 run UUID 记录次数和正文 SHA256，不隐藏重复。合同断言可接入未来 Collector；本轮只用测试专用驱动验证套件，并直接测试既有 pinned transport。

## 7. 范围内

- 本地 fake provider、实例隔离、线程安全计数和有界资源生命周期。
- 复用虚构语料、Collector 合同断言、真实故障及正反例自测。
- CI 本地验证脚本、Makefile 接线、文档、manifest 和实施证据。

## 8. 范围外

GEO-403 管理连接测试/资格；GEO-404 生产解析器和 adapter；GEO-405/406 Worker/lease/恢复；GEO-803 Browser 模拟站；分析/指标/机会；真实外部平台、数据库和前端行为。技术文档将调度扫描误写为 GEO-402，按 WBS 修正说明而不实施扫描。

## 9. 不变量

PostgreSQL 仍为业务权威，替身内存仅为测试观测，不保存业务状态。Collector 不获得 ORM/事务。重复调用如实记录，不能由 fake 去重伪造 at-most-once。凭据/正文/Header 不进统计与日志；只使用虚构数据，不抓取引用。

## 10. 契约变化

OpenAPI、数据库、Alembic、generated 类型不改；head=0051_geo_manual_collection，无前滚/回填。fake 独立测试协议的模式/计数约定写在 backend/tests/fixtures/geo_provider/README.md。

## 11. 后端设计

业务 Router/Application Service/Read Model/Worker 不变。标准库 TCP 替身支持真实流和断连。实例锁拥有计数及场景，响应外 I/O 不持锁；每个新 attempt UUID 独立。合同断言使用既有 GeoCollector/CollectedAnswer/CollectorError，测试驱动不登记生产 Registry。套件验证回调失败零请求、完整响应状态及发送后失败不安全重发，但不声明已完成持久化发送隔离。

## 12. 前端

无路由、query key、URL、页面状态或用户旅程变化。

## 13. 测试计划

基线 Collector/registry/fixture/pinned HTTP 166 passed（evidence/baseline.log）。真实 TCP 模式/脚本配置、计数哈希、实例与并发隔离、secret 反例、套件故意错误驱动检测；既有 pinned transport 的故障矩阵。指定五个根命令与新脚本，记录退出码/日志，部署环境不足时不伪称通过。

## 14. 验收

同一 UUID 两次发送显示 count=2；不同 UUID 各 count=1；无授权发送 count=0。成功与引用保持原文、位置、unknown/partial 元数据。429/timeout/disconnect/redirect/大小/非法回答可复现。套件拒绝自动重试/跟随重定向/敏感错误；日志及产物 secret scan 通过。

## 15. 命令

`git diff --check`、`make lint`、`make typecheck`、`make test-unit`、`make test-deploy-scripts`；新 `make test-geo-collector-contract`；指定脚本 Ruff 和合同定向 pytest。依赖 API 不变，不运行无关 PostgreSQL/Worker/浏览器门禁。

## 16. 数据和上线

不启用业务开关，不部署服务，不改变 Compose。回滚删除本任务新增文件并恢复本任务 Makefile/文档片段，保护前序未提交工作。fake 仅回环、单进程，终止即清空观测。

## 17. 风险与停止条件

真实断连不能用 ASGI 异常冒充；使用标准库 socket。计数不能通过去重掩盖重发。脱敏扫描不替代通用 DLP 或业务审计。仅文档/ADR不可解冲突、破坏性历史迁移、安全/状态/指标变化、必需外部输入/授权缺失、依赖实际未完成触发 blocked。

## 18. 证据

实施与逐项验证写入 implement.md；起始工作树/所有文件哈希、文档与 Makefile 基线在 evidence/。实现及本地验证已完成，状态 review；57 项合同自测、lint/typecheck/unit/contract/diff 通过。make test-deploy-scripts 因 Docker socket 缺失在前置构建失败，后续 recipes 未运行；精确结果见 implement.md 和 evidence/validation-results.json。2026-10-03 本会话用户已人工审查并接受上述实现与测试证据；现仅记录人工验收完成，保留所有原有验证结果及环境缺口，不改动其他任务状态或实施后续任务。

## 19. 后续

GEO-403、GEO-404、GEO-405/406、GEO-803 继续按 manifest 依赖推进，本轮不实现。
