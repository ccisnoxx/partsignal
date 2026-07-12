# 多角色项目设计评审：总体设计

## 设计目标

在不引入微服务、通用工作流引擎或第二业务状态源的前提下，补齐 PartSignal MVP 的运行安全、发布闭环、审核证据、GEO 数据可信度、前端失败恢复和生产运行能力。六个子任务拥有各自领域实现；父任务不重复领域能力，直接拥有跨域历史门禁、数据分级、生产运维、灾备、真实预发布、行为保持结构整理和最终集成验收。

## 总体不变量

1. PostgreSQL 是生成作业、任务、发布异常、审核历史和 GEO 观测的唯一业务状态来源；Redis 只传递 Celery 作业 ID。
2. AI 出站请求的实际 TCP 目的地址必须属于本次校验通过的地址集合，Host、SNI 和证书校验仍使用原始主机名。
3. 发布账号平台必须与内容任务锁定平台一致；第一条关联发布达到 `VERIFIED` 时，任务在同一业务操作中自动完成。
4. `COMPLETED` 记录曾完成发布闭环的历史事实，不因后续发布失效而回退；后续问题由独立发布异常待办承接。
5. 审核上下文只读取任务锁定的不可变事实、内容版本和追加式审核记录，不读取当前可编辑工作区作为替代来源。
6. GEO 的“可能影响”与实际引用是两种关系；更正记录追加而不覆盖，指标只统计更正链当前有效记录。
7. 服务端拥有状态、权限、关系和输入校验的最终权威；前端只消费 OpenAPI 生成类型和服务端投影。
8. 第三方模型只接收已分类的 `PUBLIC` 数据；未分类、`INTERNAL` 和 `RESTRICTED` 在生成应用服务边界失败。
9. 生产恢复能力以异地加密备份和隔离恢复演练为证据；日志、Redis、OSS 或前端缓存都不能代替 PostgreSQL 备份。
10. 结构调整必须行为保持并晚于业务契约稳定；Router 只映射 HTTP，领域应用服务拥有状态转换。

## 子任务边界

| 子任务 | 唯一责任 | 主要影响层 |
|---|---|---|
| `generation-reliability` | PENDING 补投递、租约、故障恢复与诊断 | 数据库、Worker、Beat、运维 |
| `ai-egress-security` | DNS 解析结果与实际连接绑定 | AI HTTP 适配器、测试 |
| `publication-task-closure` | 平台一致性、任务自动完成、异常与修复任务 | 契约、数据库、后端、前端 |
| `review-evidence` | 审核历史和冻结审核上下文 | 契约、后端、前端 |
| `geo-integrity-analysis` | GEO 关系、更正、筛选和指标口径 | 契约、数据库、后端、前端 |
| `frontend-recovery-e2e` | 共享失败恢复、工作台导航与跨域验收 | 前端、E2E |

领域子任务拥有正常业务 UI 和目标组件测试；最终前端子任务不重复实现领域页面，只补共享状态、聚合导航和端到端验证。

## 跨层数据流

### 生成作业

```text
API 提交 PENDING Job → 尝试发送 UUID → Beat 补投递超龄 PENDING
→ Worker 原子声明 RUNNING → 单次供应商调用 → SUCCEEDED/FAILED
```

只有 `PENDING` 自动补投递。`RUNNING` 租约过期后转为 `FAILED`，不得自动重放供应商调用；用户重试创建新 Job。

### 发布闭环

```text
APPROVED ContentVersion → 匹配平台账号 → PublicationRecord
→ PUBLISHED → VERIFIED + ContentTask.COMPLETED
→ 后续 REMOVED/VERIFICATION_FAILED → OPEN PublicationAttention
→ 用户显式创建修复任务 → 用户说明处置 → RESOLVED
```

发布验证、任务自动完成、状态事件和审计必须位于同一数据库事务。发布异常与修复任务独立于原任务终态。

### 审核证据

```text
不可变内容版本 + 锁定事实版本 + 证据投影 + 质量问题
+ 版本差异 + 追加式审核记录 → ContentReviewContext → 审核 UI
```

聚合上下文是查询投影，不持久化第二份事实或内容。

### GEO 分析

```text
GeoObservation + GeoCitation + 可能影响的发布
→ 追加式更正链 → 当前有效链尾查询
→ 同一筛选谓词 → 列表 / 指标 / 工作台计数
```

`citation_rate` 只按 `OFFICIAL` 或 `EXTERNAL_COMPANY` 实际引用计算，不要求绑定发布记录；“可能影响”永不进入引用率。

## 公共契约原则

