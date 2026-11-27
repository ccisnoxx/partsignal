# GEO-701 Task Brief：定义 GEO 规则集契约和配置

## 1. 基本信息

- Task ID：GEO-701；发布增量R6；负责人本会话主代理。
- 状态：review；实现与本地验证完成，等待人工接受；未done、未提交/PR/发布。
- 分支：进入时已为geo/GEO-701；未执行分支创建或切换。
- 依赖：GEO-601在manifest为done，Trellis为completed；2026-10-03人工接受记录已核对。
- 当前任务目录由task.py create创建并关联本会话，不借用其他会话指针。

## 2. 目标

为管理员建立服务端权威规则配置，覆盖最低样本、阈值、机会去重窗口和复测恢复条件，支持revision与无写入preview。未来评估冻结完整实际规则和revision，历史Opportunity不因配置更新改变。本次不创建Opportunity。

## 3. 关联需求

CAP-GEO-12；PRD §9.7默认机会规则与§12指标；页面规格§12.3；指标方法§4/15；API设计§12。完整WBS GEO-701行指定交付：最低样本、阈值、去重窗口、复测恢复条件和规则revision/preview；指定测试：Schema、权限、revision、规则preview；验收：未来评估生效、历史机会保存快照。

## 4. 必读文档

根AGENTS.md、backend/AGENTS.md、frontend/AGENTS.md、.trellis/workflow.md与受影响spec索引；用户指定的README、路线图、完整WBS、执行指南、任务模板、manifest，产品PRD/页面规格，业务架构/领域/状态机/指标方法，技术/数据/API/前端架构与测试策略，Accepted ADR-001/002/004及GEO-002评审记录；GEO-601/607现有任务记录；根OpenAPI/数据库合同及当前Schema/服务/迁移/测试。具体裁决证据见evidence/blocking-contracts.json。

## 5. 当前行为

- GEO-601内部SamplePolicy默认reportable_minimum=3、stable_minimum=5；样本0/1–2/3–4/≥5分别NONE/OBSERVED/REPORTABLE/STABLE。
- geo_metrics.compare_metric_windows对非SOV时间趋势要求STABLE，对SOV要求REPORTABLE。公式与资格由服务端唯一拥有。
- GeoBatchRuleSnapshot仅schema_version=1和rule_set_revision；GeoRunInputSnapshot携带rule_set_revision。geo_batches._create从计划配置冻结revision，尚无管理员配置实体。
- 当前根OpenAPI无GET/PUT /geo/rules或POST /geo/rules/preview；前端无规则页面。
- 当前Alembic head=0057_geo_insight_indexes；Opportunity尚未实现，报告opportunity导出明确未实现。
- 当前工作树有大量前序dirty/untracked改动，必须保留。

## 6. 目标行为

管理员读取/按expected_revision更新当前规则集，服务端严格校验闭合配置并提供同实现preview；实际更新revision递增，同值保持；规则更新不重算/改写历史快照。未来正式评估与preview复用服务端规则实现。历史消费者保留完整实际配置和revision，非仅可变配置引用。

## 7. 范围内

- [x] 统一已裁决的规则默认最低样本、阈值、去重窗口与复测恢复配置。
- [x] OpenAPI、必要PostgreSQL配置模型/Alembic、Schema、管理员权限/CSRF和revision。
- [x] 无业务写入preview与未来正式评估共享边界。
- [x] 前端generated类型与规则管理表单；输入保护及服务端preview。
- [x] 相关测试和权威文档同步。

## 8. 范围外

GEO-702 Opportunity表、identity、初始批量评估与状态机；GEO-703工作台/API，704跨域行动，705复测计划，706前后比较/解决，707闭环验收；Browser、生产数据保留、最终上线、真实外部AI、依赖大版本升级和无关重构。

## 9. 业务不变量

PG唯一业务来源，Redis仅稳定ID；Router不拥有事务/锁/ORM写入；Application Service拥有规则更新不变量。规则只影响未来评估；历史Opportunity必须冻结实际配置+revision。preview与正式评估共用服务端实现；前端不重算指标或维护第二状态机。无分母null、失败不算未提及、必要复核和不可比维度门禁保持。

## 10. 契约变化

OpenAPI：已新增GET/PUT /api/v1/geo/rules、POST /api/v1/geo/rules/preview，以API设计§12为依据。完整字段/枚举/错误见根合同与design.md。

