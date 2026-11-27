# GEO-406 Task Brief

## 1. 基本信息
Task ID GEO-406；R3；负责人777；状态done（Trellis completed，2026-10-03 本会话用户人工验收）；分支geo/GEO-406；依赖GEO-405=done（manifest人工接受记录）；无PR/Commit。

## 2. 目标
四种外部调用状态持久化与at-most-once恢复：未发送过期租约安全恢复，已发送未知结果终止，迟到结果不覆盖终态，显式新attempt才能再次调用。

## 3. 关联需求
CAP-GEO-05/06/16；AC-RUN-05/06；业务状态机4.2/4.3；ADR-005发送隔离；WBS GEO-406完整任务行。

## 4. 必读文档
用户指定README、roadmap、WBS、execution guide、task template、manifest、PRD、domain、state machine、技术/数据/API/Worker/安全/测试/运维、ADR-001/002/003/005；根AGENTS、backend边界、相关spec、contracts及0048–0052迁移、GEO-405 Task Brief/design/implement和当前代码/测试。当前分支已是建议分支；初始未提交工作保存evidence/before及baseline-sha256.json。

## 5. 当前行为
PG已有NOT_STARTED/SENT/UNKNOWN/COMPLETED、attempt连续与唯一后继、revision/lease、终态冻结。405claim与发送回调已接线；过期RUNNING全部FAILED/WORKER_LOST；无显式retry HTTP；迟到结果拒绝写入。基础答案原子提交；引用/文件明确拒绝；budget执行未实施。

## 6. 目标行为
NOT_STARTED过期锁内撤销token→PENDING，旧Worker不能发送；SENT/UNKNOWN过期→FAILED/COLLECTOR_UNKNOWN_OUTCOME/UNKNOWN且不自动重发。完整接收但业务失败保留COMPLETED。retry追加同Batch/cell/完整输入attempt+1，原终态原样保留；重复retry409，不自动重放。

## 7. 范围内
恢复、错误发送事实合并、旧token/迟到结果守卫；显式retry服务与公共端点、generated类型和动作；真实PG/local fake测试、对应合同和文档。

## 8. 范围外
GEO-407/408/506、引用/usage/cost/预算/rate limit、分析/指标/机会/Browser、真实AI、UI旅程、依赖升级、无关重构。

## 9. 业务不变量
PG唯一权威；Redis只有Run UUID；首字节前提交SENT；已发送不回NOT_STARTED；终态/输入/答案不改；retry只追加无分叉；无答案的COLLECTION失败才可retry；provider在事务外；当前资格/安全不放宽。

## 10. 契约变化
OpenAPI新增POST /api/v1/geo/observation-runs/{run_id}/retry；required expected_revision；201稳定新attempt身份；401/403/404/409/422。不使用Idempotency-Key，前序ID和唯一后继是防分叉身份，重复409。数据库复用0052 head和现有列/守卫；无新Alembic/回填。

## 11. 后端实现
Router仅参数/权限/CSRF/投影。Service拥有User→Channel→Model→Surface→Profile→Batch→Run锁与事务；恢复/结果Batch→Run，无反向配置锁。配置Profile使用NO KEY UPDATE兼容FK；revision每次实际UPDATE+1。retry校验当前资格和冻结Profile，完整复制输入，子Run+Batch+成功审计原子提交；commit后dispatch。发送后未知故障固定非敏感错误，lease/token/期限联合守卫。

## 12. 前端实现
只generated类型与服务端RETRY动作；无路由/search/query key/UI变化。交互由GEO-408。

## 13. 测试计划
Unit复用Run策略/Collector；PG发送前后崩溃与恢复、SENT/UNKNOWN/COMPLETED、迟到成功/旧token、并发retry与审计/Batch回滚、权限/CSRF/当前资格。fake provider调用计数；现有Redis/Celery重复消息验证。最低diff/lint/typecheck/unit/integration及contract-check。

## 14. 验收标准
未发送恢复后仍同attempt且新token；旧token0次发送。已发送失败原attempt终态保留且自动补投递0；retry只建一个同输入后继；迟到结果不覆盖旧终态或新attempt；正常成功为COLLECTED/COMPLETED，不伪装分析完成。

## 15. 验证命令
见implement.md和evidence日志；基线unit退出0，PG Worker/Run46 passed。

## 16. 数据和上线
复用0052，无回填/生产迁移。registry批准false、工厂INTERNAL、开关默认关闭保持。停止Worker/Beat安全停止；回退到405恢复逻辑更保守，历史数据不变。

## 17. 风险与开放问题
发送授权和恢复交错、retry唯一/原子审计通过真实PG验证。仅用户列明的真实blocker才停止，不将环境单项缺口冒充业务冲突。

## 18. 完成证据
最低门禁已通过：lint/typecheck、后端2999与前端1125单元、全量860集成；复核修正后80项受影响集成通过。contract-check和隔离空库前滚0052通过，无新Alembic。独立critical_reviewer已接受，P2动作投影漂移已修正并以真实诊断/启用恢复当前资格验证。审计Bundle及SUBAGENT_EXECUTION_DIGEST校验通过。实际命令、失败原因、证据与限制见implement.md/evidence。实施完成时manifest与task.json为review；2026-10-03经本会话用户人工验收后manifest=done、Trellis=completed。原验证证据与已知限制保留。

## 19. 后续任务
GEO-407元数据/预算/rate limit；GEO-408自动UI纵向；GEO-506机器分析，不实施。
