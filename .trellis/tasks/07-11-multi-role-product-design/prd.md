# 多角色项目设计评审

## Goal

从产品、前端、后端等角色审视 PartSignal 当前 MVP，识别影响业务闭环、可用性、数据契约和后续演进的缺口，形成有证据、有优先级且可验收的下一阶段方案。

## Background

- 当前系统已实现“批准事实 → 内容任务 → AI 草稿 → 人工审核 → 人工发布登记 → GEO 观测”的 MVP 纵向闭环。
- 现有产品方案、OpenAPI、数据库契约、前后端实现和测试可作为评审证据，不重新猜测已由仓库确认的事实。
- 本任务处于规划阶段，只产出需求、设计和实施规划；未经用户审阅，不启动实现。
- 评审采用多角色只读分析，主 Agent 负责合并冲突、维护唯一规划文档和逐项向用户确认产品决策。

## Scope And Priority

- 本轮只补齐当前 MVP 的全部已确认 P0/P1；核心闭环达到可用、可靠、可验收前，不规划第二阶段扩展能力。
- 产品、前端和后端角色共同提供证据，主 Agent 维护唯一契约与规划；涉及 API、数据库、状态机或跨模块边界时必须明确不变量、迁移风险和验收。
- 不为架构完整性引入无业务价值的复杂度。P2 易用性、移动端、服务端分页和平台账号生命周期不纳入本轮。

## Requirements

### P0-GEN：生成作业可靠性

- 数据库提交后到首次 Redis 投递前的故障不得留下永久 `PENDING`（证据：`backend/app/routers/production.py:374`、`backend/app/worker.py:38`）。超龄且尚未被 Worker 认领的 `PENDING` 必须自动补投递。
- 重复消息和并发认领不得让同一 Job 重复调用供应商或创建多个内容版本。已经进入 `RUNNING` 的作业租约过期后显式失败且不自动重放；用户重试创建新 Job，不承诺供应商与数据库之间无法证明的分布式 exactly-once。
- 租约必须严格覆盖作业快照中的供应商超时与收尾裕量，真实 Worker 丢失仍在明确上界内失败（证据：`backend/app/models.py:457`、`backend/app/config.py:81`）。
- 暴露 Worker/Beat 存活、最老 `PENDING`/`RUNNING` 年龄和失败原因等可定位信号，不记录 Prompt、响应正文或凭据。

### P0-EGRESS：AI 出站安全

- AI 实际 TCP 连接必须绑定本次校验通过的地址集合，保持原始 Host、SNI 和证书校验，禁止 DNS rebinding 绕过公网 HTTPS 限制（证据：`backend/app/services/openai_client.py:52`、`backend/app/services/openai_client.py:123`）。

### P0-PUB：发布平台一致性

- 发布账号所属平台必须与内容任务锁定平台一致，由服务端和数据库最终保护；前端过滤不构成安全控制（证据：`backend/app/routers/publication.py:302`）。

### P1-CLOSURE：任务、发布异常与修复

- `ContentTask.COMPLETED` 表示曾完成发布闭环。第一条关联发布转为 `VERIFIED` 时，服务端在同一业务操作中自动完成仍为 `OPEN` 的任务；删除独立人工完成入口（证据：现入口仅校验状态与 revision，`backend/app/routers/planning.py:495`）。
- 任务存在 `PENDING_MANUAL_PUBLISH`、`PLATFORM_REVIEW` 或 `PUBLISHED` 发布时不得取消；必须先显式处置在途发布，避免任务终态与发布流程冲突。
- `COMPLETED` 是历史终态。关联发布后来转为 `REMOVED` 或 `VERIFICATION_FAILED` 时不回退任务，而是创建独立 `OPEN` 异常待办。
- 创建修复任务只建立关联，不关闭待办；用户完成实际处置并填写非空说明后才能显式转为 `RESOLVED`。
- 修复任务固定继承原产品、目标问题和平台；事实版本与平台规则版本必须分别从当前 `APPROVED` / `ACTIVE` 候选中显式选择并展示新旧差异。受众、内容角度、转化目标、格式、长度和 `canonical_url` 从原任务预填但允许编辑。

### P1-REVIEW：审核证据

- 事实和内容退回意见必须以追加式历史向创建者和审核者可见；批准内容前展示任务锁定事实版本的关键参数、证据、替代边界、质量问题和版本差异（证据：记录已写入 `backend/app/routers/production.py:566`、`backend/app/routers/product_facts.py:609`，当前页面上下文不足，`frontend/src/features/content-editor/ContentEditorPage.tsx:42`）。
- `request-changes` 必须填写非空意见；`submit` 与 `approve` 意见可选，但批准仍需显式确认。服务端执行最终门禁。

