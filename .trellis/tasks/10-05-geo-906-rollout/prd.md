# GEO-906 Task Brief：生产渐进上线、最终验收与文档状态

## 1. 基本信息
GEO-906 / R8；主代理；入场分支geo/GEO-906；903/904/905均done且有Trellis人工接受记录。入场planned，实施in_progress，缺必需生产输入后blocked；本地与生产验收满足才review，done只能人工接受。生产输入缺失时blocked，不虚构review。未提交、推送、归档。2026-10-05本会话用户明确人工审查并接受实现与测试证据，实际blocked→done，Trellis=completed；原阻断、验证失败、生产未执行/未验证及既有缺口保留，验收记录见implement.md。

## 2. 目标
按ADR-006以MANUAL为正式采集方式，形成可停止、可恢复的expand/deploy/enable流程、内部试用与最终验收证据。R7 deferred不阻断核心上线；生产Browser必须false、服务/profile未启用且无会话/材料。

## 3. 关联需求
CAP-GEO-16、REQ-GEO-OPS-004/005/006/007；PRD§17、运维§4/6/10/13/14；WBS完整GEO-906行及manifest。

## 4. 必读资料
根AGENTS、Trellis workflow/infra规范；用户列出的README/governance/roadmap/WBS/guide/template/manifest、PRD/domain/workflow/methodology/技术/数据/安全/测试/运维及Accepted ADR001～006；903～905任务；人工SOP/恢复runbook。根合同按MANUAL提交/复核/指标/发送恢复/Browser/retention/观测单元读取，未宣称逐行审查31212行OpenAPI。代码依据当前deploy/activate/manifest producer、prod Compose、worker、配置检查及相关测试。

## 5. 当前行为
MANUAL提交/分析/复核/指标/机会/复测已有实现；新开关默认关闭，配置改变须recreate。候选producer要求clean main=origin/main及确定性archive/镜像身份；当前脏树不能冻结正式候选。生产计划cron及自动机会评估未接线。配置检查仍禁止geo_任务，已验收901注册retention，基线dev/omitted失败。904/905 done不消除各自现场限制。

## 6. 目标行为
阶段入口/批准/退出条件明确，复用权威发布脚本；模板缺失值为null/NOT_VERIFIED，不能生成默认通过证据；MANUAL闭环与内部人工试用分别验收；监控/停止/恢复有直接证据。无法生产则交付准备并blocked。

## 7. 范围内
发布runbook、低敏release/acceptance模板、验收及阻断记录、配置旧断言修正、指定门禁及隔离恢复/闭环验收、文档索引与状态同步。

## 8. 范围外
其他GEO任务、新cron/evaluator/claim/API或UI、804～807、指标/历史/权限变更、真实第三方普通测试、依赖升级、新基础设施、破坏性迁移及未批准生产动作。

## 9. 业务不变量
PG权威、Redis只ID；Router/Service所有权、不可变证据和历史不变；MANUAL/API指标及分母不变；Browser false且无生产会话；未知不补零/N/A；SENT/UNKNOWN不重发；生产阶段分别人工批准。

## 10. 契约变化
OpenAPI/generated/database/Alembic均无变化，head0065；无本任务回填/存量迁移/降级。发布记录为运维证据，不替代既有candidate manifest或业务状态。

## 11. 后端
不编辑Router/Application Service；事务、锁序、revision、幂等、lease和错误映射不变。配置测试允许已验收retention注册，保留三进程同配置、18场景启动零网络；不执行任务或新增批准。

## 12. 前端
无路由/query key/URL/页面状态变更。试用通过已有MANUAL/Review/Overview/Reports/Opportunity路径，缺行动/复测创建UI用已有公共API，不伪装页面能力。

## 13. 测试计划
基线配置/worker/health；候选18配置；git diff --check、make lint/typecheck/test-deploy-scripts/verify；隔离PG恢复/缺对象/中断及MANUAL纵向。生产smoke、目标恢复/停止/内部试用需入口与批准。缺失明确未运行，不新增镜像实现的测试。

## 14. 验收标准
备份/前滚/候选身份/三进程配置/Browser现场负证据完整；MANUAL提交→分析→必要复核→指标下钻→行动→同口径复测→显式解决；内部试用和观察期负责人签署；监控实测、停止/恢复无重发。全部满足才review。

## 15. 验证命令
精确命令、退出码、日志见evidence/validation-results.json及implement.md；未运行不填PASSED，补测不改写失败全门禁。

## 16. 数据和上线
expand/deploy保持四开关false及retention dry-run；MANUAL enable可启用总开关/已有机会手工评估资格，API无批准false，Browser始终false。未写运行env。upgrade维护/backup先行，existing deploy/activate控制candidate/state/lock；无clean-init授权。应用回滚只到支持当前schema版本，否则前滚。

## 17. 风险与开放输入
目标/获准入口或现场报告、candidate、各阶段人工批准、负责人/试用范围/观察期/停止阈值及容量定义尚缺，已异步请求。cron和自动evaluator缺口保留，不扩产品。独立复核确认prepared阶段artifact失败无现有恢复路径，保持维护并须发布所有者受支持方案，不能提前activate解锁。停止条件按用户五类执行。

## 18. 完成证据
evidence保存入场before/工作树/哈希、基线与候选日志、增量diff、现场NOT_VERIFIED及独立复核审计。生产秘密仅受保护通道，有材料不允许Browser N/A。

## 19. 后续
补齐同一目标输入与阶段批准后继续906；R7仍需产品重新排期及ADR006恢复，不提前实现。已done依赖的现场限制在906收口，不改依赖状态。
