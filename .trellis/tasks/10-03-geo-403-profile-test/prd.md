# GEO-403 API Profile 连接测试和能力验证

## 1. 基本信息
- 发布：R3；状态：completed（manifest=done，2026-10-03 本会话用户人工验收）；负责人：Codex；分支：geo/GEO-403；无 PR/Commit。
- 依赖：GEO-402、GEO-205 在 manifest 均为 done，前置 Trellis 记录 completed。

## 2. 目标
管理员可以显式诊断当前 API Profile 的连接和已声明能力，读取安全结果；任何依赖配置变化都使旧资格失效。诊断不创建业务 Batch/Run，成功不自动启用。

## 3. 关联需求
GEO WBS GEO-403、API Profile 管理与连接测试；不扩大到 GEO-404 的采集合同。

## 4. 必读文档
已读取根/backend/frontend AGENTS、Trellis workflow 与相关 backend/frontend/infra spec；GEO README、roadmap、WBS、execution-guide、task-template、manifest、core PRD、domain model、workflows、technical/data/API/worker/security/testing/deployment 文档、ADR-001/002/003/005、GEO-402/GEO-205 task 记录、当前 OpenAPI/database/0046–0051 迁移和相关源码测试。目标文档不是当前实现事实。

## 5. 当前行为
Profile 只有 UNTESTED/PASSED/FAILED 和时间，无 test HTTP 命令、错误摘要、依赖资格失效机制。Registry 仅 manual。已有 pinned HTTP、AI 模型连接测试、共享能力资格裁决、管理员配置页面和 revision 命令；Worker 尚无 API Collector。相关基线后端 149 passed；前端 116 passed。

## 6. 目标行为
显式管理员/CSRF/revision test 命令执行一次固定诊断请求；当前状态和安全错误来自服务端。API 诊断 adapter 仅登记已实现 answer_text 能力且未批准采集。缺少批准、开关、有效模型或能力时在出网前失败。结果仍禁用；旧配置结果不能覆盖新配置。工程师无诊断错误/动作/配置。

## 7. 范围内
- 管理员 test 命令、服务端动作和阻断、错误摘要。
- 当前资格失效、无锁出网和过期结果保护。
- 真实 pinned TLS fake HTTPS、数据库约束/并发、前端状态和合同验证。

## 8. 范围外
GEO-404 Collector、自动 Worker/lease、机器分析、指标、机会评估、Browser Collector、真实外部平台测试、无关重构和发布。

## 9. 业务不变量
1. PostgreSQL 为唯一状态来源；不创建业务 Run/Batch，不发 Redis 消息。
2. Router 不拥有事务、行锁、ORM 写入；应用服务拥有管理员重验和事务。
3. 诊断保留三个既有状态，不自动启用；连接/能力/合规/模型变化后旧资格失效。
4. 所有出网经过 pinned transport 的 SSRF/TLS/peer/redirect/size 限制，无写入自动重试。
5. 不保存响应正文/请求凭据；错误摘要只用固定安全映射。

## 10. 契约变化
- OpenAPI：POST /api/v1/geo/collection-profiles/{profile_id}/test，GeoConfigurationRevisionRequest；响应 GeoCollectionProfileRead。管理员读取 test_error/test_blockers，动作 TEST。
- 数据库：Profile 内部 attempt UUID、安全错误 code/summary；0052_geo_profile_tests；约束及当前配置依赖失效触发器。历史 GEO 记录不修改；删除模型仍 paired SET NULL。

## 11. 后端实现
Router 只委派。服务事务锁 User→Channel→Model→Surface→Profile，预留 attempt、禁用/清旧资格/revision+1 后提交；网络在事务外；完成重锁并校验 attempt、revision 与依赖 revision，写状态/审计/revision+1。失效触发器只改当前 API Profile 并按 UUID 锁定；所有 config/header/model/surface 实质资格变化覆盖。

## 12. 前端实现
复用现有路由/query key/URL。只消费 generated 类型和服务端 actions/blockers。确认后发送一次；等待/失败/成功反馈，409 显式重读，重复点击阻止，过期 GET 不覆盖，卸载不应用晚结果；保持 dirty/focus/键盘语义。

## 13. 测试计划
- Unit：诊断能力与收集资格分离、失败映射、OpenAPI 语义。
- PostgreSQL Integration：前滚、触发器、权限/CSRF、无业务记录、成功仍禁用、并发重复/配置变化。
- Transport：真实 pinned transport→真实验证 TLS fake HTTPS，证书/peer/redirect/响应大小和错误。
- Frontend：服务端动作、确认、pending、PASSED/FAILED、409重读、工程师摘要。
- E2E：本次路径由真实 HTTP/PG 集成与组件可观察边界直接验证；无路由改动，无浏览器矩阵要求。
- 独立只读复核公共合同、失效与并发候选增量。

## 14. 验收标准
固定诊断请求成功返回 PASSED/时间但 inactive；失败只有安全摘要；不产生 Run/Batch/指标；配置变更或失效使旧资格无效；重复 revision 不重复出网；无管理员或 CSRF 不能测试。

## 15. 验证命令
必跑 git diff --check、make lint、make typecheck、make test-unit、make test-integration、npm --prefix frontend run test、npm --prefix frontend run typecheck。另跑定向 PG/TLS 及 make contract-check。完整集成使用隔离 compose 项目 partsignal-geo403，无真实平台。

## 16. 数据和上线
现有功能开关继续裁决。先前滚 nullable 字段及失效约束再部署；旧 API 资格清为 UNTESTED/inactive，不修改历史快照。项目迁移 forward-only，恢复用前向修复/关闭 API 开关；无发布授权，不部署。

## 17. 风险与开放问题
并发配置修改：预留及依赖版本校验；旧结果409。敏感错误：固定映射。仅 answer_text 诊断支持：未知搜索能力明确阻断；采集未批准。环境：原 Colima 停止，已启动隔离验证，完成后恢复。
停止条件限定用户给定五项；普通测试失败先定位修复。无未消解业务冲突。

## 18. 完成证据
证据存 evidence/，初始工作树与哈希、baseline-backend.log(149)、baseline-frontend.log(116)、before/增量快照。最终结果补充 implement.md；未运行检查不声称通过。

## 19. 后续任务
GEO-404 实现 OpenAI-compatible GEO Collector；只保留明确交接，不实施。

本地验收证据：822 集成、2857 后端单元、1125 前端均通过。2026-10-03 本会话用户已人工审查并接受实现与测试证据；manifest 更新为 done，Trellis 更新为 completed。原有验证结果、独立复核和限制保留，详见 implement.md。
