# 文档包变更记录

## GEO-102 Catalog ORM 与 Alembic — 2026-10-01（review）

- 唯一直接依赖 GEO-101 已经人工接受，状态 done；GEO-102 按门禁 planned→in_progress→review，不自行 done。
- 新增三表 ORM、共享 metadata 注册与冻结迁移 `0044_geo_catalog`；活动 OWN_PRODUCT partial unique、真实父类型 MATCH FULL 复合 FK、身份 trigger、字典约束/索引及 RESTRICT/CASCADE 与已接受合同一致。
- 空库及含旧 Product/GEO 的 0043 前滚通过，不回填或改写历史；0001～0043 和 migration_schema_v1 的 44 项指纹保持一致。downgrade 明确拒绝删除三表，恢复使用前滚修复或迁移前备份。
- 定向 77 项、后端单元 855 项、前端 863 项、完整集成 427 项、lint/typecheck/contract 检查通过；保留 metadata 的两项 SQLAlchemy warning。fresh critical_reviewer 未确认阻断问题，执行摘要与审计校验通过。精确命令、环境、局部早期失败与修复见 GEO-102 implement.md。
- 同步数据库实施状态、导航、需求覆盖、manifest、哈希及 Trellis 证据；OpenAPI、generated types、Service/Router/UI、部署配置与旧 GEO 行为没有本任务变化，GEO-103 保持 planned。

## GEO-101 Catalog 合同 — 2026-10-01（review）

- GEO-003、GEO-002 均为 done，本任务从 planned 进入 in_progress；仅冻结三类 Catalog 资源的公共 Schema、12 个待接线操作和数据库合同。
- OWN_PRODUCT 只引用 Product；自有名称由当前 Product 投影，Catalog 不保存第二份产品身份或事实。明确父 revision、规范化、父子类型、活动身份唯一、typed actions/blockers 与聚合删除语义。
- 操作使用显式 CONTRACT_ONLY 扩展，GEO-104 才迁入标准 paths；当前 runtime drift gate 保持严格。仅同步 generated types，不实施 ORM/Alembic/Service/Router/页面。
- 产品、领域、数据和 API 文档的 Catalog 草案已统一到根合同；测试、独立复核及实际验证见本任务 implement.md。交付状态 review，不自行 done，GEO-102/103/201/203 未实施。

## GEO-005 虚构夹具与分析金标 — 2026-10-01（review）

- 确认 GEO-003=done，GEO-005 按门禁从 planned 进入 in_progress；交付进入 review，不自行 done。
- 新建单一 v1 JSON 语料、独立 gold 目录及严格 Schema：2 个产品、4 个问题、13 个回答、4 条原引用和 13 个分析场景；保留重复引用、歧义与 unknown/null，不实现分析算法或指标公式。
- 定义版本与敏感数据规则；全部手工虚构，只允许专用 HTTPS .test 地址，无真实平台调用。Python 统一执行格式/证据关系/敏感数据校验，前端 Node 测试运行时读取同一语料，避免 frontend-only 构建上下文依赖。
- Fixture 定向 27+2 项、后端 821 项、前端 863 项测试及 contract/lint/typecheck 通过；无 backend 邻目录的前端隔离构建通过。make test-deploy-scripts 因缺少 Docker socket 在前置镜像构建失败，其后续 recipe 与真实容器未验证。
- 更新格式说明、导航、质量策略、Trellis 证据、任务状态与文档哈希；OpenAPI、数据库、Alembic 和现有 GEO 业务语义未变，GEO-402/GEO-501 保持 planned。

## GEO-004 安全配置 — 2026-10-01（review）

- 确认唯一依赖 GEO-003=done，按门禁从 planned 进入 in_progress；四项 GEO 启动开关默认 false，拒绝总开关关闭而子能力开启的配置。
- Production 模板增加四键；旧 runtime 可省略并由 Settings 默认关闭，其余必填、未知键、secret 和既有生产安全边界不变。
- 45 项配置及生产边界单测、18 组三套 Compose 与真实入口初始化探针通过；contract/lint/typecheck 和后端 794、前端 861 项单元测试通过。make test-deploy-scripts 因缺少 Docker socket 在前置 frontend 镜像构建失败，未运行其后续测试；真实容器与 Worker/Beat 进程未验证。
- 独立只读配置复核未确认阻断问题；同步权威配置说明、技术文档实施状态、Trellis 证据与文档哈希，GEO-004 进入 review，等待人工验收。
- 不新增 Collector、GEO 调度或机会业务；OpenAPI、数据库、Alembic、前端和旧人工 GEO 保持原合同，GEO-203/405 等后续任务未实施。

