# 文档包变更记录

## GEO-208 Plan命令、查询、状态机与API — 2026-10-02（review）

- GEO-207依赖done；12个标准Plan操作、完整typed读模型、服务端动作/revision/资格与同事务审计已接线，状态等待人工验收。
- 新建/复制DISABLED revision0、集合顺序no-op稳定、ACTIVE实际修改重验资格、归档只读；锁旧/新资源并集后锁Plan，锁后重验版本与身份漂移。
- GET/preview认证前RR禁autoflush，列表批量查询；审计仅status/revision，业务失败或审计失败整体回滚，未知数据库异常不冒充业务错误。
- run-now只接受命令边界后501，无成功审计/幂等结果/Batch/Run/dispatch；默认费用仍unknown，不实施GEO-209/301/303。
- 根OpenAPI/generated与数据库语义合同同步；无新Alembic revision、历史迁移或生产操作，head仍0047。实际测试、独立复核和环境清理见[GEO-208实施记录](../../.trellis/tasks/10-02-geo-208-plan-api/implement.md)。

## GEO-207 服务端运行矩阵预览和费用覆盖 — 2026-10-02（review）

- GEO-206、GEO-204 已人工接受 done；本任务按 planned→in_progress→review 交付，不自行 done。
- RunMatrixBuilder 唯一计算 prompt×profile×repeat，10×3×3=90；Subject 不乘入、同 Surface 的不同 Profile 不合并，缺失/停用不删格，三模式及 unresolved 数保持完整。
- 资格复用 GEO-204，blocker/warning 定位资源；内部估价保留 Decimal、分币小计与 known/unknown 运行覆盖，默认全部 unknown/null，包括人工模式。明确零、部分估价、预算相等/超出、混币与未知预算均有固定语义。
- 只读应用服务要求调用方 RR/SERIALIZABLE 快照，三次批量 SELECT 禁 autoflush，无锁/写/commit/rollback、秘密正文或外部请求。根 OpenAPI 仅追加预览数据组件，前端仅同步 generated 类型。
- 无数据库合同、ORM 或 Alembic 变化，既有 head 为 0047，无历史迁移或生产操作。没有 Plan API/页面、Batch/Run、Collector 定价/执行预算、指标或机会；GEO-208/303 未实施。
- 指定门禁、定向矩阵/真实 PostgreSQL 证据、独立只读复核与环境清理见 [GEO-207 实施记录](../../.trellis/tasks/10-02-geo-207-run-matrix/implement.md)。

## GEO-206 MonitoringPlan 数据契约 — 2026-10-02（review）

- 依赖 GEO-202、GEO-205 均已人工接受 done；本任务按 planned→in_progress→review 交付，不自行 done。
- 新增闭合配置组件与 generated 类型、四表 ORM 和 0047；计划状态、repeat、Cron/IANA 时区、预算、rule_set_revision/revision 与追溯字段一致，没有运行状态。
- 至少一个 PRIMARY、prompt、profile、关系唯一和 RESTRICT 删除阻断由真实 PostgreSQL 验证；可延迟约束支持事务内替换，父 Plan 锁与 MVCC 写冲突阻止 RC/RR 的最后 PRIMARY 并发写偏斜。归档标量/关系只读。
- 既有 Subject/Prompt/Profile/User 删除预检和批量投影接入真实配置引用，只精确映射新 FK；不锁存历史首次运行、不冻结配置维护、不改变权限/CSRF/审计。前端只同步类型和删除说明。
- 无数据回填、历史重写、生产迁移或新依赖；不实现 GEO-207/208/209、Batch/Run、外部采集、指标或机会。实际门禁、首次失败诊断、独立只读复核和隔离环境清理见 [实施证据](../../.trellis/tasks/10-02-geo-206-monitoring-plan/implement.md)。

## GEO-205 观测面与 Profile 管理 — 2026-10-02（review）