### P1-GEO：观测数据与指标

- 指标与明细支持一致的产品、问题、模型和测试时间筛选；更正从记录行发起，不要求用户输入内部 UUID（证据：服务端已有指标筛选，`backend/app/routers/observation.py:205`，前端仍请求无筛选全局数据）。
- 默认列表、指标和近期准确性错误只统计更正链当前有效记录；行内可查看完整历史并显式选择“包含历史”，历史永不进入当前指标。
- 保留“可能影响的发布”与 `GeoCitation` 实际引用两种关系。绑定的发布必须属于同一产品且状态至少为 `PUBLISHED`；绑定发布的 Citation URL 必须与最终 URL 一致。
- `citation_rate` 统计当前有效观测中至少包含一条 `OFFICIAL` 或 `EXTERNAL_COMPANY` Citation 的样本，不要求绑定 `PublicationRecord`；`OTHER` 和“可能影响”不进入分子。

### P1-FRONTEND：失败恢复与工作台

- 依赖查询失败、无权限和真实空状态必须明确区分，并提供重试或准确前置入口；依赖未就绪时不能提交（证据：当前多个关键页面只显示 mutation 错误）。
- 工作台展示近期准确性错误，所有关键待办链接到服务端同一筛选语义（证据：后端已返回字段，前端遗漏，`frontend/src/features/dashboard/DashboardPage.tsx:23`）。
- 从内容任务创建开始的最终主闭环必须通过 UI 验收，不用 `page.request` 绕过被验收步骤。

### P1-INTEGRITY：历史上线门禁

- 契约或迁移上线前运行只读完整性检查。旧 `COMPLETED` 任务缺少 `VERIFIED` 发布、尚未终态处置的跨平台发布错绑或当前有效 GEO 关联非法时，输出稳定记录 ID 与原因并阻断上线。
- 用户逐条显式处置历史问题；不自动改绑、删除、回退或猜测修复。
- 异步、并发、状态和数据完整性要求由 PostgreSQL 集成测试、故障注入或全 UI E2E 证明，不能只依赖固定成功 Mock。

### P1-OPS：生产可运行与真实预发布

- 生产敏感配置必须通过 Secret 文件注入并在启动、部署前显式校验；普通环境变量不得承载明文凭据。
- 月度 UI/API 可用性 SLO 为 `99.5%`；非外部同步 API `p95 < 1s`；生成作业从 `PENDING` 到 `RUNNING` 的 `p95 < 5min`。健康、日志、诊断和告警必须能区分 API、Worker、Beat、Redis、PostgreSQL、OSS 与模型供应商故障。
- 每日数据库备份必须在客户端加密后上传异地区域，满足 `RPO 24h`、`RTO 4h`，并通过隔离环境恢复演练证明可恢复。
- 部署必须固定执行 Secret 检查、Compose 校验、加密备份、历史门禁、迁移、服务启动、smoke test 与诊断；新状态已经写入时不得以破坏历史的 downgrade 回滚。
- 普通 CI 继续使用 fake OSS 和真实 HTTP 模型替身；上线前预发布必须使用专用非生产 OSS、低权限真实模型和纯虚构 `PUBLIC` 数据完成全 UI 验收。
- 审计保留、账号安全和第三方模型数据分级必须有明确运维边界；第三方模型只接收 `PUBLIC` 数据。

### P1-STRUCT：行为保持的模块化单体整理

- 继续保持模块化单体，不拆微服务；结构调整只在业务契约、数据库和状态机稳定后开始。
- 评估并按真实职责拆分 `models.py`、`schemas.py` 和大型 Router；Router 只负责 HTTP 契约映射，业务状态转换由对应领域应用服务唯一拥有。
- PostgreSQL 继续作为唯一业务状态源；不得引入第二套 Schema、重复状态机、Repository/Factory/Plugin 框架或无价值的一行转发抽象。
- 重构必须行为保持，不改变 OpenAPI、数据库语义、迁移历史、错误码、权限、前端行为和部署接口。

## Child Tasks

