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

## 当前 V1.0 发布冻结（ADR-007 / GEO-1002）

2026-10-05 用户正式接受 [ADR-007](./05-decisions/ADR-007-manual-first-v1-release-scope.md)：V1.0 以 MANUAL 回答级观测、人工批次、证据、确定性分析/复核、指标/现有报告、管理员显式机会评估和现有 Action/Retest API 为范围。完整能力与当前实现统一见 [V1.0 能力矩阵](./01-product/05-v1-release-capability-matrix.md)。

**当前仍为 NO-GO。** [GEO-1001 审计](./06-reviews/GEO-1001-release-readiness-audit.md)记录的 Browser 硬禁止、Catalog 竞态、CRON 假 ACTIVE、管理员评估入口、升级恢复、候选和生产证据由新增 R9A / GEO-1003～1010 收口；范围批准不代表修复或现场验收。API 初始关闭，Browser production 硬禁止，CRON 到期执行和 Opportunity 自动周期评估不属首发。机会 CSV、完整 Action/Retest 页面、公共管理员重分析及无依据无引用推断不能宣称可用。

R0—R8 的 67 done＋4 deferred 和历史接受记录保持；任务状态以 manifest 为准。GEO-1002～1008 的接受边界保留；[整PR接受记录](./06-reviews/2026-10-07-v1-pr-acceptance.md)不改写。GEO-1009 的固定 clean main `e5949ab66989c1277424cfe9ab8b93e10ce10046` 完整门禁 exit 0 已获[人工接受](./06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md)，状态 done。[ADR-008](./05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md)将 UI done 后新候选的门禁、工件和冻结归属 GEO-1010-DEPLOY。UI 已于2026-10-07[人工接受](./06-reviews/2026-10-07-geo-1010-ui-acceptance.md)并done；父任务in_progress，DEPLOY已在Hostdzire直接构建852c6d5e并完成完整本地Gate；正确runtime已交付、OSS读写成功，Bucket公开读取权限待确认，admin-ui移交实现与定向验证/独立复核完成，新候选准备中，当前blocked；UAT planned、未开始。UI及治理已按后续Git授权提交并push/fetch；首个候选因GEO测试配置冲突失败，独立修复后的源码候选76d1d523完整门禁exit0，archive/hash和clean checkout已保存；后续852c6d5e的镜像/manifest已生成，生产预检通过；配置和现场Gate未闭合，完整release未冻结。核心最小页面闭环见ADR-008，超出该闭环的完整UI仍延期。生产仍NOT_STARTED/NO-GO。

## GEO-1010 当前任务导航

| 任务 | 状态 | brief / 交付 |
|---|---|---|
| [GEO-1010](../../.trellis/tasks/10-07-geo-1010-manual-pilot/prd.md) | in_progress | 聚合治理；三项done且集成工作验收后review，人工接受才done |
| [GEO-1010-UI](../../.trellis/tasks/10-07-geo-1010-ui-business-closure/prd.md) | done | 页面闭环已人工接受并提交；原接受对象为工作树身份 |
| [GEO-1010-DEPLOY](../../.trellis/tasks/10-07-geo-1010-internal-pilot-deploy/prd.md) | blocked | Hostdzire直接构建与852c6d5e完整本地Gate通过；runtime已交付，Bucket读取权限/AI初始化待确认，尚未切换 |
| [GEO-1010-UAT](../../.trellis/tasks/10-07-geo-1010-manual-uat-performance/prd.md) | planned | 真实MANUAL样本/闭环、用户反馈、性能和具名内部Go/No-Go |

用户已授权main提交/push/fetch、Hostdzire现有站点清空重建；现有env已核对、正确runtime已交付，当前需确认Bucket全局权限范围，完成已选择的admin-ui移交，之后沿同候选fresh-init执行。具体[Hostdzire执行记录](../../.trellis/tasks/10-07-geo-1010-internal-pilot-deploy/hostdzire-direct-build.md)保留真实阻断和未执行边界；GitHub Actions不是部署前提。DEPLOY尚未部署，UAT不得提前开始。内部Go/No-Go须具名显式人工结论，任务done不代表正式生产Go。完整依赖与验收见[WBS](./04-delivery/02-work-breakdown-structure.md)；父子关系以Trellis为准。