- GEO-204 已人工接受为 done；交付观测面/Profile 各七个公共操作及管理员工作台，任务等待人工验收，不自行 done。
- 闭合非敏感配置与角色读模型使用 generated OpenAPI；ENGINEER 仅摘要，管理员写入沿用 CSRF。新 Profile 停用/UNTESTED，真实配置更新清除测试资格并停用；启用复用 Registry 资格，未批准 BROWSER 不能启用。
- Application Service 拥有 User→Channel→Model→Surface→Profile 锁、revision、真实引用/历史标记删除保护与原子最小审计；读模型使用认证前 RR 快照。业务错误只映射已知数据库约束，校验错误不回显秘密值或未知键名。
- `/configuration/geo-surfaces` 提供 CRUD、启停确认、服务端阻断、URL 筛选/详情、409 保留草稿和主体/卸载守卫；提交后取消关联旧读取，204 消费完成后再关闭删除详情。
- 无新 Alembic revision 或数据回填，隔离空库前滚到既有 `0046_geo_surfaces_profiles`；仅测试容器只读挂载根合同。没有连接测试、自动 adapter、外部采集、Plan/Batch/Run、指标或会话运维能力。
- 实际门禁、独立复核、真实 API 与桌面/窄屏证据见 [GEO-205 实施记录](../../.trellis/tasks/10-02-geo-205-surface-management/implement.md)。

## GEO-204 Collector Registry 与 Profile 资格 — 2026-10-02

- 新增精确 key、不可变元数据、capabilities、validate_profile 和共享配置资格；默认仅 manual。
- 未知/重复 adapter、模式/能力不匹配明确失败；自动模式受批准、环境、合规、启停、测试和功能开关门禁。
- 当前资格从 PostgreSQL 非敏感列一次读取，模型解绑后不复用旧 PASSED，不读取凭据正文或 provider 参数。
- 无公共 OpenAPI/数据库 Schema/Alembic 变化，不创建 Plan/Batch/Run、Worker 或 provider 请求；既有安全与历史边界保留。
- [Task Brief](../../.trellis/tasks/10-02-geo-204-collector-registry/prd.md)与[实施证据](../../.trellis/tasks/10-02-geo-204-collector-registry/implement.md)记录基线、实际验证与独立复核；本地完成后进入 review，不自行 done。

## GEO-203 EngineSurface/Profile 数据契约 — 2026-10-02（review）

- GEO-004/GEO-101 依赖均 done；新增两类主数据公共 components、模式判别 Schema、ORM 与 0046 expand 迁移，只交付 GEO-203。
- MANUAL/API/BROWSER、闭合六项能力、合规枚举、非敏感 settings、同渠道 AIModel 复合 FK、成对 SET NULL 与 User/Surface RESTRICT；新配置默认停用/UNTESTED，revision 和创建身份受数据库守卫。
- PRD 的旧 surface_type/合规名称及技术默认值统一到详细领域与权威根合同。旧行不回填；0046 拒绝有损 downgrade，使用前滚恢复或备份。
- Task 记录保存指定门禁、模式/FK/秘密/迁移直接 SQL 证据与独立只读复核；不把未执行门禁视为通过。无新端点、页面、Registry、运行资格、外部调用、Batch/Run、指标或生产迁移。
- [实施证据](../../.trellis/tasks/10-02-geo-203-surface-profile/implement.md)记录精确结果、初次失败修正和环境清理。

## GEO-202 问题变体 API 与工作区 — 2026-10-02（review）

- GEO-201 已人工接受为 done；本任务按 planned→in_progress→review 交付，等待人工验收，不自行 done。仅实现当前变体配置切片。
- 七个标准 OpenAPI 操作、closed workspace 投影与 generated types；Application Service 拥有业务事务、User→Topic→Variant 锁与 revision、历史冻结、原子最小审计及精确错误映射。列表/详情用 RR、固定 join/count/page，显式维度、字面搜索与稳定分页。
- 独立只读复核发现并修复同账号主题审计FK锁环和同Cookie改密Session锁环：User使用FOR NO KEY UPDATE，舍弃不参与安全决定的pending活动提示；认证、撤销、过期和CSRF保留，三个真实修前死锁与修后回归保存到Task证据。
- `/geo/questions` 支持业务主题选择、显式点名/语言/地区/优先级、CRUD/启停/复制、URL恢复和详情；409/后台失败保留草稿，principal/unmount/dirty守卫；运行入口禁用并说明NOT_IMPLEMENTED。
- 无新Alembic revision、数据回填、生产迁移、Batch/Run、外部采集、指标、机会或GEO-206能力；隔离前滚仍为0045。完整AC-TOPIC-02的至少一个活动变体使用门禁随计划/运行任务落实，不宣称本任务完成该总体验收。
- lint/typecheck/contract、987项后端单元、940项前端、495项PG集成及问题库真实API E2E通过；完整真实栈22 passed/1既有失败，fixture497 passed/48 skipped/1既有失败。隔离数据库、Redis、端口和存储已清理，Colima恢复初始停止状态。
- 实际命令、验证结果、前端真实API E2E和全仓门禁分类见[实施证据](../../.trellis/tasks/10-02-geo-202-question-workspace/implement.md)。

