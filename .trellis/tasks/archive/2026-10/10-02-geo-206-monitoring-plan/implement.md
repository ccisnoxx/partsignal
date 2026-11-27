# GEO-206 实施与验证证据

## 交付状态

分支 `geo/GEO-206`，实现和本地验证已完成，manifest 与 Trellis 均为 `review`，等待人工验收，未自行 `done`。没有提交、推送、发布或生产迁移。依赖 GEO-202、GEO-205 均在 manifest 为 done，Trellis completed 且人工接受记录已确认。GEO-207 及后续仍未实施。

## 读取与 preflight

根/后端/前端 AGENTS、Trellis workflow/spec、前置 task、根 OpenAPI/database、0045/0046 和相关维护源码/调用者/测试已读取；用户列出的 GEO 文档按结构与完整相关章节读取，WBS GEO-206 完整行及 Accepted ADR-001 已核对。编码前在会话输出十二项 preflight，并创建模板十九节 Task Brief。

当前 head=0046、没有 Plan 数据；目标为配置聚合。PRD 的产品/主题/观测面属于页面业务概念，领域/数据文档落实为 Subject/PromptVariant/Profile，没有无法消解的业务冲突。具体设计见 `design.md`。

## 实现与文件

新增 `GeoMonitoringPlan` 与 Subject/Prompt/Profile 三类关系，闭合 Create/完整 Update/Out/RevisionRequest 与角色/状态/调度枚举。状态 DISABLED/ACTIVE/PAUSED/ARCHIVED；repeat1..10 默认3；MANUAL_ONLY 默认，CRON 五字段；IANA 时区默认 Asia/Shanghai；预算 finite nonnegative numeric14,6 或 NULL；rule_set_revision 默认1；revision 默认0；双用户/时间追溯。

已有 Subject/Prompt/Profile/User 查询和删除 owner 接入真实 Plan 关系，前端仅 generated OpenAPI 类型和删除 blocker 文案。既有current-head迁移断言和列表固定批量查询预算随新契约更新，未弱化验证。

完整增量清单见 `evidence/changed-files.json`，起点差异见 `evidence/increment.patch`；这些证据排除了前置任务和未改动中文路径，不把整个 dirty 工作树归入本任务。

## 公共及数据库合同

根 OpenAPI 新增八个 Plan 数据组件，不新增 Plan operation、preview 或动作模型。既有 Prompt/Profile 删除 blocker 加 MONITORING_PLAN，Profile DELETE 登记 GEO_PROFILE_IN_USE；generated types 同步。相关领域/数据/API 文档说明当前配置边界，根 database 更新实际引用计数。

`0047_geo_monitoring_plans`（down_revision=`0046_geo_surfaces_profiles`）冻结本地 DDL，不导入运行时 ORM，仅新增四表/索引/命名 CHECK/PK/FK/函数/触发器，不回填、搬迁或改写旧行。Plan→关系 CASCADE 仅显式聚合删除；关系→资源 RESTRICT；creator/updater→User RESTRICT。归档标量及关系只读，创建身份不可变。

## 事务、锁与并发

三个集合属于一个配置一致性边界。DEFERRABLE INITIALLY DEFERRED constraint triggers 在提交时检查至少一个 PRIMARY/prompt/profile，允许同事务暂时空再替换；提前 SET CONSTRAINTS ALL IMMEDIATE 可验收最终集合。同资源关系 PK 唯一，Subject 角色不同也不能重复。

关系触发器先锁父 Plan，再同值 UPDATE 父行建立 MVCC 写冲突，不改变逻辑 revision、updated_at 或审计。真实并发测试观测 pg_blocking_pids：READ COMMITTED 下后到删除失败23514，REPEATABLE READ 下旧快照写失败40001，均保留一个 PRIMARY。不自动重试或吞错。未来 GEO-208 Service 拥有命令状态机、资源锁序、CAS/revision 一次递增和原子审计；206 没有 Plan Service/Router/幂等执行入口。

现有资源删除沿原锁序（Catalog、User→Topic→Variant、User→Surface→Profile），持锁预检真实引用，资源 FK KEY SHARE 与删除锁最终仲裁。仅新的精确23503+具名 FK 在对应 DELETE 映射409；未知错误保留失败，业务和成功审计回滚。

## 安全与前端

