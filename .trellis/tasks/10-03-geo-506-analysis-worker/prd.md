# GEO-506 Analysis Worker 和 revision 生命周期

## 1. 基本信息

GEO-506，R4，主代理负责；分支 geo/GEO-506。manifest 状态 done、Trellis 状态 completed；2026-10-03 已由本会话用户人工审查并接受。依赖 GEO-502/503/504/505/405 均为 done；manifest 初始 planned，初次交付 review。无提交、PR 或发布授权。

## 2. 目标

将不可变 AnswerSnapshot 接入确定性分析 Worker：COLLECTED claim、输入 hash 幂等、追加 revision、结果与指针和首次 Run 状态原子提交；失败保留证据，支持内部管理员重新分析。

## 3. 关联需求

CAP 分析与复核；AC-ANA-01/02/03/04/05/07，AC-RUN-04，AC-SEC-02/04。本任务不交付 AC-ANA-06 的人工复核命令。

## 4. 必读文档

已读取根/后端 AGENTS、Trellis workflow/backend specs、GEO README、roadmap、WBS 的完整 GEO-506 行、执行指南、任务模板和 manifest；PRD、领域模型、状态机、方法与指标、技术/数据/API/前端/Worker/安全/测试架构、Accepted ADR-002/003。已核对根 OpenAPI/database、0054 和采集相关迁移、501–505/405 Task 设计及当前相关代码/测试。

## 5. 当前行为

采集 Worker 保存答案后停在 COLLECTED；纯提及/推荐/引用/声明分析存在但没有执行生命周期。0054 建立冻结输入、事实强绑定、不可变结果和限定指针发布，缺执行元数据与引用分类落库。HTTP 分析/复核和前端详情尚属后续任务。工作树保有此前任务大量未提交变更，必须保留。

## 6. 目标行为

稳定 UUID 消息经数据库 claim；首次推进 ANALYZING，成功按复核原因进入 COMPLETED/NEEDS_REVIEW，失败进入 FAILED/ANALYSIS。重复输入返回已有 PENDING/COMPLETED revision；显式失败重跑可追加新 revision。重分析不倒退采集 Run，成功只推进指针；失败保留旧指针。

## 7. 范围内

- COLLECTED 装配、冻结输入、hash 幂等与追加 revision。
- 独立 revision 执行 lease、派发补偿、过期失败、旧 token 拒绝。
- 四段已有规则、normalized 结果、review reasons、原子 publication。
- 内部管理员 reanalyze、受控审计、必要合同/迁移/测试。

## 8. 范围外

GEO-507 的 HTTP 接口、分析查询与复核；汇总指标、Opportunity、Browser Collector；外部模型、调度计划、批量历史重分析；无关重构与依赖升级。

## 9. 业务不变量

PostgreSQL 唯一状态源，Redis 仅 UUID；答案/历史分析/事实强引用不修改删除。Router 不拥有事务。input hash 由 PostgreSQL 唯一权威函数生成。只使用冻结同产品 APPROVED 事实，不猜测未知事实或信源。首次结果与 Run/Batch 状态及 current pointer 同事务提交；后续 revision 不倒退 Run。

## 10. 契约变化

OpenAPI：无新 operation/公共字段；沿用已批准状态和错误。Database：0055 添加 geo_analysis_jobs 执行元数据和 geo_citation_classifications 不可变结果；RESTRICT、guard、延迟装配检查。无历史回填、不修改0054。

## 11. 后端实现

无 Router 写入。应用服务拥有短事务与 Batch → Run → Analysis → Job 锁序，创建绑定在末端锁 Fact；创建使用 REPEATABLE READ 冻结字典/事实；计算事务外；提交按数据库时钟重验 lease。重新分析锁最新用户校验管理员和 expected_revision；审计只保存受控原因码与 ID。Celery 参数仅 run/revision UUID，PENDING 补投递和过期失败由数据库扫描恢复。

## 12. 前端实现

无前端修改；现有运行读取可观察状态推进。后续507交付分析详情/复核和动作。

## 13. 测试计划

复用已有纯规则金标；真实 PostgreSQL/Redis/Celery 验证 claim、并发/重复、hash、初次成功/待复核、结果写入回滚、失败保留答案、expired/late token、reanalyze 历史与权限。数据库负例覆盖引用归属、装配与不可变。无真实外部 AI；独立只读并发/持久化复核。

## 14. 验收标准

- 分析失败保留原 AnswerSnapshot 与引用，不产生部分结果或成功指针。
- 同输入 hash 重复消息/并发创建只执行一个有效 revision；失败可显式重跑。
- 输入变化追加历史；成功推进 current，失败不清空；迟到旧 token 不写入。
- 首次与后续生命周期遵循 ADR-003；review reasons 保存四阶段真实原因。

## 15. 验证命令

git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration（本任务独立 Compose）。定向 Worker 集成与数据库不变量测试；每项结果写 evidence，未执行不报通过。

## 16. 数据和上线

迁移先于新 Worker；0055 只加表/索引/触发器，不回填历史。复用已有 GEO recovery 扫描参数，确定性本地分析无外发授权需求。关闭新 Worker/beat 并保留历史，前向修复；不降级删除分析证据。

## 17. 风险与开放问题

重点：RR 并发序列化、旧触发器限定 pointer-only UPDATE、首次 lease 和 revision lease 一致、重分析终态不回退。出现用户指定五类实质阻断时标记 blocked；日常实现/环境失败先诊断，不伪造成功。

## 18. 完成证据

基线定向 unit 737 passed，PG integration 21 passed；精确命令/日志在 evidence/baseline-*.{json,log}。evidence/before 保存本任务前源码/合同/文档；baseline-files.json 用于确认无关文件保留。实现、迁移与门禁已完成：lint/types/合同/diff通过，unit后端3327/前端1141，完整PG944，最后局部安全错误保护另由30项相关PG复验；0055非空历史迁移4项通过，两次fresh独立复核与审计已校验。manifest/Trellis=review，仅待人工验收；详细范围、初次失败、限制和精确argv见implement.md/evidence。

## 19. 后续任务

GEO-507 分析查询/复核 API 和数据质量/current selection；GEO-508 页面；均不在本次实现。
