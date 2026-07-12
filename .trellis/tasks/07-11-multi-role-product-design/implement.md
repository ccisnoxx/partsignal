# 多角色项目设计评审：实施计划

## 六阶段实施顺序

### Goal 1：P0 运行与出站安全

- [ ] 复核并完成 `07-11-generation-reliability` 与 `07-11-ai-egress-security`，保留当前未提交候选实现并以代码、迁移和测试重新判定完成度。
- [ ] 父任务同时完成第三方模型 `PUBLIC`-only 数据分类；生成、模型发现和模型测试共同使用安全出站边界。
- [ ] 两个子任务可并行检查独立模块，但共享生成路径、OpenAPI、Compose 和真实 HTTP 替身测试必须串行合并。

### Goal 2：发布、任务与审核证据闭环

- [x] 先共同冻结发布、修复任务、异常待办和事实/内容审核上下文的 OpenAPI 与数据库契约。
- [x] 并行完成 `07-11-publication-task-closure` 与 `07-11-review-evidence`；父任务同时交付历史 `preflight-integrity` 门禁。
- [x] 验证发布验证后任务自动完成、后续异常不回退、修复显式解决、退回意见和冻结审核证据完整可见。

### Goal 3：GEO 完整性与分析闭环

- [ ] 在 Goal 2 发布状态、异常语义和历史门禁稳定后完成 `07-11-geo-integrity-analysis`。
- [ ] 验证两种发布关系、更正链、筛选、指标和工作台计数使用同一服务端语义。

### Goal 4：前端恢复与全 UI E2E

- [ ] 完成 `07-11-frontend-recovery-e2e` 的共享失败恢复、稳定深链与工作台导航。
- [ ] 使用受控 fixture 准备非本轮前置数据，从创建内容任务开始全程通过 UI 验收主闭环。

### Goal 5：生产运行、灾备与真实预发布

- [ ] 由父任务完成 Secret、SLO、健康、日志、指标输入、告警、故障处理、备份恢复、部署回滚和上线检查表，不创建第七个子任务。
- [ ] 使用专用非生产 OSS、低权限真实模型和纯虚构 `PUBLIC` 数据完成预发布全 UI 验收。

### Goal 6：行为保持结构整理与最终集成

- [ ] 仅在 Goal 1～5 契约和行为稳定后拆分 ORM、Schema 与大型 Router，将状态转换收敛到领域应用服务。
- [ ] 执行父任务最终跨层检查，确认没有第二套 Schema、重复状态机、无价值抽象或验收映射遗漏。

## 每个子任务的统一门禁

- [ ] 开始前重新读取对应 `prd.md`、`design.md`、`implement.md` 与相关 spec，并核对工作区未提交改动。
- [ ] 涉及公共 API、数据库、状态机或模块边界时，先按已确认清单更新根契约；若实施需要新增计划外变化，停止并再次请求用户确认。
- [ ] 目标测试先行，随后运行相关 lint、类型检查、契约检查、迁移测试、构建和该 Goal 的端到端验收。
- [ ] 代码审查确认没有第二状态源、静默回退、重复状态机、宽泛兼容逻辑或无价值抽象。
- [ ] 每个 Goal 完成后停止，不自动提交、推送、归档或进入下一 Goal。

## Goal 1 已有候选证据（待 `/goal` 复核）

- 工作区存在生成可靠性、固定目的地址 AI Transport 与 PUBLIC-only 数据分级的未提交候选实现，不因文件存在直接认定为已完成。
- `0011_generation_reliability` 与 `0012_ai_data_classification` 均通过 PostgreSQL 升降级测试；历史任务分级保持 `NULL`。
- `make verify` 在显式本地 PostgreSQL/Redis 环境完整通过；目标 E2E 额外证明 `INTERNAL` 返回 `AI_DATA_CLASSIFICATION_FORBIDDEN`，改为 `PUBLIC` 后真实 Celery/HTTP 链路成功。
- 这些证据仅作为 Goal 1 的复核起点；必须重新核对代码、迁移、真实集成测试和完整差异后才能更新完成状态。