- 根 `contracts/openapi.yaml` 与 `contracts/database.md` 由主 Agent 维护，先于前后端实现冻结。
- 删除冗余的人工 `completeContentTask` 入口，不保留兼容分支。
- 新增面向用例的读取投影，例如发布候选、发布异常、修复上下文、审核上下文和 GEO 更正历史；不让前端拉取全量资源后自行重建业务规则。
- 状态可执行动作由服务端投影并最终校验，前端不维护第二份转换表。
- 列表、指标和工作台计数必须复用同一服务端筛选语义。

## 数据迁移与历史完整性

上线前运行只读完整性检查，至少覆盖：

- 缺少追加式 `PublicationStatusEvent.status=VERIFIED` 历史的旧 `COMPLETED` 任务；当前发布后来失效不抹除其合法完成历史。
- 非终态跨平台发布错绑。
- 当前有效 GEO 观测中的跨产品、低状态或引用 URL 不一致关联。

检查输出记录类型、稳定 ID 和原因；任一未处置问题阻断上线。历史处置只能通过显式业务动作或追加式更正完成，不自动改绑、删除或回退。

## 发布与回滚

1. 先部署并验证两个 P0 子任务；AI 出站安全失败时禁用 AI 渠道，不回滚到已知不安全实现。
2. 发布与审核在 Goal 2 共同冻结 OpenAPI，再按领域边界并行实现；发布数据库迁移先于依赖它的 GEO 工作。
3. GEO 在 Goal 3 等待发布状态、异常语义和历史门禁稳定后实施。
4. 最终 E2E 在 Goal 4 等所有领域接口稳定后收口。
5. 生产运行与真实预发布在 Goal 5 完成；行为保持结构整理严格放在 Goal 6。

数据库变更采用可向后读取的 expand 迁移；代码回滚前必须确认旧进程不会写入新状态。不可变历史和新产生的业务记录不得通过回滚删除。

## 明确不引入

- 不引入微服务、消息总线、通用工作流/异常引擎或新的权限体系。
- 不把 Redis、前端缓存、日志或审计表变成业务状态第二来源。
- 不增加供应商自动降级、同一 RUNNING Job 自动重放或模糊 URL 匹配。
- 不在本轮实现 P2 移动端、服务端分页、平台账号生命周期或自动发布。

## 最终确认的唯一所有权

| 不变量 | 唯一所有者 |
|---|---|
| PostgreSQL 是业务状态唯一来源；Redis 只传递生成 Job UUID | 数据库契约与生成应用服务 |
| 事实版本及其证据快照不可变 | 产品事实应用服务与 `FactVersion` |
| 只有任务分类和全部事实证据均为 `PUBLIC` 才能调用第三方模型 | 生成应用服务；任务保存分类人和分类时间 |
| 同一 GenerationJob 至多调用供应商一次；RUNNING 丢失不自动重放 | `GenerationJob.status` 与生成执行服务 |
| TCP peer 必须属于本次解析批准集合，敏感 Header 在 peer 校验前不得发送 | 固定目的地址 AI Transport |
| 发布账号平台必须等于任务锁定平台 | 发布应用服务和 PostgreSQL 触发器 |
| 首条 VERIFIED 发布自动完成 OPEN 任务；COMPLETED 不回退 | 发布应用服务 |
| 发布失效只创建唯一 OPEN 异常；修复任务不自动解决异常 | `PublicationAttention` 与发布异常应用服务 |
| 审核上下文只读取锁定版本和追加式审核记录 | 审核应用服务 |
| GEO 默认列表、指标和工作台只消费更正链尾 | GEO 共享链尾查询服务 |
| “可能影响的发布”和实际 Citation 是两个关系 | GEO 应用服务 |
| 前端 Query 缓存、日志和审计均不是业务状态源 | 各领域服务端应用服务 |
| Secret 只通过文件边界注入，明文环境文件不保存凭据 | 配置加载器与部署 preflight |
| SLO、健康、日志和告警口径只描述可观测事实，不反向驱动业务状态 | 运维诊断与告警脚本 |
| PostgreSQL 备份满足异地加密、可校验和可恢复 | 备份/恢复脚本与恢复演练记录 |
| Router 不拥有领域状态转换，结构重构不改变公共行为 | 各领域应用服务与契约回归测试 |

## 最终确认的公共变化

### API 与状态机

