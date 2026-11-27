# GEO-103 实施与验证证据

## 当前状态

GEO-103 / R1，主代理实现。依赖 GEO-101/102 均已人工接受 done；本任务已按 planned→in_progress→review 完成本地实现、验证、独立复核及文档收尾，等待人工接受，不自行 done。分支 geo/GEO-103；没有提交、推送、生产迁移或发布。编码前 12 项 preflight 已在会话输出，Task Brief 按 19 项模板创建。

## 已实现范围

- Schema：闭合类型、创建/更新、Alias/Domain、revision、列表/详情及 typed actions/blockers/references；拒绝只读字段和事实副本，PATCH 省略与明确 null 不混淆。
- 规范化：NFKC / Unicode 空白折叠 / casefold；保留标点、连字符、型号后缀，检查规范键长度扩张；受控语言标签小写。直接声明现有 idna 3.18，不升级任何已锁定包版本；IDNA2008+UTS #46 non-transitional/STD3 和 A-label 往返，不执行网络。
- 领域：真实父子合法类型、产品身份、别名活动候选去重及歧义显式失败；ADMIN/ENGINEER stage/actions/deletion 单一 owner，五类引用全部显式传入，不能默认零。
- 投影：显式接收 ORM 及已加载关联，逐字段 DTO 转换，验证 Subject/Product/parent/子项关联；OWN_PRODUCT 名称来自当前 Product，事实正文不输出，不写 ORM 或递增 Subject revision。

无 CRUD write service/Router/页面、Batch/Run、采集、指标/机会或 Redis 业务消息；GEO-104 与以后任务保持 planned。根 OpenAPI 操作/Schema 语义和 generated types 没有本任务修改。无新 Alembic revision、索引、列或历史数据迁移；45 项既有版本文件/冻结快照字节不变。

## 修改文件清单

| 文件 | 本任务变化 |
|---|---|
| backend/app/schemas/geo_catalog.py | 新增闭合协议模型、规范化边界、PATCH 意图及完整生成声明 |
| backend/app/services/geo_catalog_normalization.py | 新增无 I/O 文本/语言/IDNA 规范化 owner |
| backend/app/services/geo_catalog_policy.py | 新增父子/身份/歧义、角色动作/删除策略及完整领域引用计数 |
| backend/app/services/geo_subjects.py | 新增显式 ORM→DTO 投影，读取当前 Product 且不写库 |
| backend/tests/unit/test_geo_catalog_schema.py | 请求正反例、IDNA、PATCH、生成声明机器形状及两侧反例 |
| backend/tests/unit/test_geo_catalog_policy.py | 25 种父子组合、未知/自引用、歧义与角色/引用动作 |
| backend/tests/unit/test_geo_catalog_projection.py | ORM 实例、关联边界、Product 无事实副本、角色及两侧声明验证 |
| backend/pyproject.toml / backend/uv.lock | idna 直接声明；已锁定包版本不变 |
| contracts/database.md | 只更新 Schema/领域策略实施状态与证据链接，DDL/业务合同不变 |
| docs/geo-monitoring/README.md / CHANGELOG.md | 本任务交付导航和记录；README 同步已接受的依赖状态 |
| docs/geo-monitoring/03-technical/02-data-architecture.md | Schema/投影已实施与 GEO-104 查询/事务责任边界 |
| docs/geo-monitoring/04-delivery/03-requirement-traceability-matrix.md | 已覆盖 Schema/策略与尚未覆盖 CRUD/页面/快照的区别 |
| docs/geo-monitoring/04-delivery/task-manifest.yaml / SHA256SUMS | 仅 GEO-103 状态/证据及五份受影响文档哈希 |
| .trellis/tasks/10-01-geo-103-catalog-policy | Task Brief、设计、资料索引、实施记录及原始验证/审计证据 |

所有新人工维护源码均小于 500 行。既存工作树差异按起始指纹保留，不能把 git 对 HEAD 的前序差异算入本任务。

## 已取得的基线与执行结果

所有结果来自实际工具退出码和原始日志；evidence/validation-results.json 记录精确命令，不把未运行检查写成通过。