1. **`07-11-generation-reliability` 生成作业可靠性与可观测性**：补投递、租约不变量、重复消息、Worker/Beat 健康信号和 PostgreSQL 故障测试。
2. **`07-11-ai-egress-security` AI 出站安全**：消除 DNS rebinding/TOCTOU，验证真实连接目的地址并补安全测试。
3. **`07-11-publication-task-closure` 发布与任务闭环完整性**：平台一致性、`VERIFIED` 自动完成、发布异常待办、显式修复任务及事实/平台版本差异。
4. **`07-11-review-evidence` 事实与内容审核证据闭环**：追加式审核历史、冻结事实与证据上下文、批准前质量门禁。
5. **`07-11-geo-integrity-analysis` GEO 数据完整性与分析闭环**：两类发布关系、更正链、筛选、异常计数和可操作工作台。
6. **`07-11-frontend-recovery-e2e` 前端失败恢复与全 UI 验收**：关键依赖查询的加载/失败/空状态，以及不绕过 UI 的主闭环 E2E。

依赖顺序：子任务 3 先于子任务 5；子任务 6 在子任务 3 至 5 的契约稳定后收口。其余子任务可独立规划和验收。

上述六个边界已获用户确认，应据此创建独立 Trellis 子任务；父任务只维护统一需求、依赖关系和最终集成验收，不直接承载实现。

领域子任务分别拥有自身契约、服务端门禁、正常业务 UI 和目标组件测试；`07-11-frontend-recovery-e2e` 只拥有共享失败恢复模式、工作台聚合导航和最终跨域 E2E，不重复实现领域交互。

## Delivery Order

1. **P0 运行与安全**：`07-11-generation-reliability` 与 `07-11-ai-egress-security` 可并行规划和实施。
2. **业务契约**：稳定 `07-11-publication-task-closure` 与 `07-11-review-evidence` 的状态、数据和 API 契约。
3. **分析闭环**：在发布语义稳定后实施 `07-11-geo-integrity-analysis`。
4. **最终验收**：基于稳定接口完成 `07-11-frontend-recovery-e2e`，并执行父任务集成验收。

## Acceptance Criteria

- [x] **PLAN**：产品、前端和后端评审结论已合并；`prd.md`、`design.md`、`implement.md` 和六个子任务边界均可审阅且无临时问题。
- [x] **PLAN**：用户审阅并明确批准最终规划后，才允许启动第一个子任务。
- [ ] **P0-GEN**：提交后首次投递失败可恢复；重复消息只认领一次；最大超时不被误杀；RUNNING 丢失不自动重放；均有故障测试。
- [ ] **P0-EGRESS**：DNS 公网到私网切换无法建立连接或发送敏感 Header，正常公网 HTTPS 的 Host/SNI/证书校验保持可用。
- [x] **P0-PUB**：直接 API、并发请求和数据库写入均拒绝跨平台账号，同平台账号可正常发布。
- [x] **P1-CLOSURE**：第一条 `VERIFIED` 发布自动完成任务；后续发布失效不回退任务，只创建一个可处置异常待办。
- [x] **P1-CLOSURE**：存在在途发布时任务不能取消；发布被明确拒绝、移除或验证失败后才允许按状态机继续处置任务。
- [x] **P1-CLOSURE**：创建修复任务不关闭待办；只有非空处置说明能解决。修复任务的固定上下文不漂移，可编辑字段正确预填，事实与平台规则版本必须重新选择并显示差异。
- [x] **P1-REVIEW**：退回后完整意见历史可读，空退回意见被拒绝；批准前可核对冻结事实、证据、替代边界、质量问题和版本差异。
- [ ] **P1-GEO**：跨产品、低状态和绑定发布 URL 不一致的关联被拒绝；OFFICIAL/EXTERNAL_COMPANY Citation 按确认口径计入引用率，可能影响和 OTHER 不计入。
- [ ] **P1-GEO**：默认列表、指标和近期错误只使用更正链当前有效记录；筛选结果、样本数和工作台计数可相互复算，历史仍可追溯。
- [ ] **P1-FRONTEND**：关键依赖的 loading、500、403、empty 和 success 状态可区分并恢复；全 UI E2E 不绕过任务、审核、发布、修复、观测和更正步骤。
- [ ] **P1-INTEGRITY**：完整性检查可重复执行并输出稳定 ID；任一未处置历史不一致阻断上线，全部显式处置后才通过。
- [ ] **P1-OPS**：Secret、SLO、告警、故障处理、加密异地备份、恢复演练、部署回滚和真实预发布均有可重复证据，满足 `RPO 24h`、`RTO 4h`。
- [ ] **P1-STRUCT**：业务契约稳定后完成行为保持拆分；Router 不再拥有领域状态机，且全量验证证明公共行为未变化。

