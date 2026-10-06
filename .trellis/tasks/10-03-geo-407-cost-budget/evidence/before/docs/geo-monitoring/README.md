# PartSignal GEO 监测平台文档包

| 项目 | 内容 |
|---|---|
| 文档包版本 | V1.0 |
| 编制日期 | 2026-10-01 |
| 目标仓库 | `ccisnoxx/partsignal` |
| 产品形态 | 公司内部单租户系统 |
| 目标能力 | 电子元器件与国产替代业务的 GEO 监测、分析和运营闭环 |
| 仓库文档根路径 | `docs/geo-monitoring/` |
| 纳入仓库状态 | GEO-001 已于 2026-10-01 完成人工验收 |

本文档包描述目标设计，纳入仓库不代表功能已实现。2026-10-01 用户接受五份初始 ADR 及 GEO-002 评审修订，ADR 状态均为 `Accepted`，GEO-002 状态为 `done`。接受范围、历史评审与后续合同对齐要求见 [架构评审记录](./05-decisions/GEO-002-architecture-review.md)。文档按 [文档治理规则](./00-governance/01-document-governance.md) 和对应任务管理；任务状态与依赖以 [任务清单](./04-delivery/task-manifest.yaml) 为准。

GEO-003 已冻结当前文章关系级 GEO 实现、契约和迁移源码基线，并于 2026-10-01 经用户接受，状态为 `done`。后续开发先查阅 [当前实现基线](./04-delivery/06-current-geo-baseline.md) 与 [本轮验证证据](./04-delivery/geo-003-baseline/validation.md)，区分现有 GeoObservation/GeoInsights 和尚未实现的回答级 Batch/Run；完整 `make verify` 的 Docker 环境阻断已记录，不代表全栈门禁通过。

GEO-004 / R0 已实现四项默认关闭的启动配置、父子开关校验和部署一致性测试，交付状态为 `review`。具体配置与旧生产 runtime 省略规则以 [Production 配置说明](../production-configuration.md) 为权威；Task Brief 与实际验证见 [GEO-004 任务记录](../../.trellis/tasks/10-01-geo-004-safe-configuration/prd.md) 和 [实施证据](../../.trellis/tasks/10-01-geo-004-safe-configuration/implement.md)。本次未接入 Collector、调度或机会业务；完整部署脚本门禁因本地 Docker Engine 不可用而未完成。

GEO-005 / R0 的共享虚构语料与独立分析金标见 [fixture 格式与敏感数据规则](../../backend/tests/fixtures/geo_analysis/README.md)，可用 `make test-geo-fixtures` 离线校验。后端与前端测试读取同一份版本化 JSON；实现范围、实际验证及状态见 [Task Brief](../../.trellis/tasks/10-01-geo-005-fixtures-gold/prd.md) 和 [实施证据](../../.trellis/tasks/10-01-geo-005-fixtures-gold/implement.md)。该目录不代表采集、分析或指标业务已经实现。

GEO-101 / R1 的 Catalog 公共与数据库合同已于 2026-10-01 经用户接受，状态为 `done`。权威为 [OpenAPI](../../contracts/openapi.yaml) 的标准 components/paths 及 [数据库合同](../../contracts/database.md) 的 GEO Catalog 章节；合同范围与接受记录见 [GEO-101 Task Brief](../../.trellis/tasks/10-01-geo-101-catalog-contract/prd.md) 和 [实施证据](../../.trellis/tasks/10-01-geo-101-catalog-contract/implement.md)。

GEO-102 / R1 已实现 Subject/Alias/Domain ORM、模型注册及新迁移 `0044_geo_catalog`，已于 2026-10-01 经用户接受，状态为 `done`。隔离 PostgreSQL 16 的空库/旧 head 前滚、metadata、直接 SQL 反例和活动 OWN_PRODUCT 并发唯一通过；指定静态、单元与完整集成检查及独立只读复核证据见 [Task Brief](../../.trellis/tasks/10-01-geo-102-catalog-orm/prd.md) 和 [实施记录](../../.trellis/tasks/10-01-geo-102-catalog-orm/implement.md)。尚未迁移生产数据库；GEO-104 CRUD Application Service/Router 实施状态见下文，Catalog 页面由 GEO-105 实施，状态与证据见下文。

