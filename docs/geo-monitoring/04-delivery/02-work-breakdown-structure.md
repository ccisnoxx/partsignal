# PartSignal GEO 工作分解结构（WBS）

| 项目 | 内容 |
|---|---|
| 文档版本 | V1.0 |
| 文档状态 | 可执行任务基线 |
| 任务粒度 | 一个任务对应一个可独立评审和验收的分支/PR |

## 1. 使用规则

1. 只有依赖任务全部完成，任务才可进入 `ready`；
2. 每个任务执行前使用 `05-task-template.md` 生成任务说明；
3. 公共接口先改 OpenAPI，数据库先改 contract 和 Alembic；
4. 任务不得顺手实现后续任务；
5. 完成状态必须附验证命令、测试结果和迁移证据；
6. 高风险任务可以继续拆分，但不能合并成大爆炸 PR。

## 2. 任务总表

## R0 文档与基线

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-001` | 将 GEO 文档包纳入仓库并建立导航 | — | 把文档放入 docs/geo-monitoring，补充仓库导航、阅读顺序和文档状态。 | Markdown 链接检查；不运行代码变更。；所有文档可从单一入口访问，现有文档不被覆盖。 |
| `GEO-002` | 评审并接受初始 GEO ADR | GEO-001 | 确认模块化单体、统一运行模型、采集/分析/复核分离、无统一总分、分阶段采集五项决策。 | 架构评审记录。；ADR 状态为 Accepted，冲突方案有明确结论。 |
| `GEO-003` | 冻结当前 GEO 实现与契约基线 | GEO-001, GEO-002 | 盘点现有 GeoObservation、GeoInsights、路由、表、E2E、查询和迁移，生成基线清单。 | 运行 make verify 或记录无法运行项；保存 schema/route/test 基线。；后续任务能明确区分现有文章关系观测和新回答级观测。 |
| `GEO-004` | 增加 GEO 渐进启用配置和安全默认值 | GEO-003 | 增加 GEO_MONITORING/API/BROWSER/OPPORTUNITY 功能开关及配置校验，默认关闭新自动能力。 | Settings 单元测试、生产边界测试、Compose config。；API/Worker/Scheduler 读取一致配置；关闭时无外部调用。 |
| `GEO-005` | 建立 GEO 测试夹具和金标目录 | GEO-003 | 创建虚构产品、问题、回答、引用和分析金标目录，定义 fixture 格式和敏感数据规则。 | Fixture schema 校验；最小加载测试。；后续分析和指标任务可复用稳定夹具，不含真实公司或凭据。 |

## R1 主数据与计划

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-101` | 定义 GEO Catalog 公共契约与数据库合同 | GEO-003, GEO-002 | 定义 GeoSubject、Alias、Domain 的请求/响应、枚举、错误码、约束和删除语义。 | Contract schema tests。；契约包含 revision、actions、blockers，OWN_PRODUCT 不复制 Product 事实。 |
| `GEO-102` | 实现 GEO Catalog ORM 与 Alembic | GEO-101 | 新增 geo_subjects/aliases/domains、约束、索引和模型注册。 | 迁移、metadata、约束、直接 SQL 反例。；当前 head 可前滚，OWN_PRODUCT 唯一和父子约束生效。 |
| `GEO-103` | 实现 GEO Catalog Schema 与领域策略 | GEO-101, GEO-102 | 实现规范化、父子类型、域名、stage/actions/deletion projection。 | 单元测试覆盖别名歧义、IDNA、动作。；未知类型和非法父子关系明确失败，无前端推断。 |
| `GEO-104` | 实现 GEO Catalog 应用服务和 API | GEO-103 | CRUD、启停、删除、列表/详情、引用计数和审计。 | PostgreSQL 集成、并发唯一冲突、权限/CSRF。；有历史引用只能停用；错误映射只认精确约束。 |
| `GEO-105` | 实现监测对象、竞品、别名和域名管理页面 | GEO-104 | 管理员工作台、搜索筛选、详情、别名/域名、启停和阻断展示。 | Vitest 组件测试、generated types、路由测试。；ENGINEER 只读；409 保留表单；不暴露敏感数据。 |
| `GEO-106` | 完成 Catalog 纵向验收和产品引导 | GEO-105 | E2E 创建 OWN_PRODUCT/竞品/alias/domain，补充使用说明和测试证据。 | Playwright real API；make verify 相关集合。；可从现有 Product 建立唯一监测身份且不改变产品事实。 |
| `GEO-201` | 定义并实现 PromptVariant 契约与数据模型 | GEO-003, GEO-101 | 新增 geo_prompt_variants、branded/unbranded、语言、地区、优先级、revision。 | 迁移、唯一性、规范化、历史引用测试。；复用 QueryTopic；变体被运行引用后只能停用。 |
| `GEO-202` | 实现问题变体服务、API 和前端工作区 | GEO-201 | 变体 CRUD/启停、列表过滤、详情和运行入口占位。 | 集成、权限、组件和 E2E。；点名属性显式；页面不从文本猜测；历史语义稳定。 |
| `GEO-203` | 定义并实现 EngineSurface 与 CollectionProfile 数据契约 | GEO-004, GEO-101 | 新增观测面/profile、能力、模式、合规状态、AI model 引用和非敏感 settings。 | 模式组合、FK、敏感字段缺失、迁移测试。；MANUAL/API/BROWSER 约束明确，profile 响应不含 secret。 |
| `GEO-204` | 建立 Collector Registry 和 Profile 资格策略 | GEO-203 | adapter registry、capabilities、validate_profile、未知 adapter 和开关门禁。 | 单元 contract tests。；Plan preview 与 Worker 可复用同一资格策略；未知 adapter 不回退。 |
| `GEO-205` | 实现观测面/Profile 管理 API 和页面 | GEO-204 | CRUD、启停、非敏感列表/详情、UNTESTED 状态和管理员工作台。 | 权限、CSRF、敏感回显、组件测试。；BROWSER 未批准时不可启用；ENGINEER 仅看摘要。 |
| `GEO-206` | 定义并实现 MonitoringPlan 数据契约 | GEO-202, GEO-205 | 计划及 subject/prompt/profile 关系、状态、repeat、cron、budget、revision。 | 迁移、CHECK、关系唯一、删除阻断。；至少一个 PRIMARY、prompt、profile；计划配置不保存运行状态。 |
| `GEO-207` | 实现服务端运行矩阵预览和费用覆盖 | GEO-206, GEO-204 | RunMatrixBuilder、资格 blocker/warning、manual/api/browser 数量、known/unknown cost。 | 矩阵组合、停用资源、预算、能力缺失、边界。；10×3×3 准确返回 90；未知费用不补零。 |
| `GEO-208` | 实现 Plan 命令、查询、状态机和 API | GEO-207 | CRUD、preview、activate/pause/resume/archive/copy/run-now 占位、读模型、审计。 | 状态机、revision、并发、权限、审计。；ACTIVE 修改不改变未来已创建快照；ARCHIVED 只读。 |
| `GEO-209` | 实现监测计划列表和向导 | GEO-208 | 分步向导、服务端预览、URL 列表、状态动作、dirty 保护。 | Vitest、路由、409、E2E 创建/启停计划。；前端不计算最终 run_count；所有 blocker 可定位修正。 |

