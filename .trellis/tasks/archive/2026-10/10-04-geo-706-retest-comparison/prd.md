# GEO-706 Task Brief：干预前后比较和机会解决流程

## 1. 基本信息
GEO-706 / R6，主代理负责，分支 geo/GEO-706，base main。依赖 GEO-705、GEO-605 manifest=done，Trellis=completed且已有人工接受记录。实施后仅review，禁止自行done、提交、归档或生产上线。

## 2. 目标
在机会详情提供可解释的干预前后比较和服务端恢复判断，并让用户显式选择确认复测解决、人工解决或继续跟进；页面不把单次变化解释为因果。

## 3. 关联需求
WBS GEO-706完整行：baseline/retest metrics、样本说明、恢复规则、显式 resolve/continue；前后窗口、样本不足、未恢复、人工解决；页面不宣称因果；结果含环境/模型差异。PRD机会闭环与AC-OPP/RETEST，指标方法§20恢复规则。

## 4. 必读文档
用户列出的GEO README、路线图、WBS、执行指南、模板、manifest、核心PRD、页面规格、业务架构、领域模型、工作流、指标方法、数据/API/前端/测试/技术架构及ADR001/002/004；根及backend/frontend AGENTS、Trellis workflow与相关spec；根OpenAPI/数据库、0059～0061迁移、705/605任务记录和相关当前实现。

## 5. 当前行为
705创建严格可比的冻结基线与RETEST矩阵，并保存创建回执。机会支持acknowledge/dismiss和行动关联；尚无比较与resolve/continue。601/603公式及资格已有，当前总览读取current分析和latest审核，不能直接替代冻结历史基线。

## 6. 目标行为
服务器提供基线/复测指标与窗口、候选/合格/排除样本、冻结阈值、恢复状态和实际环境/模型/采集方式差异。达标仍需明确确认；人工解决需要非空依据；继续保持IN_PROGRESS并追加处理证据。

## 7. 范围内
- [x] 固定历史来源身份的baseline与latest retest比较。
- [x] 复用既有指标公式、样本资格和冻结恢复配置；未知与不可比显式保留。
- [x] resolve/continue事务、CAS、比较版本校验、不可变处理记录和低敏审计。
- [x] 抽屉UI、generated类型、URL选择/query key、错误/冲突/草稿保护。
- [x] 定向及指定验证、权威合同/文档同步。

## 8. 范围外
GEO-707及其他未交付能力、Browser Adapter、生产数据保留/最终上线、真实AI普通测试、无关重构、依赖大版本升级或新存储/身份系统。

## 9. 业务不变量
PostgreSQL唯一业务事实；公共合同优先，前端不计算指标或恢复状态。首次trigger与历史分析/审核身份固定；失败/pending/低样本不补零。环境完整分层，模型未知/漂移不宣称严格恢复；单次前后变化无因果结论。只有IN_PROGRESS可解决，继续不回退状态，终态不可逆。Router无事务/锁/ORM写入。

## 10. 契约变化
OpenAPI增加比较GET与resolve/continue命令及闭合DTO、动作token、比较版本；expected_revision与比较证据版本用于并发冲突，命令不自动重放。Database新增不可变decision记录，固定选择、原因、比较快照、用户/时刻及机会revision，FK RESTRICT；0062加法迁移，无历史回填，不改既有指标/状态机。

## 11. 后端实现
读端一次RR快照、批量加载、按冻结source IDs读取基线，actual retest重新验证可比性。服务端复用601/603与701恢复值，规则未知显式不可判。写端User身份锁、相关Batch→Run稳定锁序、Opportunity最后CAS；锁内重读比较版本与恢复资格，机会/处理记录/审计原子提交。人工处理独立于自动恢复，需非空code/comment；错误422/403/404/409保持显式。无Collector/Redis变更。

## 12. 前端实现
机会抽屉新增比较选择、样本/排除/完整环境和模型字段、恢复说明与非因果说明。generated DTO唯一类型；query key包含机会与所选复测，URL可恢复。加载/无复测/未完成/样本不足/不可比/未恢复/达标/已关闭；403隐藏旧数据、409保留输入并显式重读，不自动提交。复用Design System、键盘/焦点与dirty guard。

## 13. 测试计划
Unit覆盖冻结恢复政策及样本/未知/未恢复。PG覆盖历史版本、完整窗口、实际版本变化、人工/复测解决、继续、权限/CSRF、CAS/比较漂移、并发与审计回滚、追加记录不可变。Contract检查runtime及generated一致。Frontend组件覆盖选择、低样本/环境差异/非因果和冲突保护。真实API目标E2E验证处理旅程，使用隔离PG与本地fake。

## 14. 验收标准
1. 比较显示baseline/retest窗口、分子分母和样本/排除说明。
2. 低样本、未知版本、环境变化或未恢复不允许复测确认解决。
3. 达标不自动解决，显式确认才关闭；人工解决非空依据、仅IN_PROGRESS。
4. continue保持状态，记录操作者与不可变证据。
5. 页面显示环境/模型/采集方式，明确描述关联变化而无因果断言。
6. 本地验证完成后manifest与Trellis仅review。

## 15. 验证命令
必跑git diff --check、make lint、make typecheck、make test-unit、make test-integration、npm --prefix frontend run test、npm --prefix frontend run typecheck；另make contract-check、定向单元/PG/UI/真实API旅程。实际命令/退出码/log记录evidence，未运行不宣称通过。

## 16. 数据和上线
0062仅加法无回填，不重写历史trigger/baseline/evaluation。独占测试库前滚；禁止生产执行。downgrade不删除历史，失败整体事务回滚，恢复采用备份或前向修复。无新依赖或生产开关。

## 17. 风险与开放问题
历史current指针漂移、actual模型变化、规则级分母与恢复样本门槛、审查/attempt写入并发。按用户五类条件才blocked；环境失败保留证据并报告，不能伪成功。

## 18. 完成证据
初始工作区文件hash和git状态保存在evidence/initial-files.json、initial-status.txt，用于排除已有脏修改。实施前基线：140后端单元、20前端、22PG集成通过。最终候选：3658后端单元、1265前端测试、1123完整PG集成、27定向PG和1真实API目标E2E通过，lint/typecheck/contract通过；精确命令、退出码、日志、已修复失败与覆盖限制见implement.md，全部修改文件见changes.md。独立只读复核的P1恢复样本门槛问题已经红绿回归并复核关闭，SUBAGENT_EXECUTION_DIGEST已校验。manifest/Trellis仅review，等待人工接受；无Commit/PR或生产迁移。

## 19. 后续任务
GEO-707等待人工接受706后推进，当前不实现；R7不实施。