## GEO-201 PromptVariant 契约与数据模型 — 2026-10-02（review）

- 确认 GEO-003、GEO-101 均 done，按 planned→in_progress→review 交付；本地原已位于 geo/GEO-201，保留共享工作树，未提交或自行 done。
- 新增一张 geo_prompt_variants，复用 QueryTopic；公共 closed Schema、BRANDED/UNBRANDED、语言、地区、CORE/STANDARD/EXPLORATORY、revision 及 generated types 一致，无 GEO-202 operation 或页面。
- 0045 只 expand，不回填旧 variants 或改写旧 GEO；UTF8 SHA-256 generated hash、NFKC/Unicode 空白规范化、含停用的五维 UNIQUE、RESTRICT FK 及命名历史/revision 守卫。按当前任务要求收紧历史变体为只能停用，真实消费者未来必须同事务锁存+快照+RESTRICT 引用。
- QueryTopic/User 删除预检计入新表；既有前端仅同步 blocker。27 项初始定向、后端980/前端926单元、481 PostgreSQL 集成及指定合同/静态检查通过，复核后时间守卫补测的最终定向28项通过。独立只读复核无确认阻断问题；coverage gap 与审计证据见 implement.md。
- 隔离 PostgreSQL 16 前滚与安全拒绝降级验证通过；无生产迁移、真实 AI/采集或回答级 Run。未运行 E2E/完整 verify/浏览器矩阵，不能声称这些门禁通过。

## GEO-106 Catalog 纵向验收和产品引导 — 2026-10-02（review）

- 依赖 GEO-105 已人工接受 done；本任务只增加 PostgreSQL 产品事实不变验收、Playwright real API Catalog 流程及使用指南，不新增 Catalog 运行时能力。
- 后端比较整个 Product 行、全部 FactVersion 和审核历史；页面创建 OWN_PRODUCT、竞品品牌/产品及双方 alias/domain，验收规范化、唯一冲突保留输入、URL/刷新和 ENGINEER 只读。新真实用例登记到 canonical E2E 集合，保留隔离、秘密扫描和清理。
- 增加当前 R1 使用指南、索引与测试/追踪入口；实际验证确认搜索文案含域名但后端未实现域名搜索，明确记录限制，不扩大本任务查询能力。
- Catalog 定向、后端 967/前端 926 单元、467 PostgreSQL 集成、静态/合同/构建与脚本检查通过。make e2e/make verify 的真实集合为 21 passed/1 未修改上传断言失败；单独 fixture 为 497 passed/46 skipped/1 未修改编辑器焦点失败。秘密扫描 clean，清理成功，完整门禁未通过，不自行 done。
- 无 OpenAPI/数据库合同变化、新 Alembic revision、数据回填、生产迁移或真实外部 AI 调用。验证结果、首次失败诊断与环境清理见 GEO-106 implement.md；GEO-502/GEO-504 未实施。

## GEO-105 Catalog 管理页面 — 2026-10-02（review）