## Out Of Scope

- 本次计划同步不修改产品代码、OpenAPI、数据库或非 Trellis 文档；后续各 Goal 只能在对应契约确认和依赖门禁通过后实施。
- MVP 补齐结论收敛前，不纳入第二阶段新能力。
- 不默认实现跨平台自动发布、复杂权限系统、微服务或插件架构。
- 不以增加功能数量为目标；缺少明确用户价值或验收依据的设想不进入实施范围。

## 最终确认基线（2026-07-11）

用户已确认本父任务进入可由 `/goal` 顺序执行的最终计划。当前未提交改动全部视为用户工作；后续 Goal 必须保留这些改动，不得重置、覆盖或把规划能力误判为已完成。

### 现状差距矩阵

| 能力 | 判定 | 代码证据与执行含义 |
|---|---|---|
| 基础 MVP 纵向闭环 | 已实现 | 事实、生成、审核、人工发布和 GEO 基础链路已存在；现有 E2E 大量使用 `page.request`，不能证明全 UI 可操作。 |
| 生成可靠性与诊断 | 正在实现 | `0011`、投递服务、Worker/Beat、CLI 和测试存在未提交候选实现；留有一次完整验证记录，但 Goal 1 尚未按当前工作区重新复核。 |
| AI 实际连接安全 | 正在实现 | 固定目的地址 Transport 和真实 HTTPS 测试存在未提交候选实现；三条调用路径、peer 校验和当前完整验证仍待 Goal 1 复核。 |
| 发布平台一致性与任务闭环 | 已实现 | 当前未提交工作区已完成 `0013`、应用服务、数据库触发器、前端和并发验收；首条 `VERIFIED` 与任务完成保持同事务原子性。 |
| 发布异常、修复任务和审核证据 | 已实现 | 异常待办、固定修复上下文、显式解决和冻结审核上下文均已实现，并通过 PostgreSQL、组件及全 UI E2E 验证。 |
| GEO 完整性与分析 | 尚未实现 | 已有更正唯一索引和链尾指标基础，但列表、关系门禁、筛选、历史及引用率口径未闭合。 |
| 前端恢复和全 UI E2E | 尚未实现 | 缺 retry、403、request ID、业务空状态、依赖提交门禁和不绕过 UI 的主闭环。 |
| 历史上线门禁 | 正在实现 | Goal 2 的旧完成态与非终态跨平台发布检查已实现，稳定输出和本地清零已验证；GEO 检查及生产/预发布目标环境清零仍待后续 Goal。 |
| 生产配置、健康和日志基础 | 已实现 | 已有生产配置校验、live/ready、容器健康和日志轮转，但尚未形成 SLO、告警和灾备闭环。 |
| 生产外部服务验收 | 证据不足 | 真实 OSS/模型适配器存在，预发布默认仍为 fake OSS/确定性生成器。 |
| 结构职责拆分 | 尚未实现 | `models.py`、`schemas.py` 和大型 Router 同时承担过多职责。 |

### 最终优先级

- 父任务、`generation-reliability`、`ai-egress-security`、`publication-task-closure` 的有效优先级为 `P0`。
- `review-evidence`、`geo-integrity-analysis`、`frontend-recovery-e2e` 的有效优先级为 `P1`。
- 六个现有子任务的 `task.json` 已按上述有效优先级同步；后续 Goal 只复核，不重复创建或改名任务。

### 已确认生产目标

- 月度 UI/API 可用性 SLO 为 `99.5%`；非外部同步 API `p95 < 1s`；生成作业从 `PENDING` 到 `RUNNING` 的 `p95 < 5min`。
- 灾备目标为 `RPO 24h`、`RTO 4h`；每日数据库备份必须客户端加密并上传异地区域，完成可重复恢复演练。
- 第三方模型只允许接收 `PUBLIC` 数据；未分类、`INTERNAL` 和 `RESTRICTED` 均由服务端阻断，不建设授权 INTERNAL 的复杂策略。
- 普通 CI 使用 fake OSS 和真实 HTTP 模型替身；上线前预发布必须使用专用非生产 OSS、低权限真实模型和纯虚构 PUBLIC 数据完成全 UI 验收。

### 父任务直接责任

- 不创建第七个同义子任务。父任务直接拥有跨域历史门禁、PUBLIC-only 出站分类、生产运维、灾备、真实预发布、行为保持结构重构和最终集成验收。
- 六个现有子任务继续拥有各自领域的契约、服务端门禁、正常业务 UI 和目标测试。