## R2 人工运行框架（核心正式采集方式）

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-301` | 定义 Batch/Run 公共契约与数据库模型 | GEO-208, GEO-002 | 批次、运行、快照、attempt、lease、状态、索引和错误字段。 | 迁移、CHECK、唯一单元、终态反例。；Run 输入不可变；Batch 可从 runs 重建；旧 GeoObservation 不迁移。 |
| `GEO-302` | 实现 Batch/Run 状态策略与动作投影 | GEO-301 | 合法转换、batch 状态投影、retry/cancel 资格、workflow stage/actions。 | 完整状态机表驱动测试。；前端无需从 status 推断动作；终态不能回退。 |
| `GEO-303` | 实现批次工厂、计划快照和创建幂等 | GEO-302, GEO-207 | 从 plan/临时请求冻结矩阵、原子创建 batch+runs、schedule/manual identity。 | PostgreSQL 事务、并发同键、1000 runs、无部分提交。；requested_run_count 与实际 runs 一致；提交后配置变化无影响。 |
| `GEO-304` | 定义并实现 AnswerSnapshot、Citation 与证据关联 | GEO-301 | 原始回答、哈希、引用、截图/raw payload 文件引用和不可变防线。 | 迁移、URL 规范化、文件资格、UPDATE 反例。；原始证据提交后不可修改；secret 不进入 raw summary。 |
| `GEO-305` | 实现 MANUAL 草稿和正式提交 | GEO-303, GEO-304 | manual entry context、draft revision、submit、幂等、状态推进和分析投递占位。 | 并发提交、草稿冲突、证据要求、非 MANUAL 拒绝。；正式提交一次冻结 answer/citations/files；失败不伪装成功。 |
| `GEO-306` | 实现 Batch/Run 列表与详情读模型 | GEO-303, GEO-305 | 批次 summary、run 分页、GeoRunDetail、时间线、data quality 占位。 | REPEATABLE READ、固定查询数、筛选分页。；详情单请求返回输入、证据、状态和 attempts；大文件只返回签名访问。 |
| `GEO-307` | 实现运行中心、人工录入和详情页面 | GEO-306 | 批次/运行双层视图、manual editor、截图上传、引用编辑、详情证据。 | 组件、dirty、轮询、错误、Playwright。；人工批次完整纵向通过；刷新不丢筛选或草稿。 |
| `GEO-308` | 完成 R2 并发、不可变和兼容性验收 | GEO-307 | 补齐取消/提交竞态、不可变触发器、旧文章观测导航兼容和 R2 验收证据。 | make verify + GEO E2E。；现有 GEO 流程不回归，新人工回答级观测可业务试用。 |

## R3 API 自动观测

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-401` | 定义 GeoCollector 协议和稳定错误模型 | GEO-204, GEO-301 | CollectionRequest/CollectedAnswer/CollectorError、capability 和 adapter contract。 | 抽象 contract unit tests。；Collector 不依赖 ORM，不提交事务，错误含 send state。 |
| `GEO-402` | 实现 GEO fake provider 和 Collector 合同套件 | GEO-401, GEO-005 | 成功、引用、429、timeout、disconnect、redirect、oversize、invalid response 模式和调用计数。 | 合同套件自身测试。；CI 可证明每 attempt 调用次数和 secret 脱敏。 |
| `GEO-403` | 实现 API Profile 连接测试和能力验证 | GEO-402, GEO-205 | 管理员 test 命令、状态、错误摘要、模型/profile 资格失效规则。 | 真实 pinned transport fake HTTPS、前端状态。；测试不创建业务 run；成功不自动启用 profile。 |
| `GEO-404` | 实现 OpenAI-compatible GEO Collector | GEO-401, GEO-403 | 无品牌污染的 user prompt 请求、回答/引用/usage/cost 解析、严格大小和错误。 | Collector contract、SSRF/TLS/响应金标。；不复用 GeneratedDraft 解析；未知搜索/费用为 null。 |
| `GEO-405` | 实现采集 Worker、lease、dispatch 和补投递 | GEO-303, GEO-404, GEO-004 | claim、RUNNING、调用、结果提交、PENDING redispatch、expired lease 扫描。 | 真实 Redis/Celery 集成。；消息仅携带 run ID；重复消息不重复调用。 |
| `GEO-406` | 实现 external_call_state 与 at-most-once 恢复 | GEO-405 | NOT_STARTED/SENT/UNKNOWN/COMPLETED 持久化、崩溃恢复、迟到结果和显式 retry attempt。 | 发送前/后崩溃、UNKNOWN、success late result、并发 retry。；发送后任何失败不自动重发；原 attempt 终态保留。 |
| `GEO-407` | 实现引用、usage、cost、预算和 profile rate limit | GEO-405, GEO-406 | 保存采集元数据、费用覆盖、batch/day budget、并发预留和 rate limit。 | 预算并发、未知费用、429、限速。；未知费用不当 0；预算判断不是前端独有。 |
| `GEO-408` | 完成 API 自动观测 UI 和纵向验收 | GEO-407, GEO-307 | 自动 run 状态轮询、费用/usage/错误/重试展示、API E2E 和运维说明。 | Playwright real stack + fake provider。；R3 业务演示全部通过，功能开关关闭时无外部调用。 |