- 删除 `POST /api/v1/content-tasks/{id}/complete`，任务只由首条 `VERIFIED` 发布自动完成；不保留兼容入口。
- `ContentTaskUserPromptUpdate` 增加生成数据分类；任务投影返回分类、分类人、分类时间和服务端 `available_actions`。
- 新增专用 `PublicationCandidate`、发布异常列表/详情、修复上下文、创建修复任务和显式解决命令；`PublicationRecord` 返回 `task_id` 与 `available_actions`。
- 新增事实与内容审核上下文；`request-changes` 使用非空意见请求，`submit`/`approve` 意见可选。
- GEO 列表增加产品、问题、模型、日期、准确性和 `include_history` 筛选，并增加更正历史和按产品发布候选。
- `ContentTask` 状态保持 `OPEN -> CANCELLED`，另由首条 VERIFIED 触发 `OPEN -> COMPLETED`；新增 `PublicationAttention: OPEN -> RESOLVED`。

### 数据库与迁移

- `0011_generation_reliability` 完成现有补投递和动态租约设计。
- `0012_ai_data_classification` 增加任务生成数据分类、分类人和分类时间；历史数据不得自动归类为 PUBLIC。
- `0013_publication_closure` 增加 `publication_attentions`、`content_tasks.source_publication_attention_id`、唯一约束、状态保护和平台一致性触发器。
- `0014_geo_integrity_indexes` 只增加共享筛选和 Citation 查询所需索引；复用 `0007` 已有的 `supersedes_id` 唯一部分索引。
- 不新增指标汇总表、第二任务表、第二发布状态机或 Redis 业务状态。

### 生产与 Secret 边界

- 敏感配置增加 `*_FILE` 读取并通过 Docker Secret 注入；普通 `.env` 只保存非敏感配置和 Secret 路径。
- 不新增公开 metrics API；结构化日志、诊断 CLI、Docker health 和宿主机 `ops-check` 共同提供指标和告警输入。
- PostgreSQL、Redis、Worker、Beat、OSS 和模型故障必须显式失败或积压并被告警发现，不得回退开发适配器。
- 每日 `pg_dump` 经 `age` 公钥客户端加密后上传不同区域的独立备份 Bucket，保留 7 日、4 周、6 月。

### 生产故障与恢复边界

- 保持单机 Compose 模块化单体：API、Worker、Beat、Redis 和 PostgreSQL 分进程运行，但不拆业务服务。API readiness 只检查自身与必要的 PostgreSQL/Redis；OSS 和模型供应商故障通过业务失败率、积压和告警表达，避免外部抖动使全部 API 离线。
- PostgreSQL 不可用时拒绝业务读写并告警；Redis 不可用时生成 Job 保持 PostgreSQL `PENDING`，恢复后由 Beat 补投递；Worker/Beat 故障由进程健康与队列年龄共同发现。
- OSS 或模型供应商失败必须返回稳定错误并保留可重试业务状态，不切换到 fake 适配器、不记录正文、Prompt、凭据或外部响应正文。
- 宿主机 `ops-check` 汇总 readiness、Worker/Beat、最老 Job、连续外部失败、备份新鲜度、磁盘、容器重启和 OOM，并通过可替换 webhook 发出告警；这些信号不写回业务状态。
- 备份在数据库主机侧生成、压缩、`age` 公钥加密、校验后上传异地区域；恢复演练只在隔离 PostgreSQL 中执行，并验证 Alembic、历史门禁和代表性业务不变量。
- 审计记录按运维保留策略只追加和归档，不通过应用回滚删除；生产默认账号、共享凭据和过期 Secret 必须在上线检查中失败，轮换过程不得把明文写入仓库或日志。
- 普通 CI 不访问真实 OSS/模型；预发布使用专用低权限账号、纯虚构 `PUBLIC` 数据和与生产一致的 Secret/网络边界，验收结果不能外推为真实生产数据授权。

## 契约稳定后的结构边界

- 行为稳定后按身份、事实、策划、配置、生产、发布、GEO 和文件拆分 ORM 与 Pydantic 文件。
- `models/__init__.py` 仅负责 SQLAlchemy 模型注册；Router 不再直接导入其他 Router。
- 事实审核、内容审核、任务、发布、异常修复和 GEO 状态转换逐步收敛到领域应用服务；Router 只做 HTTP 契约映射。

## Goal 2 落地边界

- `0013_publication_closure`、发布与审核应用服务、OpenAPI 投影和全 UI 闭环已在当前未提交工作区落地并通过验证。
- 终态跨平台旧记录作为已处置历史保留，不阻断 preflight；只有非终态错绑需要人工处置。
- `PublicationAttention` 只能从 revision 为 0 的 `OPEN` 开始，必须经带 expected revision 和非空说明的命令解决，且不得删除。
- Goal 2 未扩展 GEO 语义、生产/预发布验收或统一前端路由；这些边界仍分别属于 Goal 3、Goal 5 和 Goal 4。
- 结构重构不得改变 OpenAPI、迁移历史、数据库语义、错误码、权限或前端行为。