## 历史阶段交付记录与目标设计导航

以下各 GEO 段落记录该阶段交付时的范围和限制；早期“未实施”或“review/blocked”不是当前全系统状态。当前实现参见能力矩阵/审计，当前任务治理状态参见 manifest，生产未知仍保留未知。

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

GEO-503 / R4 已实现纯推荐分类与可靠位置阶段：四态、原文依据、可空rank和复核原因。
名称/普通编号不证明推荐或优先级；明确否定、对象作用域、排序冲突与歧义由独立金标保护。
无公共合同或数据库迁移，无Worker/页面接线；GEO-506继续拥有revision生命周期。
状态以[任务清单](./04-delivery/task-manifest.yaml)为准，范围及验证见
[Task Brief](../../.trellis/tasks/10-03-geo-503-recommendation-ranking/prd.md)和
[实施记录](../../.trellis/tasks/10-03-geo-503-recommendation-ranking/implement.md)。

GEO-501 / R4 已定义 AnalysisRevision、Mention、Recommendation、Claim、Review 及当前选择组件，新增六张表和 `0054_geo_analysis_contract`。原始证据、不可变分析与追加复核分离；完整输入摘要、多产品事实强引用、显式前进指针与历史保留由数据库约束保证。仅补既有资源的删除阻断和真实分析引用计数，不提供分析算法、Worker、API 或复核页面。状态为 `review`，实际验证、修复记录与独立复核见 [Task Brief](../../.trellis/tasks/10-03-geo-501-analysis-contract/prd.md) 和 [实施证据](../../.trellis/tasks/10-03-geo-501-analysis-contract/implement.md)。未迁移生产数据库。