| 命令 | 结果 | 原始日志 |
|---|---|---|
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py backend/tests/unit/test_geo_catalog_metadata.py backend/tests/unit/test_contract.py backend/tests/unit/test_contract_check.py | 基线 163 passed | baseline.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_schema.py backend/tests/unit/test_geo_catalog_policy.py backend/tests/unit/test_geo_catalog_projection.py | 首次 96 passed；Schema 修正后 98 passed | targeted-final.log / targeted-schema-corrected.log |
| make lint | Ruff + ESLint 通过 | make-lint-final.log |
| make typecheck | mypy 85 个 source files + tsc 通过 | make-typecheck-corrected.log |
| make test-unit | 最终后端 953、前端 863 / 92 files 通过 | make-test-unit-final.log |
| make contract-check | runtime 契约 / generated types 通过 | make-contract-check.log |
| git diff --check | 通过；另检查19项自有源码/文档的未跟踪文件空白 | diff-check-final.log / final-scope-audit.json |
| sh -c 'cd docs/geo-monitoring && shasum -a 256 -c SHA256SUMS' | 全部113项通过 | docs-check-final.log |
| UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_catalog_contract.py | 文档更新后29 passed | catalog-contract-final.log |
| make test-integration COMPOSE='docker compose --env-file .env.example -p partsignal-geo103-validation -f deploy/compose.dev.yaml -f .trellis/tasks/10-01-geo-103-catalog-policy/evidence/compose-validation.yaml' | 427 passed，2 条既有 SAWarning，无 skipped | make-test-integration.log |
| env DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@localhost:55439/geo103_validation UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini upgrade head | 隔离空库前滚到既有 0044_geo_catalog | alembic-upgrade.log / postgresql-head.json |

静态与完整单元结果已在补齐 Schema 元数据后复验。完整集成输入中无新增 Router/DB/旧服务变化；最终修正仅未接线的 Catalog 声明及类型注解、共享原 IP regex 常量和单元保护，不影响任何 integration 消费边界，故复用已经成功的完整 PostgreSQL 集成证据，不重复运行五分钟全套。测试数据库版本为 PostgreSQL 16.15，Compose project/network/volumes 均专属 partsignal-geo103-validation，仅加载 .env.example。测试服务使用缓存镜像与源码 bind mount；没有修改部署配置、访问生产、真实 AI 或真实 OSS。执行后删除专属容器/卷/网络；确认没有其他运行容器后，恢复本次启动的 Colima 为停止状态，见 validation-cleanup.log、containers-after-cleanup.txt、colima-restore.log。

两条 SAWarning 来自已接受 GEO-102 metadata 测试：旧非 Catalog 表有 FK 环、反射含 dialect_options。427 项测试通过，未吞警告或宣称全部旧 metadata 已无问题。

## 早期诊断与修正

初次定向测试收集失败：Pydantic 默认 Rust regex 不支持根合同 hostname lookahead；改用编译后的 Python re 表达式，保留原 pattern。第二次一项“超长 IDNA”测试实际为合法的 247 字节 ASCII 主机名；将每标签 é 从 55 改为 57，形成编码后 255 字节且 raw 231 字符的真实反例，生产校验没有放宽。原始 targeted-initial.log / targeted-fixed.log 保留。

在 runtime API contract-check 之外，对新 Pydantic 生成 Schema 额外运行机器 shape 诊断，发现尚缺 minProperties/条件 allOf 以及多余 nullable default 元数据；相关实例校验和投影行为已通过，但声明也必须符合根公共合同。诊断见 schema-parity-diagnostic.json。已补齐元数据和定向合同保护，不改已接受公共语义。新增机器对照测试在旧实现先失败（schema-parity-before-fix.log），修正后 9 个公共入口及全部引用的完整 failure list 为 []（schema-parity-after-fix.log）；空 PATCH、非法品牌 parent、stage/parent 摘要反例在根合同及生成 Schema 两侧均拒绝，真实请求 dump/ORM 投影两侧接受。

元数据初次 typecheck 报 7 项递归 JSON dict 推断不兼容；按已安装 Pydantic ConfigDict 的 JsonDict 合同给三份条件字典加精确类型注解，未新增 ignore/cast 或放宽校验，make-typecheck-corrected.log 通过。首次和修正日志均保留。

## 并发、安全与未覆盖部分