## GEO-003 当前实现基线 — 2026-10-01（review）

- GEO-001、GEO-002 均为 done，五份 ADR 为 Accepted；GEO-003 按任务门禁从 planned 进入 in_progress，盘点与本地验证后进入 review，未自行标记 done。
- 冻结源码 HEAD `cd88fbf61d65018f7eb1a47b9f0f379ed47e3814` 的 12 个 API path、16 个 operation、74 个 schema、7 张表、43 个迁移和 35 个相关测试源文件，保存 143 个源码/合同/依赖指纹。
- 新增基线清单与快照，明确现有人工文章关系、legacy 模型历史与未来回答级 Batch/Run 的字段、统计单位、查询、路由、锁和历史删除边界。
- 八项指定命令均实际执行；契约、lint、typecheck、后端 749 单元测试、前端 861 测试和桌面 GEO fixture E2E 57 项通过。make verify 被缺失 Docker socket 阻断；PostgreSQL 定向测试跳过与真实栈缺少 DATABASE_URL 的证据分别保留。
- 仅更新本任务文档、导航、校验清单、任务状态和 Trellis 证据；业务代码、根 OpenAPI/数据库合同、Alembic、generated types、页面交互、其他任务与依赖保持原样。

## GEO-002 人工接受 — 2026-10-01（已完成）

- 用户明确接受 ADR-001 至 ADR-005，以及本轮架构评审记录中的修订；五份 ADR 更新为 Accepted，分别记录接受日期、依据和适用范围。
- 接受已修订的架构方向与约束；具体业务/技术合同按这些约束在后续任务中对齐，本轮不实施功能、不启用平台自动采集。
- GEO-002 从 review 更新为 done，保留其他任务状态、依赖与原最终验收要求。
- 当前分支及本地文档基线无 GEO-002 Trellis 记录，补建对应任务并记录人工接受与实际文档验证；不提交或归档其他任务。
- 保留原评审发现和阶段记录，更新文档导航与 SHA256SUMS；仅修改文档和任务记录。

## GEO-002 架构评审 — 2026-10-01（待人工决策）

- 以代码基线 `83ff42e7` 和文档基线 `122884b3` 完成五项 ADR 的逐项架构评审，新增评审记录及当前实现、迁移、部署证据。
- 当前分支原无 GEO 文档目录；仅从本地 `docs/geo-monitoring-v1` 分支恢复文档目录，不合并其代码或其他文件。
- 导入基线的五份 ADR 原带 `Accepted` 标签，本轮未取得其人工架构接受证据；按本轮仅评审授权将文档状态记录为 `Review`，保留原正文和源提交历史，追加待批准的评审补充。
- GEO-002 更新为 `review`，保留最终接受验收要求；其他任务状态不变，不实施后续任务。
- 本轮只修改评审文档、导航、任务状态及文档哈希；不修改源码、根级合同、迁移或部署配置。

## GEO-001 纳入仓库 — 2026-10-01（已验收）

- 确认文档根路径为 `docs/geo-monitoring/`，保留既有产品、业务、技术文档和 ADR 状态。
- 增加仓库 README 导航、完整文档索引、可点击阅读顺序和根 AGENTS 执行入口。
- 校验文档清单与相对链接，删除 SHA256SUMS 自引用条目，同步本次编辑文件的哈希。
- 按现有 Trellis 约定记录 GEO-001 范围与验证证据，任务清单先进入 `review`；2026-10-01 经用户确认批准，更新为 `done`。

## V1.0 — 2026-10-01

- 建立 PartSignal GEO 监测核心版完整产品与技术文档体系。
- 纳入现有《GEO 监测核心版 PRD V1.0》。
- 明确产品定位、业务能力、领域实体和统一观测运行模型。
- 明确人工、API、浏览器三种采集方式的分阶段策略。
- 固定可见率、推荐率、SOV、引用、准确性、稳定性和数据质量口径。
- 给出目标数据库表、API 资源、前端路由、Worker/Collector 架构和安全边界。
- 给出按发布增量划分的实施路线图、WBS、追踪矩阵和机器可读任务清单。
- 给出 Codex 单任务执行规则和任务模板。
- 记录五项初始架构决策。