## Goal 2 完成证据（当前未提交工作区）

- OpenAPI、FastAPI 运行时 Schema 和前端生成类型一致；`0013_publication_closure`、发布/审核应用服务、前端工作区与部署前 preflight 已完成。
- PostgreSQL 集成验证覆盖跨平台触发器、并发验证只完成任务一次、并发失效只创建一个待办、待办状态保护、审核历史冻结和质量门禁。
- 当前本地 `preflight-integrity` 输出 `[]`；目标生产或预发布数据仍必须在 Goal 5 部署前执行，不以本地结果代替目标环境证据。
- 最终门禁结果：契约、lint、类型检查、62 个单元测试、17 个 PostgreSQL 集成测试、8 个前端组件测试、2 个全 UI E2E 和双端 Docker 构建通过。
- 按执行边界停止在 Goal 2；未提交、未推送、未归档，也未进入 Goal 3。

## 阶段范围与完成标准

| Goal | 范围与涉及模块 | 公共变化 | 迁移风险与回滚 | 测试与完成标准 |
|---|---|---|---|---|
| 1 | 生成 API/应用服务、Worker、Beat、AI Transport、配置、Compose、生成 UI；非目标是供应商自动降级和 `RUNNING` 自动重放 | `0011` 生成可靠性字段、`0012` 数据分类字段及对应 OpenAPI；不新增诊断 HTTP API | 错误租约或重复投递可导致重复供应商调用；先停 Beat/生成写入并前滚修复，不重放失败 Job、不恢复 TOCTOU Transport | PostgreSQL/Redis/Celery 故障与并发、真实 HTTP/HTTPS 替身、分类门禁、迁移升降级和完整 `make verify` 全部通过 |
| 2 | 发布、内容任务、异常修复、事实/内容审核、Dashboard、历史 preflight；非目标是通用工作流、第二任务模型和兼容 complete API | 删除人工 complete；新增发布候选/异常/修复/审核上下文；`0013_publication_closure` 新表、来源字段、约束和触发器 | 历史非法数据阻断迁移；新异常或修复来源写入后只允许前滚，必要时停止发布/审核写流量 | API、触发器、并发事务、迁移、历史输出、审核历史、组件和目标 E2E 通过，首条 VERIFIED 与任务完成保持原子 |
| 3 | GEO 观测、Citation、发布影响关系、更正链、筛选、指标和 Dashboard；非目标是 GEO 综合评分、持久化汇总和模糊 URL | 扩展 GEO 列表筛选、历史和发布候选；`0014` 只补必要索引，复用 `0007` 更正唯一约束 | 非法当前链尾阻断上线；通过追加更正修复，不删除历史，查询口径异常时停止 GEO 写入并前滚 | 关系门禁、并发更正、URL 规范化、组合筛选、历史和列表/指标/Dashboard 可复算 |
| 4 | 前端共享查询状态、稳定路由、query key、跨域失效和 Playwright；非目标是新增 API/数据库或在前端复制状态机 | 不新增公共 API/数据库，只消费 Goal 1～3 冻结契约 | 路由或失效错误时停止前端发布，不保留双路由兼容层、不用 `page.request` 绕过 | 页面状态矩阵、刷新恢复、提交门禁和从内容任务创建开始的全 UI E2E 全部通过 |
| 5 | 配置/Secret、SLO、health、日志、ops-check、告警、故障注入、备份恢复、部署脚本、预发布；非目标是多区域高可用或把外部供应商纳入 readiness | 新增 `*_FILE` 配置边界和部署/运维接口；不改变业务 OpenAPI、状态机或数据库业务模型 | 部署前加密备份和历史门禁；新状态写入后只前滚，恢复演练在隔离 PostgreSQL 执行 | 达成 `99.5%`、API/排队延迟、`RPO 24h`、`RTO 4h` 证据，完成故障、恢复、smoke 和真实 OSS/模型预发布演练 |
| 6 | ORM、Pydantic Schema、大型 Router、领域应用服务与最终集成；非目标是微服务、插件、Repository/Factory 框架和行为变化 | 不允许任何公共 API、数据库、状态机、模块导出或部署接口变化 | 小批次重构，每批可独立撤销代码改动；发现行为漂移立即回到最后稳定批次 | contract/runtime OpenAPI、Alembic metadata、单元/集成、build、全 UI E2E、生产 Compose 和 smoke 全部保持一致 |