本任务纯读取/计算，无 Session、事务、commit、锁、CAS、幂等重放或外部 I/O。非法真实父子抛 409 GEO_SUBJECT_PARENT_INVALID 并定位 body.parent_subject_id；Schema ValueError/enum/extra 在未来 HTTP 接线映射 422；别名歧义是带完整候选 ID 的领域失败，不引入新 HTTP code。精确 SQLSTATE/constraint 映射及成功审计属于 GEO-104，没有宽泛吞 IntegrityError。

权限动作仅为投影，不能代替后续命令授权。没有放宽 session/CSRF、SSRF/TLS、凭据、历史不可变或审计；created_by 不接受客户端输入。引用计数由未来一致批量查询提供，未知不能猜零。本任务不实现 Product/User 生命周期接线；FK 的最终防线及其现有集成证据保留。

未运行 make verify、build、浏览器 E2E/矩阵或真实平台探针：没有页面、部署、Router 或外部集成变化，最低命令分别执行。未迁移生产库或演练生产备份恢复；无本任务数据库变更。前端页面、路由、query key 与 URL 状态均无改动；生成类型仍只来自根合同。

## 独立复核与收尾

首次 fresh critical_reviewer /root/geo103_catalog_review 确认1项P2：请求/投影实际行为正确，但生成声明尚缺公共合同条件，不能把未来Router未接线当作Schema已完成。主代理按安全方向修正声明及保护测试，随后第二次 fresh critical_reviewer /root/geo103_schema_correction_review 独立确认阻断解除，无新增确认问题。两次报告和前后11项只读指纹核对见 evidence/independent-review-initial.md、independent-review-corrected.md、review-write-evidence.json、review-corrected-write-evidence.json。第二次独立内存验证9入口/30组件机器failure=[]，22反例拒绝、31正例接受；未重复执行pytest或外部I/O。

Audit Bundle：20261002T062023Z-geo-103-catalog-review-d852ceb3。两份 plan/guard、实际 dispatch 与 runtime/task_outcome 分开记录；本地工具生成 SUBAGENT_EXECUTION_DIGEST.json/md 并关闭、离线校验 Bundle，passed，无审计异常。摘要记录2次复核报告验收，不代表主任务已获用户接受。复核代理均没有写入；自查不冒充独立复核。

evidence/final_audit.py 与 final-scope-audit.json 确认：7个新源码/测试、9个既有文件的本任务修改，其他初始哈希输入未改写或丢失；45个冻结迁移/快照无变化；OpenAPI与generated类型相对任务开始不变；manifest仅GEO-103记录改变，依赖均done、104仍planned；19项自有文档/源码无空白问题。精确作用域diff保存在 evidence/task-diff.patch。

首次范围脚本把初始哈希遗漏的5个已跟踪中文旧文档误算作新文件，检查明确失败；改用Git NUL分隔的tracked/untracked清单后正确归类，并补充初始dirty列表为空、最终HEAD diff为空的证据。原初始哈希不补写/伪造，这5个旧文档未被本任务编辑。

Trellis资料索引已校验；自动注入提示三份大型合同/spec可能截断，不能把索引当阅读证据，实际已手动完整读取Catalog权威章节与必要规范。状态review、completedAt=null、commit/PR=null；无提交、推送、生产操作或归档。数据库样例隔离资源已清理，Colima恢复初始停止状态。

## 后续任务及限制

人工接受本任务后，GEO-104再检查依赖并实现CRUD/Application Service/Router、批量一致读取/引用查询、锁内revision重验/CAS、精确数据库错误映射、审计及Product/User生命周期。纯策略的references必须由该调用服务真实提供，不能按当前页推算或猜零。随后页面与历史快照按各自任务推进；本轮不启动任何后续任务。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-103 的实现与测试证据。”据此仅将 manifest 的 GEO-103 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，并记录完成日期、接受者、范围和依据；Task Brief 的当前状态同步更新。

以上实施章节和原始 evidence 保留提交人工验收时的历史状态、测试结果及边界，不把未运行检查改写为通过。人工接受不表示尚未实施的 GEO-104 CRUD/Service/API/UI 或后续任务已完成。本次不修改其他任务状态，不实现后续任务，不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾检查执行 git diff --check，并另检查五个收尾文件的未跟踪文件空白；结果见本轮最终收尾报告。
