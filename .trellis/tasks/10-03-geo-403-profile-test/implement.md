# GEO-403 实施和验证记录

## 状态与范围
依赖 GEO-402/GEO-205 done；沿用 geo/GEO-403。manifest planned→in_progress→review→done；本地验证完成后进入review，2026-10-03本会话用户人工验收后更新done；Trellis completed。仅API Profile固定诊断；无业务Batch/Run、Worker、指标、Browser或GEO-404 Collector。

## 实现
新增管理员 POST /collection-profiles/{profile_id}/test，expected_revision与canonical Profile。服务端投影 TEST、test_blockers、test_error；工程师两字段null，无管理动作。只声明诊断answer_text，adapter采集approved=false。

事务锁 User→Channel→Model→Surface→Profile；预留 token、清资格/错误并停用/revision+1后提交，网络阶段无数据库锁。完成重验管理员、token/revisions/当前资格，提交PASSED或FAILED及固定安全摘要/revision+1。中断保持UNTESTED/停用；最新revision允许显式重试；过期结果409。

0052_geo_profile_tests新增3个可空字段、成对错误/预留约束、Profile配置与Channel/Model/Header/Surface资格失效触发器。旧API资格前滚失效，人工配置与历史快照保留。失效仅API；按Profile UUID锁定。模型删除先失效再成对解绑；没有第二个虚构revision。前向修复，55000拒绝恢复旧测试事实。

出网复用OpenAICompatibleClient固定hi/非流式与生产pinned transport；GEO要求非空answer_text。模型显式输出参数原样保留，Profile覆盖沿用max_completion_tokens（若无则max_tokens）；不按模型名称猜、不失败换参数重试。只保存固定代码/摘要，不保存原始请求/回答、URL、Header或异常文本。测试结果审计SUCCESS表示命令已提交，facts.test_status如实表示测试成败。

前端复用现有路由/query key/URL；服务端动作、确认、pending、结果、安全错误与阻断，409显式重读重新确认，取消过期GET与身份/卸载保护。不自动启用。

## 基线
- 后端相关149 passed，baseline-backend.log。
- 前端GEO Catalog116 passed，baseline-frontend.log。
- 原Colima停止、默认Docker不可用；启动Colima并创建隔离compose项目partsignal-geo403、独立PG/Redis/fake-oss，不连接真实平台。

## 诊断与修正
- 首轮单元2854 passed/3 failed：增加operation后同步冻结计数、status signature和诊断registry断言；新端点错误响应改标准ErrorResponse引用。最终make test-unit：2857后端、1125前端通过。
- 首轮完整集成68 failed/743 passed：失效触发器误影响人工模式、旧head/内部字段/并发revision断言，均已修正；限定API范围，历史0046验收仅排除0052新增列，0052另有ORM/前滚验证。
- 宿主补跑45/44失败：开发存储内部地址/签名与容器环境不同、APP_ENV限制；另并发测试常量与tuple断言错误已修复。不放宽权限、签名或环境限制。容器一致环境复验原失败范围75 passed。
- 一次完整重跑因发现已收集的旧并发测试断言而主动停止（exit137），test-integration-cancelled.log；稳定候选完整检查另记录test-integration-final.log。
- 独立审查发现max_tokens兼容性问题已修复；真实fake HTTPS请求参数3场景通过。

## 当前有效验证
- make test-unit：2857后端通过；120文件/1125前端通过（test-unit-final.log）。
- npm --prefix frontend run test：120文件/1125通过（frontend-test.log）。
- make lint、make typecheck、npm --prefix frontend run typecheck：通过，对应final日志。
- make contract-check：运行时语义与generated类型均通过。
- GEO-403真实PG/HTTPS/安全/并发/迁移：32通过（geo403-integration-final.log）；核心policy单元纳入2857。
- 原失败范围在隔离容器：75通过（container-failed-scope-final.log）。
- git diff --check：通过（diff-check.log）；本次增量2154行差异已与initial-hashes/before核对，未覆盖无关前置工作。
- 完整集成最终结果：822 passed、18 warnings、exit 0，381.31s（test-integration-final.log）。命令为 make test-integration COMPOSE='docker compose -p partsignal-geo403 -f .trellis/tasks/10-03-geo-403-profile-test/evidence/validation-compose.yaml'，复用Make目标并隔离PG/Redis/fake-oss。warnings为现有SQLAlchemy循环FK排序/dialect_options告警，不是失败或metadata漂移。

## 独立复核与限制
critical_reviewer只读复核一次；问题与处理见evidence/review.md。SUBAGENT_EXECUTION_DIGEST已生成并audit-verify通过，audit_id=20261003T083455Z-geo-403-5d21afac；无未知写入/残留活跃Worker。

没有运行真实外部AI平台、浏览器矩阵或完整E2E；本次诊断路径由真实HTTP/身份/PG/pinned TLS及组件边界验证，无新增路由。多Profile相交锁等待、网络中管理员降权/Surface变更/删除依赖未逐项动态交错；静态锁序/完成重验支撑，不声称穷举。当前仅answer_text诊断；采集仍未批准。

## 后续
GEO-404负责真实Collector请求和采集解析/批准，本次未实施。无提交、推送、部署或外部发布。

## 最终收尾

822集成检查明确exit0后状态已转review。git diff --check与43文件增量空白检查均通过，编辑前哈希匹配且无意外范围。验证compose创建的容器/网络/两卷已清理；Colima恢复原停止状态，Docker context恢复default。所有日志保留，未对真实业务数据库前滚或发布。

## 人工验收完成

2026-10-03，本会话用户明确表示：“我已经人工审查并接受 GEO-403 的实现与测试证据。”据此将 manifest 中 GEO-403 从 review 更新为 done；Trellis task 从 review 更新为 completed，记录完成日期、验收人和验收依据，Task Brief 同步当前状态。

原有测试日志、独立复核证据、未运行验证和已知限制均保留。本轮仅进行状态与验收记录收尾，并运行 `git diff --check`；未重新运行实现测试，沿用用户已接受的证据。不修改其他任务状态，不实施 GEO-404 或其他后续任务，不提交、推送、部署或归档。按文档包约定仅同步 manifest 对应 SHA-256 条目。
