# GEO-208 Task Brief

## 1. 基本信息
GEO-208 / R1；已由本会话用户人工审查并接受实现与测试证据，manifest=done、Trellis=completed，验收日期2026-10-02；主代理负责；依赖 GEO-207=done（manifest 与 completed/人工接受记录均确认）；分支 geo/GEO-208。无提交/PR/发布授权。

## 2. 目标
提供监测计划 CRUD、配置预览、activate/pause/resume/archive/copy 和 run-now 命令占位，以及一致读模型、服务端动作和原子审计。

## 3. 关联需求
CAP-GEO-04；AC-PLAN-01/02/04；AC-AUDIT-01；WBS GEO-208 完整行及其状态机/revision/并发/权限/审计验收。

## 4. 必读文档
本次读取用户指定的 README、路线图、WBS、执行指南、任务模板、manifest、产品愿景、PRD、页面规格、业务架构、领域模型、状态机、技术/数据/API/前端架构、质量策略与 Accepted ADR-001；读取 backend AGENTS、相关 spec、206/207记录、根合同、0047及现有命令/查询/测试。相关章节与差异见 design.md。

## 5. 当前行为
0047已有四张Plan配置表、完整性/归档守卫；Create/Update/Out数据组件和207矩阵预览；无Plan端点/动作/审计。默认仅manual Registry，无生产估价。大量前序dirty变更保留，起点快照留evidence/baseline。

## 6. 目标行为
ADMIN/ENGINEER共享Plan配置；新建/复制DISABLED revision0；完整配置替换、合法状态转换各变化revision+1；no-op不改版本/审计；ARCHIVED只能读/复制。预览不写。run-now通过认证/CSRF/revision/状态边界后明确NOT_IMPLEMENTED，无假成功。

## 7. 范围内
CRUD、12个文档指定operation、完整读模型、列表筛选分页、预览、状态机、revision、当前资源资格、原子审计；根合同/generated和必要测试/文档同步。

## 8. 范围外
GEO-209页面、GEO-301/303 Batch/Run/快照持久化、调度执行、外部采集、指标、机会、预算消费、真实AI；不升级依赖、不重构无关模块。

## 9. 业务不变量
PRIMARY/prompt/profile非空且唯一；配置生命周期不保存运行状态；Plan修改仅写自身配置/关系，不写任何历史；ACTIVE修改锁内重新检查资格；ARCHIVED永久只读，复制创建独立身份；业务和审计同事务。

## 10. 契约变化
OpenAPI先新增Plan路径与typed详情/列表/stage/action/deletion/run_entry/copy请求及错误；数据库只追加命令锁序/CAS/审计说明，无表/列/Alembic变化，head0047，无数据迁移。

## 11. 后端实现
Router仅HTTP/session/CSRF与service；命令独占RC事务，当前User资格锁后复核，资源锁在Plan前；读服务RR、批量查询，preview复用207；命令锁内使用同一Builder与204资格，不误用RR旧快照。

## 12. 前端实现
仅generated schema.d.ts；不新增路由/query key/URL状态/页面；209消费typed读模型，不复制状态机。

## 13. 测试计划
现有Plan/207单元与PG基线；新增状态表、JSON合同；真实PG API CRUD/状态/权限/CSRF/stale/归档/审计回滚/无秘密/固定查询数/并发编辑/资源停用交错；既有0047前滚数据保留证据。最低门禁与contract-check。

## 14. 验收标准
正常CRUD/复制独立身份；ACTIVE修改保留status且版本递增，不写历史；ARCHIVED编辑/删除/转换拒绝；stale无副作用；并发同revision仅一个变化成功；读/预览无写与N+1；run-now无Batch/Run/dispatch/成功审计。

## 15. 验证命令
精确命令与结果见implement.md/evidence：git diff --check、make lint、make typecheck、make test-unit、make test-integration（专用Compose）、make contract-check/generate及定向pytest。

## 16. 数据和上线
无新migration/生产操作。隔离本地PG/Redis/fake-oss；保留起点Colima停止/default context并在收尾恢复。无feature flag变更。

## 17. 风险与停止条件
后续快照/Batch尚不存在，208不能宣称验证真实已创建Batch；通过只写Plan边界证明隔离，完整快照验收由303完成。默认估价unknown；自动profile默认不登记。仅用户五项业务冲突/破坏迁移/安全状态变更/输入授权缺失/依赖未完条件可blocked；环境阻断如实记。

## 18. 完成证据
实际门禁：lint/typecheck通过，完整unit1247+993passed，完整integration625passed（8个既有warning），contract/build/diff检查通过；独立只读复核与Digest校验通过，记录见implement.md。
基线与最终增量/验证日志/独立只读复核及审计Digest留evidence。实现阶段交付manifest/Trellis=review；现已依据用户明确人工验收更新manifest=done、Trellis=completed，completedAt=2026-10-02。原始证据保留，未提交或归档。

## 19. 后续任务
GEO-209、GEO-301、GEO-303及后续执行/调度/采集；本次不实施。
