# GEO-504 Task Brief：引用归属和来源类别分析

## 1. 基本信息
GEO-504 / R4；主代理；当前分支 geo/GEO-504；manifest 状态 done、Trellis 状态 completed；2026-10-03 本会话用户人工验收完成；依赖 GEO-501、GEO-106、GEO-304 manifest 均 done，前序 Trellis 记录有人工接受证据。无 Commit/PR/部署。

## 2. 目标
针对不可变原始 Citation，在冻结监测字典和版本化来源规则上产出自有/竞品/第三方类别、明确归属或歧义候选；人工修正形成独立有效投影，机器证据和原始引用始终保留。

## 3. 关联需求
CAP-GEO-08、REQ-GEO-ANALYSIS-005、AC-ANA-03/06/07；WBS GEO-504 完整行与 Accepted ADR-002/003。

## 4. 必读文档
已读根/backend AGENTS、Trellis workflow/spec 相关数据库/质量/错误合同；用户指定的 GEO README、路线图、WBS、执行指南、任务模板、manifest、PRD、领域模型、状态机、方法论、技术架构/数据/API/前端/Worker/安全/质量文档相关完整合同单元及全篇结构；ADR-002/003 全文。现有106/304/501/502/503 Task Brief/design/实施记录；根 OpenAPI 的 Catalog/Run/Answer/Analysis/source/review 组件、根 database 的完整证据/分析/复核单元及对应迁移0050/0054、Schema、代码、测试和共享金标。技能 trellis-before-dev、clean-code-design、structured-response。

## 5. 当前行为
head0054；原始 Citation 保存不可变 URL、hostname、位置/occurrences；Catalog保存精确 IDNA hostname 与 OWNED/OFFICIAL/DISTRIBUTOR/OTHER 关系。501已有十类 source_category 和 citation 修正数据合同，无引用机器分类。502/503是纯阶段，无Worker/API接线，详情仍 NOT_IMPLEMENTED。工作树大量前序改动已保存初始hash与status。

## 6. 目标行为
- 相等或以点加登记hostname结尾才匹配，拒绝前后缀仿冒、路径/query文字等误判；IDNA沿已有输入边界。
- OWNED/OFFICIAL结合自有/竞品Subject类型判断；DISTRIBUTOR/OTHER显式对应来源类别；REFERENCE_PART不证明自有或竞品，保持UNKNOWN。
- 所有重叠/共享匹配完整保留，不按长度、角色、父子关系或顺序选对象；多个对象归属歧义，类别可一致保留，但subject_id=null。类别冲突UNKNOWN。
- 第三方类别仅由显式版本化hostname规则提供；默认无预置真实域名，未登记UNKNOWN。
- 修正消费已有GeoCitationCorrection，验证本回答引用与本快照对象，独立返回有效结果；不修改原始/机器值。不实现review选择或命令。

## 7. 范围内
纯引用分析、冻结输入、规则/候选证据、人工修正投影、定向unit/PG、稳定架构说明和任务证据。

## 8. 范围外
GEO-505事实核验、GEO-506 Worker/持久化/组合revision生命周期、GEO-507/508查询与复核API/UI、GEO-604洞察、汇总指标、Opportunity、Browser、Article匹配、抓取/网络所有权验证、历史重分析；无关重构与依赖升级。

## 9. 业务不变量
原始Citation始终权威；派生结果引用稳定citation ID；规范hostname的DNS标签边界匹配；歧义不猜对象；字典/规则/结果不可变且版本可追溯；未知来源不猜；不执行标题/答案指令；无敏感数据输出。

## 10. 契约变化
OpenAPI/数据库/ORM/Alembic无变更：复用501来源枚举/修正形状与304证据组件。本任务内部纯值不冒充公共wire或新表。head仍0054，无回填；未来506持久化派生结果须按其任务补合同与迁移。

## 11. 后端实现
geo_analysis.py拥有阶段装配；geo_citation_rules.py拥有规范域名规则/冻结输入/匹配证据和修正投影。无Router/事务/锁/数据库revision/状态转换/dispatch/成功审计变更；同输入同输出，无第二hash。非法输入抛固定中文ValueError，不回显URL；未知IntegrityError保持既有处理。

## 12. 前端实现
无前端变更，generated类型/路由/query key/URL不变，详情分析继续NOT_IMPLEMENTED。

## 13. 测试计划
Unit：精确host、子域、仿冒、URL路径/query、IDNA/非transitional、IP、共享/重叠、多对象同类别与类别冲突、关系/Subject类型、十类规则、规则版本/冻结、原始位置顺序、修正清空归属/非法目标/独立机器结果、安全repr；共享引用金标对照。
PG：真实Citation/Analysis输入→纯阶段，已有review修正可追加且原始引用不变，越回答/对象修正拒绝、机器输入保留、新revision后旧review历史。
Contract：make contract-check；五项最低命令实际执行。无UI/E2E新旅程。

## 14. 验收标准
hostname边界/子域/IDNA/共享域名/人工修正均可观察；不使用contains归属；不改原始Citation、未增加后续任务运行时行为。

## 15. 验证命令
基线 uv run --project backend pytest（253 passed）、make contract-check、专属Compose下分析input/原始证据PG；结果逐项写implement.md/evidence。
最低：git diff --check、make lint、make typecheck、make test-unit、make test-integration COMPOSE='docker compose -p partsignal-geo504-validation -f <本任务evidence/validation-compose.yaml>'；增加定向unit/PG、合同、Alembic heads和文档SHA。

## 16. 数据和上线
无新Alembic/历史回填/生产迁移/开关；在隔离PG中复用前滚fixture证明0054仍可运行。撤回纯代码不删除历史。规则版本由未来506组成完整分析配置并冻结，来源规则不得在相同版本下静默变动。

## 17. 风险与停止条件
共享品牌/产品域名只确定类别而不能选一个Subject；全量候选仍复核。未经登记的第三方UNKNOWN；不推测页面内容或网络所有权。仅用户指定五类实质阻断标blocked；环境失败记录准确证据，不伪装通过。

## 18. 完成证据
evidence记录初始工作树/hash、修改前文件、实际命令/log/exit_code、候选增量与保留审查；implement.md记录实际结果。最低五项门禁全通过；unit后端3255/前端1141、完整PG909/23既有warnings，修正后定向66unit/3PG通过。本任务纯分析不改变高后果公共/持久化/权限/并发合同，主代理自查，不宣称独立review。最终manifest/Trellis均review，不自行done或归档。

## 19. 后续任务
GEO-505、GEO-506、GEO-507/508、GEO-604；只记录，不实施。