GEO-103 / R1 已实现 Catalog 请求/响应 Schema、Unicode/IDNA 规范化、真实父子与别名歧义策略、角色 stage/actions/deletion 及当前 Product 只读投影；已于 2026-10-02 经用户接受，状态为 `done`。公共 Schema 生成声明与根合同一致，具体修改、98 项定向、后端 953/前端 863 项单元及 PostgreSQL 427 项集成证据见 [Task Brief](../../.trellis/tasks/10-01-geo-103-catalog-policy/prd.md) 和 [实施记录](../../.trellis/tasks/10-01-geo-103-catalog-policy/implement.md)。GEO-104 已接线 Catalog 操作，Catalog 页面状态见下文；Batch/Run、采集和指标仍未实施。

GEO-104 / R1 已实现 Catalog 应用服务和 12 个 API，已于 2026-10-02 经用户接受，状态为 `done`。包括 CRUD、启停、列表/详情一致快照、当前直接引用计数、Product/User 生命周期接入及最小原子审计。锁、revision、精确错误映射及真实 PostgreSQL 并发/权限/CSRF 验证见 [Task Brief](../../.trellis/tasks/10-02-geo-104-catalog-api/prd.md) 和 [实施证据](../../.trellis/tasks/10-02-geo-104-catalog-api/implement.md)。无新 Alembic revision 或生产迁移；Catalog 页面状态见下文，其他后续能力未实施。

GEO-105 / R1 已实现 `/configuration/geo-entities` 监测对象与竞品工作台，已于 2026-10-02 经用户接受，状态为 `done`。页面支持搜索筛选、详情、五类身份、别名/域名、启停与服务端删除阻断；ENGINEER 只读，409 与后台刷新失败保留草稿，写命令不自动重放。实现范围、指定验证、独立复核修正和浏览器布局/键盘证据见 [Task Brief](../../.trellis/tasks/10-02-geo-105-catalog-ui/prd.md) 与 [实施证据](../../.trellis/tasks/10-02-geo-105-catalog-ui/implement.md)。无公共 API/数据库语义变更、Alembic revision 或外部调用；GEO-106 的真实 API 纵向验收和产品引导已进入实施，状态与证据见下文。

GEO-106 / R1 已完成本地验证，当前为 `review`，只补真实 API Catalog 纵向验收、产品事实不变证据和 [Catalog 使用指南](./01-product/04-catalog-user-guide.md)，不新增运行时能力。Catalog 验收通过；完整门禁仍有未修改上传测试/编辑器焦点断言失败，当前域名搜索缺口已在指南说明。范围及逐项验证见 [Task Brief](../../.trellis/tasks/10-02-geo-106-catalog-acceptance/prd.md) 和 [实施记录](../../.trellis/tasks/10-02-geo-106-catalog-acceptance/implement.md)。

GEO-201 / R1 已新增问题变体合同、ORM 与 `0045_geo_prompt_variants`，复用 QueryTopic，明确 BRANDED/UNBRANDED、语言、地区、优先级及 revision。历史引用后只能停用，首次引用不可逆；GEO-201 未提供端点，后续 GEO-202 实施见下文，回答级 Run 未实施。交付状态与逐项验证见 [Task Brief](../../.trellis/tasks/10-02-geo-201-prompt-variant/prd.md) 和 [实施证据](../../.trellis/tasks/10-02-geo-201-prompt-variant/implement.md)。

GEO-202 / R1 已实现问题变体 Application Service、七个 API 与 `/geo/questions` 工作区，当前状态为 `review`。显式点名属性、历史语义、revision 和动作投影由服务端裁决，运行入口占位不创建 Batch/Run。任务内真实 API E2E 通过；完整门禁仍保留 GEO-106 已记录的未修改上传断言与编辑器焦点失败。Task Brief、逐项验证和实际状态见 [任务记录](../../.trellis/tasks/10-02-geo-202-question-workspace/prd.md) 与 [实施证据](../../.trellis/tasks/10-02-geo-202-question-workspace/implement.md)。

GEO-203 / R1 已实现 EngineSurface/Profile 数据组件、ORM、Schema 和 `0046_geo_surfaces_profiles`，已于 2026-10-02 人工接受为 `done`。三模式、同渠道模型引用、闭合能力/非敏感 settings、默认停用与测试状态均受结构约束；只重生成前端类型。实施与逐项验证见 [Task Brief](../../.trellis/tasks/10-02-geo-203-surface-profile/prd.md) 和 [实施证据](../../.trellis/tasks/10-02-geo-203-surface-profile/implement.md)。未实施 GEO-205 管理接口/页面、外部采集或回答级 Batch/Run；未迁移生产数据库。