## R4 分析与复核

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-501` | 定义 AnalysisRevision、Mention、Recommendation、Claim、Review 契约和表 | GEO-304, GEO-005 | 分析 revision、子结果、review、current pointer/选择规则和不可变约束。 | 迁移、unique、UPDATE/DELETE 反例。；原始证据与分析分离；revision 可追溯。 |
| `GEO-502` | 实现监测对象别名快照和确定性提及识别 | GEO-501, GEO-106 | 中英文、型号边界、大小写/连字符、否定上下文和歧义原因。 | 金标单元测试。；同别名歧义触发复核，不任意选择 subject。 |
| `GEO-503` | 实现推荐分类和可靠位置识别 | GEO-501, GEO-502 | RECOMMENDED/CONSIDERED/NOT_RECOMMENDED/UNKNOWN、rank 和依据。 | 列举、否定、有序/无序、多竞品金标。；名称出现不自动等于推荐；无可靠顺序 rank 为 null。 |
| `GEO-504` | 实现引用归属和来源类别分析 | GEO-501, GEO-106, GEO-304 | 自有/竞品域名、来源类别、歧义、规则版本。 | hostname 边界、子域名、IDNA、共享域名、人工修正。；不使用字符串 contains 误判；引用仍以原始记录为权威。 |
| `GEO-505` | 实现声明提取、事实版本装配和准确性评估 | GEO-501, GEO-502 | claim types、FactVersion 资格、verdict、severity、UNJUDGEABLE 和关键替代关系门禁。 | 参数、封装、认证、条件替代、事实不足金标。；只用 APPROVED FactVersion；受限事实不被外发。 |
| `GEO-506` | 实现 Analysis Worker 和 revision 生命周期 | GEO-502, GEO-503, GEO-504, GEO-505, GEO-405 | COLLECTED claim、revision、结果原子写入、review reasons、run 状态推进、reanalyze。 | Worker 集成、失败、重复任务、迟到结果。；分析失败不丢 AnswerSnapshot；相同 input hash 幂等。 |
| `GEO-507` | 实现人工复核策略、API 和当前结果选择 | GEO-506 | confirm/correct、stale revision、追加式 review、current reviewed projection。 | 权限、并发、旧 review supersede、correction schema。；NEEDS_REVIEW 未复核不进入业务指标；原机器结果保留。 |
| `GEO-508` | 实现分析/复核前端并完成 R4 金标验收 | GEO-507 | 详情分析区、声明表、修正表单、历史、E2E 和分析器质量报告。 | Vitest、Playwright、全部金标。；用户可追溯原文→分析→复核，严重错误必须人工处理。 |

## R5 指标与洞察

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-601` | 实现 MetricEligibility、样本等级和公式库 | GEO-507 | 通用资格、可比维度、比率结构、visibility/recommendation/SOV/citation/accuracy/stability。 | 完整金标公式测试。；无分母 null；失败不算未提及；人工/模式默认分离。 |
| `GEO-602` | 实现 GEO Overview 读模型和 API | GEO-601 | 卡片、重点产品、风险、最近批次、开放机会占位和数据质量。 | REPEATABLE READ、固定查询数、筛选一致。；所有卡片含分子/分母和下钻筛选。 |
| `GEO-603` | 实现趋势、竞品 SOV 和问题/平台覆盖 | GEO-601 | 前周期、产品矩阵、问题覆盖、平台表现、Mention/Recommendation SOV。 | competitor set 变化、样本不足、点名排除。；不可比窗口明确不可用，不静默聚合。 |
| `GEO-604` | 实现引用、事实风险和数据质量洞察 | GEO-601, GEO-504, GEO-505 | 域名/URL、source categories、claims、severity、排除计数、费用/版本覆盖。 | 引用去重、共享域名、UNJUDGEABLE、review backlog。；摘要和明细下钻结果一致。 |
| `GEO-605` | 实现总览和分析洞察前端 | GEO-602, GEO-603, GEO-604 | URL 筛选、指标卡、趋势、矩阵、SOV、引用、风险、数据质量和表格替代。 | 组件、路由、null/sample level、E2E。；前端不计算公式；图表可访问；筛选作用于全部区块。 |
| `GEO-606` | 实现打印报告和安全 CSV 导出 | GEO-605 | 报告预览、打印路由、runs/citations/claims/opportunities CSV、审计。 | CSV 注入、字段白名单、流式、大数据、打印 E2E。；报告显示筛选、as_of、公式和数据质量；空数据不伪装成功。 |
| `GEO-607` | 完成洞察性能、索引和 R5 验收 | GEO-606 | 查询计划、必要索引、100k run fixture、性能证据和门禁。 | P95 基准、N+1 检查、make verify。；常用 30 天洞察达到目标，无不可重建的指标缓存。 |