- 确认 GEO-104 manifest=done、Trellis completed 与人工接受记录，GEO-105 按 planned→in_progress→review 交付，未自行 done。
- 新增 canonical Catalog domain 与 `/configuration/geo-entities` 路由，管理员导航接线；搜索/筛选/分页/选中对象可由 URL 恢复。五类身份、父级、别名/域名、启停与删除阻断使用已存在的 12 个 API 和 generated 类型。
- ENGINEER 只读；OWN_PRODUCT 不编辑产品绑定、名称或事实；所有字典写采用父 revision。409 保留输入、不自动重放，显式读取/再次确认；后台读取失败保留编辑器，延迟成功不恢复旧筛选，主体切换不写旧 continuation。
- 完成 63 项 Catalog API/模型/组件/文件路由定向验证、后端 967/前端 926 项单元、指定 lint/typecheck/generated/contract 检查，以及两个明确 fixture 的 Chromium production artifact 布局/键盘/URL/只读检查和敏感产物扫描。独立复核两项发现已修正，具体命令、首次失败及证据见 GEO-105 implement.md。
- 无 OpenAPI/数据库语义变更、新 Alembic revision、历史回填、生产迁移或外部 AI/DNS/HTTP 调用。数据库文档仅校正过时实施状态/路径；GEO-106 与其他任务未实施。

## GEO-104 Catalog 应用服务与 API — 2026-10-02（review）

- GEO-103 为 done；GEO-104 从 planned 进入 in_progress，完成本地验证后交付 review，人工验收前不标记 done。
- 接线 12 个冻结 Catalog 操作并删除 CONTRACT_ONLY 扩展；总操作数 176，严格 runtime drift gate 保持，generated types 同步。公共删除 blocker 增加 GEO_SUBJECT，既有前端仅补删除/审计文案和运行时枚举适配，没有 Catalog 页面。
- Application Service 拥有 Product→UUID 顺序品牌→Subject→子行锁序、锁后 identity/revision 校验、同态 no-op、精确 SQLSTATE/constraint 映射及业务/revision/成功审计同事务。读取采用 REPEATABLE READ 和批量投影；Product 身份读取当前事实，不保存副本。
- 子 Subject（包含停用）真实引用阻止删除；Product/User 删除接入 Catalog 引用。未来四个未建表引用域显式零并保留接入义务。十个审计动作只保存稳定目标 UUID 与 revision/is_active，删除后保留 tombstone。
- 读取在认证前关闭 autoflush，避免同 Cookie 的认证更新时间在 RR 快照内发生冲突；搜索词和当前 Product/显示名称共用 Unicode 规范化。flush 前保存唯一冲突的稳定身份，避免失败事务读取过期 ORM。39 项 Catalog 定向、466 项完整 PostgreSQL 集成及3轮独立只读复核通过；最低门禁和完整记录见 implement.md。
- 无新 Alembic revision、历史回填、生产迁移、外部 AI/DNS/HTTP 调用。当前 head 0044 的隔离前滚、API/并发/事务证据和最低验证命令结果见 GEO-104 implement.md；GEO-105 及后续能力未实施。

## GEO-103 Catalog Schema 与领域策略 — 2026-10-01（review）

- 依赖 GEO-101、GEO-102 均已人工接受 done；本任务按 planned→in_progress→review 交付，不自行 done。
- 实施闭合 Catalog 创建/PATCH/响应 Schema；拒绝未知类型、只读字段及 OWN_PRODUCT 事实副本，保留省略/null 意图。NFKC/Unicode 空白/casefold 保留型号区别；受控语言标签小写；IDNA2008/UTS #46 non-transitional + STD3 严格往返，非法输入显式失败且无网络调用。
- 无 I/O 的领域策略验证真实父子、自引用和别名候选歧义；显式完整引用计数形成 ADMIN/ENGINEER stage/actions/deletion。OWN_PRODUCT 从当前 Product 投影 identity/revision，不修改 Catalog 名称或 Subject revision。
- Pydantic 生成声明补齐 minProperties/条件与 hostname not，九个入口及所有引用与已接受根合同机器形状一致。修正前失败、修正后通过的合同保护、98 项定向、后端 953/前端 863 项单元、427 项 PostgreSQL 集成与静态检查见 GEO-103 implement.md；保留两条既有 metadata warning。
- 首次独立复核确认的声明机器形状 P2 已由最小修正及第二次 fresh 只读复核解除，执行审计与原始证据保留。
- 将现有 idna 3.18 声明为直接依赖，锁定包版本不变；无新 OpenAPI 操作或 Alembic revision，无历史回填、生产迁移或前端改动。GEO-104 CRUD/Router、页面及后续采集/分析/指标均未实施。

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