GEO-502 / R4 新增不可变别名匹配快照和确定性提及纯阶段。中英文、大小写、有限 Unicode 连字符、型号边界、原文字符位置及否定线索由独立金标验证；共享别名、规范化碰撞和跨对象重叠均返回完整候选与 `ALIAS_AMBIGUOUS`，不任选对象。无公共合同或 Alembic 变化，Worker/revision 持久化和 NEEDS_REVIEW 接线留 GEO-506，运行详情分析区仍为 NOT_IMPLEMENTED。使用规则见 [实际分析边界](./03-technical/05-worker-and-collector-architecture.md#当前-r4geo-502-确定性提及阶段)，Task Brief 与实际检查见 [任务说明](../../.trellis/tasks/10-03-geo-502-mention-matching/prd.md) 和 [实施证据](../../.trellis/tasks/10-03-geo-502-mention-matching/implement.md)，当前状态以 [任务清单](./04-delivery/task-manifest.yaml) 为准。

GEO-507 / R4 已实现追加人工复核API、stale revision裁决、机器/复核历史和当前reviewed投影；未完成必要复核明确阻断业务指标使用。0056仅扩展受控Run发布守卫，无历史回填。Task Brief与实际验证见[任务记录](../../.trellis/tasks/10-03-geo-507-run-review/prd.md)和[实施证据](../../.trellis/tasks/10-03-geo-507-run-review/implement.md)，本地交付后状态为review，待人工接受。GEO-508页面和GEO-601指标未实施，未迁移生产数据库。

GEO-705 / R6 已新增严格复测预览和创建 API、不可变基线及幂等回执。显式选中首次触发来源批次，完整复制原矩阵/输入/规则，Profile、Variant 或已观测模型版本不可比（含版本未知）时给出差异并阻断。本地实现与验证完成，状态review，等待人工接受；实际门禁见 [Task Brief](../../.trellis/tasks/10-04-geo-705-retest-planner/prd.md) 和 [实施证据](../../.trellis/tasks/10-04-geo-705-retest-planner/implement.md)。0061 为加法迁移，无历史回填；未迁移生产。GEO-706 的结果比较、恢复裁决、解决机会及页面继续由后续任务实施。

## 历史核心范围调整（ADR-006，V1.0 细目由 ADR-007 冻结）

2026-10-05 用户接受[人工优先、浏览器延期决策](./05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)：MANUAL 回答级观测是核心版正式采集方式，操作见[人工观测 SOP](./02-business/05-manual-geo-observation-sop.md)。核心路径为 R6 → R8，R7 是 post-core 可选扩展；旧 ADR-005/GEO-002 的自动化及真实界面首发门禁由 ADR-006 显式替代，安全与平台批准条件保留。

GEO-801、802、803 已人工接受为 done，代码和证据保留。GEO-804～807 为 deferred，release 为 post-core；真实 Adapter 未实施。核心生产必须保持 GEO_BROWSER_COLLECTION_ENABLED=false 且无生产 Browser 会话，实际环境检查留 GEO-904/906，不从默认配置推断已验收上线。

GEO-904 / R8 的本地安全复核与两项真实 PG 补充测试见[专项复核报告](./04-delivery/11-r8-security-review.md)和[实施记录](../../.trellis/tasks/10-05-geo-904-security/implement.md)。实施时因目标环境与实际平台批准证据缺失记录 blocked，随后用户明确接受为 done；现场仍未验证，不以默认配置或隔离演练证明生产 Browser false/无材料。GEO-906 收口现场证据，不改写依赖的历史限制。

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
│  ├─ 04-monitoring-methodology-and-metrics.md
│  └─ 05-manual-geo-observation-sop.md
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
   ├─ ADR-006-defer-browser-collection-and-adopt-manual-first-core.md
   ├─ ADR-007-manual-first-v1-release-scope.md
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
| 产品 | [V1.0 发布能力矩阵](./01-product/05-v1-release-capability-matrix.md) |
| 业务 | [业务架构](./02-business/01-business-architecture.md) |
| 业务 | [领域模型](./02-business/02-domain-model.md) |
| 业务 | [人工 GEO 观测 SOP](./02-business/05-manual-geo-observation-sop.md) |
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
| 交付 | [GEO-607：洞察性能与 R5 验收](./04-delivery/06-r5-insight-performance-acceptance.md) |
| 交付 | [GEO-003：基线验证与环境阻断](./04-delivery/geo-003-baseline/validation.md) |
| 交付 | [GEO-904：R8 安全专项复核](./04-delivery/11-r8-security-review.md) |
| 交付 | [GEO-906：R8 核心发布验收与阻断](./04-delivery/13-r8-core-release-acceptance.md) |
| 运维 | [核心版渐进发布 Runbook](./03-technical/10-core-rollout-runbook.md) |
| 运维 | [低敏发布记录模板](./04-delivery/geo-906-release-record.template.yaml) |
| 交付 | [任务状态与依赖清单](./04-delivery/task-manifest.yaml) |
| 决策 | [ADR-001：扩展模块化单体](./05-decisions/ADR-001-extend-modular-monolith.md) |
| 决策 | [ADR-002：统一观测运行模型](./05-decisions/ADR-002-unified-observation-run-model.md) |
| 决策 | [ADR-003：采集、分析、复核分离](./05-decisions/ADR-003-separate-collection-analysis-review.md) |
| 决策 | [ADR-004：不提供统一 GEO 总分](./05-decisions/ADR-004-no-unified-geo-score.md) |
| 决策 | [ADR-005：分阶段启用采集](./05-decisions/ADR-005-staged-collector-rollout.md) |
| 决策 | [ADR-006：人工优先、浏览器延期](./05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md) |
| 决策 | [ADR-007：V1.0 人工优先发布范围和门禁](./05-decisions/ADR-007-manual-first-v1-release-scope.md) |
| 评审 | [GEO-1001：发布候选完整性审计（NO-GO）](./06-reviews/GEO-1001-release-readiness-audit.md) |
| 决策 | [ADR-008：内部试运行页面优先与候选归属](./05-decisions/ADR-008-manual-pilot-ui-first-delivery-and-candidate-ownership.md) |
| 评审 | [GEO-1009：固定 main 门禁人工接受](./06-reviews/2026-10-07-geo-1009-main-gate-acceptance.md) |
| 决策 | [GEO-002：架构评审记录](./05-decisions/GEO-002-architecture-review.md) |

校验命令从本目录执行：`shasum -a 256 -c SHA256SUMS`。清单覆盖本目录其余可交付文件（Git 跟踪或本次新增且非忽略的文档），不包含本机忽略缓存或 `SHA256SUMS` 自身；修改文件后应同步更新对应哈希。

R9A Release Blocker Closure 追加在 R8 之后；具体依赖/交付/测试/验收见路线图、WBS 和 manifest。GEO-1001 / production-readiness 原始记录保持，新的首发证据由 GEO-1010 另行收集。

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
| R7 浏览器试点（post-core 可选） | 保留已完成基础设施，804～807 延期；恢复须满足 ADR-006 与合规门禁 |
| R8 核心生产硬化 | 从 R6 直接进入，MANUAL 正式闭环、安全/恢复/性能验收；Browser 关闭且无生产会话 |

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
GEO-406 已完成按发送事实恢复与显式新 attempt；GEO-407 已实现预算/限速，状态以任务清单为准。
生产 adapter 批准和 INTERNAL 外发限制保持，状态以 [任务清单](./04-delivery/task-manifest.yaml) 为准。
见 [Task Brief](../../.trellis/tasks/10-03-geo-405-collection-worker/prd.md) 和
[实施证据](../../.trellis/tasks/10-03-geo-405-collection-worker/implement.md)。


GEO-407 / R3 保存原始引用、独立 usage、已报告 cost 与费用覆盖；PostgreSQL 账本原子预留
batch/global UTC day 预算和 Profile 并发/滚动分钟配额。未知费用不补零，受限预算缺乏明确估价
或存在未结未知发送时阻断；429 持久化并冷却后续采集，同 attempt 不自动重发。
实现与本地验证见 [GEO-407 实施记录](../../.trellis/tasks/10-03-geo-407-cost-budget/implement.md)。
GEO-408 自动采集页面与整栈验收见下文；GEO-506 机器分析仍未实现，本任务不代表 R3 发布。

GEO-408 / R3 运行中心补齐自动轮询、独立 usage、费用覆盖、发送/错误元数据与显式新尝试。
真实栈验收使用独占 PG/Redis、真实 API/Worker 和回环 fake provider，并分别启动关闭 API 和
关闭总开关的进程证明待消费任务零外发。使用、安全停止和测试装配边界见
[R3 API 指南](./04-delivery/08-r3-api-acceptance.md)；实际门禁与限制见
[Task Brief](../../.trellis/tasks/10-03-geo-408-api-acceptance/prd.md) 和
[实施证据](../../.trellis/tasks/10-03-geo-408-api-acceptance/implement.md)。
状态以任务清单为准；生产 adapter 批准与 INTERNAL 外发限制保持，不涉及 Browser/分析/指标/机会。


GEO-504 / R4 已实现纯引用归属阶段：规范 hostname 的相等/点分子域匹配、
自有/竞品/第三方来源类别、共享与冲突候选、版本化规则及独立人工修正投影。
原始 Citation 与机器证据不改写；未登记来源保持 UNKNOWN，不抓取页面或猜 Article。
规则边界见 [Worker 架构](./03-technical/05-worker-and-collector-architecture.md#当前-r4geo-504-引用归属与来源类别阶段)，
实际验证和限制见 [Task Brief](../../.trellis/tasks/10-03-geo-504-citation-attribution/prd.md)
和 [实施证据](../../.trellis/tasks/10-03-geo-504-citation-attribution/implement.md)。
交付状态以 [任务清单](./04-delivery/task-manifest.yaml) 为准；GEO-506 的接线见下文，GEO-604 洞察仍未实施。


GEO-505 / R4 提供本地声明提取、同产品最高合格 APPROVED FactVersion 装配及准确性评估；
事实不足为 UNJUDGEABLE，关键替代条件完整核对并强制人工复核。受限事实仅在本地使用。
规则范围见 [Worker 架构](./03-technical/05-worker-and-collector-architecture.md#当前-r4geo-505-声明和事实阶段)，
验证与限制见 [Task Brief](../../.trellis/tasks/10-03-geo-505-claim-assessment/prd.md) 和
[实施证据](../../.trellis/tasks/10-03-geo-505-claim-assessment/implement.md)。
状态以任务清单为准；GEO-506 Worker/revision/落库及GEO-604洞察见下文。

GEO-506 / R4 接入确定性 Analysis Worker：COLLECTED claim、冻结输入hash幂等、追加revision、
四阶段结果/current pointer/首次Run状态原子提交、失败保留原始回答、旧token与迟到结果拒绝，
以及内部管理员重新分析。新增0055执行元数据和引用分类，无历史回填或公共API变化。
执行和迁移合同见 [Worker架构](./03-technical/05-worker-and-collector-architecture.md#当前-r4geo-506-analysis-worker)
及 [数据库合同](../../contracts/database.md#geo-506-analysis-worker--revision-生命周期r4)；
Task Brief与逐项验证见 [任务记录](../../.trellis/tasks/10-03-geo-506-analysis-worker/prd.md)
和 [实施证据](../../.trellis/tasks/10-03-geo-506-analysis-worker/implement.md)。
交付状态以manifest为准；GEO-507公共分析/复核/current读取、前端详情、指标、Opportunity与Browser均未实现。


## GEO-508 / R4 分析复核与金标验收

GEO-508依赖已人工接受的GEO-507，详情接入原文、机器四类结果、声明事实依据、有效人工结果及只读revision/review历史；严重错误需逐条人工核对并说明，最新复核整体替换旧修正。全部分析金标质量口径、已知映射与实际结果见 [R4验收报告](./04-delivery/09-r4-analysis-acceptance.md)，精确门禁、浏览器证据和限制见 [Task Brief](../../.trellis/tasks/10-03-geo-508-analysis-review-ui/prd.md) 与 [实施证据](../../.trellis/tasks/10-03-geo-508-analysis-review-ui/implement.md)。完成后仅review等待人工接受；无新OpenAPI/数据库/Alembic、生产迁移或发布。完整指标、Opportunity和Browser仍由后续任务交付。


## GEO-601 / R5 指标资格与公式库

GEO-601 已实现内部 MetricEligibility、可比维度、样本等级和18项透明公式，完整本地验证已完成，交付review等待人工接受，状态以manifest为准。两个争议分母已由用户裁决采用指标方法口径；唯一字典见 [指标方法 §18](./02-business/04-monitoring-methodology-and-metrics.md#18-geo-601-回答级公式字典当前内部计算合同)。快照转换复用GEO-507 current有效结果，失败/旧attempt不进入业务分母，模式和点名默认分离。Task Brief及逐项证据见 [任务记录](../../.trellis/tasks/10-03-geo-601-metric-formulas/prd.md) 与 [实施记录](../../.trellis/tasks/10-03-geo-601-metric-formulas/implement.md)。本任务没有新API、数据库/Alembic、前端页面或生产启用；GEO-602/603/604当前读合同见下文，GEO-701仍独立验收；旧资格投影是否接线以相应API为准。


GEO-602 / R5 已实现回答级Overview与组成样本API，本地验证完成后交付review：透明卡片、按冻结cell分栏、重点产品、风险、最近批次、机会占位和质量。运行/分析质量两项分母已获本会话用户裁决，详见[方法字典§19](./02-business/04-monitoring-methodology-and-metrics.md)与ADR-004；范围和实际验证见[Task Brief](../../.trellis/tasks/10-03-geo-602-overview/prd.md)与[实施证据](../../.trellis/tasks/10-03-geo-602-overview/implement.md)。不实施603/604洞察明细、605前端、Opportunity、Browser或生产启用；最终状态以manifest为准。

GEO-603 / R5 提供回答级趋势、产品矩阵、问题变体/主题覆盖、平台表现和 Mention/Recommendation SOV，另有同筛选组成运行 GET。不可比窗口显式不可用，实际竞争集合改变不聚合，点名不进入自然可见/SOV；完整 cell 和全部变体可追溯。语义见[方法字典§20](./02-business/04-monitoring-methodology-and-metrics.md)，范围及逐项验证见[Task Brief](../../.trellis/tasks/10-04-geo-603-trends-coverage/prd.md)、[设计](../../.trellis/tasks/10-04-geo-603-trends-coverage/design.md)和[实施证据](../../.trellis/tasks/10-04-geo-603-trends-coverage/implement.md)。无DDL/Alembic、前端页面或生产启用；状态以manifest为准，完成本地验证仅进入review，等待人工接受。

GEO-604 / R5 扩展回答级洞察，提供域名/URL/来源类别、声明与错误severity、共享域名、review backlog、去重排除计数及费用/版本覆盖，并新增三个同筛选明细GET。摘要和下钻共用601资格与current有效结果；UNJUDGEABLE独立可见，费用未知不补零、币种分开。当前合同见[方法§21](./02-business/04-monitoring-methodology-and-metrics.md)，实施及逐项实际验证见[Task Brief](../../.trellis/tasks/10-04-geo-604-citation-risk-quality/prd.md)、[设计](../../.trellis/tasks/10-04-geo-604-citation-risk-quality/design.md)和[实施证据](../../.trellis/tasks/10-04-geo-604-citation-risk-quality/implement.md)。无DDL/Alembic/回填，605页面见下文；702行动闭环、Browser和生产启用仍由各自任务交付。状态以manifest为准。

GEO-605 / R5 新增 `/geo/overview` 总览和 `/geo/insights/answers` 回答洞察，保留旧文章关系 `/geo/insights` 及打印。统一 URL 筛选作用于全部卡片、双窗口趋势、产品矩阵、问题/平台表现、SOV、引用、风险、质量与分页明细。只格式化服务端结果，不重算公式、资格或样本级别；null 不补零，图形始终附可访问表格，引用和声明只读。当前 URL/query key/异步与安全合同见[前端架构§0.4](./03-technical/04-frontend-architecture.md)，逐项验证、独立审查及已知缺口见[Task Brief](../../.trellis/tasks/10-04-geo-605-insights-ui/prd.md)与[实施证据](../../.trellis/tasks/10-04-geo-605-insights-ui/implement.md)。无 OpenAPI/DB/Alembic 变化；filter-options、平均排名、机会/报告/导出、干预比较及生产启用不在本次交付。任务状态以 manifest 为准，仅进入 review，等待人工接受。

GEO-702 / R6 已建立Opportunity、来源、行动与追加评估记录，确定性开放identity与十条初始规则；批量评估复用601/603/604有效事实及701完整规则快照。低样本、无分母、不可比或阈值未配置保留原因，不生成机会。0059为加法前滚，不回填或改写历史；关闭机会与来源保留，Batch来源使用真实RESTRICT FK。当前内部合同见[数据库合同](../../contracts/database.md#geo-702-opportunity来源行动与评估r6)与[数据架构§7](./03-technical/02-data-architecture.md#71-geo_opportunities)，逐项证据见[Task Brief](../../.trellis/tasks/10-04-geo-702-opportunity-evaluation/prd.md)、[设计](../../.trellis/tasks/10-04-geo-702-opportunity-evaluation/design.md)和[实施记录](../../.trellis/tasks/10-04-geo-702-opportunity-evaluation/implement.md)。无新HTTP operation或前端页面；703API/工作台、704行动、705/706复测与解决、Browser及生产启用仍由后续任务交付。仅review等待人工接受，状态以manifest为准。


GEO-703 / R6 新增机会列表/详情与acknowledge/dismiss API、历史证据读模型和 `/geo/opportunities` URL工作台/Drawer。服务端拥有状态和动作，关闭必须原因；历史analysis/review绑定不随当前Run pointer漂移。无新DDL/Alembic或生产启用，行动创建/复测/resolve仍由704–706交付。设计与实际验证见[Task Brief](../../.trellis/tasks/10-04-geo-703-opportunity-workbench/prd.md)、[设计](../../.trellis/tasks/10-04-geo-703-opportunity-workbench/design.md)和[实施证据](../../.trellis/tasks/10-04-geo-703-opportunity-workbench/implement.md)；状态以manifest为准。

GEO-706 / R6 提供机会干预前后比较、冻结恢复裁决与显式继续/解决。基线固定首次触发的历史分析/复核，复测读取最新有效证据；结果展示两个窗口的样本、排除原因和实际环境、模型及采集方式差异，单次变化不构成因果结论。0062 新增不可变处理记录，无历史回填；CAS 和比较指纹在持锁后重验，人工解决与复测恢复确认独立。范围、真实验证和限制见[Task Brief](../../.trellis/tasks/10-04-geo-706-retest-comparison/prd.md)、[设计](../../.trellis/tasks/10-04-geo-706-retest-comparison/design.md)和[实施证据](../../.trellis/tasks/10-04-geo-706-retest-comparison/implement.md)。状态以[任务清单](./04-delivery/task-manifest.yaml)为准；完整 R6 验收由 GEO-707 另行交付。


GEO-707 / R6 收口 TOPIC_COVERAGE_GAP → ContentTask → RETEST → 显式解决纵向验收，并补首次机会创建审计和已存在复测审计的前端消费者。当前状态以 manifest 为准，交付仅 review，待人工接受。实际验证、页面/API 覆盖边界与限制见 [R6 机会闭环验收](./04-delivery/10-r6-opportunity-acceptance.md)、[Task Brief](../../.trellis/tasks/10-04-geo-707-r6-acceptance/prd.md) 与 [实施证据](../../.trellis/tasks/10-04-geo-707-r6-acceptance/implement.md)。无新 OpenAPI wire shape、Alembic revision、历史回填或生产上线，该次707交付未实施GEO-901/902，后续状态以manifest为准。


GEO-801 / R7 提供独立 Browser Collector package/image、三个环境共享的 `geo-browser`
Compose profile、真实离线 Chromium 健康、资源/网络隔离与默认 STOP kill switch。
默认不启动，不接 Broker/数据库；UUID 入口在关闭时拒绝，开启后仍显式未实现。
普通 API Worker 忽略误投非 API Run，普通镜像没有浏览器依赖。运行合同见
[部署文档](./03-technical/08-deployment-and-operations.md#当前-r7geo-801-独立-browser-骨架)，
范围与实际验证见 [Task Brief](../../.trellis/tasks/10-05-geo-801-browser-collector/prd.md) 和
[实施证据](../../.trellis/tasks/10-05-geo-801-browser-collector/implement.md)。
状态以 manifest 为准；无新 API/数据库迁移，不实现802会话、803模拟站或真实平台采集/生产启用。

GEO-803 / R7 新增完全本地的模拟AI站与Browser Adapter合同套件：streaming/晚到引用、
登录/过期、selector漂移、挑战页、敏感UI和超时。测试参考Adapter不进入生产Registry；
结果复用现有Collector类型，CI在仅回环的独立Chromium容器执行，打印前扫描虚构canary。
协议、运行与接入方法见[模拟站说明](../../tests/browser-fixture/README.md)，
实际验证及限制见[Task Brief](../../.trellis/tasks/10-05-geo-803-browser-contract/prd.md)与
[实施证据](../../.trellis/tasks/10-05-geo-803-browser-contract/implement.md)。
状态以 manifest 为准；GEO-803 已人工接受为 done，未实施 GEO-804 真实平台或 GEO-805 生产证据捕获。804～807 按 ADR-006 延期。


GEO-901 / R8 已交付限批材料清理、dry-run、引用保护和低敏不可变墓碑，状态为review等待人工接受。0064加法前滚、默认保留策略不启用且新任务只预览；所有指标/Answer历史与引用raw保持。实际验证、Browser开发环境N/A与覆盖边界见[Task Brief](../../.trellis/tasks/10-05-geo-901-retention/prd.md)、[实施证据](../../.trellis/tasks/10-05-geo-901-retention/implement.md)及[运维](./03-technical/08-deployment-and-operations.md)。生产Browser false/无会话由904/906另行实测；903恢复记录见下方。


GEO-902 / R8 增加受保护运维CLI、PG低敏指标、稳定JSON日志、Worker/Beat真实健康与
Grafana/Prometheus资产。最老pending、过期lease、费用异常和失败分布可定位；
业务低表现不影响容器健康。无公共API/前端行为变化，0065为加法迁移、无历史回填。
实际验证和限制见[Task Brief](../../.trellis/tasks/10-05-geo-902-observability/prd.md)、
[实施记录](../../.trellis/tasks/10-05-geo-902-observability/implement.md)和
[运维资产](../../deploy/observability/geo/README.md)。当时只交付review，未部署生产或实施903/905；当前状态以manifest为准。


GEO-903 / R8 交付加密一致性集合、数据库/对象/密钥成套恢复扫描和一次性隔离演练。
入口及资产/恢复/停止/Browser条件流程见[恢复Runbook](./03-technical/09-backup-recovery-runbook.md)。
真实PG16、对象HTTP GET/HEAD、配套凭据、Run Detail/Overview、调度去重与中断清理的
实际证据见[Task Brief](../../.trellis/tasks/10-05-geo-903-recovery/prd.md)与
[实施记录](../../.trellis/tasks/10-05-geo-903-recovery/implement.md)。已人工接受为done；
Browser N/A只适用于新建演练来源的检查证据，生产false/无会话由904/906另核实。


GEO-905 / R8 实施Run列表先窄键分页再投影、真实Worker启动并发配置，以及100k列表/CSV、1000根矩阵、threads/prefork并发和EXPLAIN诊断门禁。实施时因目标环境与冻结阈值缺失blocked，随后用户明确接受为done；本地结果不能当作VPS验收，目标容量仍待906收口。范围、真实失败/补验证、资源限制及状态见[容量记录](./04-delivery/12-r8-capacity-hardening.md)、[Task Brief](../../.trellis/tasks/10-05-geo-905-capacity/prd.md)和[实施证据](../../.trellis/tasks/10-05-geo-905-capacity/implement.md)。没有新API/数据库迁移、业务物化缓存或生产部署。

GEO-906 / R8 本轮因必需生产输入/人工批准缺失记录blocked，当前状态以manifest为准。提供[渐进发布Runbook](./03-technical/10-core-rollout-runbook.md)、[记录模板](./04-delivery/geo-906-release-record.template.yaml)及[最终验收矩阵](./04-delivery/13-r8-core-release-acceptance.md)，修正配置gate对已验收retention注册的旧断言。未执行生产expand/deploy/enable；目标入口、候选和阶段批准尚缺。MANUAL/API公式、历史、安全边界和运行开关未改，Browser现场仍NOT_VERIFIED，不能填N/A；生产cron/自动evaluator缺口保留。核心与R7延期证据分别记录，不标已上线。