## R6 机会与复测

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-701` | 定义 GEO 规则集契约和配置 | GEO-601 | 最低样本、阈值、去重窗口、复测恢复条件和规则 revision/preview。 | Schema、权限、revision、规则 preview。；规则更新影响未来评估，历史 opportunity 保存快照。 |
| `GEO-702` | 实现 Opportunity 数据模型、identity 和评估器 | GEO-701, GEO-603, GEO-604 | opportunities/sources/actions、确定性 identity、初始规则、批量评估。 | 并发去重、样本不足、周期更新、状态机。；每个机会含规则、值、阈值、来源运行和不可用原因。 |
| `GEO-703` | 实现 Opportunity API、读模型和工作台 | GEO-702 | 列表、详情、ack/dismiss、证据、状态、URL 筛选和 Drawer。 | 权限、revision、组件、E2E。；状态和动作服务端拥有；驳回/解决需非空原因。 |
| `GEO-704` | 集成事实修订、内容任务和发布修复行动 | GEO-703 | 通过现有服务创建/导航行动、保存 action link 和来源快照。 | 跨域集成、失败回滚/可恢复、权限、审计。；不直接修改其他域 ORM；任务完成不自动解决机会。 |
| `GEO-705` | 实现 RetestPlanner、基线冻结和可比性门禁 | GEO-704, GEO-303 | 基线 snapshot、严格矩阵复现、差异列表、RETEST batch、幂等。 | profile/variant 不可用、模型版本变化、并发、重复复测。；不可比时阻断或要求新基线，不静默替换。 |
| `GEO-706` | 实现干预前后比较和机会解决流程 | GEO-705, GEO-605 | baseline/retest metrics、样本说明、恢复规则、显式 resolve/continue。 | 前后窗口、样本不足、未恢复、人工解决。；页面不宣称因果；结果含环境/模型差异。 |
| `GEO-707` | 完成机会闭环 E2E、审计和 R6 验收 | GEO-706 | TOPIC_COVERAGE_GAP→ContentTask→RETEST→resolve 纵向流，补齐审计。 | Playwright、make verify、审计脱敏。；核心版“监测→行动→复测”闭环可用。 |

## R7 浏览器试点（post-core 可选扩展）

依据[ADR-006](../05-decisions/ADR-006-defer-browser-collection-and-adopt-manual-first-core.md)，801～803 已人工接受为 done，基础设施和证据保留；804～807 deferred/post-core，不得执行或标 done。每项延期原因、恢复条件和待定责任见 task-manifest。以下保留恢复后的目标设计；当前核心使用[MANUAL SOP](../02-business/05-manual-geo-observation-sop.md)，R6 直接进入 R8。

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-801` | 建立独立 Browser Collector 服务骨架和 Compose profile | GEO-408, GEO-002 | 独立镜像/服务、任务领取边界、资源/网络限制、默认关闭。 | Compose config、健康、无 profile 时不启动。；普通 API/Worker 不包含浏览器依赖，kill switch 可用。 |
| `GEO-802` | 实现浏览器会话加密引用和撤销流程 | GEO-801 | session reference、health、人工登录导入/撤销、访问控制和审计。 | 越权、secret redaction、撤销、恢复。；Cookie 不进数据库明文、日志、普通 OSS 或截图。 |
| `GEO-803` | 建设本地模拟 AI 产品和 Browser Adapter 合同套件 | GEO-801, GEO-402 | streaming DOM、引用卡片、登录态、selector 变化、挑战页和敏感 UI。 | 完全本地 Playwright adapter contract。；CI 不访问真实第三方，适配器失败语义可重复。 |
| `GEO-804` | 实现第一个合规批准的真实界面 Adapter | GEO-802, GEO-803 | temporary chat、submit、stable wait、answer/citation extraction、version metadata。 | local contract + 受控 staging smoke。；DOM 不确定时失败，不保存空成功；频率限制生效。 |
| `GEO-805` | 实现浏览器证据捕获、敏感裁剪和对象存储提交 | GEO-804, GEO-304 | 截图、可选安全 DOM 摘要、哈希、敏感区域规则和 AnswerSnapshot 提交。 | 账号菜单/登录页/失败截图、哈希、存储故障。；业务证据不包含账号、Cookie、支付或调试敏感信息。 |
| `GEO-806` | 实现 Browser Profile 健康、频率、kill switch 和管理 UI | GEO-805, GEO-205 | session health、reauth、max concurrency、rate limit、开关、运维状态。 | 会话过期、停用、并发、UI 权限。；管理员可立即停止新浏览器运行并识别需重新登录 profile。 |
| `GEO-807` | 执行真实平台小规模试点和人工交叉验收 | GEO-806 | 批准账号、低频计划、人工/API/浏览器结果对比、停止和撤销演练。 | 受控人工验收，不作为普通 CI。；合规清单、数据质量、账号安全和试点报告均批准后才可生产启用。 |

