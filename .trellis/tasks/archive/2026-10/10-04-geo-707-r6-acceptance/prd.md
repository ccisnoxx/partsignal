# GEO-707 Task Brief：完成机会闭环 E2E、审计和 R6 验收

## 1. 基本信息
- Task ID：GEO-707；阶段：R6；状态：review；负责人：777 / Codex。
- 依赖：GEO-706 manifest=done、Trellis=completed，2026-10-04 人工接受已核对。
- 分支：geo/GEO-707；无提交、PR 或发布授权需求，本任务不执行提交/发布。

## 2. 目标
验证核心版 TOPIC_COVERAGE_GAP → ContentTask → RETEST → 显式 resolve 闭环，补齐首次机会审计及复测审计消费者，形成可复核的 R6 证据。

## 3. 关联需求
CAP-GEO-12/13/14；REQ-GEO-OPP-001～007；E2E-04；审计脱敏。

## 4. 必读文档
已检查根、backend、frontend AGENTS，.trellis/workflow.md、backend/frontend/infra 相关 spec，GEO-704～706 Brief/design/implement，用户指定 GEO README、路线图、WBS、执行指南、模板、manifest、核心 PRD、页面规范、业务架构/领域模型/状态机/方法字典、技术架构/数据/API/前端/测试，以及 ADR-001/002/004。合同按相关完整权威单元读取 contracts/openapi.yaml、contracts/database.md 和迁移/调用者/测试。

## 5. 当前行为
702～706 已支持确定性机会评估、认领、内容行动、冻结基线复测、服务端比较和显式决策。当前 evaluator 首次创建无审计；后端 geo.retest.created 的动作和四个事实字段未在前端审计闭合投影登记。现有分段测试与706浏览器测试未证明 TOPIC_COVERAGE_GAP 全链。行动创建/复测创建目前只有公共 API，没有相应页面。

## 6. 目标行为
五个合格零提及基线通过真实规则产生机会；认领后真实内容领域任务完成仍 IN_PROGRESS；严格同口径五个复测样本恢复后仍需显式解决。五段机会审计可展示且不复制正文、原因或凭据；首次创建重放不重复审计，写入失败整体回滚。

## 7. 范围内
- [x] 同事务首次创建审计及已存在复测审计前端消费者。
- [x] 真 PostgreSQL 纵向集成、真实本地栈 Playwright、审计脱敏。
- [x] 默认 E2E 入口、R6 文档/需求映射、合同语义及任务证据。

## 8. 范围外
无新规则、Browser Adapter、生产保留、最终上线、GEO-901/902、新身份系统、依赖升级或无关重构。

## 9. 业务不变量
PG 唯一业务事实来源；Redis 只稳定 ID。Router 不持有写事务/锁。原规则、样本门槛、状态机、权限、CSRF、不可变与审计边界保持。ContentTask 完成、比较 RECOVERED 均不自动解决；解决需最新 revision/fingerprint 和明确原因。前端仅消费 generated DTO。

## 10. 契约变化
### OpenAPI
wire shape/operation/enum/error 无变化；audit action 原为 string、facts 为闭合安全标量投影。contract-check及初始哈希对照已通过。
### Database
新增永久审计动作语义，无表/列/索引/触发器/DDL/历史回填；当前 head 0062。不修改旧迁移清单。数据库合同补真实 CREATED 与重放、回滚语义。

## 11. 后端实现
Router 无变化；evaluator 应用服务同现有 User → Catalog → identity advisory → Opportunity 锁顺序，显式操作 request_id，append_audit 不 commit。只真正 CREATED 写 opened，fingerprint 不含 request_id。query/read model、worker、队列语义不变；测试用虚构人工证据、实际规则和本地分析流程。

## 12. 前端实现
审计动作/安全字段/显示标签登记，无路由/query key/URL 状态变化。机会详情比较沿用现有加载/错误/CAS/显式恢复动作和可访问性。测试使用 UI 验证已有页面；无页面的行动/复测通过公共 API 编排，不宣称这些页面已提供。

## 13. 测试计划
- Unit：复测/首次创建审计闭合安全投影，先证实缺口。
- PG：真实规则创建、重放和事务回滚；完整 ContentTask/RETEST/比较/显式解决、冻结历史和安全审计。
- Contract：既有 generated 一致性检查。
- E2E：隔离随机 PG、Redis DB14、真实 API/分析 Worker、本地文件服务，不使用真实 AI。
- Security：审计正文/原因/敏感字段负向断言与测试产物秘密扫描；既有权限/CSRF/不可变回归。

## 14. 验收标准
1. 0/5 基线触发 TOPIC_COVERAGE_GAP，服务端机会正常关联 ContentTask。
2. 任务完成后仍 IN_PROGRESS；5/5同口径复测 RECOVERED、NOT_ESTABLISHED，显式 RETEST resolve 才 RESOLVED。
3. 原机会来源/批准事实/冻结基线保持不变，五段审计只最小安全事实、可正常投影。
4. 指定门禁结果逐项真实记录；manifest/Trellis 仅 review，等待人工接受。

## 15. 验证命令
基线：相关42项PG集成通过；make test-unit 后端3658/前端1265通过。
必须运行：git diff --check、make lint、make typecheck、make test-unit、make test-integration、npm --prefix frontend run test、npm --prefix frontend run typecheck、make e2e、make verify；追加定向与contract-check、脱敏检查。命令、环境、exit、耗时见 evidence/*.json/log。

## 16. 数据和上线
不执行生产迁移/回填/部署。使用本地独占随机数据库与稳定ID测试队列；不开生产外发。新审计仅影响未来写入，不补造历史；没有DDL逆操作；写入永久opened后，停止新写入可回退evaluator，但必须保留前后端审计登记/消费者，或前向修复，不删除历史记录。当前head在空测试数据库前滚验证。

## 17. 风险与开放问题
审计原子性由PG失败注入验证；前端闭合投影用真实payload回归；冻结口径和自动解决风险用纵向边界断言。仅用户指定五类实质阻断才 blocked；环境失败保留精确证据，能独立完成的工作继续。

## 18. 完成证据
初始工作树/hash、baseline、compose、preflight、独立只读分析与执行审计在 evidence。最终结果和差异范围见 implement.md：完整verify退出2的fixture时序失败已定向修正通过，成功目标证据复用，剩余门禁续跑退出0；manifest/Trellis均review，不把原始失败或未再次执行检查当通过。

## 19. 后续任务
GEO-901、GEO-902 保持原状态，本次不实施。