## 最终验证

```bash
make contract-check
make lint
make typecheck
make test-unit
make test-integration
make e2e
make build
make verify
```

先运行预计 60 秒内完成的目标测试。若完整 `make verify` 超时或依赖生产外部服务，必须记录替代检查、跳过原因和剩余风险。

## 风险与回滚点

- **历史数据阻断**：完整性检查不通过时停止部署，不绕过或维护隐藏 allowlist。
- **生成恢复竞态**：任何重复供应商调用或重复内容版本都回滚波次 1，不进入业务契约波次。
- **AI 出站回归**：出现连接兼容问题时禁用 AI 渠道并修复安全传输，不恢复旧 TOCTOU 路径。
- **公共契约漂移**：OpenAPI、运行时 Schema 或前端生成类型任一不一致即停止合并。
- **指标口径漂移**：列表、指标和工作台样本数无法相互复算时停止 GEO 上线。

## 最终确认执行顺序（覆盖前述实施波次）

以下六个 Goal 是唯一推荐执行顺序；每个 Goal 独立完成、验证并停止，等待用户确认后才进入下一个 Goal。

| Goal | 目标 | 对应任务 | 串行门禁 |
|---|---|---|---|
| 1 | 生成可靠性、固定目的地址 AI Transport、PUBLIC-only 数据分级 | `generation-reliability`、`ai-egress-security`、父任务分类工作 | 先保留并验证当前未提交 WIP |
| 2 | 发布平台一致性、任务自动完成、异常修复、审核证据、历史 preflight | `publication-task-closure`、`review-evidence`、父任务历史门禁 | Goal 1 完成；先冻结公共契约 |
| 3 | GEO 完整性、更正链、筛选和指标口径 | `geo-integrity-analysis` | Goal 2 发布契约和门禁稳定 |
| 4 | 前端恢复、稳定深链、全 UI E2E | `frontend-recovery-e2e` | Goal 2、3 契约稳定 |
| 5 | Secret、SLO、告警、故障处理、灾备、部署和真实预发布 | 父任务 | 真实验收等待 Goal 4 |
| 6 | 行为保持结构重构与最终集成 | 父任务 | Goal 1～5 全部稳定 |

### 并行规则

- Goal 1 内生成可靠性与固定目的地址 Transport 可并行分析，但共享生成路径、测试和部署必须串行合并。
- Goal 2 在主 Agent 一次冻结共享 OpenAPI 后，发布闭环与审核证据可按领域模块并行；数据库迁移、Schema 生成和跨域验证串行收口。
- Goal 3 严格等待 Goal 2 的发布状态语义和历史 preflight 稳定，不与发布数据库变化并行。
- Goal 5 的备份和监控脚本可提前准备，但真实外部验收必须等待完整 UI 流程。
- Goal 6 严格最后执行，不与业务契约变化并行。

## `/goal` 提示词

### Goal 1