## R8 核心生产硬化（R6 直接进入）

| ID | 任务 | 依赖 | 主要交付 | 测试与验收 |
|---|---|---|---|---|
| `GEO-901` | 实现 GEO 数据保留、归档和清理任务 | GEO-707 | raw payload、临时草稿、无引用文件的限批清理和墓碑；Browser 临时数据仅在部署 R7 或存在材料时适用，否则记录有依据的 N/A。 | 保留边界、引用保护、存储故障重试、dry-run。；不删除指标所需元数据和已引用证据，清理可观察；Browser 延期不豁免实际存在材料的保护/清理。 |
| `GEO-902` | 完善运行、成本、失败和积压可观察性 | GEO-408, GEO-607, GEO-707 | 低敏感指标、dashboard/alerts、稳定日志字段、Scheduler/Worker health。 | 指标模拟、告警阈值、日志 secret scan。；可区分业务低表现与系统故障；可定位 oldest pending/expired lease。 |
| `GEO-903` | 完成数据库、OSS、密钥和会话备份恢复演练 | GEO-901, GEO-902 | 数据库、OSS、适用密钥的备份清单、恢复步骤、一致性扫描与隔离证据；未部署 R7 且确认无 Browser 材料时，会话恢复 N/A。 | 真实隔离恢复、哈希、凭据解密、调度去重。；任意 Run Detail 和指标可恢复；缺失对象明确报告；N/A 附部署及材料检查依据，存在 Browser 材料仍须保护并验证恢复/撤销。 |
| `GEO-904` | 执行 GEO 安全与合规专项复核 | GEO-903 | 权限、CSRF、SSRF、secret、XSS、CSV、prompt injection 和实际外部平台批准检查；核心环境验证 Browser false、服务/profile 未启用且无生产会话/会话材料。 | 全部 TEST-GEO-SEC。；无未接受的高风险项；例外有责任人和到期日；Browser 关闭及无生产会话有目标环境证据，不能仅凭默认配置判定。 |
| `GEO-905` | 完成大数据量性能和容量硬化 | GEO-607, GEO-902 | 100k+ runs、1000 run batch、流式导出、并发 Worker、必要索引/物化策略。 | 性能门禁和查询计划。；达到目标环境阈值，缓存可重建且不成为权威。 |
| `GEO-906` | 执行生产渐进上线、最终验收和文档状态更新 | GEO-903, GEO-904, GEO-905 | 核心范围 expand/deploy/enable、MANUAL 正式闭环、内部试用、监控/回滚和文档验收；R7 延期不阻断核心上线，GEO_BROWSER_COLLECTION_ENABLED 必须保持 false。 | make verify、生产 smoke、恢复/停止演练。；核心版正式可用；GEO_BROWSER_COLLECTION_ENABLED=false、Browser 服务/profile 未启用且无生产会话；R7 deferred 不阻断，延期项不标已实现，核心与延期证据分别保留。 |

