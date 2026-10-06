# GEO-003 Task Brief：冻结当前 GEO 实现与契约基线

## 1. 基本信息

| 字段 | 内容 |
|---|---|
| Task ID | GEO-003 |
| 发布增量 | R0 |
| 状态 | done（2026-10-01 用户人工审查并接受实现与测试证据；Trellis 为 completed） |
| 负责人 | 本会话主代理；不委派 |
| 依赖 | GEO-001=done；GEO-002=done；五份初始 ADR=Accepted |
| 分支 | geo/GEO-003（用户建议且当前已存在） |
| 代码基线 | cd88fbf61d65018f7eb1a47b9f0f379ed47e3814 |
| PR/Commit | 未创建；本任务无提交、推送、部署或归档授权 |

## 2. 目标

建立当前 GEO 实现与契约的可追溯基线，使后续开发能区分已有文章关系级 GeoObservation/GeoInsights 与尚未实现的回答级 Batch/Run；保存 schema、route、table、query、migration、test 及本轮验证结果，不改变业务行为。

## 3. 关联需求

本任务属于 R0 基线治理，WBS/manifest 未分配独立 CAP/REQ 编号；不虚构编号。关联 PRD §10.1、§12.5、领域模型 §2.5 和 ADR-002：保留旧文章观测且不合并新旧分母。

## 4. 必读文档

- 根与 backend/frontend 的 AGENTS.md、.trellis/workflow.md，以及 backend/frontend/infra/guides spec 索引。
- [GEO 文档入口](../../../docs/geo-monitoring/README.md)、[治理](../../../docs/geo-monitoring/00-governance/01-document-governance.md)。
- [愿景](../../../docs/geo-monitoring/01-product/01-product-vision-and-scope.md)、[PRD](../../../docs/geo-monitoring/01-product/02-geo-core-prd.md)。
- [领域模型](../../../docs/geo-monitoring/02-business/02-domain-model.md)、[状态机](../../../docs/geo-monitoring/02-business/03-workflows-and-state-machines.md)。
- [架构](../../../docs/geo-monitoring/03-technical/01-technical-architecture.md)、[质量](../../../docs/geo-monitoring/03-technical/07-testing-and-quality.md)。
- [路线图](../../../docs/geo-monitoring/04-delivery/01-implementation-roadmap.md)、[WBS 完整 GEO-003 行](../../../docs/geo-monitoring/04-delivery/02-work-breakdown-structure.md)、[执行指南](../../../docs/geo-monitoring/04-delivery/04-codex-execution-guide.md)、[本 Brief 模板](../../../docs/geo-monitoring/04-delivery/05-task-template.md)、[manifest](../../../docs/geo-monitoring/04-delivery/task-manifest.yaml)。
- ADR-001～005 已完整读取，复用 [GEO-002 接受记录](../../../docs/geo-monitoring/05-decisions/GEO-002-architecture-review.md)；具体目标合同仍须在对应后续任务统一。
- [OpenAPI](../../../contracts/openapi.yaml)、[数据库合同](../../../contracts/database.md) 的 GEO/QueryTopic 与关联生命周期条款；相关 ORM、Schema、Router、Service、迁移和测试。
- 既有 G06 洞察、G08 real-stack、GEO context reconciliation 与 GEO-002 Trellis 记录用于追溯；历史测试成绩不作为本轮通过证据。

## 5. 当前行为

- 新写入只创建 MANUAL_ARTICLE_SEARCH，必须提交当前完整候选文章集合；发现/提及独立，准确性可空，截图可选。
- LEGACY_MODEL_RESULT 历史只读，保留原问题、模型、摘要、推荐、引用与准确性。
- 更正创建 supersedes_id 后继；服务端投影 current tail、历史、动作与证据。
- GeoInsights 按 MANUAL_OBSERVATION_PUBLICATION_RELATION 聚合，已有优化内容任务与不可变来源；无回答级 Run/Collector。
- canonical frontend 的 geo.api.ts 拥有 geoKeys，页面消费 generated types 和服务端 read model。
- 仓库根没有 tests/；当前测试位于 backend/tests、frontend/src 与 frontend/tests/e2e。

## 6. 目标行为

用户行为完全不变。交付基线说明与机器快照，包括三类模型对照、原始 schema/route、持久化列/FK、迁移链与当前 head、查询所有者/调用者、测试入口/收集清单和验证限制。

## 7. 范围内

- [x] 冻结当前实现、契约及源码哈希，区分源码证据与运行数据库证据。
- [x] 盘点 GeoObservation、GeoInsights、QueryTopic、路由、表、查询、迁移、单元/集成/组件/E2E。
- [x] 记录当前与目标差异及既有文档历史条款，保持目标文档的未实现状态。
- [x] 执行八项指定命令并保存精确结果；补充 GEO 定向检查，记录跳过和阻断。
- [x] 更新导航/哈希与本任务状态，交付 review。

## 8. 范围外

