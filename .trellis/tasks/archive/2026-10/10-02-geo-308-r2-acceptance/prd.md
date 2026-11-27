# GEO-308 Task Brief：R2 并发、不可变与兼容性验收

## 1. 基本信息
GEO-308 / R2；状态done，2026-10-03已由本会话用户人工审查并接受实现与测试证据；Trellis状态completed；负责人主代理；分支geo/GEO-308（进入时已有）；直接依赖GEO-307=done，task.json=completed及2026-10-02用户人工接受记录一致。按planned→in_progress→review交付后经人工接受完成；未提交、归档或发布。

## 2. 目标
既有文章关系GEO不回归，新人工回答级观测可业务试用；以真实数据库和浏览器证据证明R2并发与不可变合同。

## 3. 关联需求
WBS GEO-308完整行：补齐取消/提交竞态、不可变触发器、旧文章观测导航兼容和R2验收证据；make verify + GEO E2E。路线图R2退出门禁，PRD 9.4/9.5、11.3 MANUAL、12.5、AC-RUN-01..04，页面规格1.1、6、7，Accepted ADR001/002/003。

## 4. 必读文档
已读取根/后端/前端AGENTS、Trellis workflow及受影响spec；用户列出的README、delivery 01/02/04/05/manifest、产品PRD及页面规格、领域/状态机、技术/数据/API/前端/Worker/测试质量与ADR001/002/003。大PRD与根合同按完整相关章节/operation/schema及引用依赖读取；阅读当前0048..0051迁移与冻结SQL、manual service/state policy、相关测试、旧GEO真实栈及导航、307 prd/design/implement与接受记录。当前实现及根合同为运行事实权威。

## 5. 当前行为
303工厂、305MANUAL命令、306一致读、307UI均已交付。旧文章观测模型/API/更正链/洞察独立。人工提交原子冻结并COLLECTED，分析NOT_IMPLEMENTED。取消/重试只有策略，无HTTP命令，读模型不投影可执行动作。已有并发提交及触发器反例，欠缺确定先后与跨已提交事务完整行保留证据。307完整E2E留下上传postDataBuffer=null与共享content_editor改密污染。

## 6. 目标行为
真实PG验证取消与submit两个顺序、save与submit两个顺序；已提交Batch/Run/Answer/Citation/创建身份/主体关系/提交身份拒绝SQL篡改，失败原子回滚且新连接可读。旧URL导航/刷新/更正历史和优化链真实E2E通过；三次manual业务演示由runs-real-stack既有用例完成。

## 7. 范围内
- [x] PostgreSQL确定性竞态及事务后不可变反例。
- [x] 旧文章观测导航、书签刷新和新运行中心并存。
- [x] 精确修复妨碍GEO验收的上传测试观测、账号隔离、数值搜索词的URL编码断言与问题库E2E手工URL构造。
- [x] R2证据、最低命令结果、文档及状态。

## 8. 范围外
不实施其他GEO任务；无API/BROWSER Collector、调度、分析、指标、机会、真实AI、数据迁移、依赖升级或无关重构。取消HTTP/UI仍未接线，测试内SQL取消writer不作为生产能力。

## 9. 业务不变量
PG唯一业务来源；Redis稳定ID且本任务无新增消息；Router无事务写入；Application Service拥有资格与原子性。generated DTO唯一API类型。旧文章分母不混入新Run；未知费用/分析不补零或成功。正式证据/终态不改不删。

## 10. 契约变化
OpenAPI、database合同与Alembic预计零变化；head=0051_geo_manual_collection。所有数据库反例使用真实SQLSTATE和具名constraint，不放宽guard，不改历史迁移。

## 11. 后端实现
仅tests新增。锁测试使用独立Session、Event/Queue、有界statement_timeout与pg_blocking_pids证明真实等待；不移除生产锁。取消writer仅测试使用Batch→Run与既有require_cancellable/run_transition，标注不是HTTP应用命令。提交继续既有锁序User→identity→Surface→Profile→Batch→Run→Draft→UUID Files。检查失败/成功revision、回执、草稿、文件引用、审计及完整行。无Worker/Collector。

## 12. 前端实现
保留/geo/observations/new、/{id}、/{id}/correct、/geo/insights和/geo/runs；导航双入口与旧URL筛选/刷新可恢复。无query key、URL Schema或动作变更；真实E2E使用UI现有业务mutation。上传验证改用真实签名GET完整字节与hash，仍断言一次PUT、来源/路径/CSRF/204/complete。工程师测试使用自己的账号，保持must_change_password真实边界。

## 13. 测试计划
基线：后端1382passed、前端59passed、PG77passed；命令与日志见evidence。新增PG定向、旧GEO/runs定向E2E，随后执行所有用户指定命令；contract、迁移非空旧GEO兼容和文档hash检查。实际结果更新implement.md。

## 14. 验收标准
取消先提交：submit拒绝且无答案/身份/成功审计；提交先取消：取消策略409且完整答案/身份不变。保存先提交：stale draft409保留赢家草稿；提交先保存：保存409不重建草稿。跨已提交事务SQL改/删/追加拒绝且完整聚合不变。旧文章更正/洞察/优化流程与新MANUAL业务演示通过。失败门禁如实记录。

## 15. 验证命令
最低全部执行：git diff --check；make lint；make typecheck；make test-unit；make test-integration；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；make verify。另定向PG及GEO E2E。

## 16. 数据和上线
无新revision/回填/生产迁移。只在任务独立Compose和E2E独占数据库验证base→0051及旧数据前滚；API/BROWSER/机会开关保持关闭。退出清理本任务数据库/容器/临时OSS；回退测试及文档不改业务历史。

## 17. 风险与开放问题
Colima进入时Stopped，已启动现有运行时；不改变生产配置。取消无公共命令的边界必须在证据明确。全门禁不得掩盖原有失败；只按新增证据修复相关测试。仅用户列举的业务冲突/破坏迁移/状态安全变更/输入授权缺失/依赖未完成才blocked。

## 18. 完成证据
证据保存在evidence；起始hash/start-status与候选文件baseline已保存。编码前已输出12项preflight；实际验证、变更与残余风险已写implement.md。2026-10-03本地验收结束，manifest/task=review、completedAt=null；所有指定命令已运行，首次verify失败及恢复成功分开记录。不声称未运行门禁通过。

## 19. 后续任务
GEO-401..408负责API Collector/恢复及自动观测；GEO-501以后负责分析复核；本任务不实施。取消/重试公共命令须在后续明确授权任务接线，不暗中新增。