Database：已新增0058，保存单一当前规则指针与不可变revision配置，实际样本/阈值配置必须由PG读取并冻结。已新增规则JSON/历史/指针约束和v2快照验证，未执行生产迁移/回填；不能给历史只有revision的快照补造实际阈值。

## 11. 后端实现

已实现，由应用服务持有事务、行锁、CAS revision和审计，Router只参数/认证/响应。只读preview不创建机会、批次或队列消息。规则快照读取时点与其他资源锁顺序、完整snapshot演进及精确错误映射见design.md；不得用猜测默认值修复未知历史。

## 12. 前端实现

前端实现完成。配置路由为`/configuration/geo-rules`，generated API类型权威，query key由唯一domain owner持有。本地草稿独立服务器cache，dirty/409保留输入、显式更新基线、取消过期preview、principal/unmount保护；无前端业务规则计算。

## 13. 测试计划

- Unit/Contract：现有指标与Batch/Plan snapshot基线；新增严格Schema、默认与边界、revision、不可用preview及纯共享实现行为验证。
- PostgreSQL：权限/CSRF、CAS并发、原子回滚、无副作用preview、迁移前滚/约束与未来生效和历史冻结。
- Frontend：服务端preview、输入变化失效、dirty/409、权限、迟到响应；浏览器验证按实际路由/交互变化选择。
- 当前基线和候选定向证据分别保存，不以基线通过表示GEO-701验收。

## 14. 验收标准

规则更新后，未来评估读取新配置，已有触发快照逐字段不变；权限/Schema/revision/preview测试通过。GEO-702前保留明确未实现边界，不创建固定成功Opportunity。实现和本地验证完成只进入review，人工接受之前不done。

## 15. 验证命令

用户最低命令：git diff --check、make contract-check、make lint、make typecheck、make test-unit、make test-integration、npm --prefix frontend run test、npm --prefix frontend run typecheck。实际argv/退出码及日志保存在evidence；完整集成使用独占Compose覆盖COMPOSE，避免复用开发库。

## 16. 数据和上线

0058已在隔离PostgreSQL前滚验证；无历史回填或生产启用。测试Compose只运行PG/Redis/fake-oss/backend-test；不调用真实AI。停机与测试环境清理只针对本任务项目。

## 17. 风险与开放问题

| 规则 | PRD §9.7 | 指标方法 §15（§4当前STABLE≥5） |
|---|---|---|
| VISIBILITY_DROP/RECOMMENDATION_DROP | 当前/前期各至少3 | 两期均STABLE，当前默认至少5 |
| TOPIC_COVERAGE_GAP | ≥3有效非点名运行、零提及 | STABLE，当前默认≥5 |
| REPEATED_FACT_ERROR | 同一规范化错误声明30天内≥2次 | 同类错误跨≥3运行 |

例：两个可比窗口各3个合格运行，下降20个百分点；PRD允许默认触发，方法门禁拒绝。三个有效非点名运行均未提及时同样不同；两个不同运行出现同一错误时重复错误规则也不同。两种选择影响用户真实机会，而不是措辞或技术实现差异。

README §4的治理优先级明确业务不变量与指标口径高于PRD，消解三组差异；PRD同步方法§15。初始误判blocked已撤销，证据保存resolved_by_document_precedence，不需要用户新增裁决。

实质风险为配置/快照新合同、PG历史不可变和CAS竞争，由定向测试、迁移验证及独立复核覆盖。仅用户指定的未完成依赖、业务冲突、破坏性迁移、已批准合同改变或必需授权缺失时blocked。

## 18. 完成证据

完成证据已保存implement.md与evidence，全部指定命令实际执行，manifest/Trellis已review。Task Brief/prd.md、design.md、implement.md与evidence/blocking-contracts.json可恢复原因和下一步。baseline-files.json和manifest-before.yaml记录当前代码与manifest前像。精确测试结果由implement.md汇总，不提前写通过。候选已由两个fresh critical_reviewer复核，三项确认P2均修正，实际组件回归/PG反例与全部门禁完成；审计Bundle关闭验证，不将子任务交付验收推算为GEO-701人工接受。

## 19. 后续任务

完成本任务后进入review；后续GEO-702保持planned且不实施。