沿用内部单租户身份；追溯字段不作为用户归属，不接受客户端状态/identity/revision/creator/运行字段或秘密。没有新增权限、CSRF 例外、TLS/SSRF/凭据路径、Redis 载荷或外部请求。配置引用不锁存历史 first_referenced_at，不冻结 Prompt 编辑/启停或修改未来快照；停用/暂停/归档引用仍阻断资源删除。ENGINEER 的 Profile deletion 仍为 null。

前端不新增 Plan 页面、路由、query key、URL 状态或客户端状态机。现有页面只展示服务端 MONITORING_PLAN 删除说明；代码和 generated 类型一致。

## 基线与环境

初始 Docker default context 不可用、Colima 停止；记录后启动 Colima，使用专用 compose project `partsignal-geo206-validation`，PostgreSQL16=127.0.0.1:55446、Redis=56386、fake-oss=19006，显式 APP_ENV=test。本地测试凭据均为既有虚构测试配置；未使用真实 AI 平台。

- `UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_prompt_variant_contract.py backend/tests/unit/test_geo_surface_contract.py backend/tests/unit/test_contract.py`：129 passed，`baseline-unit.log`。
- `env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55446/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/integration/test_geo_prompt_variants.py backend/tests/integration/test_geo_surfaces_profiles.py`：61 passed，4 项既有 reflection warnings，`baseline-postgresql.log`。

## 实际验证

| 命令 | 最终/历史结果 | 日志 |
|---|---|---|
| `git diff --check` | 最终通过，exit0 | evidence/git-diff-check.final.log |
| `make contract-check` | 通过，runtime contract 和 generated 一致 | evidence/make-contract-check.cron-final.log |
| `make lint` | 通过，Ruff/ESLint | evidence/make-lint.cron-final.log |
| `make typecheck` | 通过，mypy109源码/tsc | evidence/make-typecheck.cron-final.log |
| `make test-unit` | 最终后端1185/前端993 passed，exit0 | evidence/make-test-unit.cron-final.log |
| `make test-integration COMPOSE='docker compose -p partsignal-geo206-validation -f .trellis/tasks/10-02-geo-206-monitoring-plan/evidence/validation-compose.yaml'` | 最终600 passed，8项reflection warnings，exit0 | evidence/make-test-integration.final.log |
| `env APP_ENV=test DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55446/partsignal_geo206_migration UV_CACHE_DIR=.cache/uv uv run --project backend alembic -c backend/alembic.ini upgrade head` | 专用空库从0001前滚0047，exit0 | evidence/migration-forward.log |
| `env APP_ENV=test PARTSIGNAL_TEST_DATABASE_URL=postgresql+psycopg://partsignal:partsignal_dev@127.0.0.1:55446/partsignal UV_CACHE_DIR=.cache/uv uv run --project backend pytest backend/tests/unit/test_geo_monitoring_plan_contract.py backend/tests/integration/test_geo_monitoring_plans.py backend/tests/integration/test_geo_plan_reference_api.py backend/tests/integration/test_geo_surfaces_profiles.py` | 124 passed，4项reflection warnings | evidence/focused.log |

指定全门禁源于用户明确要求，不从定向检查机械扩张。完整集成首次598 passed/2 failed（8项reflection warnings）：test_geo_questions_api固定查询数3→4批量计划引用、test_migrations固定head0046→0047过时断言；精确修正后两项定向通过，完整重跑600 passed/8 warnings。最后只改Cron词法与Schema单元，PG所覆盖的模型/DDL/服务/PG测试输入未变，复用完整PG证据；该词法最终由71项定向/1185项全后端单元和独立内存探针覆盖。原日志 evidence/make-test-integration.log 保留。

完整 E2E、build/verify、浏览器矩阵未运行：本任务没有新 Plan API/UI/导航/外部执行路径，既有删除可观察边界已用真实 API/PG 和全单元覆盖；不声称未运行门禁通过。生产迁移未执行。0046→0047 现有行保持、metadata一致、安全拒绝降级、CHECK、关系唯一、删除阻断、最终集合更新和并发已由定向 PG 验证。

## 首次失败及修正