```text
在 /Users/sc/PycharmProjects/partsignal 的 agent/mvp 分支完成生成可靠性、AI 出站安全和 PUBLIC-only 数据分级。读取项目 AGENTS.md、Trellis workflow/spec，以及 generation-reliability、ai-egress-security、multi-role-product-design 全部任务材料。保留当前所有未提交改动；现有 0011、generation_dispatch.py 和相关测试是用户工作，禁止 reset、覆盖或重建同义任务。

修正父任务、生成、AI 出站、发布闭环为 P0，审核、GEO、前端恢复为 P1。完成并验证 0011：PostgreSQL 为执行权威，只有 PENDING 自动补投递，RUNNING 租约过期显式失败且不重放，租约来自快照 timeout+grace。将模型发现、测试和生成统一切换到固定目的地址 Transport：单次解析并完整校验 A/AAAA，只连接批准 sockaddr；TLS SNI、证书 hostname 和 Host 使用原 hostname；发送任何敏感 Header 前验证 peer；禁止重定向、响应超限和发送后自动切换。

新增 0012 与对应 OpenAPI/UI：任务 Prompt 每次保存必须记录整份生成输入的数据分类、分类人和时间；历史数据不自动标记 PUBLIC。只有任务分类为 PUBLIC 且事实快照全部 Evidence 为 PUBLIC 才允许调用第三方模型，其他情况返回 AI_DATA_CLASSIFICATION_FORBIDDEN，并把分类写入 Job 快照。

使用真实 PostgreSQL、Redis、Celery 和 HTTP/HTTPS 替身执行故障、并发、连接和分类测试，关键集成测试不得 skip。运行 contract-check、lint、typecheck、unit、integration、build 和目标 E2E。更新相关规范和文档。不要自动提交或推送；完成后停止。
```

### Goal 2

```text
在同一仓库完成发布平台一致性、任务自动完成、发布异常待办、修复任务、事实/内容审核证据和历史完整性门禁。复用 publication-task-closure、review-evidence 和父任务，不创建新任务。确认 Goal 1 已完成后先共同冻结 OpenAPI 和数据库契约，再实现 0013_publication_closure；审核上下文预计不新增业务表。

删除人工完成任务端点和 UI。发布账号平台必须与任务锁定平台一致，并由服务层和 PostgreSQL 触发器共同保护。第一条关联发布变为 VERIFIED 时，在同一事务完成仍为 OPEN 的任务并写事件与审计；存在 PENDING_MANUAL_PUBLISH、PLATFORM_REVIEW 或 PUBLISHED 时拒绝取消。VERIFIED 后失效不回退任务，只幂等创建唯一 OPEN PublicationAttention。

实现发布候选、异常列表/详情、repair-context、创建修复任务和 resolve。修复任务固定继承产品、问题和平台；事实与 ACTIVE 平台规则重新选择并显示服务端差异；创建修复任务不解决待办，只有非空说明和正确 revision 能 RESOLVED。

实现 FactReviewContext、ContentReviewContext、ReviewRecord 和演员摘要；上下文一次性读取不可变内容、任务锁定事实、证据、替代边界、质量问题、版本差异、非敏感生成追溯和完整时间线，不得用当前工作区补缺。request-changes 去除空白后必须非空，submit/approve 意见可选；事实和内容状态转换、质量门禁与 available_actions 由审核应用服务唯一拥有，Router 只映射 HTTP。

实现只读 preflight-integrity CLI，稳定输出 check、record_type、record_id、reason_code、related_ids，识别旧完成态、非终态跨平台发布和当前 GEO 非法关系，任一问题非零退出；不得自动修复或维护 allowlist。覆盖直接 API、触发器、并发、迁移、审核历史稳定性、空退回意见和前端测试。不要自动提交或推送；完成后停止。
```

### Goal 3

```text
在同一仓库完成 GEO 数据完整性与分析闭环。只复用 geo-integrity-analysis，不创建新任务；必须以 Goal 2 的发布契约、异常语义和 preflight-integrity 为前提。

实现 GEO 共享链尾查询，列表、指标和 Dashboard 全部复用。扩展产品、问题、模型、日期、准确性和 include_history 筛选，增加完整历史和按产品发布候选。从记录行发起更正，固定产品、问题和来源。严格区分可能影响关系与 Citation；关联发布必须同产品且至少 PUBLISHED，绑定 Citation URL 必须确定性等于 final_url。citation_rate 只统计 OFFICIAL 或 EXTERNAL_COMPANY Citation。

复用 0007 的更正唯一约束，只在 0014 增加必要索引。执行关系门禁、URL、并发更正、组合筛选、历史追溯和指标复算测试。不要自动提交或推送；完成后停止。
```

