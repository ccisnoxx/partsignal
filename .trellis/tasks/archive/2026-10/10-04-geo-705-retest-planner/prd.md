# GEO-705 Task Brief

## 1. 基本信息
Task ID GEO-705；R6；负责人主代理；manifest状态done，Trellis状态completed，2026-10-04本会话用户已人工审查并接受实现与测试证据。依赖GEO-704、GEO-303均done且Trellis completed/人工接受已核对。分支geo/GEO-705已存在。无提交/PR授权。

## 2. 目标
冻结机会首次触发证据和用户明确选中的来源批次，以完全相同的根采样矩阵/输入/规则创建RETEST；无法复现返回逐项差异且不创建任何历史。幂等请求可跨后续revision重放。

## 3. 关联需求
CAP-GEO-14、CAP-GEO-05；PRD§9.7、业务流程§12、指标方法§14、WBS GEO-705。

## 4. 必读文档
用户列明的README、roadmap、WBS、execution-guide、task-template、manifest、PRD、页面规范、业务架构/领域/流程/指标、技术架构/数据/API/前端/测试及ADR001/002/004；当前根contracts、相关0048–0060迁移/服务/测试、GEO-303/704任务记录和backend spec。文档目标不代表当前实现。

## 5. 当前行为
303支持PLAN/AD_HOC MANUAL及内部SCHEDULED批次原子创建，0048已有RETEST身份字段、0059真实机会FK，但没有RETEST planner/router/冻结基线/请求回执。机会首次trigger snapshot已冻结原始窗口、规则、指标及完整来源身份；后续source追加。704行动与目标完成不关闭机会。前端复测/解决仍未接线。

## 6–8. 目标与范围
范围内：服务端预览差异、基线snapshot、完整batch矩阵复制、RETEST事务、角色/CSRF/CAS、幂等、持久化防线、合同/generated及验证文档。基线batch必须来自首次trigger当前来源（不是后来新增证据或上一趋势窗口），客户端不提供输入快照；不同条件只能新普通监测，不伪称严格复测。
范围外：706前后指标/恢复/resolve/continue及页面、707闭环E2E、Browser、生产保留/上线、新身份/依赖/无关重构。

## 9. 业务不变量
全batch根cell逐项复制（prompt/profile/repeat与input snapshot），不从当前Plan重建、不重新冻结当前字典/规则。PostgreSQL唯一来源；Router不拥有事务/锁/ORM写入。机会IN_PROGRESS才新建；复测不解决机会。Profile/Variant/Surface/主题/对象维度变更或不可用、模型观测变化均阻断；版本未知明确说明并阻断，不伪造。首次trigger及来源身份/规则/值保持；成功才持久化基线。

## 10–11. 契约与后端
GET /opportunities/{id}/retest-preview?baseline_batch_id；POST /opportunities/{id}/retest body expected_revision/baseline_batch_id，required Idempotency-Key。闭合baseline/cell/差异/receipt DTO。新0061_geo_retests在0060后增量建立不可变baseline与retest请求关系、unique/FK/复制完整性守卫，无历史回填。未知PG错误继续上抛。
READ COMMITTED命令：User非键锁→actor/key advisory→当前资源既有稳定锁序（NO KEY UPDATE，保留FK读取）→Opportunity锁后CAS→baseline/batch/roots/receipt/audit→单次commit→稳定ID dispatch。只读preview RR且禁autoflush。baseline按opportunity/batch唯一；每成功新请求推进机会revision而不改status；同键同payload重放首次结果，同键异payload409；不同键旧revision冲突。全部失败rollback。

## 12. 前端
仅canonical generated OpenAPI类型同步；不改路由/query key/URL或添加706交互。

## 13–15. 测试与验收
当前基线56unit/20PG通过，精确命令/evidence见implement.md。定向：冻结来源/完整矩阵、Profile/Variant不可用、模型变化、版本未知、身份/CAS/CSRF、同键与异键并发、重复复测、flush/audit/commit原子性、SQL旁路/不可变/前滚与metadata。执行git diff --check、make lint、make typecheck、make test-unit、make test-integration、make contract-check。API+PostgreSQL跨请求验证，本任务不创建UI旅程，707完整闭环延后。候选持久化/并发边界需fresh只读critical review。

## 16. 数据和上线
增量DDL，仅独占PG16验证；生产不迁移、不启用开关。无历史回填，不改已接受历史。downgrade安全拒绝销毁复测历史，迁移故障事务回滚/前向修复。

## 17. 风险与停止条件
当前AI配置没有平台实际版本探针；只能利用已保存Answer的模型/产品/版本观测，不能保证未来provider不变，结果可比性仍需706复核。仅用户明确列出的五类业务/授权/依赖阻断条件标blocked。环境阻断准确记录，不伪称测试通过。

## 18–19. 证据与后续
实现/命令/差异/复核证据见implement.md及evidence。实施时manifest in_progress，完成本地验证后review，等待人工接受，不done、不归档。后续GEO-706、707，仅登记。

## 人工验收完成 — 2026-10-04

本会话用户明确表示：“我已经人工审查并接受 GEO-705 的实现与测试证据。”据此记录manifest=done、Trellis=completed。上文实施与review阶段记录保留为验收前历史；本次只完成验收记录，不修改其他任务状态或实现后续任务，不提交或归档。