- 初次 PG 定向23通过1失败：测试在 SET CONSTRAINTS ALL IMMEDIATE 后创建另一聚合，遗漏恢复 DEFERRED，立即检查正确拒绝空关系；测试恢复正确事务时序后通过，未放宽数据库约束。初次日志 `targeted-postgresql.initial.log`。
- 初次 mypy 拒绝 json_schema_extra 回调参数 dict[str,object]，按已安装类型定义改为 dict[str,Any]，公共 schema 不变；重跑 typecheck 通过，`make-typecheck.initial.log` 保留。
- 新测试初次 lint 有三处行长问题，限定新测试 Ruff format 后 lint 通过；初次 `make-lint.log` 保留。
- OpenAPI末尾生成空白行被git diff --check发现；去除末尾多余空白，YAML解析值前后严格相等，最终diff检查通过。修复脚本初次使用系统Python缺少yaml，切换已安装backend uv环境后完成；不影响运行代码。
- 既有0046迁移测试此前依赖动态 head；分离历史fixture固定0046，业务fixture继续当前head，保留0046 downgrade精确合同。当前与历史迁移均通过。

## 独立复核

使用 multi-agent-orchestration，validated WorkPlan、guard-dispatch 和持久化 high-risk Audit Bundle 已准备；fresh critical_reviewer、fork_turns=none、只读无写所有权，具体任务见 evidence/review-prompt.txt。第一轮发现两项P2输入契约问题，已按 evidence/review-1.md 修复，修前7失败/修后69通过，第二位fresh reviewer验证预算/真实FK无确认问题，但发现裸月份/星期字面量后的/step仍被截断（review-2.md）。主代理最小修正，补4负例/1合法命名范围步长；第三位fresh reviewer检查43词法负例/17数值语义负例/50正例及Schema/generated一致，没有确认缺陷（review-3.md）。第二轮按修正验收未通过rejected保留真实历史，最后一次通过；没有把运行完成当作候选接受。校验过的三阶段 Digest 位于 evidence/SUBAGENT_EXECUTION_DIGEST.json/.md，Bundle已闭合且audit-verify通过；audit_id=20261002T181713Z-geo-206-monitoring-plan-fa180bae，3独立复核/2接受/1历史rejected/无活跃或未知写入。复核任务验收不等于GEO任务人工done。

最终契约修复证据：`uv run --project backend pytest backend/tests/unit/test_geo_monitoring_plan_contract.py`：71 passed（plan-contract.cron-final.log）；修复范围加真实API及两项初始PG失败：69 passed（review-fixes.final.log）；这些是不同候选时点，不把旧数量写成最新。

审计digest已读取，六列表头/分隔/数据行检查通过；闭合Bundle包含3计划和20正式artifact，校验通过。Task Brief/设计/实施/evidence/task.json均保存；manifest仅206 planned→in_progress→review，依赖202/205 done和207 planned不变，completedAt=null。相关6份GEO文档的SHA256SUMS条目同步。

## 限制、恢复与后续

Cron 在 Schema 边界完整词法匹配后复用 Celery 检查数值/范围/步长，数据库只保证五字段结构；预算超精度由 Schema 拒绝，直接 SQL numeric 列按 PostgreSQL 标准精度行为。ZoneInfo/pg_timezone_names 使用各运行环境目录，部署须具备对应 tzdata。数据库最终防线不替代未来 Service 的业务权限、活动资格、状态转换和 revision/CAS。没有 Plan 端点可调用，不能宣称 AC-PLAN 全业务流程完成。

0047 downgrade 明确以55000安全停止；不自动删除新配置，使用前向修复或恢复迁移前备份。专用compose容器/网络/两个volume及其中测试数据库已移除，保留其他volume；Colima成功停止、Docker context恢复default，记录evidence/environment-cleanup.log。

下一任务 GEO-207 矩阵与资格预览，再由 GEO-208/209 接入计划命令和页面；Batch/Run 属于 GEO-301，均未实施。

## 实际修改文件列表