### Goal 4

```text
在同一仓库完成前端失败恢复、稳定深链和不绕过 UI 的完整 E2E。只使用 frontend-recovery-e2e，不重复领域正常业务逻辑。

盘点任务、事实、审核、发布、异常修复、GEO 和 Dashboard 的查询与 mutation 失效。共享组件只提供 loading、failure+retry+错误码/request ID、permission denied；业务 empty 由领域页面定义。任何必需查询未成功时表单不可提交。建立轻量参数化 query key 和稳定的发布、修复、事实版本、内容审核、GEO 筛选/更正路由，刷新后恢复同一上下文。

组件测试逐页覆盖 loading、500+retry、403、empty+前置入口和 success。Playwright fixture 只能准备账号、平台、批准事实、测试模型和外部替身；从创建内容任务开始，生成、审核、发布验证、自动完成、发布异常、修复、GEO 登记、更正、历史和 Dashboard 深链必须全部通过 UI，禁止 page.request 执行被验收步骤。运行前端全套检查和根目录 make verify。不要自动提交或推送；完成后停止。
```

### Goal 5

```text
在同一仓库完成单机生产运行、Secret、SLO、告警、灾备、部署回滚和真实预发布验收。该工作归父任务，不创建第七个子任务。

实现敏感配置 *_FILE 和 Docker Secret，部署 preflight 拒绝缺失、空值、默认账号、共享凭据或权限过宽的 Secret，并验证凭据轮换流程。落实月可用性 99.5%、非外部同步 API p95<1s、生成排队 p95<5min、RPO 24h、RTO 4h。使用 JSON 日志和 ops-check/webhook 告警覆盖 ready、Worker/Beat、PENDING 积压、备份新鲜度、磁盘、重启/OOM、OSS 和模型连续失败；OSS/模型不得进入 API readiness 或回退开发适配器。明确审计追加、归档、保留和访问边界，日志与审计不得包含 Prompt、正文、响应或凭据。

每日 pg_dump 经 gzip 和 age 公钥客户端加密后上传不同区域独立 Bucket，生成 SHA256 manifest，保留 7 日/4 周/6 月。恢复到隔离 PostgreSQL 后验证 Alembic、preflight-integrity 和代表性业务不变量。部署顺序固定为 Secret 检查、Compose 校验、加密备份、历史门禁、迁移、Worker/Beat、API、前端原子切换、smoke 和诊断；新状态已写入时只允许前滚。

普通 CI 保持 fake OSS 和真实 HTTP 模型替身；真实预发布使用专用非生产 OSS、低权限真实模型和纯虚构 PUBLIC 数据完成全 UI 闭环。完成故障注入、恢复、回滚和真实预发布演练并记录结果。不要自动提交或推送；完成后停止。
```

### Goal 6

```text
在同一仓库完成行为保持的模块化单体结构重构和父任务最终集成验收。只有 Goal 1～5 稳定后开始。

不改变 OpenAPI、错误码、数据库、状态机、权限、前端行为或部署接口。按身份、事实、策划、配置、生产、发布、GEO、文件拆分 backend/app/models.py 和 schemas.py；models/__init__.py 只负责注册 SQLAlchemy metadata。拆分大型 Router，Router 只解析 HTTP、调用领域应用服务并映射响应；状态转换归各领域服务唯一拥有。删除 Router 间直接导入，不创建第二套 DTO、状态机、Repository/Factory/Plugin 或一行转发包装。

按小批次执行，每批运行目标测试、Alembic metadata 和运行时 OpenAPI 比较。最终运行 contract-check、lint、typecheck、全部单元/集成、build、全 UI E2E、生产 Compose 和预发布 smoke；检查不存在兼容分支、隐藏 fallback、第二来源或无价值抽象。不要自动提交或推送；完成后停止。
```