GEO-204 / R1 已实现 Collector 元数据 Registry、纯配置校验和共享 Profile 资格策略，状态 `review`，等待人工接受。
默认仅登记 `manual`，未知 adapter/能力不匹配明确失败；自动模式有批准、合规、环境及开关门禁。
资格读取用当前非敏感列，模型解绑后的旧 PASSED 不放行。实现边界见
[Worker/Collector 说明](./03-technical/05-worker-and-collector-architecture.md#当前-r1geo-204)，
实际验证与交付状态见 [Task Brief](../../.trellis/tasks/10-02-geo-204-collector-registry/prd.md)
和 [实施证据](../../.trellis/tasks/10-02-geo-204-collector-registry/implement.md)。
本任务无新公共端点、表或迁移，不实现 Plan preview/Worker/provider 请求。

GEO-205 / R1 接入观测面与 Profile 的 14 个管理 API，以及 `/configuration/geo-surfaces` 工作台。
ADMIN 管理非敏感配置、启停和删除；ENGINEER 直接访问时只看摘要。Profile 新建为 UNTESTED，
实际配置编辑清除测试事实并停用；启用由 GEO-204 的当前资格策略裁决。
本任务无新 Alembic revision，不提供连接测试或外部采集；当前状态与逐项验证见
[Task Brief](../../.trellis/tasks/10-02-geo-205-surface-management/prd.md) 和
[实施证据](../../.trellis/tasks/10-02-geo-205-surface-management/implement.md)。

GEO-206 / R1 已实现 MonitoringPlan 配置组件、Plan 与三类关系表、`0047_geo_monitoring_plans`。
至少一个 PRIMARY、prompt、profile 由输入校验与数据库提交约束保证；真实配置引用接入既有资源删除阻断，归档配置只读。
本任务不提供 Plan API、矩阵预览、调度执行或 Batch/Run，尚未迁移生产数据库。
当前状态与逐项验证见 [Task Brief](../../.trellis/tasks/10-02-geo-206-monitoring-plan/prd.md)
和 [实施证据](../../.trellis/tasks/10-02-geo-206-monitoring-plan/implement.md)，本地验收后交付 review，等待人工接受。

GEO-303 / R2 已实现计划/临时批次工厂、完整安全快照和手工/调度创建身份，状态及最终本地验证见 [Task Brief](../../.trellis/tasks/10-02-geo-303-batch-factory/prd.md) 与 [实施证据](../../.trellis/tasks/10-02-geo-303-batch-factory/implement.md)。创建不派发、不接入Collector或运行页面；根合同为创建与历史引用权威。

## 1. 文档包用途

本目录是一套面向产品、架构、研发、测试和运维的完整实施基线。它不是单独的一份需求说明，而是把“为什么做、做什么、业务语义是什么、技术上如何落地、如何分阶段实施、如何验收”拆成可独立评审、可相互引用的文档。

后续使用 Codex 开发时，不应把整套文档一次性作为“实现全部功能”的提示词。正确方式是：

1. 按推荐阅读顺序理解目标状态；
2. 从实施计划中选择一个已满足依赖的任务；
3. 使用任务模板生成单任务开发说明；
4. 契约优先完成数据库/OpenAPI/测试边界；
5. 一次只实现一个可验收切片；
6. 完成后更新任务状态、验证证据和相关文档。

## 2. 文档结构

```text
docs/geo-monitoring/
├─ README.md
├─ CHANGELOG.md
├─ SHA256SUMS
├─ 00-governance/
│  ├─ 01-document-governance.md
│  └─ 02-glossary.md
├─ 01-product/
│  ├─ 01-product-vision-and-scope.md
│  ├─ 02-geo-core-prd.md
│  └─ 03-information-architecture-and-page-spec.md
├─ 02-business/
│  ├─ 01-business-architecture.md
│  ├─ 02-domain-model.md
│  ├─ 03-workflows-and-state-machines.md
│  └─ 04-monitoring-methodology-and-metrics.md
├─ 03-technical/
│  ├─ 01-technical-architecture.md
│  ├─ 02-data-architecture.md
│  ├─ 03-api-contract-design.md
│  ├─ 04-frontend-architecture.md
│  ├─ 05-worker-and-collector-architecture.md
│  ├─ 06-security-and-compliance.md
│  ├─ 07-testing-and-quality.md
│  └─ 08-deployment-and-operations.md
├─ 04-delivery/
│  ├─ 01-implementation-roadmap.md
│  ├─ 02-work-breakdown-structure.md
│  ├─ 03-requirement-traceability-matrix.md
│  ├─ 04-codex-execution-guide.md
│  ├─ 05-task-template.md
│  ├─ 06-current-geo-baseline.md
│  ├─ geo-003-baseline/              # schema/route/table/query/migration/test 快照与验证
│  └─ task-manifest.yaml
└─ 05-decisions/
   ├─ ADR-001-extend-modular-monolith.md
   ├─ ADR-002-unified-observation-run-model.md
   ├─ ADR-003-separate-collection-analysis-review.md
   ├─ ADR-004-no-unified-geo-score.md
   ├─ ADR-005-staged-collector-rollout.md
   └─ GEO-002-architecture-review.md
```

### 文档索引

| 分层 | 文档 |
|---|---|
| 文档包 | [变更记录](./CHANGELOG.md) |
| 文档包 | [SHA-256 校验清单](./SHA256SUMS) |
| 治理 | [文档治理规则](./00-governance/01-document-governance.md) |
| 治理 | [术语表](./00-governance/02-glossary.md) |
| 产品 | [产品愿景与范围](./01-product/01-product-vision-and-scope.md) |
| 产品 | [GEO 核心版 PRD](./01-product/02-geo-core-prd.md) |
| 产品 | [信息架构与页面需求](./01-product/03-information-architecture-and-page-spec.md) |
| 产品 | [Catalog 使用指南（当前 R1）](./01-product/04-catalog-user-guide.md) |
| 业务 | [业务架构](./02-business/01-business-architecture.md) |
| 业务 | [领域模型](./02-business/02-domain-model.md) |
| 业务 | [业务流程与状态机](./02-business/03-workflows-and-state-machines.md) |
| 业务 | [监测方法与指标口径](./02-business/04-monitoring-methodology-and-metrics.md) |
| 技术 | [技术架构](./03-technical/01-technical-architecture.md) |
| 技术 | [数据架构](./03-technical/02-data-architecture.md) |
| 技术 | [API 契约设计](./03-technical/03-api-contract-design.md) |
| 技术 | [前端架构](./03-technical/04-frontend-architecture.md) |
| 技术 | [Worker 与采集器架构](./03-technical/05-worker-and-collector-architecture.md) |
| 技术 | [安全与合规](./03-technical/06-security-and-compliance.md) |
| 技术 | [测试与质量](./03-technical/07-testing-and-quality.md) |
| 技术 | [部署与运维](./03-technical/08-deployment-and-operations.md) |
| 交付 | [实施路线图](./04-delivery/01-implementation-roadmap.md) |
| 交付 | [工作分解结构（WBS）](./04-delivery/02-work-breakdown-structure.md) |
| 交付 | [需求追踪矩阵](./04-delivery/03-requirement-traceability-matrix.md) |
| 交付 | [Codex 执行指南](./04-delivery/04-codex-execution-guide.md) |
| 交付 | [单任务说明模板](./04-delivery/05-task-template.md) |
| 交付 | [GEO-003：当前 GEO 实现与契约基线](./04-delivery/06-current-geo-baseline.md) |
| 交付 | [GEO-003：基线验证与环境阻断](./04-delivery/geo-003-baseline/validation.md) |
| 交付 | [任务状态与依赖清单](./04-delivery/task-manifest.yaml) |
| 决策 | [ADR-001：扩展模块化单体](./05-decisions/ADR-001-extend-modular-monolith.md) |
| 决策 | [ADR-002：统一观测运行模型](./05-decisions/ADR-002-unified-observation-run-model.md) |
| 决策 | [ADR-003：采集、分析、复核分离](./05-decisions/ADR-003-separate-collection-analysis-review.md) |
| 决策 | [ADR-004：不提供统一 GEO 总分](./05-decisions/ADR-004-no-unified-geo-score.md) |
| 决策 | [ADR-005：分阶段启用采集](./05-decisions/ADR-005-staged-collector-rollout.md) |
| 决策 | [GEO-002：架构评审记录](./05-decisions/GEO-002-architecture-review.md) |

校验命令从本目录执行：`shasum -a 256 -c SHA256SUMS`。清单覆盖本目录其余全部文件，不包含 `SHA256SUMS` 自身；修改文件后应同步更新对应哈希。

## 3. 推荐阅读顺序

### 产品与业务评审

1. [产品愿景与范围](./01-product/01-product-vision-and-scope.md)
2. [GEO 核心版 PRD](./01-product/02-geo-core-prd.md)
3. [业务架构](./02-business/01-business-architecture.md)
4. [监测方法与指标口径](./02-business/04-monitoring-methodology-and-metrics.md)
5. [信息架构与页面需求](./01-product/03-information-architecture-and-page-spec.md)

### 架构与研发设计

1. [领域模型](./02-business/02-domain-model.md)
2. [业务流程与状态机](./02-business/03-workflows-and-state-machines.md)
3. [技术架构](./03-technical/01-technical-architecture.md)
4. [数据架构](./03-technical/02-data-architecture.md)
5. [API 契约设计](./03-technical/03-api-contract-design.md)
6. [Worker 与采集器架构](./03-technical/05-worker-and-collector-architecture.md)
7. 文档索引中相关 ADR

### Codex 执行

1. [Codex 执行指南](./04-delivery/04-codex-execution-guide.md)
2. [实施路线图](./04-delivery/01-implementation-roadmap.md)
3. [工作分解结构（WBS）](./04-delivery/02-work-breakdown-structure.md)
4. [任务状态与依赖清单](./04-delivery/task-manifest.yaml)
5. 选中任务对应的产品、业务、技术文档
6. [单任务说明模板](./04-delivery/05-task-template.md)

## 4. 权威性与冲突处理

本项目同时存在“当前实现”和“目标设计”，必须区分：

| 问题 | 权威来源 |
|---|---|
| 当前仓库已经实现了什么 | 当前代码、Alembic、`contracts/openapi.yaml`、`contracts/database.md` |
| GEO 核心版最终要实现什么 | 本文档包的 PRD、业务架构、领域模型和指标文档 |
| 应按什么顺序实现 | 实施路线图、WBS 和任务清单 |
| 具体技术决策 | 已接受的 ADR 和技术架构文档 |
| 单个任务的范围与验收 | 该任务的任务说明和验收标准 |

出现冲突时遵循：

1. 单任务已批准的 ADR；
2. 业务不变量与指标口径；
3. PRD 和页面需求；
4. 技术设计；
5. 实施计划中的顺序建议。

实施计划不能推翻业务语义，技术文档不能自行扩大产品范围。

## 5. 目标发布增量

| 增量 | 结果 |
|---|---|
| R0 文档与契约基线 | 团队对目标、术语、领域边界和任务顺序达成一致 |
| R1 监测主数据与计划 | 能配置监测对象、问题变体、平台和计划，并预览运行矩阵 |
| R2 统一观测运行框架 | 能以人工方式创建批次、保存原始回答、引用、截图和证据 |
| R3 API 自动观测 | 至少一种受控 API 采集器可按计划运行，并具备可靠状态与恢复 |
| R4 分析与人工复核 | 能识别提及、推荐、竞品、引用和事实准确性，并人工修正 |
| R5 指标与洞察 | 能按产品、问题、平台、采集方式和周期查看可解释指标与趋势 |
| R6 机会与复测闭环 | 异常可转化为任务，任务完成后可发起严格同口径复测 |
| R7 浏览器试点与生产硬化 | 在合规批准下完成一个真实界面采集试点及完整运维门禁 |

GEO-207 / R1 已实现服务端 RunMatrixBuilder、当前资源与共享 Profile 资格定位、三模式数量及 known/unknown 费用覆盖，当前交付状态见 [任务清单](./04-delivery/task-manifest.yaml)。10×3×3 准确返回90，未知费用保持 null；默认没有生产估价实现。预览组件与 generated 类型以根 OpenAPI 为权威，GEO-208已接入Plan API；仍无Batch/Run或外部采集。范围和逐项验证见 [Task Brief](../../.trellis/tasks/10-02-geo-207-run-matrix/prd.md) 与 [实施证据](../../.trellis/tasks/10-02-geo-207-run-matrix/implement.md)，具体估价与预算语义见 [API设计](./03-technical/03-api-contract-design.md#62-geomonitoringplanpreview)。

GEO-208 / R1已实现Plan CRUD、preview、activate/pause/resume/archive/copy与run-now的501命令占位；完整读模型、typed动作/revision和原子最小审计以根合同为准。GEO-208自身未实现Plan页面、Batch/Run、调度或外部采集；已于2026-10-02人工接受，状态done。Plan页面由下文GEO-209交付，见[Task Brief](../../.trellis/tasks/10-02-geo-208-plan-api/prd.md)与[实施证据](../../.trellis/tasks/10-02-geo-208-plan-api/implement.md)。

## 6. 首个建议执行任务

在代码实现前，先完成 `GEO-001` 至 `GEO-005`：

- 确认本文件包落库路径；
- 记录五项 ADR；
- 建立能力和需求 ID；
- 冻结当前 GEO 数据与接口基线；
- 创建用于渐进启用的功能开关和迁移策略说明。

完成这些任务后再进入数据库和接口开发，避免 Codex 在缺少边界时同时修改现有人工 GEO、内容生产和发布模块。

GEO-209 / R1 已完成监测计划 UI 实现及本地验证，交付状态为 `review`，提供 `/geo/plans` 列表、详情、八步向导、服务端预览、状态确认和 dirty/409 输入保护；无前端最终 run_count 计算、Batch/Run、调度执行或外部采集。完整门禁保留三项范围外既有用例失败，未将失败记为通过。当前状态以 [任务清单](./04-delivery/task-manifest.yaml) 为准，范围与逐项验证见 [Task Brief](../../.trellis/tasks/10-02-geo-209-plan-ui/prd.md) 和 [实施证据](../../.trellis/tasks/10-02-geo-209-plan-ui/implement.md)。

GEO-301 / R2 已建立独立回答级 Batch/Run 公共组件、两表 ORM 与 0048 加法迁移。快照/身份和 Run 终态冻结，初始 cell 数在提交时精确校验，attempt 追加继承且无分叉，Batch 状态保存为可重建缓存；旧 GeoObservation 不改不迁移。契约见 [OpenAPI](../../contracts/openapi.yaml) 和 [数据库合同](../../contracts/database.md#geo-batch--run-合同geo-301--r2)，范围与验证见 [Task Brief](../../.trellis/tasks/10-02-geo-301-batch-run/prd.md) 和 [实施证据](../../.trellis/tasks/10-02-geo-301-batch-run/implement.md)。已于2026-10-02人工接受，状态done；不代表创建/状态命令/答案/Collector 已实现。

GEO-302 / R2 已实现 Run 合法边、终态守卫、采集 retry/cancel 资格、每 cell 最新 attempt 的 Batch 状态和独立 typed workflow/actions；非法转换稳定409，缺失矩阵或遗漏已存在后继明确失败。公共组件与 generated 类型同步，无 HTTP/Worker 接线、数据库迁移或新页面。当前状态以 [任务清单](./04-delivery/task-manifest.yaml) 为准；范围和实际验证见 [Task Brief](../../.trellis/tasks/10-02-geo-302-state-policy/prd.md) 与 [实施证据](../../.trellis/tasks/10-02-geo-302-state-policy/implement.md)。

GEO-304 / R2 已实现不可变原始回答、数据库生成 SHA-256、原始引用规范化/实际位置和受控截图/raw 文件关系。状态与验证见 [Task Brief](../../.trellis/tasks/10-02-geo-304-answer-evidence/prd.md) 和 [实施记录](../../.trellis/tasks/10-02-geo-304-answer-evidence/implement.md)，精确边界以根合同及 Accepted ADR 为准；人工提交命令由 GEO-305 交付；Collector/分析仍由后续任务交付。

GEO-305 / R2 已实现 MANUAL 录入上下文、独立 revision 草稿及原子正式提交。幂等回执只确认原始回答/引用/文件冻结；Run 为 COLLECTED，分析为 NOT_IMPLEMENTED，占位不表示成功投递。无新前端页面、Collector、机器分析或指标。状态及验证见 [Task Brief](../../.trellis/tasks/10-02-geo-305-manual-collection/prd.md) 和 [实施证据](../../.trellis/tasks/10-02-geo-305-manual-collection/implement.md)；等待人工审查，不自行标记 done。


GEO-306 / R2 已实现五个Batch/Run列表与详情读取端点、完整批次summary、筛选分页、同cell attempts/真实时间线及受控证据签名。复杂详情由服务端一次RR快照组装，data quality明确NOT_IMPLEMENTED/null；没有新增Collector、分析、指标或前端页面。状态及验证见[Task Brief](../../.trellis/tasks/10-02-geo-306-read-model/prd.md)和[实施证据](../../.trellis/tasks/10-02-geo-306-read-model/implement.md)，已于2026-10-02人工接受，状态done；GEO-307实现见下文。

GEO-307 / R2 已实现 `/geo/runs` 批次/运行双层视图、从计划创建人工批次、manual editor、截图校验、引用编辑和不可变证据详情。URL保留筛选/分页/选中对象，服务端草稿支持刷新恢复，dirty与409不覆盖输入；不确定结果显式同键确认，文件恢复读取canonical状态。无OpenAPI、数据库或Alembic新增，无Collector/分析/指标/机会。当前状态与实际门禁见[任务清单](./04-delivery/task-manifest.yaml)、[Task Brief](../../.trellis/tasks/10-02-geo-307-run-center/prd.md)和[实施证据](../../.trellis/tasks/10-02-geo-307-run-center/implement.md)。


GEO-308 / R2 的并发、已提交聚合不可变与旧文章导航兼容验收见 [R2 试用与验收边界](./04-delivery/07-r2-acceptance.md)、[Task Brief](../../.trellis/tasks/10-02-geo-308-r2-acceptance/prd.md) 和 [实际实施证据](../../.trellis/tasks/10-02-geo-308-r2-acceptance/implement.md)。只补测试与验收文档，不改变根合同或生产状态机；取消仍无公共命令，人工正式提交停在 COLLECTED，分析为 NOT_IMPLEMENTED。当前状态以任务清单为准，不代表生产发布或后续自动采集已经完成。

GEO-401 / R3 已定义内部 `GeoCollector` 同步协议、不可变采集输入/原始结果/估价值对象和
含显式 send state 的稳定错误。能力与错误目录复用现有权威，不新增 OpenAPI、数据库或
Alembic；默认仍只登记 manual 元数据。接口包含发送前授权回调，但尚未实现 provider、
Worker 或 at-most-once 恢复。边界见 [Collector 说明](./03-technical/05-worker-and-collector-architecture.md#当前-r3geo-401-内部采集合同)，
实际状态与验证见 [Task Brief](../../.trellis/tasks/10-03-geo-401-collector-contract/prd.md)、
[实施证据](../../.trellis/tasks/10-03-geo-401-collector-contract/implement.md) 和任务清单；
本地交付为 review，等待人工接受。


GEO-402 / R3 提供独立本地 TCP fake provider、每 attempt 调用计数/请求哈希，以及 Collector
合同断言和套件自测。运行、控制协议、故障模式和 CI 脱敏边界见
[fake provider 说明](../../backend/tests/fixtures/geo_provider/README.md)，
`make test-geo-collector-contract` 只访问回环。当前状态及逐项证据见
[Task Brief](../../.trellis/tasks/10-03-geo-402-fake-provider/prd.md) 与
[实施记录](../../.trellis/tasks/10-03-geo-402-fake-provider/implement.md)。
该测试驱动不登记生产 Collector，不代表 Profile 连接测试、Worker 或发送恢复已经实现。

GEO-404 / R3 已实现独立 OpenAI-compatible GEO Collector：原始 user prompt、严格回答/
引用/usage/cost 解析、null 语义、固定错误与 pinned HTTP 发送及响应大小边界。
Registry 采集批准仍为 false，没有 Worker 或业务命令接线。实现边界见
[Collector 说明](./03-technical/05-worker-and-collector-architecture.md#当前-r3geo-404-openai-compatible-geo-collector)，
逐项证据与限制见 [Task Brief](../../.trellis/tasks/10-03-geo-404-openai-collector/prd.md) 和
[实施记录](../../.trellis/tasks/10-03-geo-404-openai-collector/implement.md)，当前状态以
[任务清单](./04-delivery/task-manifest.yaml) 为准；不代表 GEO-405/406 或 R3 发布完成。


GEO-405 / R3 已接线采集 claim/lease、发送前当前资格裁决、原子结果、首次 dispatch、
PENDING redispatch 和 expired lease 扫描；队列仅 run ID，重复消息不重复调用。
本阶段 lease 保守失败，不自动重发；GEO-406/407/506 保持未实现。
生产 adapter 批准和 INTERNAL 外发限制保持，状态以 [任务清单](./04-delivery/task-manifest.yaml) 为准。
见 [Task Brief](../../.trellis/tasks/10-03-geo-405-collection-worker/prd.md) 和
[实施证据](../../.trellis/tasks/10-03-geo-405-collection-worker/implement.md)。