## R9A Release Blocker Closure：V1.0 人工优先发布阻断闭合

依据 [ADR-007](../05-decisions/ADR-007-manual-first-v1-release-scope.md) 和 [GEO-1001](../06-reviews/GEO-1001-release-readiness-audit.md) 追加。R0—R8 表格为原始交付/接受范围，不将历史 done 等同于当前首发完整性。新增任务的当前状态以 manifest 为准，GEO-1002 完成只进入 review，1003～1010 本次仅 planned；依赖全部 done 后才能 ready。

| ID | 任务 | 依赖 | 主要交付 | 测试 | 验收 |
|---|---|---|---|---|---|
| `GEO-1002` | 冻结 GEO Core V1.0 人工优先发布范围和发布门禁 | GEO-906 | 新增 Accepted ADR-007 与统一能力矩阵；冻结首发范围、配置和 Go/No-Go；追加 GEO-1002～1010 与 R9A 路线图/WBS，不改 R0—R8 历史。 | 离线 Markdown 路径/锚点检查、YAML/依赖无环/任务字段校验、历史任务逐字/结构比对、受保护范围指纹与 git diff --check。 | 范围支持项/排除项和五类状态准确；每项后续任务有依赖/交付/测试/验收；运行代码/Schema/OpenAPI/部署脚本与历史证据不变；GEO-1002 仅 review，不自行 done。 |
| `GEO-1003` | production Browser Collection 硬禁止 | GEO-1002, GEO-004 | 由配置、启动预检和生产 profile/overlay 边界硬拒绝 Browser=true 或显式 geo-browser 启用；保留非生产隔离骨架和默认 false。 | production Settings 与启动预检开启负例、显式 profile/overlay 启用负例、false 正例、API/Worker/Beat 启动配置一致性；不访问真实平台。 | production 不能接受 Browser=true 或绕过预检启动 Browser；拒绝先于服务/会话/网络副作用，错误原因明确；三进程 false 与后续现场零部署证据分开；独立只读复核通过。 |
| `GEO-1004` | Catalog 写命令锁内重验当前管理员身份 | GEO-1002, GEO-104 | 修复 Subject/Alias/Domain 写命令的旧 ADMIN 身份竞态，沿正确锁序重读 active/role/首次改密状态并处理认证 heartbeat；授权与资源写入同一事务。 | 真实 PG 双事务：认证后等待资源锁时发生 ADMIN→ENGINEER、停用、首次改密要求变化；断言拒绝、零业务/审计写入；合法 ADMIN 正例和锁序/heartbeat 回归。 | 身份变化已提交后旧 actor 不得完成 Catalog 写入；没有锁序反转或丢失原 CAS/CSRF/不可变边界；各类 Catalog 写路径共用权威裁决；独立只读复核通过。 |
| `GEO-1005` | V1.0 禁止 CRON 写命令并披露历史只读边界 | GEO-1002, GEO-208, GEO-303 | 禁止 CRON 创建、编辑、启用、恢复、归档、复制、删除、人工运行及从 PLAN 建批；历史 ACTIVE 等存储原值保留，读模型投影 UNSUPPORTED_SCHEDULE，仅 VIEW_HISTORY，无写动作；MANUAL 人工批次正常。 | 策略及真实 PG API 定向负例、MANUAL 正例与目标计划页面 E2E；断言所有 CRON 写路径 409 GEO_PLAN_CRON_UNSUPPORTED、历史无变化、无到期调度副作用。 | 服务端拒绝与动作投影一致；历史明确只读且不承诺自动运行，不原地停用、改成人工类型或删除历史；不实现 CRON Scheduler；独立只读复核通过，现场历史披露由 GEO-1010 核验。 |
| `GEO-1006` | 交付管理员显式 Opportunity 评估入口 | GEO-1002, GEO-702, GEO-703 | 复用现有 evaluator，提供受保护管理员显式操作入口和低敏回执/审计，明确输入窗口/规则/模式/来源与评估资格；选 Router 或受保护 CLI 时在 Task Brief 冻结合同，若新增 HTTP 必须先更新 OpenAPI。 | 入口级真实评估：ADMIN 正例、ENGINEER/停用/资格关闭拒绝、重复触发 identity 去重、低样本/不可比/无引用依据不造机会、来源可追溯；由实际入口触发，不能由 seed 代替。 | 管理员能显式评估并解释结果与未生成原因；权限/事务/历史来源及幂等保留；总开关/评估开关关闭拒绝；不登记自动周期任务、不在提交或聚合读取时隐式执行；独立只读复核通过。 |
| `GEO-1007` | V1.0 页面/API 能力真实性与操作说明对齐 | GEO-1002, GEO-1005, GEO-1006, GEO-606, GEO-707 | 将页面入口、能力说明、管理员评估操作指南与首发矩阵对齐；对 Opportunity CSV、完整 Action/Retest UI、公共重分析、跨页机会/资格占位明确不可用，保留现有 API 组合操作说明。 | 相关页面组件或目标浏览器验收，核对可达入口与权限/错误/空态；三类现有 CSV 成功及 Opportunity CSV 501 说明；人工评估入口和 Action/Retest API 组合说明可复现；文档链接检查。 | 用户看不到可点击但未实现的成功承诺；占位/501 不能当空结果；现有指标/报告/API 边界准确且可操作；不顺带补 CSV、完整 UI、公共重分析或无引用推断；实际检查与未检查范围明列。 |
| `GEO-1008` | 闭合升级候选 artifact 失败安全恢复 | GEO-1002, GEO-903, GEO-906 | 由现有发布状态所有者提供 UPGRADE_DEPLOYING/UPGRADE_PREPARED、未 initialized 时候选无法启动且需新 artifact 的安全前向恢复或阶段恢复路径；维护锁、候选身份、schema 兼容及授权可审查。 | 发布状态集成/隔离演练：前滚后候选 readiness 失败、同候选环境修正重入、修正 artifact 接管、错误身份/旧镜像/并发恢复拒绝、恢复再次失败保持维护；保留业务数据与历史。 | 不通过先 activate、手改/删除状态、覆盖 artifact、直接 Compose up 或 schema downgrade 解锁；能在阶段失败后验证恢复/前向修复并保持公开维护隔离；恢复输入与安全停止明确；独立只读复核通过。 |
| `GEO-1009` | 冻结 V1.0 候选与完整性验证证据 | GEO-1003, GEO-1004, GEO-1005, GEO-1006, GEO-1007, GEO-1008 | 收集已人工接受修复的 diff/独立复核记录；在已批准且已推送 clean main=origin/main 上冻结 commit/archive/release manifest/镜像身份/schema head/tracked-file hashes；记录同一候选完整门禁。 | 既有 candidate producer/consumer 完整性检查；同一固定候选 make verify 全门禁、Markdown/manifest/hash 检查与 git diff --check；历史日志仅在输入相同且证据适用时复用。 | 候选覆盖全部首发修复且可重现，完整门禁 exit 0；dirty 工作区不代替候选；缺 commit/push/candidate 权限或身份输入时 blocked，不擅自提交/推送；不使用测试绕过；不宣称生产已部署。 |
| `GEO-1010` | V1.0 生产 readiness 与 MANUAL 试运行 Go/No-Go | GEO-1009, GEO-904, GEO-905, GEO-906 | 在分别获批目标/阶段收集同候选三进程配置、Browser 硬禁止与零部署/会话/材料、既存 CRON 治理、备份/恢复/停止、容量/监控观察期、正式 MANUAL 闭环及使用者反馈；新建本轮 readiness 记录，不改写旧现场未知。 | 获批目标定向 smoke/页面安全/权限；MANUAL 正式提交→真实分析→必要复核→指标/现有报告→管理员入口评估→Action/Retest API→比较/显式解决；实际负证据、告警、冻结容量和停止/恢复演练。 | 所有必需门禁及业务/运维签署 MET 才 Go；任何 NOT_MET/NOT_VERIFIED/缺授权均 No-Go，保留原始失败/未知；自动 CRON/evaluator 和 R7/未实现页面不作首发必需；完成先 review，done 需用户接受，生产启用仍需相应授权。 |