- [backend/alembic/versions/0047_geo_monitoring_plans.py](/Users/sc/PycharmProjects/partsignal/backend/alembic/versions/0047_geo_monitoring_plans.py)（新增）
- [backend/app/models/__init__.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/__init__.py)（修改）
- [backend/app/models/geo_monitoring_plans.py](/Users/sc/PycharmProjects/partsignal/backend/app/models/geo_monitoring_plans.py)（新增）
- [backend/app/schemas/geo_monitoring_plans.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_monitoring_plans.py)（新增）
- [backend/app/schemas/geo_prompt_variants.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_prompt_variants.py)（修改）
- [backend/app/schemas/geo_surface_management.py](/Users/sc/PycharmProjects/partsignal/backend/app/schemas/geo_surface_management.py)（修改）
- [backend/app/services/geo_catalog.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_catalog.py)（修改）
- [backend/app/services/geo_catalog_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_catalog_queries.py)（修改）
- [backend/app/services/geo_prompt_variant_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_prompt_variant_queries.py)（修改）
- [backend/app/services/geo_prompt_variants.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_prompt_variants.py)（修改）
- [backend/app/services/geo_surface_commands.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_surface_commands.py)（修改）
- [backend/app/services/geo_surface_projections.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_surface_projections.py)（修改）
- [backend/app/services/geo_surface_queries.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/geo_surface_queries.py)（修改）
- [backend/app/services/identity.py](/Users/sc/PycharmProjects/partsignal/backend/app/services/identity.py)（修改）
- [backend/tests/integration/test_geo_monitoring_plans.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_monitoring_plans.py)（新增）
- [backend/tests/integration/test_geo_plan_reference_api.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_plan_reference_api.py)（新增）
- [backend/tests/integration/test_geo_questions_api.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_questions_api.py)（修改）
- [backend/tests/integration/test_geo_surfaces_profiles.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_geo_surfaces_profiles.py)（修改）
- [backend/tests/integration/test_migrations.py](/Users/sc/PycharmProjects/partsignal/backend/tests/integration/test_migrations.py)（修改）
- [backend/tests/unit/test_geo_monitoring_plan_contract.py](/Users/sc/PycharmProjects/partsignal/backend/tests/unit/test_geo_monitoring_plan_contract.py)（新增）
- [contracts/database.md](/Users/sc/PycharmProjects/partsignal/contracts/database.md)（修改）
- [contracts/openapi.yaml](/Users/sc/PycharmProjects/partsignal/contracts/openapi.yaml)（修改）
- [docs/geo-monitoring/02-business/02-domain-model.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/02-business/02-domain-model.md)（修改）
- [docs/geo-monitoring/03-technical/02-data-architecture.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/02-data-architecture.md)（修改）
- [docs/geo-monitoring/03-technical/03-api-contract-design.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/03-technical/03-api-contract-design.md)（修改）
- [docs/geo-monitoring/04-delivery/task-manifest.yaml](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/04-delivery/task-manifest.yaml)（修改）
- [docs/geo-monitoring/CHANGELOG.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/CHANGELOG.md)（修改）
- [docs/geo-monitoring/README.md](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/README.md)（修改）
- [docs/geo-monitoring/SHA256SUMS](/Users/sc/PycharmProjects/partsignal/docs/geo-monitoring/SHA256SUMS)（修改）
- [frontend/src/domains/geo-catalog/surfaces.model.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-catalog/surfaces.model.ts)（修改）
- [frontend/src/domains/geo-questions/question-detail.tsx](/Users/sc/PycharmProjects/partsignal/frontend/src/domains/geo-questions/question-detail.tsx)（修改）
- [frontend/src/shared/api/generated/schema.d.ts](/Users/sc/PycharmProjects/partsignal/frontend/src/shared/api/generated/schema.d.ts)（修改）

另新增本任务 prd/design/implement/task.json 与 evidence，保留本任务起点、命令日志、复核记录和审计引用；未归档前置任务或改写其实现。32个维护文件的实际增量已逐项检查，没有删除旧文件、未接入回退、依赖升级、历史迁移改写或秘密暴露。

## 人工验收完成 — 2026-10-02

本会话用户明确表示：“我已经人工审查并接受 GEO-206 的实现与测试证据。”据此仅将 manifest 的 GEO-206 从 review 更新为 done，Trellis task.json 从 review 更新为 completed，completedAt=2026-10-02，并记录接受者、范围与依据；Task Brief 当前状态同步更新。

上述实施章节和原始 evidence 保留人工验收前的历史状态、实际测试结果与已知限制，不将未运行检查改写为通过。本次只记录 GEO-206 验收，不修改其他任务状态、不实施后续任务、不提交或归档。SHA256SUMS 仅同步 manifest 对应条目。

本次收尾运行 git diff --check，实际结果见本轮最终报告；不重跑实现阶段测试。
