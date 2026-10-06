# GEO-202 Task Brief

## 1. 基本信息

GEO-202 / R1；geo/GEO-202；负责人主代理；GEO-201=done（用户接受记录已核对）；状态completed（manifest=done）；2026-10-02 本会话用户已人工审查并接受实现与测试证据；无PR/commit。

## 2. 目标

ADMIN/ENGINEER 管理 QueryTopic 下实际变体，提供列表过滤、详情和运行入口占位。

## 3. 关联需求

CAP-GEO-02；AC-TOPIC-02/03 的变体部分；页面规格§4；WBS GEO-202完整行。本任务不宣称完整 AC-TOPIC-02 已验收；“一个主题至少有一个启用变体”是目标总体能力，当前空主题/停用最后变体可配置，其使用门禁随计划/运行任务落地。

## 4. 必读文档

用户列出的18项GEO文档、manifest/WBS/模板/Accepted ADR-001；根及子AGENTS；Trellis规范；GEO-201 prd/design/implement/task；根contracts和0045/ORM/Schema/相关测试均已读。完整来源复用用户请求及相关task，不复制目标文档。

## 5. 当前行为

0045/ORM/规范化和Create/Update/Revision/Out已具备，无变体操作/UI；旧QueryTopic.variants不导入。基线unit103、PG15（2既有metadata warnings）、相邻frontend9通过。

## 6. 目标行为

七个操作；显式mention_mode/language/region/priority；列表q/topic/intent/维度/active/sort/page；详情含主题摘要与服务端stage/action/deletion。历史后只能停用，复制新语义需创建新变体；运行NOT_IMPLEMENTED。

## 7. 范围内

根合同、Schema、Application Service/Router、最小原子审计、generated types、/geo/questions、CRUD/启停/复制/筛选、集成/组件/真实E2E、文档证据。

## 8. 范围外

所有其他GEO任务，尤其GEO-206；QueryTopic字段扩展、旧数组导入、CSV、Plan/Profile/Batch/Run/外部采集/指标/机会；无依赖升级/无关重构。

## 9. 业务不变量

PostgreSQL唯一权威；历史锁存不可逆且语义冻结；Router无写入/事务；generated API类型唯一；点名显式、无文本猜测；失败不假成功；不创建Batch/Run。

## 10. 契约变化

OpenAPI新增七操作和ListPage、topic summary、workflow/actions/deletion、run_entry unavailable。DB仅记录服务锁序/审计/错误映射，不改表；Alembic仍0045，无数据迁移。

## 11. 后端实现

User→QueryTopic→PromptVariant（User 使用 FOR NO KEY UPDATE，与审计 FK KEY SHARE 兼容）；锁后资格/revision；有效变更+1，无效/no-op不变；业务与白名单成功审计同事务；精确SQLSTATE+constraint，未知异常保留；RR固定查询详情与列表。

## 12. 前端实现

/geo/questions；URL恢复筛选/选中/new/copy；query keys唯一owner；RHF草稿独立，409/后台刷新保留，dirty与principal epoch守卫；运行入口禁用说明；加载/空/失败/资源消失/冲突完整。

## 13. 测试计划

Unit/contract drift；PostgreSQL API权限/CSRF/CRUD/revision/no-op/历史/唯一/并发/原子审计/过滤/RR固定查询；组件显式模式/动作/草稿/URL；真实API E2E工程师CRUD与持久化。

## 14. 验收标准

点名由用户显式选定；文本变化不猜测模式；历史语义不变；运行入口零Batch/Run及零外部调用；生成合同与运行一致。

## 15. 验证命令

git diff --check；make contract-check；make lint；make typecheck；make test-unit；make test-integration；npm --prefix frontend run test；npm --prefix frontend run typecheck；make e2e；按需要定向命令。准确结果记录implement.md/evidence。

## 16. 数据和上线

本地专用PG16/Redis隔离验证；不操作生产，不回填，不新migration；保留默认关闭自动能力；新主数据入口与既有Catalog一致可配置，运行仍未开放。

## 17. 风险与开放问题

历史语义、创建/删除交错、异步草稿隔离；只按用户五种条件blocked。若环境/既有门禁失败则记录真实证据，不放宽安全。

## 18. 完成证据

evidence初始指纹/共享原文、基线日志、增量diff、逐项命令结果及独立审计；最终状态review，等待人工接受。

## 19. 后续任务

GEO-206计划、GEO-301/303真实Run FK/锁存/快照；本次不实施。