GEO-004、GEO-005、GEO-101、GEO-201 及任何 R1+ 实施；配置开关、夹具/金标建设、Batch/Run/Answer/分析/复核/指标/机会/Collector；业务代码、公共合同、数据库 schema、历史迁移、generated types、页面交互、依赖升级、无关重构、生产数据操作。

## 9. 业务不变量

1. 模块化单体、PostgreSQL 权威、Redis 只传稳定 ID。
2. 文章关系与回答级模型、分母和历史分开，不将摘要改装成原始答案。
3. 服务端拥有事务、资格、状态和公式，前端仅消费投影。
4. 不改变权限/CSRF/SSRF/TLS/文件资格/不可变和审计边界。
5. 普通测试不访问真实 AI 平台；环境阻断不可伪装通过。

## 10. 契约变化

### OpenAPI

零新增/修改 operation/schema/enum/error code；快照是证据副本，contracts/openapi.yaml 继续为唯一权威。

### Database

零新增/修改表、列、索引、约束、trigger、revision 或数据迁移。ORM metadata 不包含全部 Alembic CHECK/index/trigger，必须联合迁移源解读；本轮不宣称已验证运行库 catalog。

## 11. 后端实现

只读盘点 Router 认证、CSRF、REPEATABLE READ 依赖，Application Service 创建/更正/整链删除/优化命令，查询和共享调用边界。记录已存在的锁顺序、精确完整性错误映射、幂等和历史删除例外。无 Worker/Collector 实施。

## 12. 前端实现

盘点 observations list/new/detail/correct、topics、insights/print；记录 URL search、geoKeys、generated types、服务端 actions，以及 loading/empty/error/conflict/dirty/上传状态。零前端编辑。

## 13. 测试计划

- Unit：指定 make test-unit；GEO unit 定向执行。
- PostgreSQL Integration：make verify 中既有门禁；GEO/QueryTopic 现有定向集合，准确报告 skip 与环境限制。
- Contract：make contract-check，提取完整 GEO/QueryTopic operation 与 schema 引用闭包，保存哈希。
- Frontend Component：指定完整 Vitest 与 GEO domain 定向集合。
- E2E：保存七份现有 GEO spec 的收集清单，桌面 GEO fixture 集合；real-stack 保持既有隔离运行资格，不以 fixture 代替。
- Security/Performance/Ops：本任务没有新增风险机制；保留既有测试/安全扫描入口，不新建业务测试或性能结论。

## 14. 验收标准

1. 从基线能定位文章关系与历史模型的字段、接口、表、指标及前端入口。
2. 明确新 Batch/Run/AnswerSnapshot/AnalysisRevision/Review 尚未实现，旧分母不可复用。
3. schema/route/test/migration 快照与源码、哈希可对账。
4. 八项指定命令均有实际结果，完整门禁阻断有精确命令、阶段、原因和已获得证据。
5. 实际修改只有本任务文档及记录；GEO-003=review，其他任务与依赖保持不变。

## 15. 验证命令

```bash
git diff --check
make contract-check
make lint
make typecheck
make test-unit
npm --prefix frontend run test
npm --prefix frontend run typecheck
make verify
```

定向命令、退出码、通过/跳过数及收集证据见 implement.md 和基线验证记录，不把收集当作测试执行。

## 16. 数据和上线

无新开关、上线、回填或迁移；不启动其他任务。已有分支保留。撤销本任务仅需移除本任务文档和恢复其导航/manifest片段；不得撤销其他未跟踪文件或历史变更。

## 17. 风险与开放问题

| 风险/问题 | 处理 |
|---|---|
| 将 0018/0029 中间态误当当前 head | 记录 0034/0037/0043 替换结果，并区分 ORM、迁移源与 catalog |
| 混合旧文章关系与新回答指标 | 三类模型对照；旧相对变化与未来百分点语义分开 |
| 环境不能完成验证 | 保存精确命令、错误和未到达阶段；不扩大为环境修复或业务修改 |
| 初始未跟踪文档被误覆盖 | 保存初始清单，只改本任务导航、manifest和校验清单 |

只有用户列出的业务冲突、未批准破坏性迁移、指标/状态机/安全改变、必需输入/授权缺失或依赖未完成才 blocked。本次只冻结事实，不需裁决后续合同。

## 18. 完成证据

见 [implement.md](./implement.md)、[基线说明](../../../docs/geo-monitoring/04-delivery/06-current-geo-baseline.md)、[验证记录](../../../docs/geo-monitoring/04-delivery/geo-003-baseline/validation.md) 和 [最终审计](./evidence/final-audit.json)。无 Commit/PR、新 Alembic 或生产数据库证据；源码指纹、工作树范围、链接与文档包校验由最终审计记录。

## 19. 后续任务

GEO-004、GEO-005、GEO-101、GEO-201 为直接后续，需各自门禁与人工验收安排；GEO-003 review 不授权其提前执行。