GEO-1001 是审计输入，不在本轮补登记接受状态。R9A 无直接或隐式 R7 依赖；1003～1008 可按依赖分别交付，1009 冻结候选，1010 收口现场。范围冻结不授权实施后续任务、提交/推送或生产操作。

## 3. 任务状态

推荐状态：

```text
planned → ready → in_progress → review → done
                    └────────────→ blocked
planned / ready / in_progress / blocked → deferred（产品延期）
```

状态更新必须写入 `task-manifest.yaml`，已有 Trellis 记录同步。`deferred` 是产品排期延期，不等于 done、不满足依赖完成条件；须记录 deferred_reason、resume_conditions、release: post-core 和责任人/待定责任。恢复经产品重新排期、授权及依赖重验后重新评估 ready，不能因历史提示词或依赖 done 自动执行。

## 4. 单任务完成证据

每个任务至少记录：

- 关联需求和文档；
- 变更文件和契约；
- Alembic revision（如有）；
- 测试命令和结果；
- 截图/浏览器验收（有页面时）；
- 已知限制和后续任务；
- 数据迁移和回滚说明；
- secret scan 结果（涉及外部服务时）。

## 5. 不建议合并的任务

- Catalog 数据模型与 API 自动采集；
- Batch/Run 数据模型与全部指标；
- 分析器和机会闭环；
- API Collector 和 Browser Collector；
- 公式变化和管理层报告上线；
- 数据迁移和历史重分析。
